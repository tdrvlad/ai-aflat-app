import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { loginPage } from 'librechat-data-provider';
import AnonAsk from '../AnonAsk';
import { ACK_KEY } from '~/components/Aflat/anonStash';

/**
 * The gate's whole job is: park the question, then ask for an account. These
 * cases pin the two halves that must never regress — nothing is POSTed before
 * the framing is acknowledged, and no answer is ever rendered.
 *
 * Test language is pinned to `en` in `client/test/setupTests.js`, so assertions
 * use the English catalog values.
 */

const jsonResponse = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response;

describe('AnonAsk (/ask)', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = jest.fn().mockResolvedValue(jsonResponse(201, { id: 'q-1' }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  const typeQuestion = (value: string) => {
    fireEvent.change(screen.getByTestId('aflat-text-input'), { target: { value } });
  };

  const questionCalls = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/aflat/anon-questions'));
  const eventCalls = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/aflat/events'));

  it('renders the heading, the framing sub-line and the starter chips', () => {
    render(<AnonAsk />);

    expect(screen.getByRole('heading', { name: 'Ask about Romanian legislation' })).toBeVisible();
    expect(screen.getByText(/direct link to the article of law/i)).toBeVisible();
    expect(screen.getByRole('group', { name: 'Example questions' })).toBeVisible();
  });

  /**
   * The gate is also where an account holder with an expired session lands, so
   * sign-in has to be reachable without walking the ask flow. Pinned because
   * losing it silently dead-ends every returning user.
   */
  it('offers an existing account holder a way to sign in', () => {
    render(<AnonAsk />);

    const link = screen.getByTestId('aflat-signin-link');
    expect(link).toBeVisible();
    expect(link).toHaveTextContent(/sign in/i);
    expect(link).toHaveAttribute('href', loginPage());
  });

  it('fills the composer from a starter chip without sending it', () => {
    render(<AnonAsk />);

    fireEvent.click(screen.getByText('What are my rights if my flight is cancelled?'));

    expect(screen.getByTestId('aflat-text-input')).toHaveValue(
      'What are my rights if my flight is cancelled?',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks the first send behind the acknowledgement and posts nothing', () => {
    render(<AnonAsk />);

    typeQuestion('Câte zile de preaviz am?');
    fireEvent.click(screen.getByTestId('aflat-send-button'));

    expect(screen.getByTestId('aflat-ack-button')).toBeVisible();
    expect(screen.getByText(/not legal advice/i)).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends after the acknowledgement, then shows the login gate instead of an answer', async () => {
    render(<AnonAsk />);

    typeQuestion('Câte zile de preaviz am?');
    fireEvent.click(screen.getByTestId('aflat-send-button'));
    fireEvent.click(screen.getByTestId('aflat-ack-button'));

    await waitFor(() => expect(questionCalls()).toHaveLength(1));

    const [, init] = questionCalls()[0];
    expect(JSON.parse(init.body)).toEqual({
      text: 'Câte zile de preaviz am?',
      ackVersion: 'v2-2026-08',
    });
    expect(localStorage.getItem(ACK_KEY)).not.toBeNull();

    /** the question is echoed back and parked for the post-signup claim */
    await waitFor(() =>
      expect(screen.getByTestId('aflat-user-bubble')).toHaveTextContent('Câte zile de preaviz am?'),
    );
    /**
     * Stamped, not just stored: the post-signup claim refuses a stash older than
     * a day, so that a question abandoned on a shared browser is never asked as
     * the next visitor's.
     */
    const parked = JSON.parse(localStorage.getItem('aflat_anon_q')!);
    expect(parked).toMatchObject({ id: 'q-1', text: 'Câte zile de preaviz am?' });
    expect(Date.now() - parked.ts).toBeLessThan(60_000);
    expect(screen.getByTestId('aflat-thinking')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId('aflat-login-gate')).toBeVisible(), {
      timeout: 3000,
    });
    expect(screen.queryByTestId('aflat-thinking')).not.toBeInTheDocument();
    expect(screen.getByText(/Create a free account to get the answer/i)).toBeVisible();
    expect(eventCalls().map(([, init]) => JSON.parse(init.body).name)).toEqual(['gate_shown']);
  });

  it('does not re-ask for the acknowledgement once it is stored', async () => {
    localStorage.setItem(ACK_KEY, new Date().toISOString());
    render(<AnonAsk />);

    typeQuestion('Ce drepturi am?');
    fireEvent.click(screen.getByTestId('aflat-send-button'));

    await waitFor(() => expect(questionCalls()).toHaveLength(1));
    expect(screen.queryByTestId('aflat-ack-button')).not.toBeInTheDocument();
  });

  /**
   * Past the 201 the question is already parked server-side, so a browser with
   * site data blocked must still reach the gate. Reporting the failed stash as
   * a failed send would invite a retry that orphans another document and burns
   * the visitor's hourly budget.
   */
  it('still reaches the gate when localStorage is blocked', async () => {
    localStorage.setItem(ACK_KEY, new Date().toISOString());
    const realSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = jest.fn(() => {
      throw new DOMException('SecurityError');
    });

    try {
      render(<AnonAsk />);

      typeQuestion('Ce drepturi am?');
      fireEvent.click(screen.getByTestId('aflat-send-button'));

      await waitFor(() => expect(questionCalls()).toHaveLength(1));
      await waitFor(() => expect(screen.getByTestId('aflat-login-gate')).toBeVisible(), {
        timeout: 3000,
      });
      expect(screen.queryByTestId('aflat-error')).not.toBeInTheDocument();
    } finally {
      Storage.prototype.setItem = realSetItem;
    }
  });

  it('surfaces the throttle as a plain message and keeps the question', async () => {
    localStorage.setItem(ACK_KEY, new Date().toISOString());
    fetchMock.mockResolvedValue(jsonResponse(429, { error: 'Too many requests' }));
    render(<AnonAsk />);

    typeQuestion('Ce drepturi am?');
    fireEvent.click(screen.getByTestId('aflat-send-button'));

    await waitFor(() => expect(screen.getByTestId('aflat-error')).toBeVisible());
    expect(screen.getByTestId('aflat-error')).toHaveTextContent(/too many questions/i);
    expect(screen.getByTestId('aflat-text-input')).toHaveValue('Ce drepturi am?');
    expect(screen.queryByTestId('aflat-login-gate')).not.toBeInTheDocument();
    expect(localStorage.getItem('aflat_anon_q')).toBeNull();
  });

  it('surfaces a network failure without crashing or gating', async () => {
    localStorage.setItem(ACK_KEY, new Date().toISOString());
    fetchMock.mockRejectedValue(new Error('offline'));
    render(<AnonAsk />);

    typeQuestion('Ce drepturi am?');
    fireEvent.click(screen.getByTestId('aflat-send-button'));

    await waitFor(() => expect(screen.getByTestId('aflat-error')).toBeVisible());
    expect(screen.getByTestId('aflat-error')).toHaveTextContent(/couldn't save your question/i);
    expect(screen.queryByTestId('aflat-login-gate')).not.toBeInTheDocument();
  });
});
