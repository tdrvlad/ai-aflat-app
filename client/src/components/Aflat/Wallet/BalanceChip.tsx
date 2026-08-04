import { useNavigate } from 'react-router-dom';
import { useLocalize } from '~/hooks';
import { useCreditBalance } from './credits';

const MEDIUM_QUESTION_COST = 10;

/**
 * The balance, top right — and **the only persistent cost element in the
 * interface**.
 *
 * Everything else about price is discoverable at the moment of choosing or after
 * the fact in the wallet. No cost on the send button, no badge on the upgrade
 * affordance, no running meter in the conversation: a meter on a legal question
 * stops people asking, which is the one behaviour this product cannot afford to
 * discourage.
 *
 * It is also the only route into the wallet, so it must render even at zero.
 */
export default function BalanceChip() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useCreditBalance();

  /* Show nothing rather than a wrong number — a flickering balance reads as a bug. */
  if (isLoading || isError || !data) {
    return null;
  }

  const available = data.available;

  return (
    <button
      type="button"
      onClick={() => navigate('/credits')}
      title={localize('com_aflat_wallet_balance_hint', {
        count: Math.floor(available / MEDIUM_QUESTION_COST),
      })}
      aria-label={`${available} ${localize('com_aflat_wallet_credits_unit')}`}
      className="flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border-light bg-surface-secondary px-3 text-sm font-medium text-text-primary transition-colors duration-150 hover:border-border-heavy hover:bg-surface-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary motion-reduce:transition-none"
    >
      <span className="tabular-nums">{available}</span>
      <span className="text-text-secondary">{localize('com_aflat_wallet_credits_unit')}</span>
    </button>
  );
}
