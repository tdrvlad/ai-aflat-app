import { useEffect } from 'react';
import { apiBaseUrl, request } from 'librechat-data-provider';
import { useGetStartupConfig } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';

/**
 * ai-aflat: LOCAL DEVELOPMENT ONLY — signs in without credentials.
 *
 * It exists so the chat surface can be reviewed without walking the identity
 * flow first. The server decides whether the door is open (`devAutoLogin` on the
 * startup config, computed by the route that implements it); this only walks
 * through it. If the flag is false — and it is false everywhere but a localhost
 * deployment with the env var deliberately set — nothing here fires at all.
 *
 * TO REMOVE: delete this file, its call in `routes/Root.tsx`, and the server
 * half listed in `api/server/routes/devAuth.js`.
 */

/**
 * One attempt per tab, and it has to survive the reload below — `sessionStorage`
 * rather than a ref, which a reload resets. Without it a server that mints the
 * cookie but cannot be redeemed would reload forever.
 */
const LATCH_KEY = 'aflat_dev_autologin_tried';

const latched = (): boolean => {
  try {
    return sessionStorage.getItem(LATCH_KEY) === 'done';
  } catch {
    /* Storage blocked: treat as latched, because an unlatched retry loop is the
       worse failure of the two. */
    return true;
  }
};

const latch = () => {
  try {
    sessionStorage.setItem(LATCH_KEY, 'done');
  } catch {
    /* See above — the reload simply will not be protected, so do not do it. */
  }
};

export default function useDevAutoLogin(): void {
  const { data: startupConfig } = useGetStartupConfig();
  const { isAuthenticated } = useAuthContext();
  const enabled = startupConfig?.devAutoLogin === true;

  useEffect(() => {
    if (!enabled || isAuthenticated || latched()) {
      return;
    }

    void (async () => {
      try {
        await request.post(`${apiBaseUrl()}/api/aflat/auth/dev`, {});
      } catch {
        /* Silent on purpose: this is scaffolding, and the real sign-in is still
           behind it. A failure means the login modal, not an error page. */
        latch();
        return;
      }
      latch();
      /**
       * Reload rather than swapping the session in place, which is what the
       * embedded Clerk flow does.
       *
       * That flow has a conversation to preserve — a parked question, a scroll
       * position — so it cannot afford a boot. This runs on a cold, empty load
       * where there is nothing to lose, and the reload buys something the
       * in-place path cannot have here: the app's own `silentRefresh` is already
       * in flight when this fires, and when it fails (there was no cookie yet)
       * it writes `isAuthenticated: false` through a debounced setter — landing
       * *after* our success and erasing it. Reloading lets the ordinary boot
       * path find the cookie and sign in the way it always does, instead of
       * racing it.
       */
      window.location.reload();
    })();
  }, [enabled, isAuthenticated]);
}
