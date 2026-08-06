import { apiBaseUrl } from 'librechat-data-provider';

/**
 * The funnel events an anonymous visitor's browser may post. Mirrors
 * `PUBLIC_EVENT_NAMES` in `api/server/routes/aflatEvents.js`, which rejects
 * anything else — every other event in the funnel is emitted server-side by the
 * route that performed the action, so it cannot be forged from here.
 *
 * `ack_shown` / `ack_declined` bracket the acknowledgement gate, which fires
 * before the question is stored. Without them a visitor who refuses leaves no
 * trace at all, and the drop-off cannot be split between refusing the consent
 * and refusing the signup.
 */
export type AflatEventName = 'ack_shown' | 'ack_declined' | 'gate_shown' | 'gate_login_clicked';

/**
 * Fire-and-forget by design: a failure here must never be visible to the
 * visitor, and `keepalive` lets the event outlive a navigation it triggers.
 *
 * Deliberately takes no payload. A refusal that carries the question's length,
 * topic or any other derived field has stopped being a refusal, and the cheapest
 * way to guarantee that is to leave no parameter to pass one through.
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
