import { ThemeSelector } from '@librechat/client';
import { BrandLockup, APP_NAME } from '~/components/Brand';
import { useLocalize } from '~/hooks';

/**
 * The chat screen's chrome for a visitor with no session.
 *
 * Same layout skeleton as the signed-in shell — header bar on top, the chat
 * filling the rest — differing only in what the header's right side can offer.
 * There is no balance chip and no account menu because there is no account, and
 * the sidebar is absent rather than empty: rendering it would fire the
 * authenticated conversation queries, which are not gated on auth state.
 * Restoring it as a sign-in invitation belongs with the rest of the chrome work.
 *
 * The sign-in link matters more than it looks. Every anonymous visitor lands
 * here, including an account holder whose session expired on a bookmarked link,
 * so signing in has to be reachable without walking the ask flow first.
 */
export default function AnonShell({ children }: { children: React.ReactNode }) {
  const localize = useLocalize();

  return (
    <div className="relative flex h-dvh flex-col bg-presentation text-text-primary">
      <header className="flex w-full items-center justify-between gap-2 border-b border-border-light px-4 py-3">
        <BrandLockup className="h-6" alt={localize('com_ui_logo', { 0: APP_NAME })} />
        <div className="flex items-center gap-3">
          <ThemeSelector returnThemeOnly={true} />
          <a
            href="/login"
            data-testid="aflat-signin-link"
            className="text-sm text-text-secondary underline decoration-border-heavy underline-offset-2 transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
          >
            {localize('com_aflat_signin_link')}
          </a>
        </div>
      </header>
      <div className="flex flex-1 flex-col overflow-y-auto">{children}</div>
    </div>
  );
}
