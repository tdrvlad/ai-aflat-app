const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  getPriceList,
  currentRefillPeriod,
  grantSignupBonus,
  runMonthlyRefill,
  createCheckoutSession,
  isPaymentsConfigured,
  CheckoutError,
  PRICE_LIST_VERSION,
} = require('@librechat/api');
const requireJwtAuth = require('~/server/middleware/requireJwtAuth');
const checkAdmin = require('~/server/middleware/roles/admin');
const methods = require('~/models');

const { getCreditBalance, getCreditLedgerPage, grantCredits, rebuildBalance } = methods;

const router = express.Router();

router.use(requireJwtAuth);

/**
 * Bring a user's automatic grants up to date, lazily.
 *
 * Both the welcome bonus and the monthly refill are applied on demand rather than
 * by a signup hook and a cron, for three reasons. It covers every registration
 * path including OAuth, which never passes through `registerUser`. It needs no
 * scheduler on a 3 GB VPS that has none. And it grants nothing to dormant
 * accounts — a refill only exists once someone comes back, so ~15k inactive users
 * cost nothing instead of accruing credits nobody asked for.
 *
 * Both grants are idempotency-keyed, so calling this on every request is safe and
 * repeated calls within a period are no-ops.
 *
 * The bonus waits for a verified email: 100 credits per throwaway account is
 * precisely the prize account farmers are after.
 */
async function ensureAutomaticGrants(user) {
  if (user.emailVerified !== true) {
    return;
  }
  await grantSignupBonus(methods, user.id);
  await runMonthlyRefill(methods, user.id, currentRefillPeriod());
}

/**
 * The price list. Credits only — cost bases, margins and the RON value of a
 * credit never leave the server. RON appears against bundles and nowhere else.
 */
router.get('/pricing', (req, res) => {
  return res.json(getPriceList());
});

/** The balance chip's source. The only persistent cost element in the interface. */
router.get('/balance', async (req, res) => {
  try {
    await ensureAutomaticGrants(req.user);
    const balance = await getCreditBalance(req.user.id);
    return res.json(balance);
  } catch (error) {
    logger.error('[credits] Error reading balance', error);
    return res.status(500).json({ error: 'could not read balance' });
  }
});

/**
 * The wallet's history. Cursor-paginated because a ledger only ever grows, and
 * `_id` descending is a stable order under concurrent writes in a way that a
 * timestamp offset is not.
 */
router.get('/ledger', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;

  try {
    const page = await getCreditLedgerPage(req.user.id, limit, cursor);
    return res.json({
      entries: page.entries.map((entry) => ({
        id: String(entry._id),
        type: entry.type,
        credits: entry.credits,
        reasonCode: entry.reasonCode,
        actionType: entry.actionType,
        effort: entry.effort,
        createdAt: entry.createdAt,
      })),
      nextCursor: page.nextCursor,
    });
  } catch (error) {
    logger.error('[credits] Error reading ledger', error);
    return res.status(500).json({ error: 'could not read ledger' });
  }
});

/**
 * Opens a Stripe Checkout session for one bundle.
 *
 * Two things this route refuses, both of which are the point of it existing:
 * a purchase without explicit consent to immediate performance (the buyer would
 * otherwise keep a 14-day withdrawal right over credits they can spend instantly),
 * and any amount supplied by the client — the bundle id is a lookup key against the
 * server's own price list and nothing more.
 */
router.post('/checkout', async (req, res) => {
  if (!isPaymentsConfigured()) {
    return res.status(503).json({ error: 'payments_unavailable' });
  }

  const { bundleId, consentImmediatePerformance } = req.body ?? {};

  if (typeof bundleId !== 'string' || !bundleId.trim()) {
    return res.status(400).json({ error: 'bundleId is required' });
  }

  try {
    const { url, paymentId } = await createCheckoutSession(methods, {
      userId: req.user.id,
      bundleId: bundleId.trim(),
      consentImmediatePerformance: consentImmediatePerformance === true,
      email: req.user.email ?? null,
    });

    logger.info(`[credits] checkout ${paymentId} opened for ${req.user.id} (${bundleId})`);
    return res.status(201).json({ url });
  } catch (error) {
    if (error instanceof CheckoutError) {
      return res.status(400).json({ error: error.code });
    }
    logger.error('[credits] Error creating checkout session', error);
    return res.status(500).json({ error: 'could not start checkout' });
  }
});

/**
 * Admin grant — support goodwill, partner and press accounts, and anything the
 * automated reason codes do not cover.
 *
 * `reasonCode` is required and free-form on purpose: a grant nobody can explain
 * later is indistinguishable from a leak, and this route is the one place credits
 * appear without a rule behind them.
 */
router.post('/grant', checkAdmin, async (req, res) => {
  const { userId, credits, reasonCode, note, idempotencyKey } = req.body ?? {};

  if (typeof userId !== 'string' || !userId.trim()) {
    return res.status(400).json({ error: 'userId is required' });
  }
  if (!Number.isInteger(credits) || credits <= 0) {
    return res.status(400).json({ error: 'credits must be a positive integer' });
  }
  if (typeof reasonCode !== 'string' || !reasonCode.trim()) {
    return res.status(400).json({ error: 'reasonCode is required' });
  }

  try {
    const entry = await grantCredits({
      userId,
      credits,
      reasonCode: reasonCode.trim(),
      note: typeof note === 'string' ? note : null,
      idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : null,
      priceListVersion: PRICE_LIST_VERSION,
      refId: req.user.id,
    });

    if (!entry) {
      return res.status(200).json({ granted: false, reason: 'already_applied' });
    }

    logger.info(`[credits] admin ${req.user.id} granted ${credits} to ${userId} (${reasonCode})`);
    return res.status(201).json({ granted: true, entryId: String(entry._id) });
  } catch (error) {
    logger.error('[credits] Error granting credits', error);
    return res.status(500).json({ error: 'could not grant credits' });
  }
});

/** Rebuild a user's snapshot from the ledger. The ledger is truth; this proves it. */
router.post('/reconcile', checkAdmin, async (req, res) => {
  const { userId } = req.body ?? {};

  if (typeof userId !== 'string' || !userId.trim()) {
    return res.status(400).json({ error: 'userId is required' });
  }

  try {
    const balance = await rebuildBalance(userId);
    return res.json(balance);
  } catch (error) {
    logger.error('[credits] Error reconciling balance', error);
    return res.status(500).json({ error: 'could not reconcile balance' });
  }
});

module.exports = router;
