const crypto = require('node:crypto');
const express = require('express');
const { shouldUseSecureCookie } = require('@librechat/api');
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
 * The claim credential.
 *
 * A parked question is a stranger's free-text legal problem — divorce, debt,
 * dismissal — so the only thing that may authorise reading one back is a secret
 * the browser that parked it holds and nobody else can produce. That rules out
 * the document's `_id`: ObjectIds are partially predictable (the 5-byte
 * per-process random is constant, the 3-byte counter is bracketed by any two
 * ids an attacker mints themselves), so an id in the request is an enumeration
 * oracle no rate limiter fully closes. The token below replaces it, and the
 * claim takes no id at all — there is nothing left to guess at.
 *
 * `path` scopes the cookie to the ai-aflat surfaces so it is not attached to
 * every request in the app. `sameSite: 'lax'` is deliberate: the visitor comes
 * back from the hosted sign-in as a top-level navigation, which Lax permits and
 * Strict would drop, taking the handoff with it. `secure` follows the fork's own
 * auth cookies via `shouldUseSecureCookie()` rather than a literal `true`, so
 * `http://localhost:3080` still works in dev.
 */
const CLAIM_COOKIE = 'aflat_claim';
const CLAIM_COOKIE_PATH = '/api/aflat';
/** 24h — the same window the client stash gives a parked question. */
const CLAIM_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * A readable companion to the credential above, carrying no secret — just the
 * fact that this browser has something to claim.
 *
 * Without it the client cannot tell whether a claim is worth attempting: the
 * token is `httpOnly` by design, and `localStorage` may be unavailable on the
 * very browsers the cookie exists to rescue. It would therefore have to claim on
 * every authenticated page load, which spends the 10/h/IP budget on users who
 * have nothing parked — and behind carrier NAT, where many Romanian mobile users
 * share one address, that budget is shared, so ordinary browsing would throttle
 * out the real claims this endpoint exists for.
 *
 * It is cleared alongside the credential, and also when a claim comes back 404,
 * so a browser never keeps asking about a question that is gone.
 */
const CLAIM_MARKER_COOKIE = 'aflat_claim_present';

const hashClaimToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const claimCookieOptions = () => ({
  httpOnly: true,
  secure: shouldUseSecureCookie(),
  sameSite: 'lax',
  path: CLAIM_COOKIE_PATH,
});

/**
 * Same lifetime, minus `httpOnly` — and deliberately at `path: '/'`, not the
 * credential's `/api/aflat`. `document.cookie` only exposes cookies whose path
 * matches the page reading them, and the page that needs to know is `/c/new`,
 * so a marker scoped to the API path would be invisible exactly where it is
 * read. The credential keeps the narrow scope; only this contentless flag is
 * widened.
 */
const markerCookieOptions = () => ({
  ...claimCookieOptions(),
  httpOnly: false,
  path: '/',
});

const setClaimCookies = (res, token) => {
  res.cookie(CLAIM_COOKIE, token, { ...claimCookieOptions(), maxAge: CLAIM_MAX_AGE_MS });
  res.cookie(CLAIM_MARKER_COOKIE, '1', { ...markerCookieOptions(), maxAge: CLAIM_MAX_AGE_MS });
};

const clearClaimCookies = (res) => {
  res.clearCookie(CLAIM_COOKIE, claimCookieOptions());
  res.clearCookie(CLAIM_MARKER_COOKIE, markerCookieOptions());
};

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
 *
 * The response body carries only the id. The claim token leaves the server
 * exactly once, as a cookie the page's own JavaScript cannot read — so it can
 * neither be logged by a client-side error reporter nor stolen by injected
 * script.
 */
router.post('/', anonQuestionLimiter, async (req, res) => {
  const { text, ackVersion, gdprAccepted, framingAccepted } = req.body ?? {};

  if (
    typeof text !== 'string' ||
    !text.trim() ||
    text.length > MAX_QUESTION_LENGTH ||
    typeof ackVersion !== 'string' ||
    !ackVersion.trim()
  ) {
    return res.status(400).json({ error: 'invalid question' });
  }

  /**
   * The basis for storing the text at all, so it is checked here rather than
   * left to schema validation: both acknowledgements must be present and true
   * before a single byte of a stranger's legal problem is written. A request
   * without them is a client that skipped the gate, and the right answer is to
   * refuse the write, not to store the question and record that it was
   * unacknowledged.
   */
  if (gdprAccepted !== true || framingAccepted !== true) {
    return res.status(400).json({ error: 'acknowledgement required' });
  }

  try {
    const claimToken = crypto.randomBytes(32).toString('base64url');
    const doc = await AnonQuestion.create({
      text: text.trim(),
      ackVersion,
      gdprAccepted: true,
      framingAccepted: true,
      claimTokenHash: hashClaimToken(claimToken),
    });
    await recordProductEvent('question_submitted', { meta: { anon: true } });
    setClaimCookies(res, claimToken);
    return res.status(201).json({ id: doc._id });
  } catch (error) {
    logger.error('[anonQuestions] Error creating anonymous question', error);
    return res.status(500).json({ error: 'could not save question' });
  }
});

/**
 * Claim the question this browser parked, after signing in. Takes no id: the
 * document is found by the hash of the cookie's token, so a caller who does not
 * hold the token cannot address any document at all. Idempotent for the owner;
 * anything else — no cookie, a forged token, a question already claimed by
 * someone else — is one indistinguishable 404.
 *
 * The limiter runs BEFORE `requireJwtAuth` on purpose, for two reasons: failed
 * auth attempts must count against the same per-IP budget (otherwise the
 * throttle is trivially bypassed), and it keeps `req.user` unset at limiter
 * time, which is what makes the no-IP-in-logs guarantee structural rather than
 * a matter of remembering not to log.
 *
 * Neither the token nor its hash is ever logged or echoed. A constant-time
 * compare would be moot here — the comparison happens inside an indexed
 * equality lookup on the hash, not against a secret held in this process.
 */
router.post('/claim', anonQuestionLinkLimiter, requireJwtAuth, async (req, res) => {
  const token = req.cookies?.[CLAIM_COOKIE];
  const userId = req.user.id;

  if (typeof token !== 'string' || !token) {
    /* Nothing to claim, so stop this browser from asking again. */
    clearClaimCookies(res);
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
      {
        claimTokenHash: hashClaimToken(token),
        $or: [{ linkedUserId: null }, { linkedUserId: userId }],
      },
      { $set: { linkedUserId: userId } },
      { new: false },
    );

    if (!previous) {
      /* Already someone else's, or gone. Same reasoning as the missing-token case. */
      clearClaimCookies(res);
      return res.status(404).json({ error: 'not found' });
    }

    /**
     * Spent. The credential authorised one handoff and must not outlive it on a
     * shared browser — the next person to sign in here gets nothing to present.
     * It is also what stops the question being asked again on every page load
     * for the next 24 hours: the claim is idempotent for its owner, so a cookie
     * left in place would keep returning the text to a browser that has already
     * delivered it.
     */
    clearClaimCookies(res);

    if (previous.linkedUserId == null) {
      await recordProductEvent('gate_converted', { userId });
    }

    return res.json({ id: previous._id, text: previous.text });
  } catch (error) {
    logger.error('[anonQuestions] Error claiming anonymous question', error);
    return res.status(500).json({ error: 'could not claim question' });
  }
});

module.exports = router;
