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
export const CONSENT_WORDING_VERSION = 'v1-2026-07';

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
 * session and the POST writes the new state into the cache directly, so any
 * refetch could only re-assert what we already know — while a refetch that
 * failed mid-session would re-raise a modal in front of a user who just accepted.
 */
export const useConsentStatus = (): UseQueryResult<ConsentStatus> =>
  useQuery<ConsentStatus>(
    consentStatusKey,
    () => request.get<ConsentStatus>(`${consentsUrl()}/me`),
    {
      staleTime: Infinity,
      cacheTime: Infinity,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  );

export const recordConsent = (input: ConsentInput): Promise<unknown> =>
  request.post(consentsUrl(), { ...input, wordingVersion: CONSENT_WORDING_VERSION });
