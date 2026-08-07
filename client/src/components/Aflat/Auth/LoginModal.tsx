import { OGDialog, OGDialogContent, OGDialogTitle } from '@librechat/client';
import { useAnonAuth } from './ClerkBridge';
import { SignInPanel } from './ClerkSignIn';
import { traceAuth } from './authTrace';
import { postAflatEvent } from '../events';
import { useLocalize } from '~/hooks';
import { useEffect } from 'react';

/**
 * The identity step, held over the conversation rather than navigated to.
 *
 * The question is already parked and visible behind the dim; this modal is the
 * only thing between it and an answer. It never navigates — the shell-level
 * bridge (`ClerkBridge.tsx`) establishes the session in place, `Root` swaps
 * the anonymous tree for the signed-in one, and the thread continues: same
 * scroll, same conversation id. That continuity is the whole reason the
 * redesign has one chat screen instead of a separate `/ask`.
 *
 * NOT dismissible — ruled by Vlad 2026-08-07, reversing the earlier call. The
 * parked question is the incentive to create an account, and the account is
 * the only way the question can be answered; a dismissal returns the visitor
 * to a thread that can never progress, which reads as the product stalling
 * rather than the visitor choosing. Escape and the overlay do nothing; the
 * ways forward are signing in, or — if the exchange itself fails — the retry
 * and full-page fallback links `SignInPanel` shows. A reload also works and
 * keeps the question: the stash survives in `localStorage`.
 */
export default function LoginModal({ open }: { open: boolean }) {
  const localize = useLocalize();
  const anonAuth = useAnonAuth();

  useEffect(() => {
    if (open) {
      traceAuth('gate_shown');
      postAflatEvent('gate_shown');
    }
  }, [open]);

  /**
   * `enabled` is false when Clerk is unconfigured — there is no widget to
   * show, and an empty, undismissable dialog would be a trap.
   */
  if (!open || !anonAuth.enabled) {
    return null;
  }

  return (
    <OGDialog
      open={true}
      /* Deliberately inert: see the component comment — the gate does not close. */
      onOpenChange={() => undefined}
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
            <SignInPanel bridge={anonAuth} />
          </div>

          <p className="m-0 text-xs leading-relaxed text-text-tertiary">
            {localize('com_aflat_gate_note')}
          </p>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
