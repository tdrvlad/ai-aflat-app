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
 * The claim is authorised by an httpOnly cookie the browser attaches by itself,
 * so nothing here — and nothing in the hook — ever names a question id. What the
 * mocked `request.post` stands in for is "the server recognised this browser's
 * cookie" (resolve) or "it did not" (404).
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

const claimCalls = () =>
  mockedRequest.post.mock.calls.filter(([url]) => String(url).includes('/claim'));

const stashQuestion = (text = 'Câte zile de preaviz am?') => {
  saveStash({ id: 'q-1', text });
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

/**
 * The readable flag the server sets beside the httpOnly credential. It is what
 * tells the hook a claim is worth making — without it the hook must stay quiet,
 * so most tests here have to plant it explicitly.
 */
const MARKER = 'aflat_claim_present';
const setClaimMarker = () => {
  document.cookie = `${MARKER}=1; path=/`;
};
const clearClaimMarker = () => {
  document.cookie = `${MARKER}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
};

describe('usePostLoginHandoff', () => {
  beforeEach(() => {
    localStorage.clear();
    clearClaimMarker();
    setClaimMarker();
    /* The hook's page-context state; a real page load always starts clean. */
    delete (window as Window & { __aflatHandoff?: unknown }).__aflatHandoff;
    mockSubmitMessage.mockReset();
    mockedRequest.get.mockReset();
    mockedRequest.post.mockReset();
    mockedRequest.post.mockResolvedValue({ id: 'q-1', text: 'server text' });
    mockConversation = { conversationId: 'new', endpoint: 'ai-aflat' };
    mockIsSubmitting = false;
  });

  /**
   * The stash is a display copy, not a credential: the cookie is what says this
   * browser parked a question. So a browser that never managed to write to
   * `localStorage` — Safari private mode refuses the write and `saveStash`
   * swallows it by contract — must still get its question back.
   */
  it('claims by cookie even when nothing was stashed locally', async () => {
    mockedRequest.post.mockResolvedValue({ id: 'q-1', text: 'Recovered from the server' });

    renderHandoff();

    await waitFor(() => expect(mockSubmitMessage).toHaveBeenCalledTimes(1));
    expect(mockSubmitMessage).toHaveBeenCalledWith({ text: 'Recovered from the server' });
  });

  /**
   * The claim costs one of 10 attempts per hour per IP, and behind carrier NAT
   * that budget is shared by everyone on the same mobile network. A user who
   * never parked a question has nothing to claim, so asking would spend a slot —
   * and enough ordinary page loads would throttle out the claims that matter.
   * With neither signal present the hook must not reach the network at all.
   */
  it('does not claim at all when nothing says this browser parked a question', async () => {
    clearClaimMarker();
    localStorage.clear();

    renderHandoff();

    await settle();
    expect(claimCalls()).toHaveLength(0);
    expect(mockSubmitMessage).not.toHaveBeenCalled();
  });

  /**
   * Two tabs, one browser: cookies and `localStorage` are shared, page-context
   * state is not. The claim is idempotent for its owner, so if the second tab
   * still sees a reason to claim while the first tab's request is in flight,
   * both succeed and the question is asked twice — two conversations, two
   * orchestrator jobs. The server does clear the marker, but only when the
   * response lands, which is 0.3–2s too late on mobile. Spending it in the
   * browser, synchronously, is what actually closes the window.
   */
  it('does not let a second tab claim while the first tab is still claiming', async () => {
    stashQuestion();
    const held = deferred<{ id: string; text: string }>();
    mockedRequest.post.mockReturnValue(held.promise);

    renderHandoff();
    await waitFor(() => expect(claimCalls()).toHaveLength(1));

    /* The other tab: same cookies and storage, its own page-context state. */
    delete (window as Window & { __aflatHandoff?: unknown }).__aflatHandoff;
    renderHandoff();
    await settle();

    expect(claimCalls()).toHaveLength(1);

    held.resolve({ id: 'q-1', text: 'Câte zile de preaviz am?' });
    await waitFor(() => expect(mockSubmitMessage).toHaveBeenCalledTimes(1));
  });

  /**
   * The window between "the server says it is ours" and "it has been asked".
   * The credential is spent by then, so a reload used to send the hook back for
   * a 404 and throw away the text it was still holding. The stash records that
   * the question is already ours, and that record outlives the page.
   */
  it('asks a claimed-but-undelivered question after a hard reload, without re-claiming', async () => {
    /* Delivery failed once: chat had moved on, question written back as ours. */
    saveStash({ id: 'q-1', text: 'Pot fi concediat în concediu medical?', claimed: true });
    clearClaimMarker();
    /* A hard reload: page-context state is gone, storage is not. */
    delete (window as Window & { __aflatHandoff?: unknown }).__aflatHandoff;

    renderHandoff();

    await waitFor(() => expect(mockSubmitMessage).toHaveBeenCalledTimes(1));
    expect(mockSubmitMessage).toHaveBeenCalledWith({
      text: 'Pot fi concediat în concediu medical?',
    });
    expect(claimCalls()).toHaveLength(0);
    expect(localStorage.getItem('aflat_anon_q')).toBeNull();
  });

  /** A stale marker the server has not cleared yet still gets one attempt. */
  it('claims on the marker alone, with no local stash', async () => {
    clearClaimMarker();
    localStorage.clear();
    setClaimMarker();

    renderHandoff();

    await waitFor(() => expect(claimCalls()).toHaveLength(1));
  });

  /** No cookie, or a question already claimed: one indistinguishable 404. */
  it('submits nothing when this browser has no parked question', async () => {
    mockedRequest.post.mockRejectedValue(axiosError(404));

    renderHandoff();

    await waitFor(() => expect(claimCalls()).toHaveLength(1));
    await settle();
    expect(mockSubmitMessage).not.toHaveBeenCalled();
  });

  /** The claim carries no question id — there is nothing left to enumerate. */
  it('claims without naming a question', async () => {
    stashQuestion();

    renderHandoff();

    await waitFor(() => expect(claimCalls()).toHaveLength(1));
    const [url, body] = claimCalls()[0];
    expect(url).toBe('/api/aflat/anon-questions/claim');
    expect(JSON.stringify(body ?? {})).not.toContain('q-1');
  });

  /**
   * The consent gate is the load-bearing one: a message must never be submitted
   * on someone's behalf before they have accepted the framing.
   */
  it('submits nothing while consent is not recorded', async () => {
    stashQuestion();
    renderHandoff({ recorded: false });
    await settle();

    expect(claimCalls()).toHaveLength(0);
    expect(mockSubmitMessage).not.toHaveBeenCalled();
    expect(readStash()).not.toBeNull();
  });

  it('waits for a new conversation rather than injecting into an open one', async () => {
    stashQuestion();
    mockConversation = { conversationId: 'existing-convo', endpoint: 'ai-aflat' };
    renderHandoff();
    await settle();

    expect(claimCalls()).toHaveLength(0);
    expect(readStash()).not.toBeNull();
  });

  it('claims the question, submits the server copy of it, and clears the stash', async () => {
    stashQuestion('Câte zile de preaviz am?');
    mockedRequest.post.mockResolvedValue({ id: 'q-1', text: 'Câte zile de preaviz am?' });

    renderHandoff();

    await waitFor(() => expect(mockSubmitMessage).toHaveBeenCalledTimes(1));
    expect(claimCalls()[0][0]).toContain('/api/aflat/anon-questions/claim');
    expect(mockSubmitMessage).toHaveBeenCalledWith({ text: 'Câte zile de preaviz am?' });
    expect(readStash()).toBeNull();
  });

  /** React strict/dev double-mount must not send the question twice. */
  it('submits exactly once under a strict-mode double mount', async () => {
    stashQuestion('O singură dată');
    mockedRequest.post.mockResolvedValue({ id: 'q-1', text: 'O singură dată' });

    renderHandoff({ strict: true });

    await waitFor(() => expect(mockSubmitMessage).toHaveBeenCalledTimes(1));
    await settle();

    expect(claimCalls()).toHaveLength(1);
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
   * A throttled claim is not a lost question: the document is still parked, the
   * claim cookie is unspent, so the stash comes back and a later mount retries.
   * Nothing is shown to the user — the failure is ours, not theirs.
   */
  it('keeps the stash on 429 and retries on a later mount', async () => {
    stashQuestion('Retry me');
    mockedRequest.post.mockRejectedValueOnce(axiosError(429));

    const first = renderHandoff();
    await waitFor(() => expect(claimCalls()).toHaveLength(1));
    await waitFor(() => expect(readStash()).not.toBeNull());
    expect(mockSubmitMessage).not.toHaveBeenCalled();
    first.unmount();

    mockedRequest.post.mockResolvedValue({ id: 'q-1', text: 'Retry me' });
    renderHandoff();

    await waitFor(() => expect(mockSubmitMessage).toHaveBeenCalledTimes(1));
    expect(mockSubmitMessage).toHaveBeenCalledWith({ text: 'Retry me' });
    expect(readStash()).toBeNull();
  });

  it('keeps the stash when the claim fails outright', async () => {
    stashQuestion();
    mockedRequest.post.mockRejectedValue(new Error('network down'));

    renderHandoff();

    await waitFor(() => expect(claimCalls()).toHaveLength(1));
    await waitFor(() => expect(readStash()).not.toBeNull());
    expect(mockSubmitMessage).not.toHaveBeenCalled();
  });

  /** A corrupt stash must not wedge the hook; the cookie still decides. */
  it('drops a malformed stash and falls back to the server copy', async () => {
    localStorage.setItem('aflat_anon_q', JSON.stringify({ id: 42, ts: Date.now() }));
    mockedRequest.post.mockResolvedValue({ id: 'q-1', text: 'server text' });

    renderHandoff();

    await waitFor(() => expect(mockSubmitMessage).toHaveBeenCalledTimes(1));
    expect(mockSubmitMessage).toHaveBeenCalledWith({ text: 'server text' });
    expect(readStash()).toBeNull();
  });

  /**
   * Shared browsers: the question a visitor parked and abandoned must not become
   * the first thing the *next* person to sign up here is shown asking. The stash
   * is only half of that guard — the claim cookie carries the same 24h limit —
   * but an expired stash must still never be offered as text.
   */
  it('never submits a question parked longer ago than the maximum age', async () => {
    localStorage.setItem(
      'aflat_anon_q',
      JSON.stringify({
        id: 'q-stale',
        text: 'A stranger question',
        ts: Date.now() - STASH_MAX_AGE_MS - 60_000,
      }),
    );
    mockedRequest.post.mockRejectedValue(axiosError(404));

    renderHandoff();
    await settle();

    expect(mockSubmitMessage).not.toHaveBeenCalled();
    expect(readStash()).toBeNull();
  });

  /**
   * Two tabs, one question. The stash lives in `localStorage` and is shared by
   * every tab of this browser, so it is consumed before the claim goes out
   * rather than after it returns — a second tab must not find a question sitting
   * there looking unclaimed.
   */
  it('clears the stash before the claim goes out, not after it returns', async () => {
    stashQuestion('One tab only');
    const claim = deferred<{ id: string; text: string }>();
    mockedRequest.post.mockReturnValue(claim.promise);

    renderHandoff();

    await waitFor(() => expect(claimCalls()).toHaveLength(1));
    expect(readStash()).toBeNull();

    claim.resolve({ id: 'q-1', text: 'One tab only' });
    await waitFor(() => expect(mockSubmitMessage).toHaveBeenCalledTimes(1));
  });

  /**
   * A `ChatForm` remount — a conversation switch, a route change — while the
   * claim is still in flight must not fire a second one. The cookie is spent by
   * whichever claim lands first, so the second would come back 404 and the
   * question would be dropped by the very code meant to deliver it.
   */
  it('does not claim twice when the chat form remounts mid-claim', async () => {
    stashQuestion('Only claimed once');
    const claim = deferred<{ id: string; text: string }>();
    mockedRequest.post.mockReturnValue(claim.promise);

    const first = renderHandoff();
    await waitFor(() => expect(claimCalls()).toHaveLength(1));

    first.unmount();
    renderHandoff();
    await settle();

    expect(claimCalls()).toHaveLength(1);
  });

  /**
   * Everything below covers the same hazard from different angles: the claim is a
   * round trip, and what was true when it left is not necessarily true when it
   * comes back. In every one of these the question must survive — a handoff that
   * cannot be delivered has to be held, not consumed. It cannot be re-claimed:
   * the cookie was spent by the claim that succeeded, so the copy the hook is
   * holding is the only one left.
   */
  describe('when the chat changes while the claim is in flight', () => {
    it('does not submit into a conversation the user opened meanwhile', async () => {
      stashQuestion('Belongs in a fresh conversation');
      const claim = deferred<{ id: string; text: string }>();
      mockedRequest.post.mockReturnValue(claim.promise);

      const view = renderHandoff();
      await waitFor(() => expect(claimCalls()).toHaveLength(1));

      /* Sidebar click: the open conversation is no longer the new one. */
      mockConversation = { conversationId: 'OLD-CONVO-123', endpoint: 'ai-aflat' };
      view.rerender();

      claim.resolve({ id: 'q-1', text: 'Belongs in a fresh conversation' });
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
      stashQuestion('Parked question');
      const claim = deferred<{ id: string; text: string }>();
      mockedRequest.post.mockReturnValue(claim.promise);

      const view = renderHandoff();
      await waitFor(() => expect(claimCalls()).toHaveLength(1));

      mockIsSubmitting = true;
      view.rerender();

      claim.resolve({ id: 'q-1', text: 'Parked question' });
      await waitFor(() => expect(readStash()).not.toBeNull());
      expect(mockSubmitMessage).not.toHaveBeenCalled();
    });

    /**
     * A jump to /search or /prompts unmounts the composer. The question was
     * already claimed by then, so the later mount must ask it *without* a second
     * claim — the cookie is gone and the server would answer 404.
     */
    it('does not submit through a chat form that has gone away, and asks on the next mount', async () => {
      stashQuestion('Still owed an answer');
      const claim = deferred<{ id: string; text: string }>();
      mockedRequest.post.mockReturnValue(claim.promise);

      const view = renderHandoff();
      await waitFor(() => expect(claimCalls()).toHaveLength(1));

      view.unmount();

      claim.resolve({ id: 'q-1', text: 'Still owed an answer' });
      await waitFor(() => expect(readStash()).not.toBeNull());
      expect(mockSubmitMessage).not.toHaveBeenCalled();

      mockedRequest.post.mockRejectedValue(axiosError(404));
      renderHandoff();

      await waitFor(() => expect(mockSubmitMessage).toHaveBeenCalledTimes(1));
      expect(mockSubmitMessage).toHaveBeenCalledWith({ text: 'Still owed an answer' });
      expect(claimCalls()).toHaveLength(1);
      expect(readStash()).toBeNull();
    });

    /** `ask` refusing to append to a preliminary assistant message is not a delivery. */
    it('holds the question when the submit is refused', async () => {
      stashQuestion('Refused once');
      mockedRequest.post.mockResolvedValue({ id: 'q-1', text: 'Refused once' });
      mockSubmitMessage.mockReturnValueOnce(false);

      const first = renderHandoff();
      await waitFor(() => expect(mockSubmitMessage).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(readStash()).not.toBeNull());
      first.unmount();

      mockedRequest.post.mockRejectedValue(axiosError(404));
      renderHandoff();
      await waitFor(() => expect(mockSubmitMessage).toHaveBeenCalledTimes(2));
      expect(claimCalls()).toHaveLength(1);
      expect(readStash()).toBeNull();
    });
  });
});
