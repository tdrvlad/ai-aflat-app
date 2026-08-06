const express = require('express');
const { logger } = require('@librechat/data-schemas');
const { getBalanceConfig } = require('@librechat/api');
const { getAppConfig } = require('~/server/services/Config');
const { setAuthTokens } = require('~/server/services/AuthService');
const { findUser, createUser } = require('~/models');

/**
 * ai-aflat: a local-development door that skips sign-in entirely.
 *
 * It exists so the chat itself — the composer, the thinking stream, the sources,
 * the whole surface the redesign is actually about — can be looked at without
 * walking the identity flow first. That is the entire justification, and it is a
 * temporary one: this file is meant to be deleted, not maintained.
 *
 * It is also, unavoidably, an unauthenticated endpoint that mints a session. So
 * it is inert unless someone has deliberately switched it on, in a deployment
 * that serves localhost, for a browser that asked for localhost. Every condition
 * is checked on the request rather than once at boot, because a bypass that can
 * be reached by accident is the same thing as no authentication at all.
 *
 * TO REMOVE: delete this file, its two lines in `routes/index.js` and
 * `server/index.js`, the `devAutoLogin` field in `routes/config.js`, and
 * `useDevAutoLogin` on the client.
 */

const router = express.Router();

/**
 * The account this door opens. Fixed, so repeat runs keep one history.
 *
 * `.test` rather than `localhost`: the user schema validates the address, and a
 * bare `dev@localhost` is refused for having no TLD. `.test` is reserved by
 * RFC 2606 precisely for this, so it can never collide with a real address.
 */
const DEV_EMAIL = 'dev@local.test';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const hostnameOf = (value) => (value ?? '').trim().toLowerCase().split(':')[0] || '';

/**
 * Two conditions, and neither is the obvious one.
 *
 * `NODE_ENV` is deliberately **not** consulted. This tree runs with
 * `NODE_ENV=production` on the workstation as well as on the VPS — it is what
 * builds and serves the real bundle — so a check against it would be inert here
 * and, worse, would read as protection that is not there.
 *
 * `DOMAIN_SERVER` is the honest discriminator: production sets it to
 * `https://app.ai-aflat.ro`, a workstation leaves it on localhost. A `.env`
 * carried onto the VPS by accident therefore switches this off rather than on,
 * which is the direction a mistake has to fail in.
 */
function isDevAutoLoginEnabled() {
  if (process.env.AFLAT_DEV_AUTOLOGIN !== 'true') {
    return false;
  }
  const domain = process.env.DOMAIN_SERVER;
  return !domain || LOCAL_HOSTS.has(hostnameOf(domain.replace(/^\w+:\/\//, '')));
}

/**
 * The browser has to believe it is talking to localhost.
 *
 * Note what this is *not*: a check on the peer address. Behind nginx every
 * request arrives from 127.0.0.1, so a loopback test would pass on the VPS for
 * the whole internet — the exact inversion of what it looks like it does. The
 * `Host` header is what differs: nginx forwards `app.ai-aflat.ro`, a developer's
 * browser sends `localhost` or `127.0.0.1`.
 */
function isLocalRequest(req) {
  return LOCAL_HOSTS.has(hostnameOf(req.headers?.host));
}

router.post('/dev', async (req, res) => {
  if (!isDevAutoLoginEnabled()) {
    return res.status(404).json({ error: 'not_found' });
  }
  if (!isLocalRequest(req)) {
    logger.warn(`[auth/dev] Refused request for host ${req.headers?.host}`);
    return res.status(403).json({ error: 'local_only' });
  }

  try {
    const appConfig = await getAppConfig({ baseOnly: true });
    let user = await findUser({ email: DEV_EMAIL });

    if (!user) {
      user = await createUser(
        {
          provider: 'local',
          email: DEV_EMAIL,
          username: 'dev',
          name: 'Dev (local)',
          /**
           * Verified on purpose. The signup bonus is gated on a verified address,
           * and a dev account with no credits cannot ask a question — which would
           * make this door open onto the same dead end it exists to avoid.
           */
          emailVerified: true,
        },
        getBalanceConfig(appConfig),
        true,
        true,
      );
      logger.warn(`[auth/dev] Created the local development account ${DEV_EMAIL}`);
    }

    req.user = user;
    await setAuthTokens(user._id, res, null, req);

    logger.warn('[auth/dev] Signed in without credentials — AFLAT_DEV_AUTOLOGIN is on');
    return res.json({ ok: true });
  } catch (error) {
    logger.error('[auth/dev] Auto-login failed', error);
    return res.status(500).json({ error: 'dev_login_failed' });
  }
});

module.exports = { router, isDevAutoLoginEnabled };
