import { useEffect, useRef } from 'react';
import { Constants, apiBaseUrl, request } from 'librechat-data-provider';
import { useChatContext } from '~/Providers/ChatContext';
import useSubmitMessage from '~/hooks/Messages/useSubmitMessage';
import { useConsentStatus } from './consent';
import { clearStash, readStash } from './anonStash';

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
 * Questions already claimed (or in flight) in this page session. `useRef` alone
 * covers React's strict-mode double-mount, but `ChatForm` also remounts on every
 * conversation switch and each remount gets fresh refs — without this the same
 * id could be claimed again in the window before `clearStash()` lands.
 */
const handledIds = new Set<string>();

const statusOf = (error: unknown): number | undefined =>
  (error as { response?: { status?: number } } | undefined)?.response?.status;

export default function usePostLoginHandoff() {
  const { data: consent } = useConsentStatus();
  const { conversation } = useChatContext();
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

  useEffect(() => {
    if (!ready || startedRef.current) {
      return;
    }

    const stash = readStash();
    if (stash == null) {
      return;
    }
    if (typeof stash.id !== 'string' || typeof stash.text !== 'string' || !stash.id) {
      /* Nothing claimable in there — drop it so it stops being read every mount. */
      clearStash();
      return;
    }
    if (handledIds.has(stash.id)) {
      return;
    }

    const { id, text: stashedText } = stash;
    startedRef.current = true;
    handledIds.add(id);

    void (async () => {
      let linked: LinkedQuestion;
      try {
        linked = await request.post(linkUrl(id), {});
      } catch (error) {
        if (statusOf(error) === 404) {
          /**
           * Stale stash: the question was already claimed by another account, or
           * never existed. Indistinguishable by design, and both mean the same
           * thing here — there is nothing left to hand off.
           */
          clearStash();
          return;
        }
        /**
         * Throttled (the claim route is 10/h/IP), server error, or offline. The
         * question is still parked and still claimable, so the stash stays and a
         * later mount retries. Deliberately silent: the user asked for an answer,
         * not for a report on our rate limiter, and the composer in front of them
         * already works.
         */
        handledIds.delete(id);
        startedRef.current = false;
        return;
      }

      /**
       * Cleared before submitting, not after: the claim has already succeeded
       * server-side, so the stash has done its job. Clearing first makes a double
       * submission impossible even if this component remounts mid-flight.
       */
      clearStash();

      /** The server's copy is authoritative — localStorage is the user's to edit. */
      const text =
        typeof linked?.text === 'string' && linked.text.trim() ? linked.text : stashedText;
      submitRef.current({ text });
    })();
  }, [ready]);
}
