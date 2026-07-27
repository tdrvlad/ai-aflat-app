const express = require('express');
const { logger } = require('@librechat/data-schemas');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { recordProductEvent } = require('./aflatEvents');
const { ConsentLog } = require('~/db/models');

const router = express.Router();

/* Every consent route is authenticated — a consent is meaningless without a subject. */
router.use(requireJwtAuth);

/** Has this user already accepted the GDPR notice and the legal-information framing? */
router.get('/me', async (req, res) => {
  try {
    const recorded = await ConsentLog.exists({ userId: req.user.id });
    return res.json({ recorded: recorded != null });
  } catch (error) {
    logger.error('[consents] Error reading consent state', error);
    return res.status(500).json({ error: 'could not read consent' });
  }
});

/**
 * Record consent. Both `gdprAccepted` and `framingAccepted` must be literally
 * `true` — the framing acknowledgement ("this informs about legislation, it is
 * not legal advice") is not optional, so a truthy-but-not-true value is a
 * client bug, not a consent.
 *
 * `wordingVersion` is stored exactly as sent and never validated against a
 * hardcoded constant: the record must say which text the user actually saw,
 * and that changes independently of this code.
 */
router.post('/', async (req, res) => {
  const { gdprAccepted, framingAccepted, marketingOptIn, wordingVersion } = req.body ?? {};

  if (
    gdprAccepted !== true ||
    framingAccepted !== true ||
    typeof wordingVersion !== 'string' ||
    !wordingVersion.trim() ||
    (marketingOptIn !== undefined && typeof marketingOptIn !== 'boolean')
  ) {
    return res.status(400).json({ error: 'invalid consent' });
  }

  try {
    const userId = req.user.id;
    await ConsentLog.create({
      userId,
      gdprAccepted: true,
      framingAccepted: true,
      marketingOptIn: marketingOptIn === true,
      wordingVersion,
    });
    await recordProductEvent('consent_recorded', { userId });
    return res.status(201).json({ recorded: true });
  } catch (error) {
    logger.error('[consents] Error recording consent', error);
    return res.status(500).json({ error: 'could not record consent' });
  }
});

module.exports = router;
