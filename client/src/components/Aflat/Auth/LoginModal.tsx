import { OGDialog, OGDialogContent, OGDialogTitle } from '@librechat/client';
import { useGetStartupConfig } from '~/data-provider';
import { postAflatEvent } from '../events';
import ClerkSignIn from './ClerkSignIn';
import { useLocalize } from '~/hooks';
import { useEffect } from 'react';

/**
 * The identity step, held over the conversation rather than navigated to.
 *
 * The question is already parked and visible behind the dim; this modal is the
 * only thing between it and an answer. It never navigates — `ClerkSignIn`
 * establishes the session in place and calls `onSignedIn`, so the modal closes
 * onto the same thread, same scroll position, same conversation id. That
 * continuity is the whole reason the redesign has one chat screen instead of a
 * separate `/ask`.
 *
 * Dismissible on purpose. Someone who backs out keeps their question — it is
 * held for 24 hours and offered back on their next visit — so trapping them here
 * would buy nothing and cost the trust the parked question was meant to earn.
 */
export default function LoginModal({
  open,
  onSignedIn,
  onDismiss,
}: {
  open: boolean;
  onSignedIn: () => void;
  onDismiss: () => void;
}) {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const publishableKey = startupConfig?.clerkPublishableKey ?? null;

  useEffect(() => {
    if (open) {
      postAflatEvent('gate_shown');
    }
  }, [open]);

  if (!open || !publishableKey) {
    return null;
  }

  return (
    <OGDialog
      open={true}
      onOpenChange={(next) => {
        if (!next) {
          onDismiss();
        }
      }}
    >
      <OGDialogContent
        data-testid="aflat-login-modal"
        showCloseButton={false}
        className="w-11/12 max-w-md gap-0 overflow-hidden p-0 sm:w-full"
      >
        <div className="aa-tricolor" aria-hidden="true" />
        <div className="flex flex-col gap-4 px-6 pb-6 pt-5">
          {/**
           * Title only. The reassurance that the question is safe is already on
           * screen, in the parked-question note directly above this modal
           * („Rămâne în browserul tău — o trimitem imediat ce ai cont"), and the
           * title already carries the ask — a body paragraph here said both of
           * them a third time (2026-08-06).
           */}
          <OGDialogTitle>{localize('com_aflat_gate_title')}</OGDialogTitle>

          {/**
           * Reserved, not fixed. Clerk's widget genuinely changes height between
           * the email step, the password step and an error — and it renders its
           * own failure alert above itself, adding more. A fixed height would
           * clip it; no reservation at all makes the load read as a stall. So
           * the common case never moves, and a taller state grows the box rather
           * than overflowing it.
           *
           * Sized for the *shortest* real step, not the first one. The widget is
           * now sign-in-or-up, so it spans an email prompt, a sign-up form and a
           * six-box verification code — reserving the tallest of those leaves a
           * visible hole under the shorter ones, which is what 244px did to the
           * code step. The reservation only has to stop the empty box collapsing
           * before Clerk paints; past that, the step decides the height.
           */}
          <div className="min-h-[180px]">
            <ClerkSignIn publishableKey={publishableKey} onSignedIn={onSignedIn} />
          </div>

          <p className="m-0 text-xs leading-relaxed text-text-tertiary">
            {localize('com_aflat_gate_note')}
          </p>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
