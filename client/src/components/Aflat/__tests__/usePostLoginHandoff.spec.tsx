import React, { StrictMode } from 'react';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { request } from 'librechat-data-provider';
import usePostLoginHandoff from '../usePostLoginHandoff';
import { consentStatusKey } from '../consent';
import { readStash } from '../anonStash';

/**
 * The handoff is the one place in the product that sends a message the user did
 * not just type. These cases pin the three ways that could go wrong: sending it
 * twice, sending it before consent exists, and losing the question when the
 * claim fails for a reason that is not "the question is gone".
 *
 * Test language is pinned to `en` in `client/test/setupTests.js`; nothing here
 * renders copy.
 */

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    request: { get: jest.fn(), post: jest.fn() },
  };
});

const mockSubmitMessage = jest.fn();
jest.mock('~/hooks/Messages/useSubmitMessage', () => ({
  __esModule: true,
  default: () => ({ submitMessage: mockSubmitMessage, submitPrompt: jest.fn() }),
}));

/** Loosely typed: custom endpoints are plain strings at runtime. */
let mockConversation: { conversationId?: string; endpoint?: string } | null = null;
jest.mock('~/Providers/ChatContext', () => ({
  __esModule: true,
  useChatContext: () => ({ conversation: mockConversation }),
}));

const mockedRequest = request as unknown as { get: jest.Mock; post: jest.Mock };

const linkCalls = () =>
  mockedRequest.post.mock.calls.filter(([url]) => String(url).includes('/link'));

/** Distinct ids per case — the hook keeps a module-level "already handled" set. */
let stashCounter = 0;
const stashQuestion = (text = 'Câte zile de preaviz am?') => {
  stashCounter += 1;
  const id = `q-${stashCounter}`;
  localStorage.setItem('aflat_anon_q', JSON.stringify({ id, text }));
  return id;
};

const axiosError = (status: number) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status },
  });

function Probe() {
  usePostLoginHandoff();
  return null;
}

const renderHandoff = ({
  recorded = true,
  strict = false,
}: { recorded?: boolean; strict?: boolean } = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(consentStatusKey, { recorded });

  const tree = (
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>
  );

  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
};

/** Lets any already-scheduled microtask/effect settle before asserting a negative. */
const settle = () => waitFor(() => expect(true).toBe(true));

describe('usePostLoginHandoff', () => {
  beforeEach(() => {
    localStorage.clear();
    mockSubmitMessage.mockReset();
    mockedRequest.get.mockReset();
    mockedRequest.post.mockReset();
    mockedRequest.post.mockResolvedValue({ id: 'q', text: 'server text' });
    mockConversation = { conversationId: 'new', endpoint: 'ai-aflat' };
  });

  it('does nothing when there is no stashed question', async () => {
    renderHandoff();
    await settle();

    expect(linkCalls()).toHaveLength(0);
    expect(mockSubmitMessage).not.toHaveBeenCalled();
  });

  /**
   * The consent gate is the load-bearing one: a message must never be submitted
   * on someone's behalf before they have accepted the framing.
   */
  it('submits nothing while consent is not recorded', async () => {
    stashQuestion();
    renderHandoff({ recorded: false });
    await settle();

    expect(linkCalls()).toHaveLength(0);
    expect(mockSubmitMessage).not.toHaveBeenCalled();
    expect(readStash()).not.toBeNull();
  });

  it('waits for a new conversation rather than injecting into an open one', async () => {
    stashQuestion();
    mockConversation = { conversationId: 'existing-convo', endpoint: 'ai-aflat' };
    renderHandoff();
    await settle();

    expect(linkCalls()).toHaveLength(0);
    expect(readStash()).not.toBeNull();
  });

  it('claims the question, submits the server copy of it, and clears the stash', async () => {
    const id = stashQuestion('Câte zile de preaviz am?');
    mockedRequest.post.mockResolvedValue({ id, text: 'Câte zile de preaviz am?' });

    renderHandoff();

    await waitFor(() => expect(mockSubmitMessage).toHaveBeenCalledTimes(1));
    expect(linkCalls()[0][0]).toContain(`/api/aflat/anon-questions/${id}/link`);
    expect(mockSubmitMessage).toHaveBeenCalledWith({ text: 'Câte zile de preaviz am?' });
    expect(readStash()).toBeNull();
  });

  /** React strict/dev double-mount must not send the question twice. */
  it('submits exactly once under a strict-mode double mount', async () => {
    stashQuestion('O singură dată');
    mockedRequest.post.mockResolvedValue({ id: 'x', text: 'O singură dată' });

    renderHandoff({ strict: true });

    await waitFor(() => expect(mockSubmitMessage).toHaveBeenCalledTimes(1));
    await settle();

    expect(linkCalls()).toHaveLength(1);
    expect(mockSubmitMessage).toHaveBeenCalledTimes(1);
  });

  /** A stale or already-claimed stash is dead weight — drop it, silently. */
  it('clears the stash and submits nothing on 404', async () => {
    stashQuestion();
    mockedRequest.post.mockRejectedValue(axiosError(404));

    renderHandoff();

    await waitFor(() => expect(readStash()).toBeNull());
    expect(mockSubmitMessage).not.toHaveBeenCalled();
  });

  /**
   * A throttled claim is not a lost question: the document is still parked and
   * still claimable, so the stash survives and a later mount retries. Nothing is
   * shown to the user — the failure is ours, not theirs.
   */
  it('keeps the stash on 429 and retries on a later mount', async () => {
    stashQuestion('Retry me');
    mockedRequest.post.mockRejectedValueOnce(axiosError(429));

    const first = renderHandoff();
    await waitFor(() => expect(linkCalls()).toHaveLength(1));
    expect(readStash()).not.toBeNull();
    expect(mockSubmitMessage).not.toHaveBeenCalled();
    first.unmount();

    mockedRequest.post.mockResolvedValue({ id: 'y', text: 'Retry me' });
    renderHandoff();

    await waitFor(() => expect(mockSubmitMessage).toHaveBeenCalledTimes(1));
    expect(mockSubmitMessage).toHaveBeenCalledWith({ text: 'Retry me' });
    expect(readStash()).toBeNull();
  });

  it('keeps the stash when the claim fails outright', async () => {
    stashQuestion();
    mockedRequest.post.mockRejectedValue(new Error('network down'));

    renderHandoff();

    await waitFor(() => expect(linkCalls()).toHaveLength(1));
    await settle();
    expect(readStash()).not.toBeNull();
    expect(mockSubmitMessage).not.toHaveBeenCalled();
  });

  /** A corrupt stash must not wedge the hook or submit garbage. */
  it('drops a malformed stash without submitting', async () => {
    localStorage.setItem('aflat_anon_q', JSON.stringify({ id: 42 }));

    renderHandoff();
    await settle();

    expect(linkCalls()).toHaveLength(0);
    expect(mockSubmitMessage).not.toHaveBeenCalled();
    expect(readStash()).toBeNull();
  });
});
