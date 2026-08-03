import type { CreditMethods, ICreditLedger } from '@librechat/data-schemas';
import type { Effort } from './pricing';
import {
  ACTION_SIMPLE_QUESTION,
  GRANT_EXPIRY_DAYS,
  GRANT_SIZES,
  PRICE_LIST_VERSION,
  getActionPrice,
  getUpgradePrice,
} from './pricing';

/**
 * ai-aflat credit service: the price list on one side, the ledger primitives on the
 * other. Nothing here touches the database directly.
 */

export type JobOutcome = 'answered' | 'clarification' | 'empty' | 'failed';

export interface HoldForActionParams {
  userId: string;
  jobId: string;
  effort: Effort;
  actionType?: string;
}

export interface UpgradeHoldParams {
  userId: string;
  jobId: string;
  from: Effort;
  to: Effort;
  actionType?: string;
}

function grantExpiry(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/**
 * The welcome grant. Ten normal questions is enough to form a real opinion of the
 * product, which is the entire job of this grant.
 *
 * Callers must only reach this once the user's email is verified — 100 credits per
 * throwaway account is the prize account farmers are actually after.
 */
export async function grantSignupBonus(
  methods: CreditMethods,
  userId: string,
): Promise<ICreditLedger | null> {
  return methods.grantCredits({
    userId,
    credits: GRANT_SIZES.signup_bonus,
    reasonCode: 'signup_bonus',
    expiresAt: grantExpiry(GRANT_EXPIRY_DAYS),
    idempotencyKey: `signup_bonus:${userId}`,
    priceListVersion: PRICE_LIST_VERSION,
  });
}

/**
 * The monthly refill, which keeps the casual citizen served forever without ever
 * meeting a paywall.
 *
 * It tops *up to* a ceiling rather than adding unconditionally, so a user who never
 * opens the app does not accumulate a year of credits to dump at once. The
 * idempotency key is month-scoped, so a re-run of the job in the same month is a
 * no-op rather than a second refill.
 */
export async function runMonthlyRefill(
  methods: CreditMethods,
  userId: string,
  period: string,
): Promise<ICreditLedger | null> {
  const { available } = await methods.getCreditBalance(userId);
  const headroom = GRANT_SIZES.refill_ceiling - available;
  if (headroom <= 0) {
    return null;
  }

  const credits = Math.min(GRANT_SIZES.monthly_refill, headroom);
  return methods.grantCredits({
    userId,
    credits,
    reasonCode: 'monthly_refill',
    expiresAt: grantExpiry(GRANT_EXPIRY_DAYS),
    idempotencyKey: `monthly_refill:${userId}:${period}`,
    priceListVersion: PRICE_LIST_VERSION,
  });
}

/** `YYYY-MM` in UTC — the refill's idempotency period. */
export function currentRefillPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Reserve the price of a question before the job starts.
 *
 * Throws `InsufficientCreditsError` rather than starting a job it cannot pay for:
 * a shortfall must block *before* retrieval, never truncate an answer in flight,
 * because a half-grounded answer is worse than no answer on this product.
 */
export async function holdForAction(
  methods: CreditMethods,
  { userId, jobId, effort, actionType = ACTION_SIMPLE_QUESTION }: HoldForActionParams,
): Promise<ICreditLedger> {
  return methods.holdCredits({
    userId,
    credits: getActionPrice(actionType, effort),
    reasonCode: actionType,
    actionType,
    effort,
    jobId,
    priceListVersion: PRICE_LIST_VERSION,
  });
}

/** Re-running an answer deeper charges only the difference; the context is reused. */
export async function holdForUpgrade(
  methods: CreditMethods,
  { userId, jobId, from, to, actionType = ACTION_SIMPLE_QUESTION }: UpgradeHoldParams,
): Promise<ICreditLedger | null> {
  const credits = getUpgradePrice(actionType, from, to);
  if (credits <= 0) {
    return null;
  }
  return methods.holdCredits({
    userId,
    credits,
    reasonCode: 'effort_upgrade',
    actionType,
    effort: to,
    jobId,
    priceListVersion: PRICE_LIST_VERSION,
  });
}

/**
 * Terminate a hold according to what the job actually produced.
 *
 * **Only `answered` is billable.** A clarifying question the system asked, an empty
 * retrieval and an outright failure all release. An absent or unrecognised outcome
 * is treated as `failed` — the fallback must always be "do not charge", because a
 * user charged for a non-answer on a legal product loses trust we cannot buy back.
 */
export async function settleForOutcome(
  methods: CreditMethods,
  holdId: string,
  outcome: JobOutcome | undefined | null,
): Promise<ICreditLedger | null> {
  if (outcome === 'answered') {
    return methods.settleHold(holdId);
  }
  const reasonCode = outcome ?? 'failed';
  return methods.releaseHold(holdId, `not_answered:${reasonCode}`);
}
