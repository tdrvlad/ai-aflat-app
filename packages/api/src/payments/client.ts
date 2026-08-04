import Stripe from 'stripe';
import { getStripeSecretKey } from './config';

let cached: Stripe | null = null;

/**
 * ai-aflat: the Stripe client, built once and reused.
 *
 * Lazy rather than module-level so that importing anything from this module does
 * not require Stripe to be configured — the app must boot and serve the assistant
 * perfectly well on a deployment that cannot take payments.
 */
export function getStripe(): Stripe {
  if (cached) {
    return cached;
  }

  cached = new Stripe(getStripeSecretKey(), {
    /**
     * Pinned deliberately, and pinned to what this SDK was generated against
     * (`stripe/cjs/apiVersion.js`). An API version that floats is an outage
     * waiting for a Tuesday; one that disagrees with the SDK is worse.
     */
    apiVersion: '2026-07-29.dahlia',
    appInfo: { name: 'ai-aflat', url: 'https://ai-aflat.ro' },
  });

  return cached;
}

/** Tests and key rotation only. */
export function resetStripeClient(): void {
  cached = null;
}
