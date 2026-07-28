import { useCallback, useId, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Checkbox,
  OGDialog,
  OGDialogContent,
  OGDialogTitle,
  OGDialogDescription,
} from '@librechat/client';
import { PRIVACY_POLICY_URL, consentStatusKey, recordConsent, useConsentStatus } from './consent';
import { useLocalize } from '~/hooks';

/**
 * The one-time gate between a new account and the app: it states the legal-
 * information framing and the data processing, and records that the user
 * accepted both. Deliberately non-dismissible — there is no close button, no
 * escape, no backdrop click and no cancel, because a consent that can be skipped
 * is not a consent. It is still a proper dialog: Radix traps focus inside it and
 * marks the rest of the page inert, so keyboard and screen-reader users are held
 * by the same boundary as everyone else, not locked out of it.
 *
 * Mounted in the authenticated shell (`routes/Root.tsx`), so it renders once per
 * session and blocks every authenticated route, not just the chat.
 */

function ConsentRow({
  id,
  testId,
  checked,
  onCheckedChange,
  children,
}: {
  id: string;
  testId: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  const labelId = `${id}-label`;
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={id}
        data-testid={testId}
        aria-labelledby={labelId}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className="mt-0.5"
      />
      <span id={labelId} data-testid={`${testId}-label`} className="text-sm text-text-primary">
        {children}
      </span>
    </div>
  );
}

export default function ConsentModal() {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { data } = useConsentStatus();
  const baseId = useId();

  const [gdprAccepted, setGdprAccepted] = useState(false);
  const [framingAccepted, setFramingAccepted] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * Synchronous in-flight latch. `mutation.isLoading` only becomes true after a
   * re-render, so two clicks dispatched in the same batch — a double-click, or an
   * impatient tap on a slow connection — would both read `false` and both POST,
   * writing two consent records for one acceptance.
   */
  const inFlightRef = useRef(false);

  const mutation = useMutation(recordConsent, {
    onSuccess: () => {
      /**
       * Written straight into the cache rather than invalidated: this is the
       * signal `usePostLoginHandoff` waits on, and a refetch would put a network
       * round trip (and a possible failure) between accepting and being let in.
       */
      queryClient.setQueryData(consentStatusKey, { recorded: true });
    },
    onError: () => setFailed(true),
    onSettled: () => {
      inFlightRef.current = false;
    },
  });

  const handleContinue = useCallback(() => {
    if (inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    setFailed(false);
    mutation.mutate({ gdprAccepted: true, framingAccepted: true, marketingOptIn });
  }, [marketingOptIn, mutation]);

  /**
   * Only an explicit `recorded: false` opens the gate. While the query is in
   * flight — or if it failed — the app stays usable: the handoff is gated on the
   * same answer, so nothing is sent on the user's behalf either way, and walling
   * off the product on a flaky GET would be a worse failure than a late modal.
   */
  if (data?.recorded !== false) {
    return null;
  }

  const canContinue = gdprAccepted && framingAccepted;

  return (
    <OGDialog open={true}>
      <OGDialogContent
        data-testid="aflat-consent-modal"
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        className="w-11/12 max-w-lg gap-5 sm:w-full"
      >
        <div className="flex flex-col gap-1.5">
          <OGDialogTitle>{localize('com_aflat_consent_title')}</OGDialogTitle>
          <OGDialogDescription>{localize('com_aflat_consent_description')}</OGDialogDescription>
        </div>

        <div className="flex flex-col gap-4">
          <ConsentRow
            id={`${baseId}-gdpr`}
            testId="aflat-consent-gdpr"
            checked={gdprAccepted}
            onCheckedChange={setGdprAccepted}
          >
            {localize('com_aflat_consent_gdpr_before')}{' '}
            <a
              href={PRIVACY_POLICY_URL}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-border-heavy underline-offset-2 transition-colors hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
            >
              {localize('com_aflat_ack_privacy_link')}
            </a>{' '}
            {localize('com_aflat_consent_gdpr_after')}
          </ConsentRow>

          <ConsentRow
            id={`${baseId}-framing`}
            testId="aflat-consent-framing"
            checked={framingAccepted}
            onCheckedChange={setFramingAccepted}
          >
            {localize('com_aflat_consent_framing')}
          </ConsentRow>

          <ConsentRow
            id={`${baseId}-marketing`}
            testId="aflat-consent-marketing"
            checked={marketingOptIn}
            onCheckedChange={setMarketingOptIn}
          >
            {localize('com_aflat_consent_marketing')}
          </ConsentRow>
        </div>

        {failed && (
          <div
            role="alert"
            data-testid="aflat-consent-error"
            className="rounded-xl border border-border-destructive bg-surface-secondary px-4 py-2.5 text-sm text-text-destructive"
          >
            {localize('com_aflat_consent_error')}
          </div>
        )}

        <Button
          variant="submit"
          type="button"
          onClick={handleContinue}
          disabled={!canContinue || mutation.isLoading}
          data-testid="aflat-consent-continue"
          className="w-full"
        >
          {localize('com_aflat_consent_continue')}
        </Button>
      </OGDialogContent>
    </OGDialog>
  );
}
