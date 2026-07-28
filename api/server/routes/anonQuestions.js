const express = require('express');
const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');
const {
  anonQuestionLimiter,
  anonQuestionLinkLimiter,
} = require('~/server/middleware/limiters/aflatLimiters');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const { recordProductEvent } = require('./aflatEvents');
const { AnonQuestion } = require('~/db/models');

const router = express.Router();

const MAX_QUESTION_LENGTH = 4000;

/**
 * ai-aflat "colectorul": park an anonymous visitor's question before signup.
 *
 * No auth. Abuse control is the per-IP limiter only — the IP lives in limiter
 * state and nowhere else: it is never stored on the document, never logged.
 *
 * `ackVersion` is the version of the acknowledgement wording the visitor was
 * shown. It is data the client sends and we store verbatim; it is deliberately
 * NOT checked against a constant, so changing the wording never invalidates
 * older records or requires a code change here.
 */
router.post('/', anonQuestionLimiter, async (req, res) => {
  const { text, ackVersion } = req.body ?? {};

  if (
    typeof text !== 'string' ||
    !text.trim() ||
    text.length > MAX_QUESTION_LENGTH ||
    typeof ackVersion !== 'string' ||
    !ackVersion.trim()
  ) {
    return res.status(400).json({ error: 'invalid question' });
  }

  try {
    const doc = await AnonQuestion.create({ text: text.trim(), ackVersion });
    await recordProductEvent('question_submitted', { meta: { anon: true } });
    return res.status(201).json({ id: doc._id });
  } catch (error) {
    logger.error('[anonQuestions] Error creating anonymous question', error);
    return res.status(500).json({ error: 'could not save question' });
  }
});

/**
 * Claim a parked question after signing in. Idempotent for the owner; a
 * question already claimed by someone else is indistinguishable from one that
 * does not exist (404), so ids cannot be probed for existence.
 *
 * The limiter runs BEFORE `requireJwtAuth` on purpose, for two reasons: failed
 * auth attempts must count against the same per-IP budget (otherwise the
 * throttle is trivially bypassed), and it keeps `req.user` unset at limiter
 * time, which is what makes the no-IP-in-logs guarantee structural rather than
 * a matter of remembering not to log.
 */
router.post('/:id/link', anonQuestionLinkLimiter, requireJwtAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  if (!mongoose.isValidObjectId(id)) {
    return res.status(404).json({ error: 'not found' });
  }

  try {
    /**
     * One conditional update, not find-then-save: two concurrent claims from
     * different users would otherwise both read `linkedUserId == null`, both
     * write, and both get 200 plus the text. The `$or` is the guard — it matches
     * only an unclaimed question or one this same user already holds, so the
     * loser of a race matches nothing and falls through to the 404 below.
     *
     * `findOneAndUpdate` returns the PRE-image by default, which is exactly what
     * we need: `previous.linkedUserId == null` is the "we are the claimer"
     * signal that gates the event, and `text` is unaffected by the update.
     */
    const previous = await AnonQuestion.findOneAndUpdate(
      { _id: id, $or: [{ linkedUserId: null }, { linkedUserId: userId }] },
      { $set: { linkedUserId: userId } },
      { new: false },
    );

    if (!previous) {
      return res.status(404).json({ error: 'not found' });
    }

    if (previous.linkedUserId == null) {
      await recordProductEvent('gate_converted', { userId });
    }

    return res.json({ id: previous._id, text: previous.text });
  } catch (error) {
    logger.error('[anonQuestions] Error linking anonymous question', error);
    return res.status(500).json({ error: 'could not link question' });
  }
});

module.exports = router;
