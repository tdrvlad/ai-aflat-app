/**
 * ai-aflat: identity is Clerk, reached through the stock OpenID Connect strategy.
 *
 * The Apple, Discord, Facebook, GitHub, Google, LDAP and SAML strategies were deleted on
 * 2026-08-06. None was ever configured, and each was one unset env var away from being a live
 * account-creation path into a product that has exactly one intended door. Google sign-in still
 * works and still says "Google" to the user -- Clerk brokers it, we do not negotiate it here.
 *
 * `localStrategy` (email + password) is kept for now because LibreChat still issues its own JWT
 * after Clerk hands back a session, and unpicking that is a separate change.
 */
const { setupOpenId, getOpenIdConfig, getOpenIdEmail } = require('./openidStrategy');
const openIdJwtLogin = require('./openIdJwtStrategy');
const passportLogin = require('./localStrategy');
const jwtLogin = require('./jwtStrategy');

module.exports = {
  passportLogin,
  jwtLogin,
  setupOpenId,
  getOpenIdConfig,
  getOpenIdEmail,
  openIdJwtLogin,
};
