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
 *
 * The claim carries no id. Authorisation is the `aflat_claim` httpOnly cookie
 * the server set when the question was parked; the browser attaches it on its
 * own and this code never sees it. Two consequences shape everything here:
 *  - the local stash is not required to claim, so the handoff still works on a
 *    browser where `localStorage` silently refused the write (Safari private
 *    mode) — the question is recovered from the server instead;
 *  - the cookie is spent on the first successful claim, so a question that was
 *    claimed but could not be delivered can never be claimed again. It is held
 *    in page-context state until this page can deliver it.
 */

/** Backend contract for `POST /api/aflat/anon-questions/claim`. */
type ClaimedQuestion = { id?: string; text?: string };

/** A claimed question waiting for a place to be asked. */
type PendingQuestion = { text: string; id?: string; ts?: number };

const claimUrl = () => `${apiBaseUrl()}/api/aflat/anon-questions/claim`;

type HandoffState = {
  /** A claim has gone out in this page context (in flight, or settled). */
  claimStarted: boolean;
  /** Claimed from the server, not yet asked. Unrecoverable if this page goes away. */
  undelivered: PendingQuestion | null;
};

type HandoffWindow = Window & { __aflatHandoff?: HandoffState };

/**
 * Page-context state, on `window` rather than in a module closure for the same
 * reason `librechat-data-provider`'s auth-recovery state is (`request.ts`): its
 * lifetime is the page, not the module instance, and a `ChatForm` remount — a
 * conversation switch, a route change — must not hand it a clean slate. A hard
 * navigation is exactly what *should* reset it.
 */
const handoffState = (): HandoffState => {
  const w = window as HandoffWindow;
  if (w.__aflatHandoff == null) {
    w.__aflatHandoff = { claimStarted: false, undelivered: null };
  }
  return w.__aflatHandoff;
};

const statusOf = (error: unknown): number | undefined =>
  (error as { response?: { status?: number } } | undefined)?.response?.status;

const usableText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

/**
 * The contentless flag the server sets beside the httpOnly claim credential.
 *
 * It is the only way this code can know a claim is worth making: the credential
 * itself is unreadable by design, and the stash may be absent on a browser that
 * refuses `localStorage` — the very case the cookie exists to cover. Without
 * this check every authenticated page load would spend one of the 10/h/IP claim
 * attempts on users who have nothing parked, and that budget is shared behind
 * carrier NAT, so ordinary browsing would throttle out real claims.
 */
const CLAIM_MARKER_COOKIE = 'aflat_claim_present';

const hasClaimMarker = (): boolean => {
  try {
    return document.cookie
      .split(';')
      .some((entry) => entry.trim().startsWith(`${CLAIM_MARKER_COOKIE}=`));
  } catch {
    /* No document.cookie access (sandboxed iframe) — fall back to the stash. */
    return false;
  }
};

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
   * floor.
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

    const state = handoffState();
    const startedInConversationId = conversationIdRef.current;

    /** Everything the question needs to still be a *deliverable* question. */
    const deliverable = () =>
      mountedRef.current &&
      readyRef.current &&
      conversationIdRef.current === startedInConversationId &&
      isSubmittingRef.current !== true;

    /**
     * A question this page already claimed and could not ask yet — the chat had
     * moved on, or `ask` refused. The cookie that authorised the claim is spent,
     * so there is nothing to re-claim: this is the only copy, and it is asked
     * without going back to the server.
     */
    const pending = state.undelivered;
    if (pending != null) {
      startedRef.current = true;
      if (!deliverable() || submitRef.current({ text: pending.text }) === false) {
        startedRef.current = false;
        return;
      }
      state.undelivered = null;
      clearStash();
      return;
    }

    if (state.claimStarted) {
      return;
    }

    /**
     * Display copy only, and only a fallback: the server's answer to the claim
     * is authoritative. Its absence is not a reason to skip the claim — on a
     * browser that refuses `localStorage` the cookie is the only thing that
     * survived the trip through the identity provider.
     */
    const stash = readStash();
    const stashed: PendingQuestion | null =
      stash == null || usableText(stash.text) == null
        ? null
        : { text: stash.text, id: stash.id, ts: stash.ts };

    /**
     * Either signal is enough — the marker covers the storage-blocked browser,
     * the stash covers a marker the server has already cleared — but with
     * neither, this account parked nothing and the claim would only burn a
     * shared rate-limit slot to be told so.
     */
    if (!hasClaimMarker() && stashed == null) {
      return;
    }

    startedRef.current = true;
    state.claimStarted = true;

    /**
     * Undelivered means untouched. Puts the question back exactly as it was —
     * same `ts`, so the 24h window is the visitor's original one — and releases
     * the instance guard so a later mount can pick it up again.
     */
    const park = (question: PendingQuestion) => {
      saveStash({ id: question.id, text: question.text, ts: question.ts });
      startedRef.current = false;
    };

    void (async () => {
      /**
       * Cleared before the claim goes out, not after it returns: the stash is a
       * display copy of a question that is about to become the account's, and
       * leaving it readable while the claim is in flight invites a second tab to
       * treat it as still-parked. What actually stops a double ask is that the
       * cookie is spent by the first claim to reach the server.
       */
      clearStash();

      let claimed: ClaimedQuestion;
      try {
        claimed = await request.post(claimUrl(), {});
      } catch (error) {
        if (statusOf(error) === 404) {
          /**
           * No claim cookie, or a question already claimed — indistinguishable
           * by design, and both mean the same thing here: this browser has
           * nothing parked, so there is nothing to hand off and nothing to
           * retry.
           */
          return;
        }
        /**
         * Throttled (the claim route is 10/h/IP), server error, or offline. The
         * question is still parked and the cookie is still unspent, so a later
         * mount claims again. Deliberately silent: the user asked for an answer,
         * not for a report on our rate limiter, and the composer in front of
         * them already works.
         */
        state.claimStarted = false;
        if (stashed != null) {
          park(stashed);
        } else {
          startedRef.current = false;
        }
        return;
      }

      /** The server's copy is authoritative — localStorage is the user's to edit. */
      const text = usableText(claimed?.text) ?? stashed?.text;
      if (text == null) {
        return;
      }
      const question: PendingQuestion = {
        text,
        id: typeof claimed?.id === 'string' ? claimed.id : stashed?.id,
        ts: stashed?.ts,
      };

      /**
       * The claim succeeded, which only means the question is *ours* — not that
       * this is still a place to ask it. In the time the round trip took, the
       * component may have unmounted (a jump to `/search`, `/prompts`), the user
       * may have opened another conversation from the sidebar, or they may have
       * typed and sent a message of their own; and `ask` itself may refuse to
       * append to a preliminary assistant message. None of those may consume the
       * question — but the cookie is spent, so it is held in page state (and
       * mirrored to the stash for display) rather than left to a re-claim that
       * would now 404.
       */
      if (!deliverable() || submitRef.current({ text }) === false) {
        state.undelivered = question;
        park(question);
      }
    })();
  }, [ready]);
}
