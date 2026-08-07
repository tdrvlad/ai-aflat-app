/**
 * The marker that carries "the user just logged out" across the auth trees.
 *
 * Clerk publishes no `end_session_endpoint` (measured on both instances,
 * 2026-08-07), so the server's logout can end our session but never Clerk's —
 * the Clerk session survives in the browser. Left alone, the next anonymous
 * surface to mount would read that surviving session as intent and exchange it
 * straight back into an app session, which turns „Ieșire" into a no-op.
 *
 * Clerk-js is only mounted on the anonymous surfaces, so the logout itself —
 * which happens in the authenticated tree — cannot call `clerk.signOut()`.
 * Instead it leaves this marker, and the bridge spends it by signing out of
 * Clerk before it reads Clerk's session as anything.
 *
 * `sessionStorage`, not `localStorage`: the disagreement being resolved belongs
 * to this tab. Another tab may be mid-sign-in, and a logout here must not
 * reach across and destroy that attempt.
 */
const SIGN_OUT_KEY = 'aflat_clerk_signout';

export const markClerkSignOutPending = (): void => {
  try {
    sessionStorage.setItem(SIGN_OUT_KEY, '1');
  } catch {
    /* No storage: the bridge will re-adopt the Clerk session, which is the
     * pre-marker behavior — signed in is the failure mode, not data loss. */
  }
};

export const clerkSignOutPending = (): boolean => {
  try {
    return sessionStorage.getItem(SIGN_OUT_KEY) === '1';
  } catch {
    return false;
  }
};

export const clearClerkSignOutPending = (): void => {
  try {
    sessionStorage.removeItem(SIGN_OUT_KEY);
  } catch {
    /* nothing to clear */
  }
};
