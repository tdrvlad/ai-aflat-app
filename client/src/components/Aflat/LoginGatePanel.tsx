import { useEffect } from 'react';
import { Button } from '@librechat/client';
import { apiBaseUrl, loginPage } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

type AflatEventName = 'gate_shown' | 'gate_login_clicked';

/**
 * Funnel telemetry. Strictly fire-and-forget: a failure here must never be
 * visible to the visitor, and `keepalive` lets the click event outlive the
 * navigation it triggers.
 */
export const postAflatEvent = (name: AflatEventName): void => {
  try {
    void fetch(`${apiBaseUrl()}/api/aflat/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* telemetry is never allowed to affect the UX */
  }
};

/**
 * Shown in place of an answer once the question is parked: the gate never
 * renders legal content to an anonymous visitor.
 */
export default function LoginGatePanel() {
  const localize = useLocalize();

  useEffect(() => {
    postAflatEvent('gate_shown');
  }, []);

  const handleContinue = () => {
    postAflatEvent('gate_login_clicked');
    window.location.assign(loginPage());
  };

  return (
    <div
      data-testid="aflat-login-gate"
      className="mx-auto flex w-full flex-col items-start gap-4 rounded-3xl border border-border-medium bg-surface-secondary p-5 text-text-primary shadow-md sm:p-6"
    >
      <p className="m-0 text-base">{localize('com_aflat_gate_body')}</p>
      <Button variant="submit" size="lg" onClick={handleContinue} data-testid="aflat-gate-continue">
        {localize('com_aflat_gate_continue')}
      </Button>
    </div>
  );
}
