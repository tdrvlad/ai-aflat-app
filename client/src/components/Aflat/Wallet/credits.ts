import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiBaseUrl, request } from 'librechat-data-provider';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

/**
 * The wallet's data layer.
 *
 * Called directly rather than through `librechat-data-provider`, matching how
 * every other ai-aflat endpoint is reached from the client (`consent.ts`,
 * `usePostLoginHandoff.ts`). Keeping the fork's endpoints out of the shared
 * package is what keeps upstream rebases cheap.
 */

export const balanceKey = ['aflat', 'credits', 'balance'] as const;
export const pricingKey = ['aflat', 'credits', 'pricing'] as const;
export const ledgerKey = ['aflat', 'credits', 'ledger'] as const;

const creditsUrl = () => `${apiBaseUrl()}/api/aflat/credits`;

export type Effort = 'low' | 'medium' | 'high';

export type CreditBalance = { available: number; reserved: number };

export type CreditBundle = { id: string; credits: number; priceRon: number };

export type PriceList = {
  version: string;
  defaultEffort: Effort;
  actions: Record<string, Record<Effort, number>>;
  bundles: CreditBundle[];
  grants: { signupBonus: number; monthlyRefill: number };
};

export type LedgerEntry = {
  id: string;
  type: string;
  credits: number;
  reasonCode: string;
  actionType: string | null;
  effort: Effort | null;
  createdAt: string;
};

export type LedgerPage = { entries: LedgerEntry[]; nextCursor: string | null };

/**
 * The balance also drives the automatic grants: reading it is what applies the
 * welcome bonus and the monthly refill, which are lazy server-side. A short
 * `staleTime` rather than a long one because a purchase changes it out of band —
 * the webhook, not the browser, is what grants purchased credits.
 */
export const useCreditBalance = (): UseQueryResult<CreditBalance> =>
  useQuery<CreditBalance>(balanceKey, () => request.get<CreditBalance>(`${creditsUrl()}/balance`), {
    staleTime: 30_000,
    retry: 2,
  });

/** The price list changes only on a deploy, so it is cached for the session. */
export const usePricing = (): UseQueryResult<PriceList> =>
  useQuery<PriceList>(pricingKey, () => request.get<PriceList>(`${creditsUrl()}/pricing`), {
    staleTime: Infinity,
    cacheTime: Infinity,
    retry: 2,
  });

export const useLedger = (): UseQueryResult<LedgerPage> =>
  useQuery<LedgerPage>(ledgerKey, () => request.get<LedgerPage>(`${creditsUrl()}/ledger`), {
    staleTime: 30_000,
    retry: 2,
  });

export type CheckoutInput = { bundleId: string; consentImmediatePerformance: boolean };
export type CheckoutResponse = { url: string };

/**
 * Opens a Stripe Checkout session and hands back its url.
 *
 * The consent flag is sent rather than assumed: the server refuses without it,
 * and that refusal is the point — credits are spendable the instant they land, so
 * the 14-day withdrawal right has to be waived explicitly before a session exists.
 */
export const useCheckout = (): UseMutationResult<CheckoutResponse, unknown, CheckoutInput> =>
  useMutation(
    /* `request.post` is untyped upstream, unlike `request.get`. */
    (input: CheckoutInput) =>
      request.post(`${creditsUrl()}/checkout`, input) as Promise<CheckoutResponse>,
  );

/**
 * Refetches balance and ledger after returning from Stripe.
 *
 * The webhook is what grants credits, and it can land after the redirect does, so
 * the return page cannot simply read once and trust the answer. Callers poll this
 * briefly rather than showing a balance that is merely not-updated-yet.
 */
export const useRefreshWallet = (): (() => Promise<void>) => {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries(balanceKey),
      queryClient.invalidateQueries(ledgerKey),
    ]);
  };
};
