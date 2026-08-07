import { useCallback, useEffect, useRef } from 'react';
import { useSubmitMessage } from '~/hooks';
import { useChatFormContext } from '~/Providers';
import AskLanding from '~/components/Aflat/AskLanding';
import { cn } from '~/utils';

/**
 * How long a tapped example sits in the composer before it is sent.
 *
 * Kept in step with `AnonChat`'s own dwell, and for the same reason: the question
 * is written into the composer first so the send is never silent. Without the
 * pause the text is painted for one frame and appears to teleport into the thread,
 * and the visitor never learns the chip filled the box they could have typed in.
 */
const PICK_DWELL_MS = 320;

/**
 * The empty-chat screen for a signed-in user.
 *
 * It renders the SAME block the anonymous shell does — mark, invitation, examples
 * — because signing in must not change what the product looks like. LibreChat's
 * stock landing lived here before: a per-endpoint icon and an animated
 * time-of-day greeting, i.e. a screen with a different mark, different words and
 * no examples. A visitor who asked a question, created an account to get the
 * answer, and then landed on that had been handed a different application than
 * the one they signed up for (Vlad, 2026-08-07).
 *
 * The endpoint/agent/assistant machinery it used to carry is gone rather than
 * hidden: ai-aflat has exactly one capability, so an icon that varies by endpoint
 * and a name that varies by agent were describing variation this product does not
 * have.
 */
export default function Landing({ centerFormOnLanding }: { centerFormOnLanding: boolean }) {
  const { submitMessage } = useSubmitMessage();
  const methods = useChatFormContext();
  const dwellRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (dwellRef.current != null) {
        clearTimeout(dwellRef.current);
      }
    },
    [],
  );

  const handlePick = useCallback(
    (starter: string) => {
      if (dwellRef.current != null) {
        return;
      }
      methods.setValue('text', starter, { shouldDirty: true });
      dwellRef.current = setTimeout(() => {
        dwellRef.current = null;
        submitMessage({ text: starter });
      }, PICK_DWELL_MS);
    },
    [methods, submitMessage],
  );

  /**
   * Sized by its content, deliberately.
   *
   * The stock landing was `h-full` with a `sm:max-h-0` collapse driven by
   * `centerFormOnLanding` — a trick that works only while the block is a single
   * short line, because collapsing a container to zero height does not shrink
   * what is inside it. With the examples in place the block is several hundred
   * pixels tall, so the collapse dropped it straight through the composer and the
   * two rendered on top of each other. `ChatView` already centres this column
   * (`items-center justify-end sm:justify-center`), so the centring the flag asked
   * for happens anyway; the flag now only decides how much air sits above the
   * composer. Width matches the composer's own so the examples line up under it.
   */
  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-3xl flex-col items-center px-4 xl:max-w-4xl',
        centerFormOnLanding ? 'pb-4' : 'pb-8',
      )}
    >
      <AskLanding className="w-full" onPick={handlePick} />
    </div>
  );
}
