const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { constructEvent, processEvent, isPaymentsConfigured } = require('@librechat/api');
const methods = require('~/models');

const router = express.Router();

/**
 * Stripe webhooks.
 *
 * **This router is mounted before `express.json()` and carries no auth**, both
 * deliberately. Stripe cannot present a JWT, so the signature check inside
 * `constructEvent` is the entire authentication of this endpoint — and it can only
 * verify the unparsed bytes, which is why `express.raw` is applied here rather than
 * inheriting the app's JSON parser.
 *
 * See `docs/superpowers/specs/2026-08-04-stripe-payments-design.md` §3.1.
 */
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!isPaymentsConfigured()) {
    logger.warn('[webhooks/stripe] Received an event while payments are unconfigured');
    return res.status(503).json({ error: 'payments not configured' });
  }

  const signature = req.headers['stripe-signature'];
  if (!signature) {
    return res.status(400).json({ error: 'missing signature' });
  }

  let event;
  try {
    event = constructEvent(req.body, signature);
  } catch (error) {
    /* Never echo the reason — it tells a prober how close their forgery got. */
    logger.warn('[webhooks/stripe] Signature verification failed', error);
    return res.status(400).json({ error: 'invalid signature' });
  }

  try {
    const result = await processEvent(methods, event);
    return res.json(result);
  } catch (error) {
    /**
     * A 500 makes Stripe retry, which is what we want: the event is recorded with
     * `handled: false` and redelivery is the recovery path. Returning 200 here
     * would drop a real payment on the floor silently.
     */
    logger.error(`[webhooks/stripe] Failed to process event ${event.id} (${event.type})`, error);
    return res.status(500).json({ error: 'processing failed' });
  }
});

module.exports = router;
