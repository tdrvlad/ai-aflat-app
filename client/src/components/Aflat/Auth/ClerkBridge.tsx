import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { roRO } from '@clerk/localizations';
import { ClerkProvider, useAuth, useClerk } from '@clerk/clerk-react';
import { apiBaseUrl, request } from 'librechat-data-provider';
import type { TRefreshTokenResponse } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import { clerkSignOutPending, clearClerkSignOutPending } from './clerkSignOut';
import { traceAuth, traceBoot } from './authTrace';
import { useGetStartupConfig } from '~/data-provider';
import { useAuthContext } from '~/hooks';

/**
 * ai-aflat: the bridge from a Clerk session to an app session, held at the
 * *shell* level rather than inside the login modal.
 *
 * The moment control passes from Clerk's state machine to ours is the seam
 * every auth bug so far has lived on, and a component that mounts and unmounts
 * around that moment cannot own it. So the orchestration lives here, above the
 * modal: it watches clerk-js for a session, exchanges it exactly once per
 * Clerk session id, and adopts the result in place. The modal only *renders* —
 * Clerk's widget plus whatever state this bridge reports.
 *
 * Holding it at the shell also closes the return legs the modal could never
 * see: a sign-in that completes by full-page redirect (mobile blocks the OAuth
 * popup), an email link opened in a new tab of the same browser, or a session
 * signed in by another tab and synced over by clerk-js. In all of those the
 * user lands on an anonymous shell with a live Clerk session and, before this,
 * nothing ever exchanged it — they stayed anonymous, the corner sign-in link
 * stayed up, and the parked question sat unclaimed.
 */

const exchangeUrl = () => `${apiBaseUrl()}/api/aflat/auth/clerk`;

export type BridgeStatus = 'idle' | 'exchanging' | 'failed';

export type ClerkBridgeState = {
  status: BridgeStatus;
  /** Server error code, when `status` is `'failed'`. */
  failure: string | null;
  /** Clears the failed attempt so the exchange may run again. */
  retry: () => void;
};

/**
 * Watches the ambient Clerk instance and exchanges its session for an app
 * session. Must be rendered inside a `<ClerkProvider>` and the app's
 * `AuthContextProvider`.
 *
 * Two disciplines, both learned the hard way:
 *
 * - **Nothing cancels an exchange that is already in flight.** The previous
 *   version kept its `state` in the effect's dependencies and set it inside
 *   the effect — so starting the exchange re-ran the effect, and React's
 *   cleanup flipped the `cancelled` flag *before the network round trip came
 *   back*. The response was then discarded at the `if (cancelled)` check and
 *   `establishSession` never ran: the direct-adoption path shipped in
 *   f139d09db was dead at runtime, and every login that "worked" got in
 *   sideways through the refresh-cookie path whenever something happened to
 *   re-trigger it. That is the "sign in two or three times" symptom. A session
 *   the server has minted is real whether or not this component is still
 *   mounted, so adoption always completes; only the UI updates check.
 *
 * - **Keyed, not gated.** The exchange runs once per Clerk `sessionId`, held
 *   in a ref — so listener re-emissions, re-renders and double-mounted
 *   effects are harmless, and a genuinely new session (sign-out, sign-in as
 *   someone else) is bridged again.
 */
export function useClerkBridge(onSignedIn?: () => void): ClerkBridgeState {
  const clerk = useClerk();
  const { isSignedIn, sessionId, getToken } = useAuth();
  const { establishSession } = useAuthContext();
  const [status, setStatus] = useState<BridgeStatus>('idle');
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * A logout leaves a marker instead of reaching Clerk (see `clerkSignOut.ts`).
   * Until that marker is spent, the surviving Clerk session is a leftover to be
   * destroyed, not an intent to be exchanged — bridging it would sign the user
   * straight back in and make logging out impossible.
   */
  const [purging, setPurging] = useState(clerkSignOutPending);
  const [retryTick, setRetryTick] = useState(0);
  const attemptedSessionRef = useRef<string | null>(null);

  /**
   * Mounted-ness for UI state only. The exchange itself deliberately outlives
   * the component — see the hook comment.
   */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * These change identity across renders (clerk-js recreates `getToken`, and
   * the caller may pass an inline `onSignedIn`). Reading them through refs
   * keeps them out of the exchange effect's dependencies — a changed identity
   * must not re-run, and above all must not *clean up*, an exchange in flight.
   */
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const establishSessionRef = useRef(establishSession);
  establishSessionRef.current = establishSession;
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;

  useEffect(() => {
    if (!purging || !clerk.loaded) {
      return;
    }
    traceAuth('clerk_signout_pending');
    void clerk
      .signOut()
      .catch(
        () => undefined,
      ) /* worst case: still signed in at Clerk, i.e. the pre-marker behavior */
      .finally(() => {
        clearClerkSignOutPending();
        if (mountedRef.current) {
          setPurging(false);
        }
      });
  }, [purging, clerk, clerk.loaded]);

  useEffect(() => {
    if (purging || isSignedIn !== true || sessionId == null) {
      return;
    }
    if (attemptedSessionRef.current === sessionId) {
      return;
    }
    attemptedSessionRef.current = sessionId;
    setStatus('exchanging');
    setFailure(null);
    traceAuth('exchange_start', { session: sessionId });

    void (async () => {
      try {
        const token = await getTokenRef.current();
        if (!token) {
          throw new Error('no_token');
        }
        traceAuth('token_ok');
        const session = (await request.post(exchangeUrl(), {
          token,
        })) as TRefreshTokenResponse;
        /**
         * The exchange hands back the session it just created, and it is
         * adopted directly. It used to be redeemed through a second round trip
         * to the refresh endpoint — and a browser that declined to return the
         * freshly set cookie left a fully successful sign-in with no session
         * in the page at all.
         */
        traceAuth('exchange_ok', { has_token: session?.token != null });
        if (!(await establishSessionRef.current(session))) {
          throw new Error('session_not_established');
        }
        traceAuth('session_established');
        onSignedInRef.current?.();
      } catch (error) {
        const code =
          (error as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'exchange_failed';
        traceAuth('exchange_failed', { code, mounted: mountedRef.current });
        if (mountedRef.current) {
          setStatus('failed');
          setFailure(code);
        }
      }
    })();
    /**
     * `retryTick` is the deliberate odd one out: `retry()` clears the attempt
     * ref, and this is what makes the effect look again at a session id it has
     * already tried. Everything else the exchange reads lives in refs so that
     * nothing here re-fires — or cleans up — around an exchange in flight.
     */
  }, [purging, isSignedIn, sessionId, retryTick]);

  const retry = useCallback(() => {
    attemptedSessionRef.current = null;
    setFailure(null);
    setStatus('idle');
    setRetryTick((tick) => tick + 1);
  }, []);

  return useMemo(() => ({ status, failure, retry }), [status, failure, retry]);
}

export type AnonAuthValue = ClerkBridgeState & {
  /** False when Clerk is not configured — the consumer has no widget to show. */
  enabled: boolean;
};

const noop = () => undefined;

const AnonAuthContext = createContext<AnonAuthValue>({
  status: 'idle',
  failure: null,
  retry: noop,
  enabled: false,
});

/** The bridge's state, readable anywhere under `AnonClerkProvider`. */
export const useAnonAuth = (): AnonAuthValue => useContext(AnonAuthContext);

function BridgeProvider({ children }: { children: ReactNode }) {
  const bridge = useClerkBridge();
  /**
   * One line per page load, at the top of the anonymous tree. A load that
   * lands in the middle of an attempt is the reload this flow keeps dying to,
   * and this is the only place it leaves a mark.
   */
  useEffect(() => {
    traceBoot();
  }, []);
  const value = useMemo<AnonAuthValue>(() => ({ ...bridge, enabled: true }), [bridge]);
  return <AnonAuthContext.Provider value={value}>{children}</AnonAuthContext.Provider>;
}

/**
 * Clerk for the whole anonymous tree.
 *
 * Mounted by `Root` around the anonymous shell, so clerk-js is alive from the
 * first anonymous render: a redirect return or a second tab is bridged on
 * boot, without the user having to reopen the login modal — or even knowing
 * there is one. `onSignedIn` is nobody's business here: adopting the session
 * flips `isAuthenticated`, `Root` swaps this entire tree for the signed-in
 * shell, and the corner sign-in link goes with it.
 *
 * Renders children bare when Clerk is unconfigured; `useAnonAuth().enabled`
 * is how consumers know the difference.
 */
export function AnonClerkProvider({ children }: { children: ReactNode }) {
  const { data: startupConfig } = useGetStartupConfig();
  const navigate = useNavigate();
  const publishableKey = startupConfig?.clerkPublishableKey ?? null;

  if (!publishableKey) {
    return <>{children}</>;
  }

  return (
    /* Clerk ships its own copy; without this the first screen a user sees is English. */
    <ClerkProvider
      publishableKey={publishableKey}
      localization={roRO}
      /**
       * Clerk's navigations must ride the SPA router, never `window.location`.
       *
       * Without these, clerk-js "navigates" by assigning `window.location` —
       * and it navigates at the worst possible moment: completing an email-code
       * sign-up ends with a trip to the after-sign-up URL, which as a location
       * assignment is a FULL PAGE RELOAD at the exact instant of success. The
       * user watches the app die and boot back up, signed in only after the
       * boot-time bridge runs — measured live 2026-08-07 (a window marker
       * planted before sign-up was gone after the code was accepted). The
       * OAuth popup path never tripped this, which is why Google "worked" and
       * email "was buggy".
       */
      routerPush={(to: string) => navigate(to)}
      routerReplace={(to: string) => navigate(to, { replace: true })}
    >
      <BridgeProvider>{children}</BridgeProvider>
    </ClerkProvider>
  );
}
