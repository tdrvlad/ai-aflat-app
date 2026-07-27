const rateLimit = require('express-rate-limit');
const { limiterCache, removePorts } = require('@librechat/api');

/**
 * ai-aflat: abuse control for the two anonymous "colectorul" endpoints.
 *
 * Built exactly like `registerLimiter` — same `express-rate-limit` options, same
 * `removePorts` key generator, same `limiterCache` store — with two deliberate
 * differences:
 *
 * 1. No `logViolation` call. Both routes are unauthenticated, so `logViolation`
 *    would short-circuit on the missing `req.user` anyway; leaving it out makes
 *    it structurally impossible for a violation record to ever carry the
 *    visitor's IP. The IP exists only as the limiter's in-memory/Redis key and
 *    is never persisted, logged, or written to any document.
 * 2. No `ViolationTypes` entry. These aren't security violations worth banning
 *    on — an over-eager landing page is the likely cause.
 */
const buildAnonLimiter = ({ windowInMinutes, max, prefix, message }) =>
  rateLimit({
    windowMs: windowInMinutes * 60 * 1000,
    max,
    handler: (_req, res) => res.status(429).json({ message }),
    keyGenerator: removePorts,
    store: limiterCache(prefix),
  });

const {
  AFLAT_ANON_QUESTION_WINDOW = 60,
  AFLAT_ANON_QUESTION_MAX = 5,
  AFLAT_EVENT_WINDOW = 60,
  AFLAT_EVENT_MAX = 30,
} = process.env;

/** 5 parked questions per hour per IP. */
const anonQuestionLimiter = buildAnonLimiter({
  windowInMinutes: Number(AFLAT_ANON_QUESTION_WINDOW),
  max: Number(AFLAT_ANON_QUESTION_MAX),
  prefix: 'aflat_anon_question_limiter',
  message: 'Prea multe întrebări trimise. Încearcă din nou peste o oră.',
});

/** 30 product events per hour per IP. */
const aflatEventLimiter = buildAnonLimiter({
  windowInMinutes: Number(AFLAT_EVENT_WINDOW),
  max: Number(AFLAT_EVENT_MAX),
  prefix: 'aflat_event_limiter',
  message: 'Too many events',
});

module.exports = { anonQuestionLimiter, aflatEventLimiter };
