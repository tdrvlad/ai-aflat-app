import React, { StrictMode } from 'react';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { request } from 'librechat-data-provider';
import usePostLoginHandoff from '../usePostLoginHandoff';
import { consentStatusKey } from '../consent';
import { STASH_MAX_AGE_MS, readStash, saveStash } from '../anonStash';

/**
 * The handoff is the one place in the product that sends a message the user did
 * not just type. These cases pin the ways that could go wrong: sending it twice,
 * sending it before consent exists, sending it into the wrong conversation or a
 * dead one, losing the question when the claim fails for a reason that is not
 * "the question is gone", and asking a question that belongs to whoever used
 * this browser last.
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
let mockIsSubmitting = false;
jest.mock('~/Providers/ChatContext', () => ({
  __esModule: true,
  useChatContext: () => ({ conversation: mockConversation, isSubmitting: mockIsSubmitting }),
}));

const mockedRequest = request as unknown as { get: jest.Mock; post: jest.Mock };

const linkCalls = () =>
  mockedRequest.post.mock.calls.filter(([url]) => String(url).includes('/link'));

/** Distinct ids per case — the hook keeps a module-level "already handled" set. */
let stashCounter = 0;
const stashQuestion = (text = 'Câte zile de preaviz am?') => {
  stashCounter += 1;
  const id = `q-${stashCounter}`;
  saveStash({ id, text });
  return id;
};

const axiosError = (status: number) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status },
  });

/** A claim we hold open, so the test can act while it is in flight. */
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

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

  /** A fresh element every time: React bails out of re-rendering an identical one. */
  const tree = () => {
    const inner = (
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    );
    return strict ? <StrictMode>{inner}</StrictMode> : inner;
  };

  const result = render(tree());
  return { ...result, rerender: () => result.rerender(tree()) };
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
    mockIsSubmitting = false;
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
    await settle();
    expect(mockSubmitMessage).not.toHaveBeenCalled();
  });

  /**
   * A throttled claim is not a lost question: the document is still parked and
   * still claimable, so the stash comes back and a later mount retries. Nothing
   * is shown to the user — the failure is ours, not theirs.
   */
  it('keeps the stash on 429 and retries on a later mount', async () => {
    stashQuestion('Retry me');
    mockedRequest.post.mockRejectedValueOnce(axiosError(429));

    const first = renderHandoff();
    await waitFor(() => expect(linkCalls()).toHaveLength(1));
    await waitFor(() => expect(readStash()).not.toBeNull());
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
    await waitFor(() => expect(readStash()).not.toBeNull());
    expect(mockSubmitMessage).not.toHaveBeenCalled();
  });

  /** A corrupt stash must not wedge the hook or submit garbage. */
  it('drops a malformed stash without submitting', async () => {
    localStorage.setItem('aflat_anon_q', JSON.stringify({ id: 42, ts: Date.now() }));

    renderHandoff();
    await settle();

    expect(linkCalls()).toHaveLength(0);
    expect(mockSubmitMessage).not.toHaveBeenCalled();
    expect(readStash()).toBeNull();
  });

  /**
   * Shared browsers: the question a visitor parked and abandoned must not become
   * the first thing the *next* person to sign up here is shown asking.
   */
  it('never claims a question parked longer ago than the maximum age', async () => {
    localStorage.setItem(
      'aflat_anon_q',
      JSON.stringify({
        id: 'q-stale',
        text: 'A stranger question',
        ts: Date.now() - STASH_MAX_AGE_MS - 60_000,
      }),
    );

    renderHandoff();
    await settle();

    expect(linkCalls()).toHaveLength(0);
    expect(mockSubmitMessage).not.toHaveBeenCalled();
    expect(readStash()).toBeNull();
  });

  /**
   * Two tabs, one question. `handledIds` is per page context but the stash lives
   * in `localStorage`, shared by every tab of the browser, and the link route is
   * idempotent for its owner — it answers 200 with the text to whoever already
   * owns it. So a second tab that can still read the stash while the first one's
   * claim is in flight claims it too, and the question is asked twice: two
   * conversations, two orchestrator jobs. The stash therefore has to be gone
   * before the claim goes out, not after it comes back.
   */
  it('clears the stash before the claim goes out, not after it returns', async () => {
    const id = stashQuestion('One tab only');
    const claim = deferred<{ id: string; text: string }>();
    mockedRequest.post.mockReturnValue(claim.promise);

    renderHandoff();

    await waitFor(() => expect(linkCalls()).toHaveLength(1));
    expect(readStash()).toBeNull();

    claim.resolve({ id, text: 'One tab only' });
    await waitFor(() => expect(mockSubmitMessage).toHaveBeenCalledTimes(1));
  });

  /**
   * Everything below covers the same hazard from different angles: the claim is a
   * round trip, and what was true when it left is not necessarily true when it
   * comes back. In every one of these the question must survive — a handoff that
   * cannot be delivered has to be put back, not consumed.
   */
  describe('when the chat changes while the claim is in flight', () => {
    it('does not submit into a conversation the user opened meanwhile', async () => {
      const id = stashQuestion('Belongs in a fresh conversation');
      const claim = deferred<{ id: string; text: string }>();
      mockedRequest.post.mockReturnValue(claim.promise);

      const view = renderHandoff();
      await waitFor(() => expect(linkCalls()).toHaveLength(1));

      /* Sidebar click: the open conversation is no longer the new one. */
      mockConversation = { conversationId: 'OLD-CONVO-123', endpoint: 'ai-aflat' };
      view.rerender();

      claim.resolve({ id, text: 'Belongs in a fresh conversation' });
      await waitFor(() => expect(readStash()).not.toBeNull());
      expect(mockSubmitMessage).not.toHaveBeenCalled();
    });

    /**
     * The silent-loss case, and it sits on the golden path: the user got bored
     * waiting, typed their own message and sent it. `ask` no-ops while a
     * submission is in flight and reports that exactly like success, so this has
     * to be caught before submitting or the question is gone with nothing left
     * to retry from.
     */
    it('does not submit while the user has a message of their own in flight', async () => {
      const id = stashQuestion('Parked question');
      const claim = deferred<{ id: string; text: string }>();
      mockedRequest.post.mockReturnValue(claim.promise);

      const view = renderHandoff();
      await waitFor(() => expect(linkCalls()).toHaveLength(1));

      mockIsSubmitting = true;
      view.rerender();

      claim.resolve({ id, text: 'Parked question' });
      await waitFor(() => expect(readStash()).not.toBeNull());
      expect(mockSubmitMessage).not.toHaveBeenCalled();
    });

    it('does not submit through a chat form that has gone away, and lets a later mount retry', async () => {
      const id = stashQuestion('Still owed an answer');
      const claim = deferred<{ id: string; text: string }>();
      mockedRequest.post.mockReturnValue(claim.promise);

      const view = renderHandoff();
      await waitFor(() => expect(linkCalls()).toHaveLength(1));

      /* A jump to /search or /prompts unmounts the composer. */
      view.unmount();

      claim.resolve({ id, text: 'Still owed an answer' });
      await waitFor(() => expect(readStash()).not.toBeNull());
      expect(mockSubmitMessage).not.toHaveBeenCalled();

      mockedRequest.post.mockResolvedValue({ id, text: 'Still owed an answer' });
      renderHandoff();

      await waitFor(() => expect(mockSubmitMessage).toHaveBeenCalledTimes(1));
      expect(mockSubmitMessage).toHaveBeenCalledWith({ text: 'Still owed an answer' });
      expect(readStash()).toBeNull();
    });

    /** `ask` refusing to append to a preliminary assistant message is not a delivery. */
    it('puts the question back when the submit is refused', async () => {
      const id = stashQuestion('Refused once');
      mockedRequest.post.mockResolvedValue({ id, text: 'Refused once' });
      mockSubmitMessage.mockReturnValueOnce(false);

      const first = renderHandoff();
      await waitFor(() => expect(mockSubmitMessage).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(readStash()).not.toBeNull());
      first.unmount();

      renderHandoff();
      await waitFor(() => expect(mockSubmitMessage).toHaveBeenCalledTimes(2));
      expect(readStash()).toBeNull();
    });
  });

  /**
   * The stash is cleared before the claim goes out, which is what normally stops
   * a second mount (or a second tab) from claiming the same id. On a browser with
   * site data blocked, `removeItem` throws, `clearStash` swallows it by contract,
   * and the stash survives the whole claim — leaving the module-level
   * `handledIds` set as the only thing standing between one question and two
   * conversations. Remove the `handledIds` check and this case claims twice.
   */
  it('does not re-claim the same question when the stash refuses to clear', async () => {
    const id = stashQuestion('Blocked storage');
    const claim = deferred<{ id: string; text: string }>();
    mockedRequest.post.mockReturnValue(claim.promise);

    const realRemoveItem = Storage.prototype.removeItem;
    Storage.prototype.removeItem = jest.fn(() => {
      throw new DOMException('SecurityError');
    });

    try {
      const first = renderHandoff();
      await waitFor(() => expect(linkCalls()).toHaveLength(1));
      /* The clear was refused, so the question is still sitting there. */
      expect(readStash()).not.toBeNull();

      /* A conversation switch remounts ChatForm; the new instance has fresh refs. */
      first.unmount();
      renderHandoff();
      await settle();

      expect(linkCalls()).toHaveLength(1);

      claim.resolve({ id, text: 'Blocked storage' });
      await settle();
      expect(mockSubmitMessage).not.toHaveBeenCalled();
    } finally {
      Storage.prototype.removeItem = realRemoveItem;
    }
  });
});
