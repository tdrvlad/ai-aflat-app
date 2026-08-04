import type Stripe from 'stripe';
import type { CreditMethods, PaymentMethods, IPayment } from '@librechat/data-schemas';
import { getStripe } from './client';
import { getStripeWebhookSecret, getVatRate } from './config';
import { baniToMicroRon, costBasisPerCredit, estimateFeeMicroRon } from './basis';

export type PaymentDeps = CreditMethods & PaymentMethods;

export interface WebhookResult {
  received: true;
  /** False when the event was a replay, or a type we deliberately ignore. */
  processed: boolean;
  eventType: string;
}

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

/**
 * Verifies the Stripe signature over the **raw** request body.
 *
 * This is the entire authentication of the webhook. The endpoint is
 * unauthenticated by necessity — Stripe cannot hold a JWT — so anyone on the
 * internet can POST to it, and only this check stands between that and free
 * credits. It must run against unparsed bytes; a body that has been through
 * `express.json()` will not verify, however identical it looks.
 */
export function constructEvent(rawBody: Buffer | string, signature: string): Stripe.Event {
  try {
    return getStripe().webhooks.constructEvent(rawBody, signature, getStripeWebhookSecret());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'signature verification failed';
    throw new WebhookSignatureError(message);
  }
}

/**
 * Stripe's real fee for a completed session, in micro-lei.
 *
 * Returns null when the balance transaction is not yet available — it is created
 * asynchronously and frequently is not ready at `checkout.session.completed`.
 * Callers grant on an estimate in that case rather than making the buyer wait.
 */
async function resolveActualFee(session: Stripe.Checkout.Session): Promise<number | null> {
  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;

  if (!paymentIntentId) {
    return null;
  }

  const intent = await getStripe().paymentIntents.retrieve(paymentIntentId, {
    expand: ['latest_charge.balance_transaction'],
  });

  const charge = intent.latest_charge;
  if (!charge || typeof charge === 'string') {
    return null;
  }

  const balanceTransaction = charge.balance_transaction;
  if (!balanceTransaction || typeof balanceTransaction === 'string') {
    return null;
  }

  return baniToMicroRon(balanceTransaction.fee);
}

/**
 * Turns a completed checkout into credits. The only path in the system that does.
 *
 * The success redirect deliberately grants nothing, so a buyer who closes the tab
 * mid-redirect still receives what they paid for — losing a customer's money to a
 * closed browser tab is the classic way prepaid-credit integrations fail.
 */
async function handleCheckoutCompleted(
  methods: PaymentDeps,
  event: Stripe.Event,
): Promise<boolean> {
  const session = event.data.object as Stripe.Checkout.Session;

  const payment = await findPayment(methods, session);
  if (!payment) {
    throw new Error(`No payment row for checkout session ${session.id}`);
  }

  if (payment.status === 'paid') {
    return false;
  }

  if (session.payment_status !== 'paid') {
    return false;
  }

  const actualFee = await resolveActualFee(session);
  const costBasisPending = actualFee === null;
  const feeMicroRon = actualFee ?? estimateFeeMicroRon(payment.grossMicroRon);

  const costBasisMicroRon = costBasisPerCredit({
    grossMicroRon: payment.grossMicroRon,
    feeMicroRon,
    credits: payment.credits,
    vatRate: getVatRate(),
  });

  const entry = await methods.grantCredits({
    userId: payment.userId,
    credits: payment.credits,
    reasonCode: 'purchase_bundle',
    source: 'purchase',
    costBasisMicroRon,
    /** Purchased credits never expire — the honest posture, and it avoids EU consumer-law trouble. */
    expiresAt: null,
    refId: session.id,
    idempotencyKey: `stripe_evt_${event.id}`,
    priceListVersion: payment.priceListVersion,
    note: `bundle:${payment.bundleId}`,
  });

  if (!entry) {
    return false;
  }

  /**
   * A purchase opens exactly one lot, so this allocation always exists. If it ever
   * does not, the grant and the payment row have diverged and that must surface
   * loudly rather than be written as an undefined lot reference.
   */
  const lotId = entry.allocations[0]?.lotId;
  if (!lotId) {
    throw new Error(`Grant for payment ${String(payment._id)} produced no lot allocation`);
  }

  await methods.markPaymentPaid({
    paymentId: payment._id,
    lotId,
    stripePaymentIntent:
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (session.payment_intent?.id ?? null),
    costBasisPending,
  });

  return true;
}

async function findPayment(
  methods: PaymentDeps,
  session: Stripe.Checkout.Session,
): Promise<IPayment | null> {
  const paymentId = session.metadata?.paymentId ?? session.client_reference_id;
  if (paymentId) {
    const byId = await methods.findPaymentById(paymentId);
    if (byId) {
      return byId;
    }
  }
  return methods.findPaymentBySessionId(session.id);
}

async function handleSessionExpired(methods: PaymentDeps, event: Stripe.Event): Promise<boolean> {
  const session = event.data.object as Stripe.Checkout.Session;
  const payment = await findPayment(methods, session);
  if (!payment || payment.status !== 'pending') {
    return false;
  }
  await methods.setPaymentStatus(payment._id, 'expired');
  return true;
}

async function handlePaymentFailed(methods: PaymentDeps, event: Stripe.Event): Promise<boolean> {
  const intent = event.data.object as Stripe.PaymentIntent;
  const paymentId = intent.metadata?.paymentId;
  if (!paymentId) {
    return false;
  }
  const payment = await methods.findPaymentById(paymentId);
  if (!payment || payment.status !== 'pending') {
    return false;
  }
  await methods.setPaymentStatus(payment._id, 'failed');
  return true;
}

/**
 * A refund is recorded and flagged; it does **not** claw back credits.
 *
 * Reversing a balance that has already been spent on answers is a support
 * judgement, not something to automate — the ledger takes a `reversal` entry when
 * a human decides it should. Doing it automatically would let a refund drive a
 * balance negative on credits already consumed.
 */
async function handleRefund(methods: PaymentDeps, event: Stripe.Event): Promise<boolean> {
  const charge = event.data.object as Stripe.Charge;
  const paymentId = charge.metadata?.paymentId;
  if (!paymentId) {
    return false;
  }
  const payment = await methods.findPaymentById(paymentId);
  if (!payment) {
    return false;
  }
  await methods.setPaymentStatus(payment._id, 'refunded');
  return true;
}

const HANDLERS: Record<string, (methods: PaymentDeps, event: Stripe.Event) => Promise<boolean>> = {
  'checkout.session.completed': handleCheckoutCompleted,
  'checkout.session.expired': handleSessionExpired,
  'payment_intent.payment_failed': handlePaymentFailed,
  'charge.refunded': handleRefund,
};

/**
 * Processes one verified Stripe event, exactly once.
 *
 * Replay protection is two-layered on purpose. `claimPaymentEvent` stops any event
 * being handled twice, and `grantCredits`'s idempotency key stops a grant landing
 * twice even if the first layer were bypassed. Stripe retries on any non-2xx, so
 * "this will be delivered more than once" is the normal case, not the edge one.
 */
export async function processEvent(
  methods: PaymentDeps,
  event: Stripe.Event,
): Promise<WebhookResult> {
  const handler = HANDLERS[event.type];
  if (!handler) {
    return { received: true, processed: false, eventType: event.type };
  }

  const claimed = await methods.claimPaymentEvent(event.id, event.type);
  if (!claimed) {
    return { received: true, processed: false, eventType: event.type };
  }

  try {
    const processed = await handler(methods, event);
    await methods.completePaymentEvent(event.id, true, null);
    return { received: true, processed, eventType: event.type };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await methods.completePaymentEvent(event.id, false, message);
    throw error;
  }
}
