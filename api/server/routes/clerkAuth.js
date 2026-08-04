const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  findOpenIDUser,
  isEmailDomainAllowed,
  verifyClerkToken,
  getClerkIssuer,
  isClerkEmbedConfigured,
  ClerkVerificationError,
} = require('@librechat/api');
const { getAppConfig } = require('~/server/services/Config');
const { setAuthTokens } = require('~/server/services/AuthService');
const { getBalanceConfig } = require('~/server/services/Config');
const { findUser, createUser } = require('~/models');
const { checkBan } = require('~/server/middleware');

const router = express.Router();

/**
 * Turns a verified Clerk session into a LibreChat session.
 *
 * This exists because embedding Clerk's sign-in leaves the browser holding a
 * *Clerk* token while the app needs a *LibreChat* one. It is the only genuinely
 * new security surface in the embedded flow, so it deliberately does as little as
 * possible: verify, find-or-create, then hand off to `setAuthTokens` — the same
 * primitive the OAuth callback already uses. The existing refresh flow does the
 * rest.
 *
 * See `docs/superpowers/specs/2026-08-04-clerk-embedded-auth-design.md`.
 */
router.post('/clerk', async (req, res) => {
  if (!isClerkEmbedConfigured()) {
    return res.status(503).json({ error: 'clerk_embed_unavailable' });
  }

  const { token } = req.body ?? {};
  if (typeof token !== 'string' || !token) {
    return res.status(400).json({ error: 'token is required' });
  }

  let claims;
  try {
    claims = await verifyClerkToken(token, getClerkIssuer());
  } catch (error) {
    /* Never echo the reason — it tells a prober how close their forgery got. */
    const detail = error instanceof ClerkVerificationError ? error.message : 'verification failed';
    logger.warn(`[auth/clerk] Token verification failed: ${detail}`);
    return res.status(401).json({ error: 'invalid_token' });
  }

  const email = claims.email ?? '';

  try {
    const appConfig = await getAppConfig({ baseOnly: true });

    /**
     * The same gate the OIDC callback applies. A second front door that ignored
     * it would silently defeat a deliberate product decision.
     */
    if (!isEmailDomainAllowed(email, appConfig?.registration?.allowedDomains)) {
      logger.warn(`[auth/clerk] Blocked - email domain not allowed [${email}]`);
      return res.status(403).json({ error: 'domain_not_allowed' });
    }

    const { user: found, error: lookupError } = await findOpenIDUser({
      findUser,
      email,
      openidId: claims.sub,
      openidIssuer: getClerkIssuer(),
      strategyName: 'clerkEmbed',
    });

    if (lookupError) {
      /**
       * Raised when an account with this email exists under a different provider.
       * Linking it here would let anyone who can create a Clerk account with a
       * known email take over the matching local account.
       */
      logger.warn(`[auth/clerk] Lookup refused for ${email}: ${lookupError}`);
      return res.status(409).json({ error: 'account_conflict' });
    }

    let user = found;

    if (!user) {
      const balanceConfig = getBalanceConfig(appConfig);
      user = await createUser(
        {
          provider: 'openid',
          openidId: claims.sub,
          openidIssuer: getClerkIssuer(),
          username: claims.username || (email ? email.split('@')[0] : claims.sub),
          email,
          emailVerified: claims.emailVerified === true,
          name: claims.name || '',
        },
        balanceConfig,
        true,
        true,
      );
      logger.info(`[auth/clerk] Created user for ${email || claims.sub}`);
    } else if (!user.openidId) {
      user.openidId = claims.sub;
      user.openidIssuer = getClerkIssuer();
      await user.save?.();
    }

    req.user = user;
    await checkBan(req, res);
    if (req.banned) {
      return;
    }

    /* Sets the refresh cookie; the client's existing silent refresh takes over. */
    await setAuthTokens(user._id, res, null, req);

    return res.json({ ok: true });
  } catch (error) {
    logger.error('[auth/clerk] Exchange failed', error);
    return res.status(500).json({ error: 'exchange_failed' });
  }
});

module.exports = router;
