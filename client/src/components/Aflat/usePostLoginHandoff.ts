import { useEffect, useRef } from 'react';
import { Constants, apiBaseUrl, request } from 'librechat-data-provider';
import { useChatContext } from '~/Providers/ChatContext';
import useSubmitMessage from '~/hooks/Messages/useSubmitMessage';
import { useConsentStatus } from './consent';
import { clearStash, readStash, saveStash } from './anonStash';

/**
 * ai-aflat "colectorul", second half: the question a visitor parked at `/ask`
 * before signing up is claimed by the new account and asked for real, so the
 * first thing they see after signing in is their own question being answered.
 *
 * This is the only place in the product that submits a message the user did not
 * just type, so it is deliberately conservative — see the guards below.
 */

/** Backend contract for `POST /api/aflat/anon-questions/:id/link`. */
type LinkedQuestion = { id?: string; text?: string };

const linkUrl = (id: string) => `${apiBaseUrl()}/api/aflat/anon-questions/${id}/link`;

/**
 * Questions already claimed (or in flight) in this page session. The stash is
 * cleared before the claim goes out, so in the normal case that clear is what
 * stops a second mount from claiming the same id. This set is the guard for when
 * it cannot: `localStorage.removeItem` throws on a browser with site data blocked
 * (Safari private mode, "block all cookies"), `clearStash` swallows that by
 * contract, and the stash then survives the whole claim. Without this set, a
 * `ChatForm` remount mid-claim — a conversation switch, a route change — would
 * read that surviving stash and claim it a second time.
 */
const handledIds = new Set<string>();

const statusOf = (error: unknown): number | undefined =>
  (error as { response?: { status?: number } } | undefined)?.response?.status;

export default function usePostLoginHandoff() {
  const { data: consent } = useConsentStatus();
  const { conversation, isSubmitting } = useChatContext();
  const { submitMessage } = useSubmitMessage();

  /**
   * `submitMessage` is a new function on most renders; keeping it in a ref stops
   * it from re-triggering an effect whose whole job is to run once.
   */
  const submitRef = useRef(submitMessage);
  submitRef.current = submitMessage;

  const startedRef = useRef(false);

  /**
   * Three conditions, all load-bearing:
   *  - consent recorded — nothing may be sent on the user's behalf before they
   *    have accepted the framing (the modal blocks until then);
   *  - the conversation is the *new* one — the question belongs in a fresh
   *    conversation, never appended to whatever the user happens to have open;
   *  - the conversation has an endpoint — `ChatRoute` applies the default
   *    `modelSpecs` preset in an effect, and asking before that lands would send
   *    against a half-initialised conversation.
   */
  const ready =
    consent?.recorded === true &&
    conversation?.conversationId === Constants.NEW_CONVO &&
    conversation?.endpoint != null;

  /**
   * The claim is a round trip — 0.3–2s on mobile, right after a signup — and the
   * chat underneath it is free to change in that time. Everything the decision to
   * submit depends on is therefore mirrored into a ref and read again on the far
   * side of the await; the values captured in the effect's closure describe the
   * render that *started* the claim and say nothing about the one that will
   * receive the message.
   */
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const conversationIdRef = useRef(conversation?.conversationId);
  conversationIdRef.current = conversation?.conversationId;
  /**
   * `ask` silently no-ops while a submission is in flight, and `submitMessage`
   * reports that the same way it reports success, so this has to be checked
   * before calling rather than after: a user who typed and sent their own
   * message during the claim would otherwise have the parked one dropped on the
   * floor, with the stash already cleared and nothing to retry from.
   */
  const isSubmittingRef = useRef(isSubmitting);
  isSubmittingRef.current = isSubmitting;

  /**
   * Whether this component is still mounted, tracked over the *instance's*
   * lifetime rather than per effect run. A `let cancelled` closed over by one
   * run would be wrong here: strict mode (and any `ready` flip) tears an effect
   * down and runs it again on a component that never went away, which would
   * cancel a claim that is still perfectly deliverable. Only a real unmount
   * leaves this false, because nothing runs after it.
   */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!ready || startedRef.current) {
      return;
    }

    const stash = readStash();
    if (stash == null) {
      return;
    }
    if (
      typeof stash.id !== 'string' ||
      !stash.id ||
      typeof stash.text !== 'string' ||
      !stash.text.trim()
    ) {
      /* Nothing claimable in there — drop it so it stops being read every mount. */
      clearStash();
      return;
    }
    if (handledIds.has(stash.id)) {
      return;
    }

    const { id, text: stashedText, ts } = stash;
    const startedInConversationId = conversationIdRef.current;
    startedRef.current = true;
    handledIds.add(id);

    /**
     * Undelivered means untouched. Puts the question back exactly as it was —
     * same `ts`, so the 24h window is the visitor's original one — and releases
     * both guards, so a later mount performs a real retry rather than skipping
     * an id it thinks is already handled. The re-claim is safe: the link route
     * matches `linkedUserId: null` *or* the caller's own id, so re-claiming a
     * question this account already owns returns 200 and the text again.
     */
    const park = () => {
      saveStash({ id, text: stashedText, ts });
      handledIds.delete(id);
      startedRef.current = false;
    };

    void (async () => {
      /**
       * Cleared before the claim goes out, not after it returns. The stash lives
       * in `localStorage` and is therefore shared by every tab of this browser,
       * while `handledIds` is per page context — two tabs open on the app after a
       * signup would both read the same stash, and the link route is idempotent
       * for its owner, so both would get a 200 and both would ask the question:
       * two conversations, two orchestrator jobs, one question. Clearing first
       * narrows that window to a single synchronous storage write, and `park()`
       * puts the question back whenever it turns out not to have been delivered.
       */
      clearStash();

      let linked: LinkedQuestion;
      try {
        linked = await request.post(linkUrl(id), {});
      } catch (error) {
        if (statusOf(error) === 404) {
          /**
           * Stale stash: the question was already claimed by another account, or
           * never existed. Indistinguishable by design, and both mean the same
           * thing here — there is nothing left to hand off, so it stays cleared.
           */
          return;
        }
        /**
         * Throttled (the claim route is 10/h/IP), server error, or offline. The
         * question is still parked server-side and still claimable, so it goes
         * back into the stash and a later mount retries. Deliberately silent: the
         * user asked for an answer, not for a report on our rate limiter, and the
         * composer in front of them already works.
         */
        park();
        return;
      }

      /**
       * The claim succeeded, which only means the question is *ours* — not that
       * this is still a place to ask it. In the time the round trip took, the
       * component may have unmounted (a jump to `/search`, `/prompts`), the user
       * may have opened another conversation from the sidebar, or they may have
       * typed and sent a message of their own. Submitting anyway would put the
       * question in the wrong conversation, into an unmounted view, or nowhere at
       * all. None of those may consume the question: it goes back in the stash.
       */
      if (
        !mountedRef.current ||
        !readyRef.current ||
        conversationIdRef.current !== startedInConversationId ||
        isSubmittingRef.current === true
      ) {
        park();
        return;
      }

      /** The server's copy is authoritative — localStorage is the user's to edit. */
      const text =
        typeof linked?.text === 'string' && linked.text.trim() ? linked.text : stashedText;

      /**
       * `false` is `ask` refusing to append to a preliminary assistant message.
       * A refusal is not a delivery, so the question goes back rather than
       * disappearing into a return value nobody read.
       */
      if (submitRef.current({ text }) === false) {
        park();
      }
    })();
  }, [ready]);
}
