import type Stripe from 'stripe';
import { getStripe } from './client';
import { getVatRate } from './config';
import { baniToMicroRon, costBasisPerCredit } from './basis';
import type { PaymentDeps } from './webhook';

export interface ReconcileReport {
  examined: number;
  corrected: number;
  /** Lots already spent against, which must not be rewritten — see `correctLotCostBasis`. */
  skippedSpent: number;
  /** Balance transaction still not available; will be retried on the next pass. */
  stillPending: number;
}

async function feeForIntent(paymentIntentId: string): Promise<number | null> {
  const intent: Stripe.PaymentIntent = await getStripe().paymentIntents.retrieve(paymentIntentId, {
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
 * Replaces estimated cost bases with the real ones.
 *
 * Deviation #2 of the payments design is the reason this exists: credits are
 * granted the instant a payment completes, on an estimated fee, because Stripe's
 * balance transaction is often not ready yet and no buyer should wait on our
 * bookkeeping. This pass closes the gap afterwards.
 *
 * It is safe to run repeatedly and safe to never run — an unreconciled purchase
 * carries a slightly wrong cost basis, which distorts margin reporting and nothing
 * else. No user-visible balance depends on it.
 */
export async function reconcileCostBases(
  methods: PaymentDeps,
  limit = 100,
): Promise<ReconcileReport> {
  const pending = await methods.listPendingCostBasis(limit);
  const report: ReconcileReport = {
    examined: pending.length,
    corrected: 0,
    skippedSpent: 0,
    stillPending: 0,
  };

  for (const payment of pending) {
    if (!payment.stripePaymentIntent || !payment.lotId) {
      report.stillPending += 1;
      continue;
    }

    const feeMicroRon = await feeForIntent(payment.stripePaymentIntent);
    if (feeMicroRon === null) {
      report.stillPending += 1;
      continue;
    }

    const costBasisMicroRon = costBasisPerCredit({
      grossMicroRon: payment.grossMicroRon,
      feeMicroRon,
      credits: payment.credits,
      vatRate: getVatRate(),
    });

    const corrected = await methods.correctLotCostBasis(payment.lotId, costBasisMicroRon);
    if (!corrected) {
      /**
       * Spent before we could correct it. Clearing the flag is deliberate: retrying
       * forever would never succeed, and the estimate is what the allocations
       * actually recorded, so it is now the truthful figure for this lot.
       */
      report.skippedSpent += 1;
      await methods.clearCostBasisPending(payment._id);
      continue;
    }

    await methods.clearCostBasisPending(payment._id);
    report.corrected += 1;
  }

  return report;
}
