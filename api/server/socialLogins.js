const passport = require('passport');
const session = require('express-session');
const { CacheKeys } = require('librechat-data-provider');
const { math, isEnabled, shouldUseSecureCookie } = require('@librechat/api');
const { logger, DEFAULT_SESSION_EXPIRY } = require('@librechat/data-schemas');
const { openIdJwtLogin, setupOpenId } = require('~/strategies');
const { getLogStores } = require('~/cache');

const DEFAULT_OPENID_REUSE_MAX_SESSION_AGE_MS = 15 * 60 * 1000;

const getSessionExpiry = () => math(process.env.SESSION_EXPIRY, DEFAULT_SESSION_EXPIRY);

const getOpenIdSessionExpiry = () => {
  const sessionExpiry = getSessionExpiry();
  if (!isEnabled(process.env.OPENID_REUSE_TOKENS)) {
    return sessionExpiry;
  }

  const reuseMaxSessionAge = math(
    process.env.OPENID_REUSE_MAX_SESSION_AGE_MS,
    DEFAULT_OPENID_REUSE_MAX_SESSION_AGE_MS,
  );
  return Math.max(sessionExpiry, reuseMaxSessionAge);
};

/**
 * Configures OpenID Connect for the application.
 * @param {Express.Application} app - The Express application instance.
 * @returns {Promise<void>}
 */
async function configureOpenId(app) {
  logger.info('Configuring OpenID Connect...');
  const sessionExpiry = getOpenIdSessionExpiry();
  const sessionOptions = {
    secret: process.env.OPENID_SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: getLogStores(CacheKeys.OPENID_SESSION),
    cookie: {
      maxAge: sessionExpiry,
      secure: shouldUseSecureCookie(),
    },
  };
  app.use(session(sessionOptions));
  app.use(passport.session());

  const config = await setupOpenId();
  if (!config) {
    logger.error('OpenID Connect configuration failed - strategy not registered.');
    return;
  }

  if (isEnabled(process.env.OPENID_REUSE_TOKENS)) {
    logger.info('OpenID token reuse is enabled.');
    passport.use('openidJwt', openIdJwtLogin(config));
  }
  logger.info('OpenID Connect configured successfully.');
}

/**
 *
 * @param {Express.Application} app
 */
/**
 * ai-aflat: OpenID is the only strategy left, and it is Clerk.
 *
 * Everything else this function used to configure -- Google, Facebook, GitHub, Discord, Apple and
 * SAML -- was deleted on 2026-08-06 along with its strategy files. None of it was ever configured,
 * and none of it can be: identity is Clerk, reached through the stock OpenID Connect strategy.
 * Google sign-in still works and still says "Google" to the user; it is brokered by Clerk rather
 * than negotiated here.
 *
 * The name is now a slight lie -- there is one "social" login and it is a federated identity
 * provider. Kept as-is because it is the boot-chain entry point and renaming it would touch the
 * server bootstrap for no behavioural gain.
 *
 * @param {Express.Application} app
 */
const configureSocialLogins = async (app) => {
  logger.info('Configuring OpenID (Clerk)...');

  if (
    process.env.OPENID_CLIENT_ID &&
    (isEnabled(process.env.OPENID_USE_PKCE) || process.env.OPENID_CLIENT_SECRET?.trim()) &&
    process.env.OPENID_ISSUER &&
    process.env.OPENID_SCOPE &&
    process.env.OPENID_SESSION_SECRET
  ) {
    await configureOpenId(app);
  }
};

module.exports = configureSocialLogins;
