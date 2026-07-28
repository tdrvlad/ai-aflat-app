import { useEffect, useRef } from 'react';
import { Constants, apiBaseUrl, request } from 'librechat-data-provider';
import { useChatContext } from '~/Providers/ChatContext';
import { useAuthContext } from '~/hooks/AuthContext';
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

/**
 * A claimed question waiting for a place to be asked.
 *
 * `uid` is the account the server confirmed it belongs to. It is carried because
 * a question in this state is delivered *without* going back to the server — the
 * credential is spent — so this is the only thing left that can tell whether the
 * person now at the keyboard is the one it was claimed for.
 */
type PendingQuestion = { text: string; id?: string; ts?: number; uid?: string };

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

/** The server's own claim window — see `CLAIM_MAX_AGE_MS` in `anonQuestions.js`. */
const CLAIM_MARKER_MAX_AGE_S = 24 * 60 * 60;

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

/**
 * The marker is not `httpOnly` precisely so it can be spent here, synchronously,
 * before the claim goes out.
 *
 * Waiting for the server to clear it would leave it readable for the whole round
 * trip — 0.3–2s on mobile — and a second tab opened in that window (session
 * restore, duplicate tab) has its own page-context state, sees the marker, and
 * claims too. The claim is idempotent for its owner, so both tabs get 200 and
 * the same question is asked twice, in two conversations, at the cost of two
 * orchestrator jobs. Spending it first narrows that to a single synchronous
 * cookie write, which is the same discipline the stash already follows.
 */
const spendClaimMarker = () => {
  try {
    document.cookie = `${CLAIM_MARKER_COOKIE}=; path=/; max-age=0`;
  } catch {
    /* Nothing to spend, and nothing that depends on it having worked. */
  }
};

/**
 * Put back after a failure that leaves the question still claimable — and only
 * if it was there to begin with, or a browser that only ever had a stash would
 * gain a marker the server never set and spend a claim slot on the next load
 * being told 404.
 *
 * Written with the server's attributes rather than as a bare `name=value`: that
 * would be a *session* cookie where the server's lives 24h, so the one browser
 * this restore exists for — `localStorage` blocked, marker the only record that
 * anything was parked — would lose it again at the next browser restart.
 */
const restoreClaimMarker = () => {
  try {
    const secure = window.location.protocol === 'https:' ? '; secure' : '';
    document.cookie = `${CLAIM_MARKER_COOKIE}=1; path=/; max-age=${CLAIM_MARKER_MAX_AGE_S}; samesite=lax${secure}`;
  } catch {
    /* The stash is the other signal; losing this one only costs a retry. */
  }
};

export default function usePostLoginHandoff() {
  const { data: consent } = useConsentStatus();
  const { user } = useAuthContext();
  const { conversation, isSubmitting } = useChatContext();
  const { submitMessage } = useSubmitMessage();

  const uid = user?.id;

  /**
   * `submitMessage` is a new function on most renders; keeping it in a ref stops
   * it from re-triggering an effect whose whole job is to run once.
   */
  const submitRef = useRef(submitMessage);
  submitRef.current = submitMessage;

  const startedRef = useRef(false);

  /**
   * Four conditions, all load-bearing:
   *  - consent recorded — nothing may be sent on the user's behalf before they
   *    have accepted the framing (the modal blocks until then);
   *  - the account is known — a claimed question is delivered to its owner and
   *    to nobody else, and until the user query lands there is nothing to check
   *    that against. Waiting costs a render; guessing costs the guard;
   *  - the conversation is the *new* one — the question belongs in a fresh
   *    conversation, never appended to whatever the user happens to have open;
   *  - the conversation has an endpoint — `ChatRoute` applies the default
   *    `modelSpecs` preset in an effect, and asking before that lands would send
   *    against a half-initialised conversation.
   */
  const ready =
    consent?.recorded === true &&
    uid != null &&
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
   * A sign-out and a sign-in can both happen inside one page context. The claim
   * was authorised for whoever was signed in when it left, so a message must
   * never land in the session of whoever is signed in when it returns.
   */
  const uidRef = useRef(uid);
  uidRef.current = uid;
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
    const startedAsUid = uid;

    /** Everything the question needs to still be a *deliverable* question. */
    const deliverable = () =>
      mountedRef.current &&
      readyRef.current &&
      uidRef.current === startedAsUid &&
      conversationIdRef.current === startedInConversationId &&
      isSubmittingRef.current !== true;

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
        : { text: stash.text, id: stash.id, ts: stash.ts, uid: stash.uid };

    /**
     * A question already confirmed as this account's that could not be asked yet
     * — the chat had moved on, or `ask` refused. The credential is spent, so
     * there is nothing left to re-claim and this text is the only copy: it is
     * asked directly, without going back to the server.
     *
     * Page state is the fast path; the stash's `claimed` flag is what makes it
     * survive a hard reload, which page state cannot. Without the flag, a reload
     * in this window sent the hook back to the server, got the 404 a spent
     * credential earns, and dropped a question that was sitting in localStorage.
     *
     * Skipping the server is exactly why the owner has to be checked here. That
     * 404 used to be the backstop: a leftover copy offered to the next account
     * simply got refused. Delivering it locally removes that, and on a shared
     * browser — one sign-out, one sign-in, inside the 24h window — it would open
     * a stranger's first conversation with a question already bound to someone
     * else's account. Anything not provably this account's falls through to the
     * normal claim, which answers 404 and drops it.
     */
    const ownedByUser = (owner?: string) => owner != null && owner === uid;

    const claimedStash: PendingQuestion | null =
      stash?.claimed === true && stashed != null && ownedByUser(stashed.uid) ? stashed : null;

    const pending: PendingQuestion | null =
      state.undelivered != null && ownedByUser(state.undelivered.uid)
        ? state.undelivered
        : claimedStash;

    /**
     * Keep a question that is ours but could not be asked. Both records are
     * written: page state, which is fast and dies with the page, and the stash
     * flagged `claimed`, which survives a reload. `ts` is taken once and then
     * carried, so a run of failed deliveries cannot roll the 24h window forward
     * a step at a time and outlive the visit it belongs to.
     */
    const hold = (question: PendingQuestion) => {
      const held: PendingQuestion = { ...question, ts: question.ts ?? Date.now(), uid };
      state.undelivered = held;
      saveStash({ ...held, claimed: true });
      startedRef.current = false;
    };

    if (pending != null) {
      startedRef.current = true;
      /**
       * Consumed before the submit, not after it: `localStorage` is shared by
       * every tab of this browser, and a second page context that finds a
       * `claimed` question still sitting there delivers it too. Same discipline
       * as the claim path below, for the same reason.
       */
      clearStash();
      if (!deliverable() || submitRef.current({ text: pending.text }) === false) {
        /* Still ours, still unasked — keep both records of that for a later mount. */
        hold(pending);
        return;
      }
      state.undelivered = null;
      return;
    }

    if (state.claimStarted) {
      return;
    }

    /**
     * Either signal is enough — the marker covers the storage-blocked browser,
     * the stash covers a marker the server has already cleared — but with
     * neither, this account parked nothing and the claim would only burn a
     * shared rate-limit slot to be told so.
     */
    const markerPresent = hasClaimMarker();
    if (!markerPresent && stashed == null) {
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
       * Both signals are spent before the claim goes out, not after it returns.
       * Either one left readable during the round trip is enough for a second
       * tab — which has its own page-context state — to treat the question as
       * still parked and claim it too; the claim is idempotent for its owner, so
       * both would succeed and the question would be asked twice. The server
       * clears its copies as well, but only once the response lands, which is
       * far too late to be the guard.
       *
       * The accepted cost: between here and the response, this browser holds no
       * record that anything was parked, so a tab closed mid-claim loses the
       * question even though the credential is still valid for 24h. That is the
       * deliberate trade for closing the duplicate-ask window, and it is the
       * rarer of the two — a page has to die inside one request.
       */
      spendClaimMarker();
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
        if (markerPresent) {
          restoreClaimMarker();
        }
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
        uid,
      };

      /**
       * The claim succeeded, which only means the question is *ours* — not that
       * this is still a place to ask it. In the time the round trip took, the
       * component may have unmounted (a jump to `/search`, `/prompts`), the user
       * may have opened another conversation from the sidebar, or they may have
       * typed and sent a message of their own; and `ask` itself may refuse to
       * append to a preliminary assistant message. None of those may consume the
       * question — but the cookie is spent, so it is held in page state AND
       * written back to the stash flagged `claimed`, which is the only one of
       * the two that survives a reload. A re-claim would now 404.
       */
      if (!deliverable() || submitRef.current({ text }) === false) {
        hold(question);
      }
    })();
    /**
     * `uid` belongs here as well as in `ready`: it is read directly inside the
     * effect, and a sign-in that replaces the account is a reason to look again
     * — the per-instance and page-context guards decide whether anything comes
     * of it.
     */
  }, [ready, uid]);
}
