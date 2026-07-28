/* eslint-disable i18next/no-literal-string */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import useAuthRedirect from '../useAuthRedirect';
import { useAuthContext } from '~/hooks';

// Polyfill Request for React Router in test environment
if (typeof Request === 'undefined') {
  global.Request = class Request {
    constructor(
      public url: string,
      public init?: RequestInit,
    ) {}
  } as any;
}

jest.mock('~/hooks', () => ({
  useAuthContext: jest.fn(),
}));

/**
 * TestComponent that uses the useAuthRedirect hook and exposes its return value
 */
function TestComponent() {
  const result = useAuthRedirect();
  // Expose result for assertions
  (window as any).__testResult = result;
  return <div data-testid="test-component">Test Component</div>;
}

/**
 * Creates a test router with optional basename to verify navigation works correctly
 * with subdirectory deployments (e.g., /librechat)
 */
const createTestRouter = (basename = '/', initialEntry?: string) => {
  const defaultEntry = basename === '/' ? '/' : `${basename}/`;

  return createMemoryRouter(
    [
      {
        path: '/',
        element: <TestComponent />,
      },
      {
        path: '/login',
        element: <div data-testid="login-page">Login Page</div>,
      },
      {
        /** ai-aflat: unauthenticated visitors land on the public ask gate */
        path: '/ask',
        element: <div data-testid="anon-ask-page">Anon Ask Page</div>,
      },
      {
        path: '/c/:id',
        element: <TestComponent />,
      },
    ],
    {
      basename,
      initialEntries: [initialEntry ?? defaultEntry],
    },
  );
};

describe('useAuthRedirect', () => {
  beforeEach(() => {
    (window as any).__testResult = undefined;
  });

  afterEach(() => {
    jest.clearAllMocks();
    (window as any).__testResult = undefined;
  });

  it('should not redirect when user is authenticated', async () => {
    (useAuthContext as jest.Mock).mockReturnValue({
      user: { id: '123', email: 'test@example.com' },
      isAuthenticated: true,
    });

    const router = createTestRouter();
    const { getByTestId } = render(<RouterProvider router={router} />);

    expect(router.state.location.pathname).toBe('/');
    expect(getByTestId('test-component')).toBeInTheDocument();

    // Wait for the timeout (300ms) plus a buffer
    await new Promise((resolve) => setTimeout(resolve, 400));

    // Should still be on home page, not redirected
    expect(router.state.location.pathname).toBe('/');
    expect(getByTestId('test-component')).toBeInTheDocument();
  });

  it('should redirect to /ask when user is not authenticated', async () => {
    (useAuthContext as jest.Mock).mockReturnValue({
      user: null,
      isAuthenticated: false,
    });

    const router = createTestRouter();
    const { getByTestId, queryByTestId } = render(<RouterProvider router={router} />);

    expect(router.state.location.pathname).toBe('/');
    expect(getByTestId('test-component')).toBeInTheDocument();

    // Wait for the redirect to happen (300ms timeout + navigation)
    await waitFor(
      () => {
        expect(router.state.location.pathname).toBe('/ask');
        expect(getByTestId('anon-ask-page')).toBeInTheDocument();
        expect(queryByTestId('test-component')).not.toBeInTheDocument();
      },
      { timeout: 1000 },
    );

    // Verify navigation used replace (history has only 1 entry)
    // This prevents users from hitting back to return to protected pages
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('should respect router basename when redirecting (subdirectory deployment)', async () => {
    (useAuthContext as jest.Mock).mockReturnValue({
      user: null,
      isAuthenticated: false,
    });

    // Test with basename="/librechat" (simulates subdirectory deployment)
    const router = createTestRouter('/librechat');
    const { getByTestId } = render(<RouterProvider router={router} />);

    // Full pathname includes basename
    expect(router.state.location.pathname).toBe('/librechat/');

    // Wait for the redirect - router handles basename internally
    await waitFor(
      () => {
        // Router state pathname includes the full path with basename
        expect(router.state.location.pathname).toBe('/librechat/ask');
        expect(getByTestId('anon-ask-page')).toBeInTheDocument();
      },
      { timeout: 1000 },
    );

    // The key point: navigate('/ask', { replace: true }) works correctly with basename
    // The router automatically prepends the basename to create the full URL
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('should use React Router navigate (not window.location) for SPA experience', async () => {
    (useAuthContext as jest.Mock).mockReturnValue({
      user: null,
      isAuthenticated: false,
    });

    const router = createTestRouter('/librechat');
    const { getByTestId } = render(<RouterProvider router={router} />);

    await waitFor(
      () => {
        expect(router.state.location.pathname).toBe('/librechat/ask');
        expect(getByTestId('anon-ask-page')).toBeInTheDocument();
      },
      { timeout: 1000 },
    );

    // The fact that navigation worked within the router proves we're using
    // navigate() and not window.location.href (which would cause a full reload
    // and break the test entirely). This maintains the SPA experience.
    expect(router.state.location.pathname).toBe('/librechat/ask');
  });

  it('should clear timeout on unmount', async () => {
    (useAuthContext as jest.Mock).mockReturnValue({
      user: null,
      isAuthenticated: false,
    });

    const router = createTestRouter();
    const { unmount } = render(<RouterProvider router={router} />);

    // Unmount immediately before timeout fires
    unmount();

    // Wait past the timeout period
    await new Promise((resolve) => setTimeout(resolve, 400));

    // Should still be at home, not redirected (timeout was cleared)
    expect(router.state.location.pathname).toBe('/');
  });

  it('should return user and isAuthenticated values', async () => {
    const mockUser = { id: '123', email: 'test@example.com' };
    (useAuthContext as jest.Mock).mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });

    const router = createTestRouter();
    render(<RouterProvider router={router} />);

    await waitFor(() => {
      const testResult = (window as any).__testResult;
      expect(testResult).toBeDefined();
      expect(testResult.user).toEqual(mockUser);
      expect(testResult.isAuthenticated).toBe(true);
    });
  });

  /**
   * ai-aflat deviation. Upstream sent unauthenticated visitors to
   * `/login?redirect_to=<current location>` and had four cases asserting how
   * that param was built. The gate replaces the target, and the deep link is
   * deliberately dropped: an anonymous visitor has no session to resume, and
   * everything past sign-in is owned by the gate's own hand-off. The two cases
   * below replace those four and pin the drop so it can't come back silently.
   */
  it('should drop the source deep link rather than pass it as redirect_to', async () => {
    (useAuthContext as jest.Mock).mockReturnValue({
      user: null,
      isAuthenticated: false,
    });

    const router = createTestRouter('/', '/c/abc123?q=hello&submit=true#section');
    render(<RouterProvider router={router} />);

    await waitFor(
      () => {
        expect(router.state.location.pathname).toBe('/ask');
      },
      { timeout: 1000 },
    );

    expect(router.state.location.search).toBe('');
    expect(router.state.location.hash).toBe('');
  });

  it('should drop the source deep link under a subdirectory deployment too', async () => {
    (useAuthContext as jest.Mock).mockReturnValue({
      user: null,
      isAuthenticated: false,
    });

    const router = createTestRouter('/librechat', '/librechat/c/abc123');
    render(<RouterProvider router={router} />);

    await waitFor(
      () => {
        expect(router.state.location.pathname).toBe('/librechat/ask');
      },
      { timeout: 1000 },
    );

    expect(router.state.location.search).toBe('');
  });
});
