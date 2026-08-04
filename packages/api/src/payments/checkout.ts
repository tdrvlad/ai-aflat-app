import type Stripe from 'stripe';
import type { PaymentMethods, IPayment } from '@librechat/data-schemas';
import { PRICE_LIST_VERSION, getBundle } from '../credits/pricing';
import { MICRO_RON, microRonToBani } from './basis';
import { getStripe } from './client';
import { CONSENT_VERSION, CURRENCY, getCancelUrl, getSuccessUrl } from './config';

export interface CreateCheckoutParams {
  userId: string;
  bundleId: string;
  /**
   * The buyer's explicit consent to immediate performance and to losing the 14-day
   * withdrawal right. Required — see `assertConsent`.
   */
  consentImmediatePerformance: boolean;
  email?: string | null;
}

export interface CheckoutResult {
  url: string;
  paymentId: string;
}

export class CheckoutError extends Error {
  constructor(
    message: string,
    readonly code: 'unknown_bundle' | 'consent_required',
  ) {
    super(message);
    this.name = 'CheckoutError';
  }
}

/**
 * EU digital content carries a 14-day withdrawal right unless the buyer explicitly
 * consents to immediate performance and acknowledges losing it. Credits are usable
 * the instant they land, so without this consent every purchase would be
 * refundable for a fortnight regardless of how many questions it had already
 * answered.
 *
 * Stripe has no field for this. It is ours to capture, ours to store, and ours to
 * produce if it is ever challenged — which is why the refusal is here, before a
 * session exists, rather than a checkbox the frontend merely renders.
 */
function assertConsent(consented: boolean): void {
  if (!consented) {
    throw new CheckoutError(
      'Consent to immediate performance is required before purchase',
      'consent_required',
    );
  }
}

/**
 * Opens a Stripe Checkout session for one bundle.
 *
 * The bundle id is a lookup key against the server's own price list and nothing
 * more; no amount from the request is ever read. A client that can name its own
 * price can buy 2500 credits for a leu.
 *
 * The `payment` row is written **before** the Stripe session, so a consent record
 * exists even for a session the user abandons, and so the webhook always has a row
 * to find.
 */
export async function createCheckoutSession(
  methods: PaymentMethods,
  { userId, bundleId, consentImmediatePerformance, email }: CreateCheckoutParams,
): Promise<CheckoutResult> {
  assertConsent(consentImmediatePerformance);

  const bundle = getBundle(bundleId);
  if (!bundle) {
    throw new CheckoutError(`Unknown bundle: ${bundleId}`, 'unknown_bundle');
  }

  const grossMicroRon = bundle.priceRon * MICRO_RON;

  const payment: IPayment = await methods.createPayment({
    userId,
    bundleId: bundle.id,
    credits: bundle.credits,
    grossMicroRon,
    priceListVersion: PRICE_LIST_VERSION,
    consentVersion: CONSENT_VERSION,
    consentAt: new Date(),
  });

  const paymentId = String(payment._id);
  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    /**
     * `payment_method_types` is deliberately **omitted**. Leaving it unset is what
     * makes Checkout use the methods enabled in the Stripe Dashboard, which is what
     * turns enabling Revolut Pay into a toggle rather than a deploy. Listing methods
     * here would silently override the dashboard and pin us to cards forever.
     */
    customer_email: email ?? undefined,
    client_reference_id: paymentId,
    /** The webhook reads these; it must never have to infer who paid for what. */
    metadata: {
      paymentId,
      userId,
      bundleId: bundle.id,
      credits: String(bundle.credits),
      priceListVersion: PRICE_LIST_VERSION,
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          unit_amount: microRonToBani(grossMicroRon),
          /**
           * Inline rather than a pre-created Stripe Price: `pricing.ts` stays the
           * single source of truth, there is no id to keep in sync, and a reprice
           * is a one-line change plus a version bump. The price list is expected to
           * change once real cost data exists, so removing a drift surface matters
           * more here than usual.
           */
          product_data: {
            name: `${bundle.credits} credite ai-aflat`,
            description: 'Credite pentru întrebări despre legislația din România.',
          },
          /** Romanian law requires displayed prices to include VAT. */
          tax_behavior: 'inclusive',
        },
      },
    ],
    success_url: getSuccessUrl(),
    cancel_url: getCancelUrl(),
  });

  await methods.attachStripeSession(paymentId, session.id);

  if (!session.url) {
    throw new Error('Stripe returned a checkout session without a url');
  }

  return { url: session.url, paymentId };
}

export type CheckoutSession = Stripe.Checkout.Session;
