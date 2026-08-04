const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

/** Set by each test; `null` means "no JWT presented". */
let mockCurrentUser = null;

jest.mock('~/server/middleware/requireJwtAuth', () => (req, res, next) => {
  if (!mockCurrentUser) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  req.user = mockCurrentUser;
  next();
});

let app;
let mongoServer;
let CreditLot, CreditLedger, CreditBalance;

const verifiedUser = () => ({
  id: new mongoose.Types.ObjectId().toString(),
  emailVerified: true,
  role: 'USER',
});

const admin = () => ({
  id: new mongoose.Types.ObjectId().toString(),
  emailVerified: true,
  role: 'ADMIN',
});

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  const dbModels = require('~/db/models');
  CreditLot = dbModels.CreditLot;
  CreditLedger = dbModels.CreditLedger;
  CreditBalance = dbModels.CreditBalance;
  await CreditLedger.syncIndexes();

  app = express();
  app.use(express.json());
  app.use('/api/aflat/credits', require('./credits'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  mockCurrentUser = null;
  await Promise.all([
    CreditLot.deleteMany({}),
    CreditLedger.deleteMany({}),
    CreditBalance.deleteMany({}),
  ]);
});

describe('GET /pricing', () => {
  it('quotes credits and never a lei-per-question figure', async () => {
    mockCurrentUser = verifiedUser();
    const res = await request(app).get('/api/aflat/credits/pricing');

    expect(res.status).toBe(200);
    expect(res.body.actions.simple_question).toEqual({ low: 5, medium: 10, high: 20 });
    expect(res.body.defaultEffort).toBe('medium');
    expect(res.body.bundles).toHaveLength(3);

    /* RON belongs to bundles alone. */
    const serialized = JSON.stringify(res.body);
    expect(serialized).toContain('priceRon');
    expect(serialized).not.toContain('costBasis');
  });

  it('requires a session', async () => {
    const res = await request(app).get('/api/aflat/credits/pricing');
    expect(res.status).toBe(401);
  });
});

describe('GET /balance', () => {
  it('provisions the welcome bonus and the monthly refill on first read', async () => {
    mockCurrentUser = verifiedUser();
    const res = await request(app).get('/api/aflat/credits/balance');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: 100, reserved: 0 });

    const reasons = await CreditLedger.find({ userId: mockCurrentUser.id }).distinct('reasonCode');
    expect(reasons).toEqual(expect.arrayContaining(['signup_bonus']));
  });

  it('does not re-grant on repeated reads', async () => {
    mockCurrentUser = verifiedUser();
    await request(app).get('/api/aflat/credits/balance');
    const res = await request(app).get('/api/aflat/credits/balance');

    expect(res.body).toEqual({ available: 100, reserved: 0 });
    expect(await CreditLedger.countDocuments({ userId: mockCurrentUser.id })).toBe(1);
  });

  it('grants nothing to an unverified account', async () => {
    mockCurrentUser = { ...verifiedUser(), emailVerified: false };
    const res = await request(app).get('/api/aflat/credits/balance');

    expect(res.body).toEqual({ available: 0, reserved: 0 });
    expect(await CreditLedger.countDocuments({ userId: mockCurrentUser.id })).toBe(0);
  });
});

describe('GET /ledger', () => {
  it('returns the user’s own history and nothing else', async () => {
    const mine = verifiedUser();
    const theirs = verifiedUser();

    mockCurrentUser = mine;
    await request(app).get('/api/aflat/credits/balance');
    mockCurrentUser = theirs;
    await request(app).get('/api/aflat/credits/balance');

    mockCurrentUser = mine;
    const res = await request(app).get('/api/aflat/credits/ledger');

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].reasonCode).toBe('signup_bonus');
    expect(res.body.entries[0].credits).toBe(100);
  });
});

describe('POST /grant', () => {
  it('refuses a non-admin', async () => {
    mockCurrentUser = verifiedUser();
    const res = await request(app)
      .post('/api/aflat/credits/grant')
      .send({ userId: mockCurrentUser.id, credits: 50, reasonCode: 'support_refund' });

    expect(res.status).toBe(403);
  });

  it('grants with a reason and reports the entry', async () => {
    const target = verifiedUser();
    mockCurrentUser = admin();

    const res = await request(app)
      .post('/api/aflat/credits/grant')
      .send({ userId: target.id, credits: 50, reasonCode: 'press_account', note: 'ProTV' });

    expect(res.status).toBe(201);
    expect(res.body.granted).toBe(true);

    const lot = await CreditLot.findOne({ userId: target.id });
    expect(lot?.creditsRemaining).toBe(50);
    expect(lot?.costBasisMicroRon).toBe(0);
  });

  it('is a no-op when the same idempotency key is replayed', async () => {
    const target = verifiedUser();
    mockCurrentUser = admin();
    const body = {
      userId: target.id,
      credits: 50,
      reasonCode: 'press_account',
      idempotencyKey: `press:${target.id}`,
    };

    await request(app).post('/api/aflat/credits/grant').send(body);
    const res = await request(app).post('/api/aflat/credits/grant').send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ granted: false, reason: 'already_applied' });
    expect(await CreditLot.countDocuments({ userId: target.id })).toBe(1);
  });

  it.each([
    [{ credits: 50, reasonCode: 'x' }, 'userId'],
    [{ userId: 'u', credits: 0, reasonCode: 'x' }, 'credits'],
    [{ userId: 'u', credits: 1.5, reasonCode: 'x' }, 'credits'],
    [{ userId: 'u', credits: 50 }, 'reasonCode'],
  ])('rejects a malformed grant (%p)', async (body, field) => {
    mockCurrentUser = admin();
    const res = await request(app).post('/api/aflat/credits/grant').send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain(field);
  });
});

describe('POST /reconcile', () => {
  it('rebuilds a drifted snapshot from the ledger', async () => {
    const target = verifiedUser();
    mockCurrentUser = target;
    await request(app).get('/api/aflat/credits/balance');
    await CreditBalance.updateOne({ userId: target.id }, { $set: { available: 9999 } });

    mockCurrentUser = admin();
    const res = await request(app).post('/api/aflat/credits/reconcile').send({ userId: target.id });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: 100, reserved: 0 });
  });

  it('refuses a non-admin', async () => {
    mockCurrentUser = verifiedUser();
    const res = await request(app)
      .post('/api/aflat/credits/reconcile')
      .send({ userId: mockCurrentUser.id });

    expect(res.status).toBe(403);
  });
});

describe('POST /checkout', () => {
  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  it('reports unavailable when Stripe is unconfigured', async () => {
    mockCurrentUser = verifiedUser();
    const res = await request(app)
      .post('/api/aflat/credits/checkout')
      .send({ bundleId: 'uzual', consentImmediatePerformance: true });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('payments_unavailable');
  });

  /**
   * Credits are spendable the instant they land, so without this consent every
   * purchase would stay refundable for a fortnight regardless of how many answers
   * it had already bought. The refusal has to be server-side — a checkbox the
   * frontend merely renders is not a record of anything.
   */
  it('refuses without consent to immediate performance', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_x';
    mockCurrentUser = verifiedUser();

    const res = await request(app)
      .post('/api/aflat/credits/checkout')
      .send({ bundleId: 'uzual', consentImmediatePerformance: false });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('consent_required');
  });

  it('refuses an unknown bundle', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_x';
    mockCurrentUser = verifiedUser();

    const res = await request(app)
      .post('/api/aflat/credits/checkout')
      .send({ bundleId: 'free-money', consentImmediatePerformance: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_bundle');
  });

  it('requires a bundleId', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_x';
    mockCurrentUser = verifiedUser();

    const res = await request(app)
      .post('/api/aflat/credits/checkout')
      .send({ consentImmediatePerformance: true });

    expect(res.status).toBe(400);
  });

  it('refuses an unauthenticated caller', async () => {
    mockCurrentUser = null;
    const res = await request(app)
      .post('/api/aflat/credits/checkout')
      .send({ bundleId: 'uzual', consentImmediatePerformance: true });

    expect(res.status).toBe(401);
  });
});
