import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { request } from 'librechat-data-provider';
import { useClerkBridge } from '../ClerkBridge';

/**
 * The bridge is the seam every auth bug so far has lived on, so this suite pins
 * its three contracts directly, with everything around it stubbed:
 *
 *  - an exchange that has started always finishes — starting it re-renders the
 *    component (status flips to 'exchanging'), and the previous implementation
 *    let that very re-render run React's effect cleanup and discard the
 *    response before `establishSession` ran. Sign-in then only ever succeeded
 *    through the refresh-cookie side door, i.e. sometimes;
 *  - the exchange is keyed by Clerk session id, not gated by mount timing —
 *    re-renders never duplicate it, a new session id runs it again;
 *  - a pending logout marker means the surviving Clerk session is destroyed,
 *    never adopted.
 */

type MockAuth = {
  isSignedIn: boolean;
  sessionId: string | null;
  getToken: jest.Mock;
};

const mockAuth: MockAuth = {
  isSignedIn: true,
  sessionId: 'sess_1',
  getToken: jest.fn(),
};

const mockClerk = {
  loaded: true,
  signOut: jest.fn(),
};

jest.mock('@clerk/clerk-react', () => ({
  __esModule: true,
  ClerkProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => mockAuth,
  useClerk: () => mockClerk,
}));

jest.mock('@clerk/localizations', () => ({ __esModule: true, roRO: {} }));

const mockEstablishSession = jest.fn();
jest.mock('~/hooks', () => ({
  __esModule: true,
  useAuthContext: () => ({ establishSession: mockEstablishSession }),
}));

jest.mock('~/data-provider', () => ({
  __esModule: true,
  useGetStartupConfig: () => ({ data: undefined }),
}));

jest.mock('librechat-data-provider', () => ({
  __esModule: true,
  apiBaseUrl: () => '',
  request: { post: jest.fn() },
}));

const postMock = request.post as jest.Mock;

function Harness({ onSignedIn }: { onSignedIn?: () => void }) {
  const bridge = useClerkBridge(onSignedIn);
  return (
    <div>
      <span data-testid="status">{bridge.status}</span>
      <span data-testid="failure">{bridge.failure ?? ''}</span>
      <button type="button" data-testid="retry" aria-label="retry" onClick={bridge.retry} />
    </div>
  );
}

describe('useClerkBridge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
    mockAuth.isSignedIn = true;
    mockAuth.sessionId = 'sess_1';
    mockAuth.getToken.mockResolvedValue('clerk-jwt');
    mockClerk.loaded = true;
    mockClerk.signOut.mockResolvedValue(undefined);
    mockEstablishSession.mockResolvedValue(true);
    postMock.mockResolvedValue({ token: 'app-jwt', user: { id: 'u1' } });
  });

  /**
   * The regression this hook exists to close. The exchange's own status flip
   * re-renders the component before the network round trip returns; the
   * response must still be adopted.
   */
  it('adopts the exchanged session even though starting the exchange re-renders', async () => {
    let resolveExchange: (value: unknown) => void = () => undefined;
    postMock.mockReturnValue(
      new Promise((resolve) => {
        resolveExchange = resolve;
      }),
    );
    const onSignedIn = jest.fn();

    render(<Harness onSignedIn={onSignedIn} />);

    /* The re-render that used to cancel the in-flight exchange has happened. */
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('exchanging'));
    expect(mockEstablishSession).not.toHaveBeenCalled();

    await act(async () => {
      resolveExchange({ token: 'app-jwt', user: { id: 'u1' } });
    });

    await waitFor(() =>
      expect(mockEstablishSession).toHaveBeenCalledWith({ token: 'app-jwt', user: { id: 'u1' } }),
    );
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it('exchanges once per Clerk session id, however often it re-renders', async () => {
    const { rerender } = render(<Harness />);

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    rerender(<Harness />);
    rerender(<Harness />);
    await waitFor(() => expect(mockEstablishSession).toHaveBeenCalledTimes(1));
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('bridges again for a genuinely new Clerk session', async () => {
    const { rerender } = render(<Harness />);
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));

    mockAuth.sessionId = 'sess_2';
    rerender(<Harness />);

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
  });

  it('reports the server error code and re-attempts on retry', async () => {
    postMock.mockRejectedValueOnce({ response: { data: { error: 'domain_not_allowed' } } });

    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('failed'));
    expect(screen.getByTestId('failure')).toHaveTextContent('domain_not_allowed');

    act(() => {
      screen.getByTestId('retry').click();
    });

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockEstablishSession).toHaveBeenCalledTimes(1));
  });

  /**
   * After a logout the surviving Clerk session is a leftover, not an intent:
   * the marker makes the bridge destroy it instead of signing the user right
   * back in — which is what "Ieșire" doing nothing looked like.
   */
  it('spends a pending logout by signing out of Clerk instead of re-adopting the session', async () => {
    sessionStorage.setItem('aflat_clerk_signout', '1');
    mockClerk.signOut.mockImplementation(async () => {
      mockAuth.isSignedIn = false;
      mockAuth.sessionId = null;
    });

    render(<Harness />);

    await waitFor(() => expect(mockClerk.signOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(sessionStorage.getItem('aflat_clerk_signout')).toBeNull());
    expect(postMock).not.toHaveBeenCalled();
    expect(mockEstablishSession).not.toHaveBeenCalled();
  });
});
