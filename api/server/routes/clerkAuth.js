const express = require('express');
const { logger } = require('@librechat/data-schemas');
const {
  findOpenIDUser,
  isEmailDomainAllowed,
  verifyClerkToken,
  getClerkIssuer,
  getBalanceConfig,
  isClerkEmbedConfigured,
  ClerkVerificationError,
} = require('@librechat/api');
const { getAppConfig } = require('~/server/services/Config');
const { sanitizeUserForAuthResponse } = require('~/server/controllers/AuthController');
const { setAuthTokens } = require('~/server/services/AuthService');
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

  /**
   * Clerk's session token carries no email address by default — only `sub`,
   * `sid` and the timing claims. The address has to be added deliberately, in
   * Clerk Dashboard → Sessions → Customize session token:
   *
   *   { "email": "{{user.primary_email_address}}",
   *     "email_verified": "{{user.email_verified}}" }
   *
   * Without it every first sign-in reached `createUser` with a blank email and
   * died inside Mongoose validation, surfacing as a 500 and, to the person
   * signing in, as a sign-in that simply did nothing. Refused here instead, with
   * a code the client can explain, because a configuration gap is not a server
   * error and must not read like one in the logs.
   */
  if (!email) {
    logger.error(
      '[auth/clerk] Token carried no email claim — add email to the Clerk session token ' +
        '(Dashboard → Sessions → Customize session token). Refusing to create an account without one.',
    );
    return res.status(422).json({ error: 'email_missing' });
  }

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

    /**
     * The session, handed back in the response — not left to be discovered.
     *
     * `setAuthTokens` also sets the refresh cookie, and that cookie still does
     * its job: it is what keeps the user signed in tomorrow. But the *first*
     * session must not depend on it. It used to: the client answered a
     * successful exchange with a second round trip to `/api/auth/refresh` to
     * redeem the cookie it had just been given, and when the browser declined
     * to send that cookie back the user was returned to an anonymous app with
     * a Clerk session in hand and no way to spend it. That is the loop we spent
     * 2026-08-06/07 chasing, and its root was a cookie policy, but its shape
     * was this indirection — a sign-in that succeeded on the server and had no
     * way of saying so.
     *
     * `setAuthTokens` already returns the access token, so the exchange returns
     * it with the user. One round trip, and the cookie becomes what it should
     * have been all along: how the session is *renewed*, not how it starts.
     */
    const token = await setAuthTokens(user._id, res, null, req);

    return res.json({ token, user: sanitizeUserForAuthResponse(user) });
  } catch (error) {
    logger.error('[auth/clerk] Exchange failed', error);
    return res.status(500).json({ error: 'exchange_failed' });
  }
});

module.exports = router;
