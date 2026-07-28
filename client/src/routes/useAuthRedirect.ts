import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthContext } from '~/hooks';

/**
 * ai-aflat: an unauthenticated visitor is sent to the public ask gate, not to
 * `/login`. Signing in is the *outcome* of parking a question, not the price of
 * admission, so the sign-in prompt lives inside the gate. The authenticated
 * path is untouched.
 */
const ANON_GATE_PATH = '/ask';

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
