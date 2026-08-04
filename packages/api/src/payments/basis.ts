/**
 * ai-aflat: what a purchased credit actually cost us to sell.
 *
 * The credit design turns on every credit carrying a cost basis in RON — grants
 * carry zero, purchases carry the real net — because that is the only thing that
 * can answer "what is the free tier costing us" and "which users lose money".
 * A modelled basis would make those reports confident and wrong, so the figure
 * here comes from Stripe's actual balance transaction wherever possible.
 *
 * Everything is integer **micro-lei** (1 leu = 1_000_000), matching `creditLot`.
 * Floating-point currency drifts and there is nothing here needing sub-micro
 * precision.
 */

/** 1 leu, in micro-lei. */
export const MICRO_RON: number = 1_000_000;

/** Stripe reports RON amounts in bani (minor units). 1 ban = 10_000 micro-lei. */
export const MICRO_RON_PER_BAN: number = MICRO_RON / 100;

export interface CostBasisParams {
  /** VAT-inclusive amount charged, in micro-lei. */
  grossMicroRon: number;
  /** Stripe's real processing fee for this charge, in micro-lei. */
  feeMicroRon: number;
  /** Credits the purchase delivers. */
  credits: number;
  /** e.g. 0.21 for 21%. Configuration, never a literal at a call site. */
  vatRate: number;
}

export function baniToMicroRon(bani: number): number {
  return Math.round(bani * MICRO_RON_PER_BAN);
}

export function microRonToBani(microRon: number): number {
  return Math.round(microRon / MICRO_RON_PER_BAN);
}

/**
 * The VAT contained in a VAT-inclusive gross. Romanian law requires displayed
 * prices to include VAT, so the bundle price is the gross and the tax is extracted
 * from it rather than added to it — `gross × rate` would overstate it by a factor
 * of `1 + rate`.
 */
export function vatFromGross(grossMicroRon: number, vatRate: number): number {
  if (vatRate <= 0) {
    return 0;
  }
  return Math.round((grossMicroRon * vatRate) / (1 + vatRate));
}

/**
 * Net revenue per credit: gross, less Stripe's cut, less the VAT we merely collect
 * on the state's behalf and never own.
 *
 * Rounds **down**. A basis that overstates what we kept would flatter every margin
 * report built on it, and these figures exist precisely to be trusted when the
 * price list is revisited.
 */
export function costBasisPerCredit({
  grossMicroRon,
  feeMicroRon,
  credits,
  vatRate,
}: CostBasisParams): number {
  if (credits <= 0) {
    throw new Error('costBasisPerCredit requires a positive credit count');
  }

  const vat = vatFromGross(grossMicroRon, vatRate);
  const net = grossMicroRon - feeMicroRon - vat;

  if (net <= 0) {
    return 0;
  }

  return Math.floor(net / credits);
}

/**
 * The fallback used when Stripe's balance transaction is not yet available at the
 * moment the webhook fires. Credits are granted immediately against this estimate
 * and the row is flagged `costBasisPending`; the reconciliation pass replaces it
 * with the real figure.
 *
 * Delaying someone's credits over an accounting detail is the worse failure, and a
 * basis that is briefly approximate is recoverable in a way that a customer who
 * paid and received nothing is not.
 *
 * These were taken from the business model's assumption of 1.4% + 1.25 lei.
 *
 * **The first real reconciliation showed that assumption is optimistic**: a 29 lei
 * charge cost 1.91 lei in fees, not the 1.656 lei predicted. The figures are left
 * as-is deliberately — one observation is not a fee schedule, and the estimate is
 * short-lived by construction, since `reconcileCostBases` replaces it with the
 * real balance-transaction fee. Revisit them (and the business model's margin
 * table, which rests on the same assumption) once enough purchases have settled to
 * see the actual rate.
 */
export const ESTIMATED_FEE_PERCENT: number = 0.014;
export const ESTIMATED_FEE_FIXED_MICRO_RON: number = 1.25 * MICRO_RON;

export function estimateFeeMicroRon(grossMicroRon: number): number {
  return Math.round(grossMicroRon * ESTIMATED_FEE_PERCENT + ESTIMATED_FEE_FIXED_MICRO_RON);
}
