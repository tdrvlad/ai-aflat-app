import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { request } from 'librechat-data-provider';
import ConsentModal from '../ConsentModal';

/**
 * The modal is the only thing standing between a new account and the app, and it
 * is the record that the framing ("information about legislation, not legal
 * advice") was actually accepted. These cases pin what must never soften: it
 * cannot be dismissed, it cannot be passed without both required boxes, and the
 * body it POSTs is the record.
 *
 * Test language is pinned to `en` in `client/test/setupTests.js`, so assertions
 * use the English catalog values.
 */

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    request: { get: jest.fn(), post: jest.fn() },
  };
});

const mockedRequest = request as unknown as { get: jest.Mock; post: jest.Mock };

const renderModal = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <ConsentModal />
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
};

const gdprBox = () => screen.getByTestId('aflat-consent-gdpr');
const framingBox = () => screen.getByTestId('aflat-consent-framing');
const marketingBox = () => screen.getByTestId('aflat-consent-marketing');
const continueButton = () => screen.getByTestId('aflat-consent-continue');

describe('ConsentModal', () => {
  beforeEach(() => {
    mockedRequest.get.mockReset();
    mockedRequest.post.mockReset();
    mockedRequest.get.mockResolvedValue({ recorded: false });
    mockedRequest.post.mockResolvedValue({ recorded: true });
  });

  it('stays out of the way for a user whose consent is already recorded', async () => {
    mockedRequest.get.mockResolvedValue({ recorded: true });
    renderModal();

    await waitFor(() => expect(mockedRequest.get).toHaveBeenCalled());
    expect(screen.queryByTestId('aflat-consent-modal')).not.toBeInTheDocument();
  });

  it('shows the framing, the privacy link and the optional opt-in', async () => {
    renderModal();

    expect(await screen.findByTestId('aflat-consent-modal')).toBeVisible();
    expect(screen.getByTestId('aflat-consent-gdpr-label')).toHaveTextContent(
      'I have read the Privacy policy and I understand how my data is used.',
    );
    expect(screen.getByTestId('aflat-consent-framing-label')).toHaveTextContent(
      'I understand that ai-aflat provides information about legislation, not legal advice.',
    );
    expect(screen.getByTestId('aflat-consent-marketing-label')).toHaveTextContent(
      'I want to receive news about ai-aflat by email.',
    );
    expect(screen.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute(
      'href',
      'https://ai-aflat.ro/confidentialitate',
    );
  });

  /**
   * The reassurance under the opt-in ("you get the answer either way") is a note
   * *about* the choice, not part of it. If it were rendered inside the label span
   * a screen reader would announce it as the checkbox's own name, and it would
   * become part of the click target — so someone reading the reassurance and
   * tapping it would opt themselves into marketing email. Both are pinned here.
   */
  it('shows the opt-in note without folding it into the checkbox', async () => {
    renderModal();
    await screen.findByTestId('aflat-consent-modal');

    const note = screen.getByTestId('aflat-consent-marketing-note');
    expect(note).toHaveTextContent(
      'You get the answer to your question either way, whether you tick this or not.',
    );

    /* an exact-name match: any extra text folded in would fail this query */
    const checkbox = screen.getByRole('checkbox', {
      name: 'I want to receive news about ai-aflat by email.',
    });
    expect(checkbox).toBe(marketingBox());
    expect(screen.getByTestId('aflat-consent-marketing-label')).not.toContainElement(note);

    /* and it is not clickable surface for the box it sits under */
    expect(marketingBox()).toHaveAttribute('data-state', 'unchecked');
    fireEvent.click(note);
    expect(marketingBox()).toHaveAttribute('data-state', 'unchecked');
  });

  it('offers no way out — no close button, no escape, no backdrop', async () => {
    renderModal();
    const modal = await screen.findByTestId('aflat-consent-modal');

    expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();

    fireEvent.keyDown(modal, { key: 'Escape', code: 'Escape' });
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' });
    fireEvent.pointerDown(document.body);
    fireEvent.mouseDown(document.body);

    await waitFor(() => expect(screen.getByTestId('aflat-consent-modal')).toBeVisible());
  });

  it('keeps Continue disabled until both required boxes are checked', async () => {
    renderModal();
    await screen.findByTestId('aflat-consent-modal');

    expect(continueButton()).toBeDisabled();

    fireEvent.click(gdprBox());
    expect(continueButton()).toBeDisabled();

    /* the optional opt-in must not stand in for a required box */
    fireEvent.click(marketingBox());
    expect(continueButton()).toBeDisabled();

    fireEvent.click(framingBox());
    expect(continueButton()).toBeEnabled();

    /* and un-checking one closes the gate again */
    fireEvent.click(gdprBox());
    expect(continueButton()).toBeDisabled();
  });

  it('posts the exact consent record and then lets the app through', async () => {
    const { queryClient } = renderModal();
    await screen.findByTestId('aflat-consent-modal');

    fireEvent.click(gdprBox());
    fireEvent.click(framingBox());
    fireEvent.click(continueButton());

    await waitFor(() => expect(mockedRequest.post).toHaveBeenCalledTimes(1));
    expect(mockedRequest.post.mock.calls[0][0]).toContain('/api/aflat/consents');
    expect(mockedRequest.post.mock.calls[0][1]).toEqual({
      gdprAccepted: true,
      framingAccepted: true,
      marketingOptIn: false,
      wordingVersion: 'v2-2026-08',
    });

    await waitFor(() =>
      expect(screen.queryByTestId('aflat-consent-modal')).not.toBeInTheDocument(),
    );
    expect(queryClient.getQueryData(['aflat', 'consent-status'])).toEqual({ recorded: true });
  });

  it('carries the marketing opt-in when it is ticked', async () => {
    renderModal();
    await screen.findByTestId('aflat-consent-modal');

    fireEvent.click(gdprBox());
    fireEvent.click(framingBox());
    fireEvent.click(marketingBox());
    fireEvent.click(continueButton());

    await waitFor(() => expect(mockedRequest.post).toHaveBeenCalledTimes(1));
    expect(mockedRequest.post.mock.calls[0][1]).toMatchObject({ marketingOptIn: true });
  });

  /** A failed write must leave the gate shut and the retry obvious. */
  it('keeps blocking and says so when the consent cannot be saved', async () => {
    mockedRequest.post.mockRejectedValue(new Error('boom'));
    renderModal();
    await screen.findByTestId('aflat-consent-modal');

    fireEvent.click(gdprBox());
    fireEvent.click(framingBox());
    fireEvent.click(continueButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "We couldn't save your confirmation. Please try again.",
    );
    expect(screen.getByTestId('aflat-consent-modal')).toBeVisible();
    await waitFor(() => expect(continueButton()).toBeEnabled());
  });

  it('does not double-post when Continue is clicked twice', async () => {
    let resolvePost: (value: unknown) => void = () => undefined;
    mockedRequest.post.mockReturnValue(
      new Promise((resolve) => {
        resolvePost = resolve;
      }),
    );
    renderModal();
    await screen.findByTestId('aflat-consent-modal');

    fireEvent.click(gdprBox());
    fireEvent.click(framingBox());
    fireEvent.click(continueButton());
    fireEvent.click(continueButton());

    await waitFor(() => expect(continueButton()).toBeDisabled());
    expect(mockedRequest.post).toHaveBeenCalledTimes(1);
    resolvePost({ recorded: true });
  });

  /**
   * The gate fails open on purpose — the modal only appears on an explicit
   * `recorded: false`, because walling a paying-attention user out of the
   * product over a flaky GET is the worse failure. But "open" has to be
   * temporary: while that GET has no answer, the user is using the product with
   * no `consent_logs` row behind them. So the query has to be able to come back
   * from a failure, on its own, without a reload.
   */
  describe('when the consent check itself fails', () => {
    const consentQueryState = (queryClient: QueryClient) =>
      queryClient.getQueryState(['aflat', 'consent-status'])?.status;

    it('retries past repeated failures and still raises the gate', async () => {
      mockedRequest.get
        .mockRejectedValueOnce(new Error('network down'))
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValue({ recorded: false });

      renderModal();

      expect(await screen.findByTestId('aflat-consent-modal', {}, { timeout: 8000 })).toBeVisible();
      expect(mockedRequest.get.mock.calls.length).toBeGreaterThanOrEqual(3);
    }, 15000);

    it('raises the gate on the next focus after the check has given up', async () => {
      mockedRequest.get.mockRejectedValue(new Error('network down'));
      const { queryClient } = renderModal();

      await waitFor(() => expect(consentQueryState(queryClient)).toBe('error'), { timeout: 8000 });
      expect(screen.queryByTestId('aflat-consent-modal')).not.toBeInTheDocument();

      mockedRequest.get.mockResolvedValue({ recorded: false });
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });

      expect(await screen.findByTestId('aflat-consent-modal', {}, { timeout: 8000 })).toBeVisible();
    }, 15000);
  });
});
