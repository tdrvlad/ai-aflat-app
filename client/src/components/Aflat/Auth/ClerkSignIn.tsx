import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { roRO } from '@clerk/localizations';
import { ClerkProvider, SignIn, useAuth } from '@clerk/clerk-react';
import { apiBaseUrl, request } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
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
};

/**
 * Runs the moment Clerk reports a signed-in session.
 *
 * The exchange sets a refresh cookie and returns nothing else; a full reload is
 * then the simplest correct way to pick it up, because it lets the app's existing
 * auth bootstrap establish the session exactly as it does after an OIDC redirect.
 * Reusing that path is deliberate — the less bespoke session handling on the login
 * route, the fewer ways it can go wrong.
 */
function ClerkHandoff({ onFailed }: { onFailed: (reason: string) => void }) {
  const { isSignedIn, getToken } = useAuth();
  const [state, setState] = useState<HandoffState>('idle');

  useEffect(() => {
    if (!isSignedIn || state !== 'idle') {
      return;
    }

    let cancelled = false;
    setState('exchanging');

    const run = async () => {
      try {
        const token = await getToken();
        if (!token) {
          throw new Error('no_token');
        }
        await request.post(exchangeUrl(), { token });
        if (cancelled) {
          return;
        }
        window.location.assign('/');
      } catch (error) {
        if (cancelled) {
          return;
        }
        const code =
          (error as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          'exchange_failed';
        setState('failed');
        onFailed(code);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, state, getToken, onFailed]);

  return null;
}

export default function ClerkSignIn({ publishableKey }: { publishableKey: string }) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const [failure, setFailure] = useState<string | null>(null);

  const message = localize((failure && FAILURE_KEYS[failure]) || 'com_aflat_auth_exchange_failed');

  return (
    /* Clerk ships its own copy; without this the first screen a user sees is English. */
    <ClerkProvider publishableKey={publishableKey} localization={roRO}>
      <ClerkHandoff onFailed={setFailure} />

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

      <SignIn
        routing="virtual"
        appearance={{
          elements: {
            /* Clerk's own card chrome would sit inside ours; ours is the one that stays. */
            rootBox: 'w-full',
            cardBox: 'w-full shadow-none border-none',
            card: 'w-full shadow-none bg-transparent p-0',
            header: 'hidden',
            footer: 'hidden',
          },
          variables: {
            colorPrimary: 'var(--panza-cta)',
            borderRadius: '0.75rem',
          },
        }}
      />
    </ClerkProvider>
  );
}
