import React from 'react';
import { render, screen, fireEvent, waitFor } from 'test/layout-test-utils';
import AnonChat from '../AnonChat';

/**
 * Two boundaries this suite does not own, and cannot reach from jsdom.
 *
 * `useGetStartupConfig` is an HTTP call for the Clerk publishable key, and `LoginModal` renders
 * nothing without one — so without this stub the suite asserts against a modal that was never
 * going to appear, and passes or fails on whether an unmocked request happened to resolve.
 * `ClerkSignIn` is a third-party widget that talks to Clerk on mount; what matters here is that
 * the gate opens on the parked question, not what Clerk draws inside it.
 */
jest.mock('~/data-provider', () => ({
  ...jest.requireActual('~/data-provider'),
  useGetStartupConfig: () => ({ data: { clerkPublishableKey: 'pk_test_stub' } }),
}));

jest.mock('../Auth/ClerkSignIn', () => ({
  __esModule: true,
  default: () => <div data-testid="clerk-signin-stub" />,
}));

/**
 * The signed-out chat screen's whole job is: take the question, hold it *here*,
 * then ask for an account. These cases pin the halves that must never regress —
 * nothing about the question leaves the browser before there is an account and a
 * recorded consent, and no answer is ever rendered.
 *
 * Test language is pinned to `en` in `client/test/setupTests.js`, so assertions
 * use the English catalog values.
 */

describe('AnonChat (the signed-out chat screen)', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  const typeQuestion = (value: string) => {
    fireEvent.change(screen.getByTestId('aflat-text-input'), { target: { value } });
  };

  const send = () => fireEvent.click(screen.getByTestId('aflat-send-button'));

  /** Anything at all carrying the question's text, to any endpoint. */
  const questionCalls = () =>
    fetchMock.mock.calls.filter(([, init]) =>
      String((init as RequestInit | undefined)?.body ?? '').includes('preaviz'),
    );
  const eventCalls = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/aflat/events'));

  const stash = () => JSON.parse(localStorage.getItem('aflat_anon_q') ?? 'null');

  const CHIP = 'What are my rights if my flight is cancelled?';

  it('renders the heading, the framing sub-line and the starter chips', () => {
    render(<AnonChat onSignedIn={jest.fn()} />);

    expect(
      screen.getByRole('heading', { name: 'Ask anything about Romanian legislation' }),
    ).toBeVisible();
    expect(screen.getByText(/direct link to the article of law/i)).toBeVisible();
    expect(screen.getByRole('group', { name: 'Example questions' })).toBeVisible();
  });

  /**
   * The order the redesign asks for: the question is taken first, the identity
   * step second, and the acknowledgement third — `ConsentModal`, raised by the
   * authenticated shell once this modal hands back a session. Nothing on this
   * screen may ask a stranger to agree to anything.
   */
  it('goes straight from the send to the login gate, asking for no acknowledgement', async () => {
    render(<AnonChat onSignedIn={jest.fn()} />);

    typeQuestion('Câte zile de preaviz am?');
    send();

    expect(screen.queryByTestId('aflat-ack-gate')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('aflat-login-modal')).toBeVisible(), {
      timeout: 3000,
    });
    expect(screen.getByText(/Create a free account to get the answer/i)).toBeVisible();
  });

  /**
   * The whole reason the question is held here rather than parked: a stranger's
   * free-text legal question is Article 9 / Article 10 material, and there is no
   * consent yet to store it under.
   */
  it('sends the question nowhere and keeps it in the browser', async () => {
    render(<AnonChat onSignedIn={jest.fn()} />);

    typeQuestion('Câte zile de preaviz am?');
    send();

    expect(questionCalls()).toHaveLength(0);

    /** Echoed back, so the visitor can see what is being held. */
    expect(screen.getByTestId('aflat-user-bubble')).toHaveTextContent('Câte zile de preaviz am?');
    expect(screen.getByTestId('aflat-thinking')).toBeInTheDocument();

    /**
     * Stamped, not just stored: the post-signup handoff refuses a stale stash so
     * that a question abandoned on a shared browser is never asked as the next
     * visitor's.
     */
    expect(stash()).toMatchObject({ text: 'Câte zile de preaviz am?' });
    expect(Date.now() - stash().ts).toBeLessThan(60_000);

    await waitFor(() => expect(screen.getByTestId('aflat-login-modal')).toBeVisible(), {
      timeout: 3000,
    });
    expect(screen.queryByTestId('aflat-thinking')).not.toBeInTheDocument();
    /** The only thing reported to the server, and it carries no question text. */
    expect(questionCalls()).toHaveLength(0);
    expect(eventCalls().map(([, init]) => JSON.parse(init.body))).toEqual([{ name: 'gate_shown' }]);
  });

  /** Backing out keeps the thread and the held question, not a fresh empty chat. */
  it('returns to the thread when the login modal is dismissed', async () => {
    render(<AnonChat onSignedIn={jest.fn()} />);

    typeQuestion('Câte zile de preaviz am?');
    send();

    await waitFor(() => expect(screen.getByTestId('aflat-login-modal')).toBeVisible(), {
      timeout: 3000,
    });
    fireEvent.keyDown(document.body, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByTestId('aflat-login-modal')).not.toBeInTheDocument());
    expect(screen.getByTestId('aflat-user-bubble')).toHaveTextContent('Câte zile de preaviz am?');
    expect(stash()).toMatchObject({ text: 'Câte zile de preaviz am?' });
  });

  /**
   * The chip's question has to be legible in the composer before it is sent, or
   * it appears to teleport into the thread and the visitor never learns that the
   * example filled the box they could have typed in.
   */
  it('holds a tapped starter in the composer before sending it', async () => {
    render(<AnonChat onSignedIn={jest.fn()} />);

    fireEvent.click(screen.getByText(CHIP));

    expect(screen.getByTestId('aflat-text-input')).toHaveValue(CHIP);
    expect(screen.queryByTestId('aflat-user-bubble')).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId('aflat-user-bubble')).toHaveTextContent(CHIP));
    expect(screen.getByTestId('aflat-text-input')).toHaveValue('');
  });

  /** One tap, one question — a second tap during the dwell must not send twice. */
  it('holds a starter once when tapped repeatedly', async () => {
    render(<AnonChat onSignedIn={jest.fn()} />);

    const chip = screen.getByText(CHIP);
    fireEvent.click(chip);
    fireEvent.click(chip);
    send();

    await waitFor(() => expect(screen.getByTestId('aflat-user-bubble')).toHaveTextContent(CHIP));
    expect(screen.getAllByTestId('aflat-user-bubble')).toHaveLength(1);
    expect(stash().text).toBe(CHIP);
  });

  /** Typing during the dwell means the visitor changed their mind. */
  it('cancels a tapped starter when the visitor types instead', async () => {
    render(<AnonChat onSignedIn={jest.fn()} />);

    fireEvent.click(screen.getByText(CHIP));
    typeQuestion('Ce drepturi am?');
    send();

    await waitFor(() =>
      expect(screen.getByTestId('aflat-user-bubble')).toHaveTextContent('Ce drepturi am?'),
    );
    expect(stash().text).toBe('Ce drepturi am?');
  });

  /**
   * A browser with site data blocked loses only the automatic re-ask after
   * sign-up. Reporting that as a failed send would claim something broke when
   * nothing did, and invite a retry that cannot succeed.
   */
  it('still reaches the gate when localStorage is blocked', async () => {
    const realSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = jest.fn(() => {
      throw new DOMException('SecurityError');
    });

    try {
      render(<AnonChat onSignedIn={jest.fn()} />);

      typeQuestion('Ce drepturi am?');
      send();

      await waitFor(() => expect(screen.getByTestId('aflat-login-modal')).toBeVisible(), {
        timeout: 3000,
      });
      expect(screen.queryByTestId('aflat-error')).not.toBeInTheDocument();
    } finally {
      Storage.prototype.setItem = realSetItem;
    }
  });
});
