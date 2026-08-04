import { useState } from 'react';
import { useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks';
import type { CreditBundle } from './credits';
import { useCheckout } from './credits';

const BUNDLE_LABEL_KEYS: Record<string, TranslationKeys> = {
  start: 'com_aflat_wallet_bundle_start',
  uzual: 'com_aflat_wallet_bundle_uzual',
  extins: 'com_aflat_wallet_bundle_extins',
};

/** Credits per normal question, used only to translate a bundle into something concrete. */
const MEDIUM_QUESTION_COST = 10;

/**
 * The purchase surface.
 *
 * **RON appears here and nowhere else in the product.** A lei-per-question figure
 * turns a legal question into a taxi meter, and meters stop people asking — so
 * bundles carry a price and everything else is quoted in credits.
 */
export default function Bundles({ bundles }: { bundles: CreditBundle[] }) {
  const localize = useLocalize();
  const checkout = useCheckout();

  const [consented, setConsented] = useState(false);
  const [showConsentError, setShowConsentError] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buy = (bundleId: string) => {
    /**
     * The server refuses without consent regardless; this check exists so the user
     * is told why rather than meeting a bare 400.
     */
    if (!consented) {
      setShowConsentError(true);
      return;
    }

    setShowConsentError(false);
    setError(null);
    setPendingId(bundleId);

    checkout.mutate(
      { bundleId, consentImmediatePerformance: true },
      {
        onSuccess: ({ url }) => {
          window.location.assign(url);
        },
        onError: (err) => {
          setPendingId(null);
          const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
          setError(
            code === 'payments_unavailable'
              ? localize('com_aflat_wallet_unavailable')
              : localize('com_aflat_wallet_checkout_error'),
          );
        },
      },
    );
  };

  return (
    <section aria-labelledby="wallet-buy-heading" className="mt-8">
      <h2 id="wallet-buy-heading" className="text-base font-semibold text-text-primary">
        {localize('com_aflat_wallet_buy_title')}
      </h2>

      <ul className="mt-3 grid gap-3 sm:grid-cols-3">
        {bundles.map((bundle) => {
          const labelKey = BUNDLE_LABEL_KEYS[bundle.id];
          const isPending = pendingId === bundle.id;

          return (
            <li
              key={bundle.id}
              className="flex flex-col rounded-2xl border border-border-light bg-surface-secondary p-4"
            >
              <span className="text-sm font-medium text-text-secondary">
                {labelKey ? localize(labelKey) : bundle.id}
              </span>

              <span className="mt-1 text-2xl font-semibold text-text-primary">
                {bundle.credits} {localize('com_aflat_wallet_credits_unit')}
              </span>

              <span className="mt-0.5 text-xs text-text-tertiary">
                {localize('com_aflat_wallet_bundle_questions', {
                  count: Math.floor(bundle.credits / MEDIUM_QUESTION_COST),
                })}
              </span>

              <span className="mt-3 text-lg font-semibold text-text-primary">
                {localize('com_aflat_wallet_price', { amount: bundle.priceRon })}
              </span>
              <span className="text-xs text-text-tertiary">
                {localize('com_aflat_wallet_price_vat')}
              </span>

              <button
                type="button"
                onClick={() => buy(bundle.id)}
                disabled={isPending}
                className="mt-4 min-h-[44px] cursor-pointer rounded-xl bg-[var(--panza-cta)] px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-[var(--panza-cta-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none"
              >
                {isPending
                  ? localize('com_aflat_wallet_opening')
                  : localize('com_aflat_wallet_buy_cta')}
              </button>
            </li>
          );
        })}
      </ul>

      {/*
       * Never pre-ticked, and adjacent to the buy buttons rather than buried in
       * terms. This is the record that answers a consumer-protection challenge.
       */}
      <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm text-text-secondary">
        <input
          type="checkbox"
          checked={consented}
          onChange={(event) => {
            setConsented(event.target.checked);
            if (event.target.checked) {
              setShowConsentError(false);
            }
          }}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--panza-cta)]"
        />
        <span>{localize('com_aflat_wallet_consent_label')}</span>
      </label>

      {showConsentError && (
        <p role="alert" className="mt-2 text-sm text-text-warning">
          {localize('com_aflat_wallet_consent_required')}
        </p>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-text-warning">
          {error}
        </p>
      )}
    </section>
  );
}
