// file deepcode ignore NoRateLimitingForLogin: Rate limiting is handled by the `loginLimiter` middleware
const express = require('express');
const passport = require('passport');
const { randomState } = require('openid-client');
const { logger } = require('@librechat/data-schemas');
const { ErrorTypes } = require('librechat-data-provider');
const {
  buildOAuthFailureLog,
  createOpenIDCallbackAuthenticator,
  createSetBalanceConfig,
  getOAuthFailureMessage,
  redirectToAuthFailure,
} = require('@librechat/api');
const { checkDomainAllowed, loginLimiter, logHeaders } = require('~/server/middleware');
const { createOAuthHandler } = require('~/server/controllers/auth/oauth');
const { findBalanceByUser, upsertBalanceFields } = require('~/models');
const { getAppConfig } = require('~/server/services/Config');

const setBalanceConfig = createSetBalanceConfig({
  getAppConfig,
  findBalanceByUser,
  upsertBalanceFields,
});

const router = express.Router();

const domains = {
  client: process.env.DOMAIN_CLIENT,
  server: process.env.DOMAIN_SERVER,
};

const authFailureRedirectOptions = {
  clientDomain: domains.client,
  authFailedError: ErrorTypes.AUTH_FAILED,
};

router.use(logHeaders);
router.use(loginLimiter);

const oauthHandler = createOAuthHandler();
const authenticateOpenIDCallback = createOpenIDCallbackAuthenticator({
  passport,
  logger,
  ...authFailureRedirectOptions,
});

router.get('/error', (req, res) => {
  /** A single error message is pushed by passport when authentication fails. */
  const errorMessage = getOAuthFailureMessage(req);
  logger.warn(
    '[OAuth] Authentication failed',
    buildOAuthFailureLog({
      provider: 'unknown',
      req,
      info: { message: errorMessage },
      defaultMessage: errorMessage,
    }),
  );

  redirectToAuthFailure(res, authFailureRedirectOptions);
});

/**
 * OpenID Routes -- the only provider left.
 *
 * ai-aflat: the Google, Facebook, GitHub, Discord, Apple and SAML route pairs were deleted on
 * 2026-08-06 together with their strategies. They were unreachable (no strategy registered without
 * its env vars) but a route that 404s on a missing strategy is still a route someone can wire back
 * up by accident. Identity is Clerk; Google sign-in is brokered by Clerk through this OpenID pair.
 */
router.get('/openid', (req, res, next) => {
  return passport.authenticate('openid', {
    session: false,
    state: randomState(),
  })(req, res, next);
});

router.get(
  '/openid/callback',
  authenticateOpenIDCallback,
  setBalanceConfig,
  checkDomainAllowed,
  oauthHandler,
);

module.exports = router;
