const express = require('express');
const { forceRefreshCloudFrontAuthCookies } = require('@librechat/api');
const { graphTokenController, refreshController } = require('~/server/controllers/AuthController');
const { logoutController } = require('~/server/controllers/auth/LogoutController');
const middleware = require('~/server/middleware');

const router = express.Router();
const getCloudFrontAuthCookieRefreshResult = (req, res) => {
  const warmedResult = req.cloudFrontAuthCookieRefreshResult;
  if (warmedResult && (warmedResult.attempted || !warmedResult.enabled)) {
    return warmedResult;
  }

  return forceRefreshCloudFrontAuthCookies(req, res, req.user);
};

/**
 * ai-aflat: LibreChat's local auth is gone (design 2026-08-04 §3) — no
 * `/login`, `/register`, `/requestPasswordReset`, `/resetPassword` and no 2FA
 * endpoints. Clerk is the identity provider: the browser exchanges a Clerk JWT
 * at `POST /api/aflat/auth/clerk`, or falls back to the OIDC redirect at
 * `/oauth/openid`. Both end in `setAuthTokens`, so `/logout` and `/refresh`
 * below still serve every session.
 *
 * The admin panel keeps its own local door at `POST /api/admin/auth/login/local`
 * as a break-glass; it is gated by `requireAdminAccess` and is deliberately not
 * part of the product's sign-in path.
 */
router.post('/logout', middleware.requireJwtAuth, logoutController);
router.post('/refresh', refreshController);
router.post('/cloudfront/refresh', middleware.requireJwtAuth, (req, res) => {
  const result = getCloudFrontAuthCookieRefreshResult(req, res);
  if (!result.enabled) {
    return res.sendStatus(404);
  }

  const status = result.refreshed ? 200 : 500;
  return res.status(status).json({
    ok: result.refreshed,
    expiresInSec: result.expiresInSec,
    refreshAfterSec: result.refreshAfterSec,
  });
});
router.get('/graph-token', middleware.requireJwtAuth, graphTokenController);

module.exports = router;
