/**
 * ai-aflat price list.
 *
 * The single source of truth for what an action costs in credits. Deliberately a
 * typed module rather than JSON: it is type-checked, it cannot drift from the
 * `Effort` union the rest of the code switches on, and it is still one file to
 * change.
 *
 * **Versioned, and the version is stored on every settled ledger row.** A price
 * change must never appear to rewrite what someone was already charged, and a user
 * holding a balance bought under an old list can be grandfathered onto it.
 *
 * Credits are quoted in credits. RON appears on bundles and nowhere else — a
 * lei-per-question figure turns a legal question into a taxi meter, and meters stop
 * people asking.
 */

export const PRICE_LIST_VERSION: string = '2026-08-03';

export const EFFORT_LEVELS = ['low', 'medium', 'high'] as const;
export type Effort = (typeof EFFORT_LEVELS)[number];

export const DEFAULT_EFFORT: Effort = 'medium';

export const ACTION_SIMPLE_QUESTION: string = 'simple_question';

/**
 * Effort is a retrieval budget, not a different model. The same synthesis model
 * runs at every level; only how much legislation is inspected before answering
 * changes. Model-tier variation is deliberately deferred.
 */
export const EFFORT_BUDGETS: Record<
  Effort,
  { syntheticQueries: number; waves: number; results: number }
> = {
  low: { syntheticQueries: 1, waves: 1, results: 5 },
  medium: { syntheticQueries: 3, waves: 2, results: 15 },
  high: { syntheticQueries: 5, waves: 3, results: 30 },
};

/**
 * The price ratio (1 : 2 : 4) is deliberately flatter than the estimated cost ratio
 * (1 : 3 : 7). Depth is slightly subsidized on purpose: high effort produces the
 * better-grounded answer, and on a product whose entire trust asset is citation
 * quality, nudging users toward more evidence is worth a few margin points.
 */
export const ACTION_PRICES: Record<string, Record<Effort, number>> = {
  [ACTION_SIMPLE_QUESTION]: { low: 5, medium: 10, high: 20 },
};

export interface GrantSizes {
  signup_bonus: number;
  monthly_refill: number;
  /** The refill tops up to this, rather than stacking forever. Stops hoard-then-dump. */
  refill_ceiling: number;
}

export const GRANT_SIZES: GrantSizes = {
  signup_bonus: 100,
  monthly_refill: 20,
  refill_ceiling: 60,
};

/** Grant lots expire; purchased lots never do. */
export const GRANT_EXPIRY_DAYS: number = 365;

/** A hold whose job never reported back is swept after this long. */
export const HOLD_TIMEOUT_MS: number = 15 * 60 * 1000;

export interface CreditBundle {
  id: string;
  credits: number;
  priceRon: number;
}

export const BUNDLES: readonly CreditBundle[] = [
  { id: 'start', credits: 200, priceRon: 29 },
  { id: 'uzual', credits: 800, priceRon: 99 },
  { id: 'extins', credits: 2500, priceRon: 249 },
] as const;

/**
 * The only sanctioned way to turn a client-supplied bundle id into a price.
 *
 * Checkout must never take an amount from the request body: a client that can name
 * its own price can buy 2500 credits for a leu. The id is a lookup key here and
 * nothing more.
 */
export function getBundle(bundleId: string): CreditBundle | null {
  return BUNDLES.find((bundle) => bundle.id === bundleId) ?? null;
}

export function isEffort(value: unknown): value is Effort {
  return typeof value === 'string' && (EFFORT_LEVELS as readonly string[]).includes(value);
}

export function getActionPrice(actionType: string, effort: Effort): number {
  const prices = ACTION_PRICES[actionType];
  if (!prices) {
    throw new Error(`Unknown billable action: ${actionType}`);
  }
  return prices[effort];
}

/**
 * Re-running an answer at higher effort charges only the difference, because the
 * conversation context is reused. Downgrades are not billable and never refund.
 */
export function getUpgradePrice(actionType: string, from: Effort, to: Effort): number {
  const difference = getActionPrice(actionType, to) - getActionPrice(actionType, from);
  return difference > 0 ? difference : 0;
}

export interface PriceListView {
  version: string;
  defaultEffort: Effort;
  actions: Record<string, Record<Effort, number>>;
  bundles: readonly CreditBundle[];
  grants: { signupBonus: number; monthlyRefill: number };
}

/** What the client is allowed to see. Cost bases and margins never leave the server. */
export function getPriceList(): PriceListView {
  return {
    version: PRICE_LIST_VERSION,
    defaultEffort: DEFAULT_EFFORT,
    actions: ACTION_PRICES,
    bundles: BUNDLES,
    grants: {
      signupBonus: GRANT_SIZES.signup_bonus,
      monthlyRefill: GRANT_SIZES.monthly_refill,
    },
  };
}
