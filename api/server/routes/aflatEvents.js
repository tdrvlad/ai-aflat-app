const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { aflatEventLimiter } = require('~/server/middleware/limiters/aflatLimiters');
const { ProductEvent } = require('~/db/models');

const router = express.Router();

/**
 * ai-aflat: the only event names an unauthenticated client may post. Everything
 * else in the funnel (`question_submitted`, `gate_converted`,
 * `consent_recorded`) is emitted server-side from the route that actually
 * performed the action, so it cannot be forged from the browser.
 *
 * `ack_shown` / `ack_declined` bracket the acknowledgement gate, which fires
 * before anything is stored — so without them a visitor who refuses is invisible
 * and the drop-off cannot be split between refusing the consent and refusing the
 * signup. They must never carry the question's length, topic or any other
 * derived field: the moment a refusal describes the refused text, it has stopped
 * being a refusal.
 */
const PUBLIC_EVENT_NAMES = ['ack_shown', 'ack_declined', 'gate_shown', 'gate_login_clicked'];

/** `meta` is client-supplied on an unauthenticated route: keep it to funnel-sized attributes. */
const MAX_META_BYTES = 2048;

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Writes a product-funnel event. Telemetry is best-effort by design: a failed
 * write is logged and swallowed so it can never fail the user's actual request.
 *
 * `userId` is null for anonymous emits, and no request IP or user agent is ever
 * passed in — see the GDPR note on the `productEvent` schema.
 */
const recordProductEvent = async (name, { userId = null, meta = {} } = {}) => {
  try {
    await ProductEvent.create({ name, userId, meta });
  } catch (error) {
    logger.error(`[aflat] failed to record product event "${name}"`, error);
  }
};

router.post('/', aflatEventLimiter, async (req, res) => {
  const { name, meta } = req.body ?? {};

  if (!PUBLIC_EVENT_NAMES.includes(name)) {
    return res.status(400).json({ error: 'unknown event' });
  }
  if (meta !== undefined && !isPlainObject(meta)) {
    return res.status(400).json({ error: 'invalid meta' });
  }
  if (meta !== undefined && Buffer.byteLength(JSON.stringify(meta)) > MAX_META_BYTES) {
    return res.status(400).json({ error: 'meta too large' });
  }

  await recordProductEvent(name, { meta: meta ?? {} });
  return res.status(204).end();
});

module.exports = router;
module.exports.recordProductEvent = recordProductEvent;
module.exports.PUBLIC_EVENT_NAMES = PUBLIC_EVENT_NAMES;
