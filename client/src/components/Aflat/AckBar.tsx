import { Button } from '@librechat/client';
import { useLocalize } from '~/hooks';

const PRIVACY_POLICY_URL = 'https://ai-aflat.ro/confidentialitate';

/**
 * Interposes between the visitor's first send and the request: states the
 * legal-information framing plus the fact that the question is stored, and
 * releases the send only once acknowledged.
 */
export default function AckBar({ onAck }: { onAck: () => void }) {
  const localize = useLocalize();

  return (
    <div
      role="group"
      aria-label={localize('com_aflat_ack_label')}
      className="mx-auto flex w-full flex-col gap-3 rounded-2xl border border-border-medium bg-surface-secondary p-4 text-sm text-text-secondary shadow-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="m-0">
        {localize('com_aflat_ack_text')}{' '}
        <a
          href={PRIVACY_POLICY_URL}
          rel="noreferrer"
          className="underline decoration-border-heavy underline-offset-2 transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
        >
          {localize('com_aflat_ack_privacy_link')}
        </a>
      </p>
      <Button
        variant="submit"
        size="sm"
        onClick={onAck}
        data-testid="aflat-ack-button"
        className="shrink-0"
      >
        {localize('com_aflat_ack_confirm')}
      </Button>
    </div>
  );
}
