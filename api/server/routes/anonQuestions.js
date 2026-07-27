const express = require('express');
const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');
const { anonQuestionLimiter } = require('~/server/middleware/limiters/aflatLimiters');
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
 */
router.post('/:id/link', requireJwtAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  if (!mongoose.isValidObjectId(id)) {
    return res.status(404).json({ error: 'not found' });
  }

  try {
    const doc = await AnonQuestion.findById(id);
    if (!doc || (doc.linkedUserId && String(doc.linkedUserId) !== String(userId))) {
      return res.status(404).json({ error: 'not found' });
    }

    const alreadyLinked = doc.linkedUserId != null;
    if (!alreadyLinked) {
      doc.linkedUserId = userId;
      await doc.save();
      await recordProductEvent('gate_converted', { userId });
    }

    return res.json({ id: doc._id, text: doc.text });
  } catch (error) {
    logger.error('[anonQuestions] Error linking anonymous question', error);
    return res.status(500).json({ error: 'could not link question' });
  }
});

module.exports = router;
