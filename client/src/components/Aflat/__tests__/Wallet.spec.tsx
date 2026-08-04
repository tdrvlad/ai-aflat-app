import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { request } from 'librechat-data-provider';
import Wallet from '../Wallet/Wallet';

/**
 * The wallet is where the product's commercial rules become visible, so these
 * cases pin the ones that would otherwise soften without anyone noticing: prices
 * are quoted in credits, RON appears only on bundles, and a purchase cannot start
 * without an explicit waiver of the 14-day withdrawal right.
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

const PRICING = {
  version: '2026-08-03',
  defaultEffort: 'medium',
  actions: { simple_question: { low: 5, medium: 10, high: 20 } },
  bundles: [
    { id: 'start', credits: 200, priceRon: 29 },
    { id: 'uzual', credits: 800, priceRon: 99 },
    { id: 'extins', credits: 2500, priceRon: 249 },
  ],
  grants: { signupBonus: 100, monthlyRefill: 20 },
};

const renderWallet = (route = '/credits') => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <Wallet />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedRequest.get.mockImplementation((url: string) => {
    if (url.includes('/balance')) {
      return Promise.resolve({ available: 420, reserved: 0 });
    }
    if (url.includes('/pricing')) {
      return Promise.resolve(PRICING);
    }
    return Promise.resolve({ entries: [], nextCursor: null });
  });
});

describe('Wallet', () => {
  it('shows the balance in credits', async () => {
    renderWallet();
    expect(await screen.findByText(/420 credits/)).toBeInTheDocument();
  });

  it('quotes the effort ladder in credits, never in lei', async () => {
    renderWallet();
    await screen.findByText(/420 credits/);

    expect(screen.getByText('5 credits')).toBeInTheDocument();
    expect(screen.getByText('10 credits')).toBeInTheDocument();
    expect(screen.getByText('20 credits')).toBeInTheDocument();
  });

  /**
   * The rule Vlad set explicitly: a lei-per-question figure turns a legal
   * question into a taxi meter. RON is allowed on bundles and nowhere else.
   */
  it('shows lei only on bundles', async () => {
    renderWallet();
    await screen.findByText(/420 credits/);

    const leiNodes = screen.getAllByText(/\d+ lei/);
    const amounts = leiNodes.map((node) => node.textContent?.trim());
    expect(amounts.sort()).toEqual(['249 lei', '29 lei', '99 lei']);
  });

  it('refuses to start checkout without the withdrawal-right waiver', async () => {
    renderWallet();
    await screen.findByText(/420 credits/);

    fireEvent.click(screen.getAllByRole('button', { name: 'Buy' })[0]);

    expect(await screen.findByRole('alert')).toHaveTextContent('Tick the box above');
    expect(mockedRequest.post).not.toHaveBeenCalled();
  });

  it('sends the consent flag once the box is ticked', async () => {
    mockedRequest.post.mockResolvedValue({ url: 'https://checkout.stripe.com/x' });
    renderWallet();
    await screen.findByText(/420 credits/);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Buy' })[1]);

    await waitFor(() => expect(mockedRequest.post).toHaveBeenCalled());
    const [url, body] = mockedRequest.post.mock.calls[0];
    expect(url).toContain('/api/aflat/credits/checkout');
    expect(body).toEqual({ bundleId: 'uzual', consentImmediatePerformance: true });
  });

  it('says plainly that a non-answer costs nothing', async () => {
    renderWallet();
    await screen.findByText(/420 credits/);

    expect(screen.getByText(/No credits are used if we find no answer/)).toBeInTheDocument();
  });

  it('reports a pending grant on return rather than a stale balance', async () => {
    renderWallet('/credits?status=success');
    await screen.findByText(/420 credits/);

    /* The webhook grants, not the redirect — so this must not claim success yet. */
    expect(screen.getByRole('status')).toHaveTextContent('will appear in a few seconds');
  });

  it('reassures on a cancelled payment', async () => {
    renderWallet('/credits?status=cancelled');
    await screen.findByText(/420 credits/);

    expect(screen.getByRole('status')).toHaveTextContent('have not been charged');
  });

  it('surfaces an unavailable payment path as such', async () => {
    mockedRequest.post.mockRejectedValue({
      response: { data: { error: 'payments_unavailable' } },
    });
    renderWallet();
    await screen.findByText(/420 credits/);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Buy' })[0]);

    expect(await screen.findByRole('alert')).toHaveTextContent('Payment is unavailable');
  });
});
