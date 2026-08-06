import { useCallback, useEffect, useRef, useState } from 'react';
import { SendIcon, TextareaAutosize } from '@librechat/client';
import { BrandMark } from '~/components/Brand';
import LoginModal from './Auth/LoginModal';
import StarterChips from './StarterChips';
import { saveStash } from './anonStash';
import { cn, removeFocusRings } from '~/utils';
import { useLocalize } from '~/hooks';

/** Kept in step with the composer bound the authenticated chat uses. */
const MAX_QUESTION_LENGTH = 4000;
/**
 * How long the thinking dots run before the gate replaces them.
 *
 * Long enough to read as the assistant taking the question, short enough not to
 * feel like a contrived wait. Set by Vlad at 1.5s after seeing it in a browser.
 */
const ASKING_MS = 1500;
/**
 * How long a tapped example sits in the composer before it is sent.
 *
 * The question is written into the composer so the send is never silent. Without
 * a deliberate pause the text is painted for one frame and the visitor sees it
 * teleport into the thread, never learning that the chip filled the box they
 * could have typed in. This is the smallest pause that reads as „it went in,
 * then it was sent".
 */
const PICK_DWELL_MS = 320;

/** `idle` → `asking` → `gate`. */
type GateState = 'idle' | 'asking' | 'gate';

/**
 * The chat screen as an anonymous visitor sees it.
 *
 * This is the same screen a signed-in user gets, not a separate front door —
 * the previous `/ask` route was the „defined twice" problem, and the whole
 * point of rendering here is that signing in changes what is on screen without
 * changing which screen it is.
 *
 * Nothing here talks to the server, and that is the design rather than an
 * omission. A stranger's free-text legal question routinely carries health,
 * criminal and family detail — Article 9 and Article 10 material — so storing it
 * before there is any consent to store it is not defensible, and consent asked
 * *before* the question has even been taken is consent asked of someone who has
 * no idea yet what they are agreeing to. So the question stays in this browser
 * (`saveStash`) until the visitor has an account and has accepted the framing in
 * `ConsentModal`; `usePostLoginHandoff` then asks it for real. Until that
 * happens the only record anywhere is one the visitor can clear themselves.
 *
 * The beat before the login modal is deliberate and load-bearing. Without it the
 * modal is a reaction to the *click*, which reads as a paywall. With it, the
 * modal is a reaction to the *question*: the assistant took it, then needed to
 * know who is asking.
 */
export default function AnonChat({ onSignedIn }: { onSignedIn: () => void }) {
  const localize = useLocalize();
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickPendingRef = useRef(false);

  const [text, setText] = useState('');
  const [state, setState] = useState<GateState>('idle');
  const [sentText, setSentText] = useState('');

  useEffect(
    () => () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
      }
      if (pickTimerRef.current != null) {
        clearTimeout(pickTimerRef.current);
      }
    },
    [],
  );

  /**
   * The one send path, shared by the composer and the example questions.
   *
   * It takes the question explicitly rather than reading `text`, because a
   * starter chip sets the composer and sends in the same tick — `text` would
   * still hold the previous value in this closure, and the gate would open on
   * the wrong question or on none at all.
   *
   * A failed stash is not an error and must not be reported as one. On a browser
   * with site data blocked the question simply cannot survive the sign-up, and
   * the visitor still gets the account they came for — telling them their
   * question „could not be saved" would suggest something broke when nothing
   * did, and invite a retry that changes nothing.
   */
  const startSend = useCallback(
    (question: string) => {
      if (!question || state !== 'idle') {
        return;
      }
      /**
       * A tapped example is already on its way. Without this, pressing send
       * during the dwell would run the whole beat twice for one question.
       */
      if (pickPendingRef.current) {
        return;
      }
      saveStash({ text: question });
      setSentText(question);
      setText('');
      setState('asking');
      timerRef.current = setTimeout(() => setState('gate'), ASKING_MS);
    },
    [state],
  );

  const handleSubmit = useCallback(
    (event?: React.FormEvent) => {
      event?.preventDefault();
      startSend(text.trim());
    },
    [text, startSend],
  );

  /**
   * Backing out of the login modal returns to the thread with the question
   * still in it — not to a fresh empty chat. It stays in this browser and is
   * offered back on the next visit.
   */
  const handleDismissLogin = useCallback(() => {
    setState('idle');
  }, []);

  /**
   * An example question sends on tap.
   *
   * It is still written into the composer first, so the send is never silent —
   * the visitor sees the question they are asking.
   */
  const handlePick = useCallback(
    (starter: string) => {
      if (pickPendingRef.current) {
        return;
      }
      setText(starter);
      pickPendingRef.current = true;
      pickTimerRef.current = setTimeout(() => {
        pickPendingRef.current = false;
        startSend(starter);
      }, PICK_DWELL_MS);
    },
    [startSend],
  );

  /**
   * Typing during the dwell cancels the pick. Whatever the visitor is writing
   * now is the question they mean, and letting the timer fire would replace it
   * with the chip's — from their point of view, sending something they didn't
   * ask for.
   */
  const handleChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (pickTimerRef.current != null) {
      clearTimeout(pickTimerRef.current);
      pickTimerRef.current = null;
      pickPendingRef.current = false;
    }
    setText(event.target.value.slice(0, MAX_QUESTION_LENGTH));
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const composerDisabled = state !== 'idle';
  const hasThread = sentText !== '';

  /**
   * Two layouts, one screen.
   *
   * Empty, everything is centred — the heading, the examples and the composer
   * are the whole page, and there is nothing to scroll past. Once a question has
   * been asked the composer drops to the bottom and the thread takes the space
   * above it, which is the arrangement every chat client has taught people to
   * read: what you said is above, where you type is below.
   *
   * The switch is a layout change rather than a different screen. The composer
   * is the same element in the same DOM position throughout, so it keeps focus
   * and its contents across the move.
   *
   * Empty, the grid is three rows — `1fr auto 1fr` — with the composer in the
   * middle one. That centres the *composer* on the viewport rather than the
   * block as a whole: the mark, the heading and the examples hang off the bottom
   * of the first row, directly above it, and the third row is empty ballast.
   * Centring the whole group instead would push the field below the midpoint by
   * half the height of everything above it, and by a different amount depending
   * on how much copy sits there.
   */
  return (
    <main
      className={cn(
        'mx-auto w-full max-w-3xl px-4',
        hasThread
          ? 'flex h-full min-h-0 flex-col'
          : 'grid h-full grid-rows-[1fr_auto_1fr] gap-6 py-10',
      )}
    >
      {!hasThread && (
        <div className="row-start-1 flex flex-col justify-end gap-6 text-center">
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
          {state === 'idle' && <StarterChips onPick={handlePick} />}
        </div>
      )}

      {hasThread && (
        <section
          aria-live="polite"
          className="flex w-full flex-1 flex-col gap-4 overflow-y-auto py-6"
        >
          <div className="flex flex-col items-end gap-1.5">
            <div
              data-testid="aflat-user-bubble"
              className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl border border-border-light bg-surface-tertiary px-4 py-2.5 text-left text-text-primary"
            >
              <span className="sr-only">{localize('com_aflat_your_question')}: </span>
              {sentText}
            </div>
            {/* The continuity promise, made in advance of the identity step. */}
            <span className="text-xs text-text-tertiary">{localize('com_aflat_parked_note')}</span>
          </div>
          {state === 'asking' && (
            <div className="flex items-center gap-2 pl-1" data-testid="aflat-thinking">
              <span className="sr-only">{localize('com_aflat_thinking')}</span>
              {/**
               * Three grey dots and nothing else. This beat must not borrow the
               * thinking view's vocabulary — no „se pregătește răspunsul", no
               * timer, no step list — because nothing is being generated yet and
               * implying otherwise spends language the real wait needs.
               */}
              <p className="submitting relative m-0" aria-hidden="true">
                <span className="result-thinking" />
              </p>
            </div>
          )}
        </section>
      )}

      {/**
       * Step one of two. Step two — the framing and data acknowledgement — is
       * `ConsentModal`, which the authenticated shell raises the moment this
       * modal hands back a session, and only for an account that has never
       * recorded one. A returning user sees this and nothing else.
       */}
      <LoginModal open={state === 'gate'} onSignedIn={onSignedIn} onDismiss={handleDismissLogin} />

      {/* The composer's row, and the anchor the empty layout centres on. */}
      <div
        className={cn('flex w-full flex-col gap-3', hasThread ? 'shrink-0 pb-6' : 'row-start-2')}
      >
        <form onSubmit={handleSubmit} className="mx-auto flex w-full flex-row gap-3">
          <div className="relative flex h-full flex-1 items-stretch md:flex-col">
            {/* composer shell — classes cloned from Chat/Input/ChatForm */}
            <div className="relative flex w-full flex-grow flex-col overflow-hidden rounded-t-3xl border border-border-light bg-surface-chat pb-4 text-text-primary shadow-md transition-all duration-200 sm:rounded-3xl sm:pb-0">
              <div className="flex flex-row">
                <div className="relative flex-1">
                  <TextareaAutosize
                    ref={textAreaRef}
                    value={text}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    disabled={composerDisabled}
                    maxLength={MAX_QUESTION_LENGTH}
                    rows={1}
                    data-testid="aflat-text-input"
                    aria-label={localize('com_aflat_chat_placeholder')}
                    placeholder={localize('com_aflat_chat_placeholder')}
                    style={{ height: 44, overflowY: 'auto' }}
                    className={cn(
                      'm-0 w-full resize-none bg-transparent px-5 py-[13px] placeholder-black/60 dark:placeholder-white/60 md:py-3.5',
                      removeFocusRings,
                      'scrollbar-hover max-h-[45vh] transition-[max-height] duration-200 disabled:cursor-not-allowed md:max-h-[55vh]',
                    )}
                  />
                </div>
              </div>
              <div className="@container items-between flex flex-row gap-2 pb-2">
                <div className="mx-auto flex" />
                <div className="mr-2">
                  <button
                    type="submit"
                    id="send-button"
                    data-testid="aflat-send-button"
                    aria-label={localize('com_aflat_send')}
                    disabled={composerDisabled || text.trim().length === 0}
                    className="rounded-full bg-text-primary p-1.5 text-text-primary outline-offset-4 transition-all duration-200 disabled:cursor-not-allowed disabled:text-text-secondary disabled:opacity-10"
                  >
                    <SendIcon size={24} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </form>
      </div>
    </main>
  );
}
