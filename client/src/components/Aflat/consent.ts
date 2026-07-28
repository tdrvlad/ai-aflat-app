import { useQuery } from '@tanstack/react-query';
import { apiBaseUrl, request } from 'librechat-data-provider';
import type { UseQueryResult } from '@tanstack/react-query';

/**
 * Consent state for the signed-in user, shared by the two surfaces that need it:
 * `ConsentModal` (blocks the app until it is recorded) and `usePostLoginHandoff`
 * (must not submit anything on the user's behalf before it is). One React Query
 * key means one request and one answer — the modal and the handoff can never
 * disagree about whether consent exists.
 */

/**
 * Version of the wording the user is shown. Stored verbatim on the consent
 * record, so bump it whenever the copy below changes — old records must keep
 * saying which text was actually accepted.
 */
export const CONSENT_WORDING_VERSION = 'v2-2026-08';

export const PRIVACY_POLICY_URL = 'https://ai-aflat.ro/confidentialitate';

export const consentStatusKey = ['aflat', 'consent-status'] as const;

export type ConsentStatus = { recorded: boolean };

export type ConsentInput = {
  gdprAccepted: boolean;
  framingAccepted: boolean;
  marketingOptIn: boolean;
};

const consentsUrl = () => `${apiBaseUrl()}/api/aflat/consents`;

/**
 * `staleTime: Infinity` on purpose: consent is a one-way transition within a
 * session and the POST writes the new state into the cache directly, so once we
 * have an answer a refetch could only re-assert what we already know — and a
 * refetch that failed mid-session would re-raise a modal in front of a user who
 * just accepted.
 *
 * Everything else here exists so that *not having* an answer stays temporary.
 * Both surfaces fail open — the modal only opens on an explicit `recorded:false`
 * — so an unanswered GET hands the user the product with no consent on record,
 * which is the state this gate exists to prevent. It must not be reachable by a
 * single flaky request: hence real retries, and a refetch when the tab is
 * focused or the network comes back. Those are safe precisely because of
 * `staleTime: Infinity` — React Query treats a query that never resolved as
 * stale (`dataUpdatedAt` is 0) and one that has as fresh forever, so these
 * triggers can only ever fire while the answer is still missing.
 */
export const useConsentStatus = (): UseQueryResult<ConsentStatus> =>
  useQuery<ConsentStatus>(
    consentStatusKey,
    () => request.get<ConsentStatus>(`${consentsUrl()}/me`),
    {
      staleTime: Infinity,
      cacheTime: Infinity,
      retry: 3,
      /* Faster than the library default: this gate stands in front of the app. */
      retryDelay: (attempt) => Math.min(250 * 2 ** attempt, 5000),
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  );

export const recordConsent = (input: ConsentInput): Promise<unknown> =>
  request.post(consentsUrl(), { ...input, wordingVersion: CONSENT_WORDING_VERSION });
