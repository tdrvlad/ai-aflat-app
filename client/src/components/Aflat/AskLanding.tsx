import { BrandMark } from '~/components/Brand';
import StarterChips from './StarterChips';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type AskLandingProps = {
  /**
   * Called when an example question is tapped. Omit it to render the block
   * without examples — the state where a question is already on its way.
   */
  onPick?: (starter: string) => void;
  className?: string;
};

/**
 * The empty-chat screen: the mark, the invitation, and a few ways in.
 *
 * ONE component, mounted by both shells — the anonymous one (`AnonChat`) and the
 * signed-in one (`Chat/Landing`). Signing in changes who you are, and it must not
 * change what the screen is: before this, the two were separately authored and
 * drifted apart, so the first thing a new account saw was a *different product*
 * from the one that had just persuaded them to create it (Vlad, 2026-08-07). The
 * only way that stays fixed is if there is nothing to keep in sync.
 *
 * Presentation only. What tapping an example *does* differs by shell — anonymous
 * parks the question behind the sign-in gate, signed-in sends it — so each owns
 * its own `onPick` and neither can quietly change the other's behaviour.
 */
export default function AskLanding({ onPick, className }: AskLandingProps) {
  const localize = useLocalize();

  return (
    <div className={cn('flex flex-col justify-end gap-6 text-center', className)}>
      <div>
        <BrandMark className="mx-auto mb-4 h-[88px]" />
        <h1 className="m-0 text-balance text-3xl font-semibold">
          {localize('com_aflat_ask_heading')}
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-balance text-sm text-text-secondary">
          {localize('com_aflat_ask_subheading')}
        </p>
      </div>
      {/* A way in, offered before the empty field rather than after it. */}
      {onPick != null && <StarterChips onPick={onPick} />}
    </div>
  );
}
