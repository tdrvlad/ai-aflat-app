import { useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks';
import type { LedgerEntry } from './credits';

const REASON_KEYS: Record<string, TranslationKeys> = {
  signup_bonus: 'com_aflat_wallet_reason_signup_bonus',
  monthly_refill: 'com_aflat_wallet_reason_monthly_refill',
  purchase_bundle: 'com_aflat_wallet_reason_purchase_bundle',
  admin_manual: 'com_aflat_wallet_reason_admin_manual',
  support_refund: 'com_aflat_wallet_reason_support_refund',
};

const EFFORT_KEYS: Record<string, TranslationKeys> = {
  low: 'com_aflat_wallet_reason_question_low',
  medium: 'com_aflat_wallet_reason_question_medium',
  high: 'com_aflat_wallet_reason_question_high',
};

/**
 * The ledger in plain Romanian.
 *
 * Reason codes are English identifiers server-side and must never surface as
 * such — „Întrebare aprofundată −20" is the whole point of this list. An
 * unmapped code falls back to a generic label rather than leaking `monthly_refill`
 * at a user.
 */
function useEntryLabel() {
  const localize = useLocalize();

  return (entry: LedgerEntry): string => {
    if (entry.type === 'release') {
      return localize('com_aflat_wallet_reason_release');
    }

    if (entry.effort && EFFORT_KEYS[entry.effort]) {
      return localize(EFFORT_KEYS[entry.effort]);
    }

    const key = REASON_KEYS[entry.reasonCode];
    if (key) {
      return localize(key);
    }

    return localize('com_aflat_wallet_reason_question');
  };
}

export default function History({ entries }: { entries: LedgerEntry[] }) {
  const localize = useLocalize();
  const labelFor = useEntryLabel();

  return (
    <section aria-labelledby="wallet-history-heading" className="mt-8">
      <h2 id="wallet-history-heading" className="text-base font-semibold text-text-primary">
        {localize('com_aflat_wallet_history_title')}
      </h2>

      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-text-tertiary">
          {localize('com_aflat_wallet_history_empty')}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border-light rounded-2xl border border-border-light bg-surface-secondary">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-text-primary">{labelFor(entry)}</p>
                <p className="text-xs text-text-tertiary">
                  {new Date(entry.createdAt).toLocaleDateString()}
                </p>
              </div>
              <span
                className={`shrink-0 text-sm font-medium tabular-nums ${
                  entry.credits >= 0 ? 'text-text-primary' : 'text-text-secondary'
                }`}
              >
                {entry.credits >= 0 ? `+${entry.credits}` : entry.credits}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
