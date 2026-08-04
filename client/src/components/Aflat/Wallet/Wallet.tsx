import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks';
import { useCreditBalance, useLedger, usePricing, useRefreshWallet } from './credits';
import Bundles from './Bundles';
import History from './History';

const MEDIUM_QUESTION_COST = 10;

const EFFORT_ROWS: {
  effort: 'low' | 'medium' | 'high';
  label: TranslationKeys;
  hint: TranslationKeys;
}[] = [
  { effort: 'low', label: 'com_aflat_effort_low', hint: 'com_aflat_effort_low_hint' },
  { effort: 'medium', label: 'com_aflat_effort_medium', hint: 'com_aflat_effort_medium_hint' },
  { effort: 'high', label: 'com_aflat_effort_high', hint: 'com_aflat_effort_high_hint' },
];

/** How long to keep re-reading the balance after returning from a successful payment. */
const RETURN_POLL_ATTEMPTS = 6;
const RETURN_POLL_INTERVAL_MS = 1500;

/**
 * Waits for the webhook after a successful checkout.
 *
 * Credits are granted by the Stripe webhook, not by this redirect, and the webhook
 * can land after the browser does. Showing the old balance and calling it done
 * would read as "I paid and got nothing", so the page polls briefly and says
 * plainly that the credits are on their way until they arrive.
 */
function useReturnFromCheckout(status: string | null, available: number | undefined) {
  const refresh = useRefreshWallet();
  const [settled, setSettled] = useState(false);
  const [startingBalance] = useState(available);

  useEffect(() => {
    if (status !== 'success' || settled) {
      return;
    }

    let attempts = 0;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) {
        return;
      }
      attempts += 1;
      await refresh();
      if (attempts >= RETURN_POLL_ATTEMPTS) {
        setSettled(true);
      }
    };

    const timer = setInterval(() => void tick(), RETURN_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [status, settled, refresh]);

  const grew =
    startingBalance !== undefined && available !== undefined && available > startingBalance;
  return { arrived: grew || settled };
}

export default function Wallet() {
  const localize = useLocalize();
  const [searchParams] = useSearchParams();
  const status = searchParams.get('status');

  const balance = useCreditBalance();
  const pricing = usePricing();
  const ledger = useLedger();

  const { arrived } = useReturnFromCheckout(status, balance.data?.available);

  if (balance.isLoading || pricing.isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <p className="text-sm text-text-tertiary">{localize('com_aflat_wallet_loading')}</p>
      </div>
    );
  }

  if (balance.isError || pricing.isError || !pricing.data) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <p role="alert" className="text-sm text-text-warning">
          {localize('com_aflat_wallet_error')}
        </p>
      </div>
    );
  }

  const available = balance.data?.available ?? 0;
  const reserved = balance.data?.reserved ?? 0;
  const actionPrices = pricing.data.actions.simple_question;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-text-primary">
        {localize('com_aflat_wallet_title')}
      </h1>
      <p className="mt-1 text-sm text-text-secondary">{localize('com_aflat_wallet_subtitle')}</p>

      {status === 'success' && (
        <p
          role="status"
          className="mt-4 rounded-xl border border-border-light bg-surface-secondary px-4 py-3 text-sm text-text-primary"
        >
          {arrived ? localize('com_aflat_wallet_success') : localize('com_aflat_wallet_pending')}
        </p>
      )}

      {status === 'cancelled' && (
        <p
          role="status"
          className="mt-4 rounded-xl border border-border-light bg-surface-secondary px-4 py-3 text-sm text-text-secondary"
        >
          {localize('com_aflat_wallet_cancelled')}
        </p>
      )}

      <section
        aria-labelledby="wallet-balance-heading"
        className="mt-6 rounded-2xl border border-border-light bg-surface-secondary p-5"
      >
        <h2 id="wallet-balance-heading" className="text-sm text-text-secondary">
          {localize('com_aflat_wallet_balance_label')}
        </h2>
        <p className="mt-1 text-3xl font-semibold text-text-primary">
          {available} {localize('com_aflat_wallet_credits_unit')}
        </p>
        <p className="mt-1 text-sm text-text-tertiary">
          {localize('com_aflat_wallet_balance_hint', {
            count: Math.floor(available / MEDIUM_QUESTION_COST),
          })}
        </p>
        {reserved > 0 && (
          <p className="mt-2 text-xs text-text-tertiary">
            {localize('com_aflat_wallet_reserved', { count: reserved })}
          </p>
        )}
      </section>

      <section aria-labelledby="wallet-howto-heading" className="mt-8">
        <h2 id="wallet-howto-heading" className="text-base font-semibold text-text-primary">
          {localize('com_aflat_wallet_howto_title')}
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          {localize('com_aflat_wallet_howto_intro')}
        </p>

        {/* Quoted in credits only — never a lei figure per question. */}
        <ul className="mt-3 divide-y divide-border-light rounded-2xl border border-border-light bg-surface-secondary">
          {EFFORT_ROWS.map((row) => (
            <li key={row.effort} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm text-text-primary">{localize(row.label)}</p>
                <p className="text-xs text-text-tertiary">{localize(row.hint)}</p>
              </div>
              <span className="shrink-0 text-sm font-medium tabular-nums text-text-primary">
                {actionPrices?.[row.effort]} {localize('com_aflat_wallet_credits_unit')}
              </span>
            </li>
          ))}
        </ul>

        {/* Small line, disproportionate trust value. */}
        <p className="mt-3 text-xs text-text-tertiary">{localize('com_aflat_wallet_free_note')}</p>
      </section>

      <Bundles bundles={pricing.data.bundles} />

      <History entries={ledger.data?.entries ?? []} />
    </div>
  );
}
