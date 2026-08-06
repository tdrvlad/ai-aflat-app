const { logger } = require('@librechat/data-schemas');
const { buildAflatUsageEvent } = require('@librechat/api');
const { UsageEvent } = require('~/db/models');

/**
 * ai-aflat: writes the `usage_events` row for a completed request, from the
 * envelope the sources fetch already returned (telemetry spec 2026-08-06 §1).
 *
 * Fire-and-forget by design: telemetry must NEVER fail or delay the user's
 * answer, so the returned promise is safe to leave un-awaited — a failed write
 * is logged and swallowed, and a skipped write (non-aflat endpoint, or no
 * envelope for this message) is a debug line, not an error.
 */
function recordAflatUsageEvent({ payload, userId, conversationId, messageId }) {
  const event = buildAflatUsageEvent({ payload, userId, conversationId, messageId });
  if (event == null) {
    logger.debug(`[aflat/usage] no usage envelope for ${messageId}; skipping usage event`);
    return Promise.resolve(null);
  }

  return UsageEvent.create(event).catch((error) => {
    logger.error(`[aflat/usage] failed to record usage event for ${messageId}`, error);
    return null;
  });
}

module.exports = { recordAflatUsageEvent };
