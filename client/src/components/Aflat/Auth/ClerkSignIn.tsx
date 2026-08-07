import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { roRO } from '@clerk/localizations';
import { ClerkProvider, SignIn, useAuth, useClerk } from '@clerk/clerk-react';
import { apiBaseUrl, request } from 'librechat-data-provider';
import { Spinner } from '@librechat/client';
import type { TRefreshTokenResponse } from 'librechat-data-provider';
import { useAuthContext, useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks';

/**
 * ai-aflat: Clerk's sign-in widget rendered inside our own page.
 *
 * Replaces the redirect to Clerk's hosted page, which was neither our page nor
 * instant — the load delay read as a stall rather than a step.
 *
 * The widget authenticates against Clerk; `ClerkHandoff` then exchanges the
 * resulting Clerk session for a LibreChat one. Nothing here mints a session
 * itself; see `docs/superpowers/specs/2026-08-04-clerk-embedded-auth-design.md`.
 */

const exchangeUrl = () => `${apiBaseUrl()}/api/aflat/auth/clerk`;

type HandoffState = 'idle' | 'exchanging' | 'failed';

/** Server error codes that deserve a specific explanation rather than a generic one. */
const FAILURE_KEYS: Record<string, TranslationKeys> = {
  domain_not_allowed: 'com_aflat_auth_domain_blocked',
  account_conflict: 'com_aflat_auth_account_conflict',
  email_missing: 'com_aflat_auth_email_missing',
};

/**
 * Runs the moment Clerk reports a signed-in session.
 *
 * The exchange sets an httpOnly refresh cookie and returns nothing else, so the
 * page has to go and redeem it. `establishSession` does that through the app's
 * existing refresh path — the same step a cold load performs — and then swaps the
 * auth context in place.
 *
 * In place is the requirement, not an optimisation. This widget renders inside a
 * modal over a conversation that already holds the user's parked question; a
 * reload would remount that conversation and make them watch the app boot at
 * precisely the moment they are owed an answer. `onSignedIn` closes the modal
 * and the thread continues, same scroll, same conversation id.
 */
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
 * is the widget mounted. Destroying is safe precisely because this modal only
 * exists for anonymous visitors: there is no session to lose by definition,
 * and the guard below refuses to run when one exists anyway.
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
    const staleAttempt =
      isSignedIn !== true &&
      (clerk.client?.signIn?.status != null || clerk.client?.signUp?.status != null);
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

function ClerkHandoff({
  onSignedIn,
  onFailed,
  onBusy,
}: {
  onSignedIn?: () => void;
  onFailed: (reason: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const { isSignedIn, getToken } = useAuth();
  const { establishSession } = useAuthContext();
  const [state, setState] = useState<HandoffState>('idle');

  useEffect(() => {
    if (!isSignedIn || state !== 'idle') {
      return;
    }

    let cancelled = false;
    setState('exchanging');
    onBusy(true);

    const run = async () => {
      try {
        const token = await getToken();
        if (!token) {
          throw new Error('no_token');
        }
        const session = (await request.post(exchangeUrl(), {
          token,
        })) as TRefreshTokenResponse;
        if (cancelled) {
          return;
        }
        /**
         * The exchange hands back the session it just created, so this adopts
         * it directly. It used to call `establishSession()` empty, which went
         * back to the server to redeem the refresh cookie — and a browser that
         * declined to return that cookie left a fully successful sign-in with
         * no session in the page at all.
         */
        if (!(await establishSession(session))) {
          throw new Error('session_not_established');
        }
        if (cancelled) {
          return;
        }
        onSignedIn?.();
      } catch (error) {
        if (cancelled) {
          return;
        }
        const code =
          (error as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'exchange_failed';
        setState('failed');
        onBusy(false);
        onFailed(code);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, state, getToken, establishSession, onSignedIn, onFailed, onBusy]);

  return null;
}

export default function ClerkSignIn({
  publishableKey,
  onSignedIn,
}: {
  publishableKey: string;
  onSignedIn?: () => void;
}) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const message = localize((failure && FAILURE_KEYS[failure]) || 'com_aflat_auth_exchange_failed');

  return (
    /* Clerk ships its own copy; without this the first screen a user sees is English. */
    <ClerkProvider publishableKey={publishableKey} localization={roRO}>
      <ClerkHandoff onSignedIn={onSignedIn} onFailed={setFailure} onBusy={setBusy} />

      {failure != null && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-border-light bg-surface-secondary px-4 py-3 text-sm text-text-primary"
        >
          <p>{message}</p>
          <button
            type="button"
            onClick={() => navigate('/login/redirect')}
            className="mt-2 text-sm font-medium text-[var(--panza-link)] underline"
          >
            {localize('com_aflat_auth_use_fallback')}
          </button>
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
       * It is a token exchange plus a refresh round trip, and until now it drew
       * nothing at all: Clerk's own widget is finished and stops showing its
       * spinner, so the modal simply sat there — the same silence as a dead
       * button, at the one moment the user has just handed over a password.
       * Absolutely positioned over the widget rather than replacing it, so the
       * box does not change height on the way out.
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
    </ClerkProvider>
  );
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
       * to the chat route, where the parked question is picked up from
       * localStorage exactly as it is after the popup flow.
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
