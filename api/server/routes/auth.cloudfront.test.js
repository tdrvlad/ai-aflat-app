const express = require('express');
const request = require('supertest');

const mockForceRefreshCloudFrontAuthCookies = jest.fn();

jest.mock('@librechat/api', () => ({
  forceRefreshCloudFrontAuthCookies: (...args) => mockForceRefreshCloudFrontAuthCookies(...args),
}));

jest.mock('~/server/controllers/AuthController', () => ({
  refreshController: jest.fn((req, res) => res.status(200).end()),
  graphTokenController: jest.fn((req, res) => res.status(200).end()),
}));

jest.mock('~/server/controllers/auth/LogoutController', () => ({
  logoutController: jest.fn((req, res) => res.status(200).end()),
}));

jest.mock('~/server/middleware', () => {
  const pass = (req, res, next) => next();
  return {
    checkBan: pass,
    requireJwtAuth: jest.fn((req, res, next) => {
      if (req.headers.authorization !== 'Bearer ok') {
        return res.status(401).json({ message: 'Unauthorized' });
      }
      req.user = { _id: 'user123', tenantId: 'tenantA' };
      if (req.headers['x-cloudfront-warmed'] === 'true') {
        req.cloudFrontAuthCookieRefreshResult = {
          enabled: true,
          attempted: true,
          refreshed: true,
          expiresInSec: 1800,
          refreshAfterSec: 1500,
        };
      }
      return next();
    }),
  };
});

const authRouter = require('./auth');

describe('POST /api/auth/cloudfront/refresh', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);
  });

  it('requires authentication', async () => {
    await request(app).post('/api/auth/cloudfront/refresh').expect(401);

    expect(mockForceRefreshCloudFrontAuthCookies).not.toHaveBeenCalled();
  });

  it('returns 404 when CloudFront cookie mode is disabled', async () => {
    mockForceRefreshCloudFrontAuthCookies.mockReturnValue({
      enabled: false,
      attempted: false,
      refreshed: false,
      reason: 'cloudfront_disabled',
    });

    const response = await request(app)
      .post('/api/auth/cloudfront/refresh')
      .set('Authorization', 'Bearer ok')
      .expect(404);

    expect(response.status).toBe(404);
  });

  it('returns cookie refresh timing when CloudFront cookies are refreshed', async () => {
    mockForceRefreshCloudFrontAuthCookies.mockReturnValue({
      enabled: true,
      attempted: true,
      refreshed: true,
      expiresInSec: 1800,
      refreshAfterSec: 1500,
    });

    const response = await request(app)
      .post('/api/auth/cloudfront/refresh')
      .set('Authorization', 'Bearer ok')
      .expect(200);

    expect(response.body).toEqual({
      ok: true,
      expiresInSec: 1800,
      refreshAfterSec: 1500,
    });
    expect(mockForceRefreshCloudFrontAuthCookies).toHaveBeenCalledWith(
      expect.objectContaining({ user: { _id: 'user123', tenantId: 'tenantA' } }),
      expect.any(Object),
      { _id: 'user123', tenantId: 'tenantA' },
    );
  });

  it('reuses the auth middleware refresh result instead of minting cookies twice', async () => {
    const response = await request(app)
      .post('/api/auth/cloudfront/refresh')
      .set('Authorization', 'Bearer ok')
      .set('x-cloudfront-warmed', 'true')
      .expect(200);

    expect(response.body).toEqual({
      ok: true,
      expiresInSec: 1800,
      refreshAfterSec: 1500,
    });
    expect(mockForceRefreshCloudFrontAuthCookies).not.toHaveBeenCalled();
  });
});
