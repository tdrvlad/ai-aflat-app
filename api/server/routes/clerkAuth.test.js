const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

/**
 * Route-level tests for the Clerk → LibreChat session exchange — the success
 * path in particular (design 2026-08-04 §5.5 / §5.6), which the unit tests in
 * `packages/api/src/auth/clerk.spec.ts` deliberately do not reach: they stop at
 * token verification, while everything the product actually depends on (the
 * user document, the linkage by Clerk `sub`, the refresh cookie) happens here.
 *
 * Only the edges we cannot control are replaced: `verifyClerkToken` (it would
 * call Clerk's JWKS endpoint) and its two config readers, plus `checkBan`
 * (Redis-backed cache) and `getAppConfig` (yaml loader). Users are created by
 * the real `createUser` against a real in-memory MongoDB, looked up by the real
 * `findOpenIDUser`, and the session cookie is minted by the real
 * `setAuthTokens` — if any of those break, these tests break.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'test-jwt-refresh-secret';

const ISSUER = 'https://clerk.test-instance.dev';

/** Set by each test: the claims a "verified" Clerk token resolves to. */
let mockClaims = null;

jest.mock('@librechat/api', () => {
  const actual = jest.requireActual('@librechat/api');
  return {
    ...actual,
    isClerkEmbedConfigured: jest.fn(() => true),
    getClerkIssuer: jest.fn(() => ISSUER),
    verifyClerkToken: jest.fn(async () => {
      if (!mockClaims) {
        throw new actual.ClerkVerificationError('invalid token');
      }
      return mockClaims;
    }),
  };
});

/**
 * `registration` carries no domain allowlist, matching both yaml files since the
 * product opened to the public — so these tests also prove the documented
 * behavior that `isEmailDomainAllowed` (the real one) passes everyone when no
 * allowlist is configured.
 */
jest.mock('~/server/services/Config', () => ({
  getAppConfig: jest.fn(async () => ({ registration: {} })),
}));

jest.mock('~/server/middleware', () => ({
  checkBan: jest.fn(async () => {}),
}));

let app;
let mongoServer;
let User;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  User = require('~/db/models').User;

  app = express();
  app.use(express.json());
  app.use('/api/aflat/auth', require('./clerkAuth'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  mockClaims = null;
  await User.deleteMany({});
  await mongoose.connection.collection('sessions').deleteMany({});
});

const CLERK_SUB = 'user_2abcDEFghij';

const signIn = () => request(app).post('/api/aflat/auth/clerk').send({ token: 'a-clerk-jwt' });

describe('POST /api/aflat/auth/clerk — success path', () => {
  it('first sign-in creates a user with provider openid and the Clerk sub (§5.5)', async () => {
    mockClaims = {
      sub: CLERK_SUB,
      email: 'ana@example.ro',
      emailVerified: true,
      name: 'Ana Pop',
    };

    const res = await signIn();

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: 'ana@example.ro' });

    const users = await User.find({}).lean();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      provider: 'openid',
      openidId: CLERK_SUB,
      openidIssuer: ISSUER,
      email: 'ana@example.ro',
      emailVerified: true,
      name: 'Ana Pop',
    });
  });

  /**
   * The client must not have to go back for the session. It used to — a second
   * call to /api/auth/refresh to redeem the cookie just issued — and a browser
   * that declined to return that cookie left a successful sign-in with no
   * session in the page (production, 2026-08-07).
   */
  it('returns the session itself, without the credential fields', async () => {
    mockClaims = { sub: CLERK_SUB, email: 'ana@example.ro', emailVerified: true };

    const res = await signIn();

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user._id).toEqual(expect.any(String));
    expect(res.body.user).not.toHaveProperty('password');
    expect(res.body.user).not.toHaveProperty('totpSecret');
    expect(res.body.user).not.toHaveProperty('backupCodes');
  });

  it('sets the refresh cookie so the existing silent refresh can take over', async () => {
    mockClaims = { sub: CLERK_SUB, email: 'ana@example.ro', emailVerified: true };

    const res = await signIn();

    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'] ?? [];
    const refreshCookie = cookies.find((c) => c.startsWith('refreshToken='));
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toMatch(/HttpOnly/i);
  });

  it('second sign-in finds the same user and does not create another (§5.6)', async () => {
    mockClaims = { sub: CLERK_SUB, email: 'ana@example.ro', emailVerified: true };

    const first = await signIn();
    expect(first.status).toBe(200);
    const created = await User.findOne({ openidId: CLERK_SUB }).lean();

    const second = await signIn();
    expect(second.status).toBe(200);
    expect(second.body.token).toEqual(expect.any(String));

    const users = await User.find({}).lean();
    expect(users).toHaveLength(1);
    expect(String(users[0]._id)).toBe(String(created._id));
  });

  it('refuses an unverifiable token with 401 and creates nothing', async () => {
    mockClaims = null;

    const res = await signIn();

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'invalid_token' });
    expect(await User.countDocuments({})).toBe(0);
  });

  it('refuses to take over an existing local-provider account with the same email (§5.8)', async () => {
    await User.create({
      provider: 'local',
      email: 'ana@example.ro',
      emailVerified: true,
      name: 'Ana Locală',
      username: 'ana',
    });
    mockClaims = { sub: CLERK_SUB, email: 'ana@example.ro', emailVerified: true };

    const res = await signIn();

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'account_conflict' });

    const users = await User.find({}).lean();
    expect(users).toHaveLength(1);
    expect(users[0].provider).toBe('local');
    expect(users[0].openidId).toBeUndefined();
  });
});
