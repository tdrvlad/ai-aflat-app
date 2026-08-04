/**
 * ai-aflat: payment configuration, read from the environment at call time.
 *
 * Read at call time rather than at module load so tests can set the environment
 * without module-registry games, and so a missing key surfaces as a clear error on
 * the first checkout rather than as a crash at boot.
 */

export const CURRENCY: string = 'ron';

/**
 * The version of the withdrawal-right text the buyer is shown. Stored on every
 * payment row.
 *
 * A boolean would be worthless here. The question a consumer-protection challenge
 * actually asks is *what did they agree to*, and the wording changes over time —
 * so bump this string whenever the text changes, and never reuse a version.
 */
export const CONSENT_VERSION: string = 'withdrawal-waiver-2026-08-04';

/**
 * VAT on digital services to Romanian consumers.
 *
 * **This rate is an open decision pending the accountant** — the business document
 * assumes 21% and says so. It is read from the environment rather than hardcoded
 * because a wrong rate here silently corrupts every margin figure the eventual
 * repricing rests on, and correcting it must not require a code change.
 */
export const DEFAULT_VAT_RATE: number = 0.21;

export function getVatRate(): number {
  const raw = process.env.AFLAT_VAT_RATE;
  if (!raw) {
    return DEFAULT_VAT_RATE;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 1) {
    throw new Error(`AFLAT_VAT_RATE must be a fraction between 0 and 1, got: ${raw}`);
  }

  return parsed;
}

export function getStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  return key;
}

export function getStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  }
  return secret;
}

/** Payments are simply unavailable, rather than broken, when Stripe is unconfigured. */
export function isPaymentsConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
}

function baseUrl(): string {
  return process.env.DOMAIN_CLIENT ?? 'http://localhost:3080';
}

export function getSuccessUrl(): string {
  return `${baseUrl()}/credits?status=success&session_id={CHECKOUT_SESSION_ID}`;
}

export function getCancelUrl(): string {
  return `${baseUrl()}/credits?status=cancelled`;
}
