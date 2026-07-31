import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '~/hooks';

/**
 * ai-aflat: an unauthenticated visitor is sent to the welcome screen, not to
 * `/login`. Signing in is the *outcome* of asking a question, not the price of
 * admission — welcome states what the product is and what it is not, then offers
 * both doors ("create an account" / "try without one"). The sign-in prompt
 * itself lives at the point where there is an answer to read. The authenticated
 * path is untouched.
 */
const ANON_GATE_PATH = '/welcome';

export default function useAuthRedirect() {
  const { user, roles, isAuthenticated } = useAuthContext();
  const navigate = useNavigate();

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (isAuthenticated) {
        return;
      }

      navigate(ANON_GATE_PATH, {
        replace: true,
      });
    }, 300);

    return () => {
      clearTimeout(timeout);
    };
  }, [isAuthenticated, navigate]);

  return {
    user,
    roles,
    isAuthenticated,
  };
}
