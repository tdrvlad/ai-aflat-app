import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { roRO } from '@clerk/localizations';
import { ClerkProvider, SignIn, useAuth, useClerk } from '@clerk/clerk-react';
import { Spinner } from '@librechat/client';
import type { ClerkBridgeState } from './ClerkBridge';
import { useClerkBridge } from './ClerkBridge';
import { useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks';

/**
 * ai-aflat: Clerk's sign-in widget rendered inside our own page.
 *
 * Replaces the redirect to Clerk's hosted page, which was neither our page nor
 * instant — the load delay read as a stall rather than a step.
 *
 * The widget only authenticates against Clerk. Exchanging the resulting Clerk
 * session for a LibreChat one is `useClerkBridge`'s job (`ClerkBridge.tsx`),
 * which deliberately lives *above* any surface that mounts and unmounts around
 * the sign-in moment. This file is presentation: the widget, restyled to pass
 * for part of our page, plus the busy/failed states the bridge reports.
 * See `docs/superpowers/specs/2026-08-04-clerk-embedded-auth-design.md`.
 */

/** Server error codes that deserve a specific explanation rather than a generic one. */
const FAILURE_KEYS: Record<string, TranslationKeys> = {
  domain_not_allowed: 'com_aflat_auth_domain_blocked',
  account_conflict: 'com_aflat_auth_account_conflict',
  email_missing: 'com_aflat_auth_email_missing',
};

/**
 * The widget resumes whatever sign-in attempt the Clerk client already holds —
 * and an abandoned attempt survives the page, the modal and even a cookie
 * clear, because it lives on Clerk's client object server-side. A visitor who
 * typed an email yesterday and closed the tab reopens this modal not at the
 * identifier screen but at „factor one" for that half-finished attempt; for a
 * password-less (Google-created) account that screen offers nothing but the
 * Google button and reads as a dead end. Measured live 2026-08-06: the modal
 * opened at `#/factor-one` for a stale attempt on a supposedly cold browser.
 *
 * So: if the client carries an in-progress attempt and no signed-in session,
 * the client is destroyed — clerk-js mints a fresh one lazily — and only then
 * is the widget mounted. This runs exactly once, at the moment the widget is
 * about to appear — never from a reactive effect that could fire mid-handshake.
 */
function useFreshSignInAttempt(): boolean {
  const clerk = useClerk();
  const { isSignedIn } = useAuth();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready) {
      return;
    }
    if (!clerk.loaded) {
      return;
    }
    /**
     * A *completed* attempt is not a stale one, and destroying the client
     * throws its sessions away with it.
     *
     * `isSignedIn` is false for a moment after an OAuth popup returns, while
     * clerk-js resolves the new session — and in that same moment `signUp` or
     * `signIn` is sitting at `complete`. The first version of this guard read
     * that pair as "an abandoned attempt and nobody signed in" and destroyed
     * the client, discarding a sign-in that had just succeeded. That is a
     * sign-in that has to be performed two or three times before one of them
     * happens to survive the race (reported 2026-08-07).
     *
     * So: only an attempt that is both unfinished and unaccompanied by any
     * session counts as stale.
     */
    const signInStatus = clerk.client?.signIn?.status ?? null;
    const signUpStatus = clerk.client?.signUp?.status ?? null;
    const attemptInProgress =
      (signInStatus != null && signInStatus !== 'complete') ||
      (signUpStatus != null && signUpStatus !== 'complete');
    const hasSession = clerk.session != null || (clerk.client?.activeSessions?.length ?? 0) > 0;

    const staleAttempt = attemptInProgress && !hasSession && isSignedIn !== true;
    if (!staleAttempt) {
      setReady(true);
      return;
    }
    let cancelled = false;
    void clerk.client
      .destroy()
      .catch(() => undefined) /* a failed reset still beats not mounting at all */
      .finally(() => {
        if (!cancelled) {
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ready, clerk, clerk.loaded, isSignedIn]);

  return ready;
}

/**
 * The widget plus the bridge's reported state, shared by the login modal and
 * the `/login` page. The bridge itself is *not* mounted here — the caller
 * decides where the orchestration lives (the anonymous shell for the modal,
 * this route's own provider for `/login`).
 */
export function SignInPanel({ bridge }: { bridge: ClerkBridgeState }) {
  const localize = useLocalize();
  const navigate = useNavigate();

  const busy = bridge.status === 'exchanging';
  const failure = bridge.status === 'failed' ? bridge.failure : null;
  const message = localize((failure && FAILURE_KEYS[failure]) || 'com_aflat_auth_exchange_failed');

  return (
    <>
      {failure != null && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-border-light bg-surface-secondary px-4 py-3 text-sm text-text-primary"
        >
          <p>{message}</p>
          {/**
           * Two ways forward, because the modal this renders in cannot be
           * dismissed: retry re-runs the exchange for the session Clerk
           * already holds (the common transient failure), and the fallback is
           * the full-page OIDC door for when the embedded path itself is what
           * is broken.
           */}
          <div className="mt-2 flex items-center gap-4">
            <button
              type="button"
              onClick={bridge.retry}
              className="text-sm font-medium text-[var(--panza-link)] underline"
            >
              {localize('com_aflat_auth_retry')}
            </button>
            <button
              type="button"
              onClick={() => navigate('/login/redirect')}
              className="text-sm font-medium text-[var(--panza-link)] underline"
            >
              {localize('com_aflat_auth_use_fallback')}
            </button>
          </div>
        </div>
      )}

      {/**
       * Clerk's widget has to pass for part of our page, not sit in it as a
       * borrowed component.
       *
       * Its defaults are built for a card of its own: 13px type and 30px
       * controls. Dropped into our modal — 18px title, 14px body, a 44px
       * composer behind the dim — that reads as a smaller, foreign interface
       * pasted into ours, which is exactly the thing this screen cannot afford
       * at the moment it asks for an email address.
       *
       * So the type is raised to our body size and every control is given the
       * same 44px as our own inputs. The heights are set on the elements rather
       * than left to `spacingUnit`, because that variable also drives the gaps
       * between fields and inflating it opens the layout up as well.
       */}
      {/**
       * The gap between „Clerk says you are signed in" and „the app says so too".
       *
       * It is a token exchange, and until now it drew nothing at all: Clerk's
       * own widget is finished and stops showing its spinner, so the modal
       * simply sat there — the same silence as a dead button, at the one
       * moment the user has just handed over a password. Absolutely positioned
       * over the widget rather than replacing it, so the box does not change
       * height on the way out.
       */}
      <div className="relative">
        {busy && (
          <div
            role="status"
            data-testid="aflat-auth-busy"
            className="bg-surface-primary/90 absolute inset-0 z-10 flex flex-col items-center justify-center gap-3"
          >
            <Spinner size={28} />
            <p className="m-0 text-sm text-text-secondary">
              {localize('com_aflat_auth_signing_in')}
            </p>
          </div>
        )}
        <FreshWidget />
      </div>
    </>
  );
}

/**
 * `/login`'s embedded sign-in: this route sits outside the anonymous shell, so
 * it mounts its own Clerk provider and its own bridge. `onSignedIn` navigates —
 * unlike the modal, this page is a destination of its own and has to name the
 * next one.
 */
export default function ClerkSignIn({
  publishableKey,
  onSignedIn,
}: {
  publishableKey: string;
  onSignedIn?: () => void;
}) {
  const navigate = useNavigate();
  return (
    /* Clerk ships its own copy; without this the first screen a user sees is English. */
    <ClerkProvider
      publishableKey={publishableKey}
      localization={roRO}
      /**
       * SPA navigation for clerk-js, or completing an email code ends in a
       * `window.location` assignment — a full reload at the moment of success.
       * Same wiring, same reason as `AnonClerkProvider` (see `ClerkBridge.tsx`).
       */
      routerPush={(to: string) => navigate(to)}
      routerReplace={(to: string) => navigate(to, { replace: true })}
    >
      <BridgedPanel onSignedIn={onSignedIn} />
    </ClerkProvider>
  );
}

function BridgedPanel({ onSignedIn }: { onSignedIn?: () => void }) {
  const bridge = useClerkBridge(onSignedIn);
  return <SignInPanel bridge={bridge} />;
}

/**
 * The widget itself, mounted only once `useFreshSignInAttempt` has said the
 * client is clean — a stale attempt would otherwise open the modal mid-flow
 * (see the hook's comment). The spinner stands in during the reset, which is
 * one round trip at worst and usually nothing.
 */
function FreshWidget() {
  const fresh = useFreshSignInAttempt();

  if (!fresh) {
    return (
      <div className="flex min-h-[180px] items-center justify-center" role="status">
        <Spinner size={28} />
      </div>
    );
  }

  return (
    <SignIn
      routing="virtual"
      /**
       * Sign-in *or up*, from the one form.
       *
       * `<SignIn>` on its own is exactly that — sign-in — so an email it has
       * never seen is answered with „Couldn't find your account." and a dead
       * end. That is the wrong half of the product: this modal is raised at
       * the moment a stranger asks their first question, its own title says
       * „Creează cont ca să primești răspunsul", and almost everyone who
       * reaches it has no account yet. With this, an unknown address moves
       * straight on to creating one instead of being told off for not
       * already existing.
       */
      withSignUp={true}
      /**
       * Google and Facebook in a popup, not a full-page redirect.
       *
       * The default sends the whole tab to the provider, which tears down the
       * conversation this modal is floating over — the question, the thread,
       * the scroll position — and returns the user to a cold app boot. That
       * is precisely the „resume the conversation you already started"
       * promise the embedded widget exists to keep, so the redirect breaks
       * the feature rather than merely looking worse.
       */
      oauthFlow="popup"
      /**
       * Where Clerk lands the user if it ever completes by REDIRECT instead of
       * the popup — which is not hypothetical: mobile browsers block popups, and
       * Clerk then falls back to a full-page trip through the provider and its
       * own account portal (`accounts.ai-aflat.ro`, measured on mobile
       * 2026-08-06). Without these the return leg is the portal's configured
       * landing page, i.e. off our app entirely; with them the user comes back
       * to the chat route, where the shell-level bridge (`ClerkBridge.tsx`)
       * exchanges the session on boot and the parked question is picked up
       * from localStorage exactly as it is after the popup flow.
       */
      fallbackRedirectUrl="/c/new"
      signUpFallbackRedirectUrl="/c/new"
      appearance={{
        elements: {
          /* Clerk's own card chrome would sit inside ours; ours is the one that stays. */
          rootBox: 'w-full',
          cardBox: 'w-full shadow-none border-none',
          card: 'w-full shadow-none bg-transparent p-0',
          /**
           * The title goes, the subtitle stays.
           *
           * Clerk's title only ever repeats ours — two „Creează cont"
           * headings, one above the other. Its subtitle is a different
           * thing: it is the *per-step* instruction, and on the code step it
           * is the only place that says a code was sent and to which
           * address. Hiding the whole header left that step as six unlabelled
           * boxes with nothing explaining what belongs in them.
           */
          headerTitle: 'hidden',
          headerSubtitle: 'text-sm text-text-secondary',
          footer: 'hidden',
          formButtonPrimary: 'min-h-[44px] text-sm font-medium normal-case tracking-normal',
          formFieldInput: 'min-h-[44px] text-sm',
          socialButtonsBlockButton: 'min-h-[44px] text-sm',
          /* Decoration on the one button that needs no help being found. */
          buttonArrowIcon: 'hidden',
        },
        variables: {
          colorPrimary: 'var(--panza-cta)',
          /* `--radius` (style.css) is the app's own control radius; Clerk's 0.75rem
             default read as a separate, rounder interface pasted into ours. */
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
        },
      }}
    />
  );
}
