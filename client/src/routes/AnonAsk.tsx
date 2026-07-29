import { useCallback, useEffect, useRef, useState } from 'react';
import { apiBaseUrl, loginPage } from 'librechat-data-provider';
import { SendIcon, Spinner, TextareaAutosize, ThemeSelector } from '@librechat/client';
import AckBar from '~/components/Aflat/AckBar';
import StarterChips from '~/components/Aflat/StarterChips';
import LoginGatePanel from '~/components/Aflat/LoginGatePanel';
import { ACK_VERSION, hasAcked, saveAck, saveStash } from '~/components/Aflat/anonStash';
import { BrandLockup, APP_NAME } from '~/components/Brand';
import { cn, removeFocusRings } from '~/utils';
import { useLocalize } from '~/hooks';

/** Matches the server's `text` bound on `POST /api/aflat/anon-questions`. */
const MAX_QUESTION_LENGTH = 4000;
/** How long the thinking dots run before the gate replaces them. */
const ASKING_MS = 1000;

/**
 * `idle` → (send attempt without ack) `needsAck` → `asking` → `gate`.
 * A failed request returns to `idle` with the question intact.
 */
type GateState = 'idle' | 'needsAck' | 'asking' | 'gate';

/**
 * The public ask gate. Deliberately self-contained: it renders outside the
 * authenticated app shell and touches no chat/auth state, so it works with no
 * session at all. It never renders an answer — the answer is what the account
 * is for.
 */
export default function AnonAsk() {
  const localize = useLocalize();
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [text, setText] = useState('');
  const [state, setState] = useState<GateState>('idle');
  const [sentText, setSentText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [errorKey, setErrorKey] = useState<
    'com_aflat_error_rate_limited' | 'com_aflat_error_generic' | null
  >(null);

  useEffect(() => {
    document.title = APP_NAME;
    return () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const submit = useCallback(async (question: string) => {
    setIsSending(true);
    setErrorKey(null);

    let id: string | null = null;
    try {
      const response = await fetch(`${apiBaseUrl()}/api/aflat/anon-questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: question, ackVersion: ACK_VERSION }),
      });

      if (response.status === 429) {
        setErrorKey('com_aflat_error_rate_limited');
        setState('idle');
        return;
      }
      if (!response.ok) {
        setErrorKey('com_aflat_error_generic');
        setState('idle');
        return;
      }

      try {
        const body = (await response.json()) as { id?: string };
        id = typeof body.id === 'string' ? body.id : null;
      } catch {
        /* the question is saved; we just can't name it for the later claim */
        id = null;
      }
    } catch {
      setErrorKey('com_aflat_error_generic');
      setState('idle');
      return;
    } finally {
      setIsSending(false);
    }

    /**
     * Past the 2xx the question IS parked server-side, so nothing below may
     * route back to an error state. A failed stash costs only the post-signup
     * auto-link; an error here would instead invite a retry that orphans
     * another document and burns the visitor's 5/hour budget.
     */
    if (id != null) {
      saveStash({ id, text: question });
    }
    setSentText(question);
    setText('');
    setState('asking');
    timerRef.current = setTimeout(() => setState('gate'), ASKING_MS);
  }, []);

  const handleSubmit = useCallback(
    (event?: React.FormEvent) => {
      event?.preventDefault();
      const question = text.trim();
      if (!question || isSending || state === 'asking' || state === 'gate') {
        return;
      }
      if (!hasAcked()) {
        setErrorKey(null);
        setState('needsAck');
        return;
      }
      void submit(question);
    },
    [text, isSending, state, submit],
  );

  /** Acknowledging releases the send the visitor already asked for. */
  const handleAck = useCallback(() => {
    saveAck();
    setState('idle');
    const question = text.trim();
    if (question) {
      void submit(question);
    }
  }, [text, submit]);

  const handlePick = useCallback((starter: string) => {
    setText(starter);
    textAreaRef.current?.focus();
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

  const composerDisabled = isSending || state === 'asking' || state === 'gate';
  const showComposer = state !== 'gate';

  return (
    <div className="relative flex min-h-screen flex-col bg-presentation text-text-primary">
      {/**
       * The gate is where *every* anonymous visitor lands, including an account
       * holder whose session expired on a bookmarked link — so sign-in must be
       * reachable without walking the ask flow. Kept visually secondary: the
       * primary action is still asking a question.
       */}
      <header className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 pt-8">
        <span />
        <BrandLockup className="h-10" alt={localize('com_ui_logo', { 0: APP_NAME })} />
        <a
          href={loginPage()}
          data-testid="aflat-signin-link"
          className="justify-self-end text-right text-sm text-text-secondary underline decoration-border-heavy underline-offset-2 transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
        >
          {localize('com_aflat_signin_link')}
        </a>
      </header>
      <div className="absolute bottom-0 left-0 m-4">
        <ThemeSelector returnThemeOnly={true} />
      </div>

      <main className="mx-auto flex w-full max-w-3xl flex-grow flex-col justify-center gap-6 px-4 py-10">
        <div className="text-center">
          <h1 className="m-0 text-balance text-3xl font-semibold">
            {localize('com_aflat_ask_heading')}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-balance text-sm text-text-secondary">
            {localize('com_aflat_ask_subheading')}
          </p>
        </div>

        {(state === 'asking' || state === 'gate') && (
          <section aria-live="polite" className="flex w-full flex-col gap-4">
            <div className="flex justify-end">
              <div
                data-testid="aflat-user-bubble"
                className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl border border-border-light bg-surface-tertiary px-4 py-2.5 text-left text-text-primary"
              >
                <span className="sr-only">{localize('com_aflat_your_question')}: </span>
                {sentText}
              </div>
            </div>
            {state === 'asking' && (
              <div className="flex items-center gap-2 pl-1" data-testid="aflat-thinking">
                <span className="sr-only">{localize('com_aflat_thinking')}</span>
                <p className="submitting relative m-0" aria-hidden="true">
                  <span className="result-thinking" />
                </p>
              </div>
            )}
            {state === 'gate' && <LoginGatePanel />}
          </section>
        )}

        {showComposer && (
          <>
            {state === 'needsAck' && <AckBar onAck={handleAck} />}

            {errorKey != null && (
              <div
                role="alert"
                data-testid="aflat-error"
                className="rounded-xl border border-border-destructive bg-surface-secondary px-4 py-2.5 text-sm text-text-destructive"
              >
                {localize(errorKey)}
              </div>
            )}

            <form onSubmit={handleSubmit} className="mx-auto flex w-full flex-row gap-3">
              <div className="relative flex h-full flex-1 items-stretch md:flex-col">
                {/* composer shell — classes cloned from Chat/Input/ChatForm */}
                <div className="relative flex w-full flex-grow flex-col overflow-hidden rounded-t-3xl border border-border-light bg-surface-chat pb-4 text-text-primary shadow-md transition-all duration-200 sm:rounded-3xl sm:pb-0">
                  <div className="flex flex-row">
                    <div className="relative flex-1">
                      <TextareaAutosize
                        ref={textAreaRef}
                        value={text}
                        onChange={(e) => setText(e.target.value.slice(0, MAX_QUESTION_LENGTH))}
                        onKeyDown={handleKeyDown}
                        disabled={composerDisabled}
                        maxLength={MAX_QUESTION_LENGTH}
                        rows={1}
                        data-testid="aflat-text-input"
                        aria-label={localize('com_aflat_ask_placeholder')}
                        placeholder={localize('com_aflat_ask_placeholder')}
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
                        {isSending ? <Spinner size={24} /> : <SendIcon size={24} />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </form>

            {/* the examples are an entry point, not something to offer mid-send */}
            {state === 'idle' && !isSending && <StarterChips onPick={handlePick} />}
          </>
        )}
      </main>
    </div>
  );
}
