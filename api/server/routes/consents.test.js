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
let ConsentLog, ProductEvent;

const userA = { id: new mongoose.Types.ObjectId().toString() };
const userB = { id: new mongoose.Types.ObjectId().toString() };

const validBody = {
  gdprAccepted: true,
  framingAccepted: true,
  marketingOptIn: false,
  wordingVersion: 'v1-2026-07',
};

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  const dbModels = require('~/db/models');
  ConsentLog = dbModels.ConsentLog;
  ProductEvent = dbModels.ProductEvent;

  app = express();
  app.use(express.json());
  app.use('/api/aflat/consents', require('./consents'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  mockCurrentUser = userA;
  await ConsentLog.deleteMany({});
  await ProductEvent.deleteMany({});
});

describe('POST /api/aflat/consents', () => {
  it('writes to the consent_logs collection', () => {
    expect(ConsentLog.collection.name).toBe('consent_logs');
  });

  it('requires authentication', async () => {
    mockCurrentUser = null;
    const res = await request(app).post('/api/aflat/consents').send(validBody);
    expect(res.status).toBe(401);
  });

  it('records the consent and emits consent_recorded', async () => {
    const res = await request(app)
      .post('/api/aflat/consents')
      .send({ ...validBody, marketingOptIn: true });

    expect(res.status).toBe(201);

    const docs = await ConsentLog.find({}).lean();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      gdprAccepted: true,
      framingAccepted: true,
      marketingOptIn: true,
      wordingVersion: 'v1-2026-07',
    });
    expect(String(docs[0].userId)).toBe(userA.id);

    const events = await ProductEvent.find({ name: 'consent_recorded' }).lean();
    expect(events).toHaveLength(1);
    expect(String(events[0].userId)).toBe(userA.id);
  });

  it('stores whatever wordingVersion the client sends, without validating it', async () => {
    const res = await request(app)
      .post('/api/aflat/consents')
      .send({ ...validBody, wordingVersion: 'v7-2031-01' });

    expect(res.status).toBe(201);
    expect((await ConsentLog.findOne({}).lean()).wordingVersion).toBe('v7-2031-01');
  });

  it('defaults marketingOptIn to false when omitted', async () => {
    const { marketingOptIn: _omitted, ...body } = validBody;
    const res = await request(app).post('/api/aflat/consents').send(body);

    expect(res.status).toBe(201);
    expect((await ConsentLog.findOne({}).lean()).marketingOptIn).toBe(false);
  });

  it.each([
    ['gdprAccepted false', { ...validBody, gdprAccepted: false }],
    ['framingAccepted false', { ...validBody, framingAccepted: false }],
    ['gdprAccepted missing', { framingAccepted: true, wordingVersion: 'v1-2026-07' }],
    ['framingAccepted missing', { gdprAccepted: true, wordingVersion: 'v1-2026-07' }],
    ['truthy-but-not-true flags', { ...validBody, gdprAccepted: 'yes' }],
    ['missing wordingVersion', { gdprAccepted: true, framingAccepted: true }],
    ['non-boolean marketingOptIn', { ...validBody, marketingOptIn: 'sure' }],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await request(app).post('/api/aflat/consents').send(body);
    expect(res.status).toBe(400);
    expect(await ConsentLog.countDocuments({})).toBe(0);
    expect(await ProductEvent.countDocuments({})).toBe(0);
  });
});

describe('GET /api/aflat/consents/me', () => {
  it('requires authentication', async () => {
    mockCurrentUser = null;
    const res = await request(app).get('/api/aflat/consents/me');
    expect(res.status).toBe(401);
  });

  it('reports recorded: false before any consent', async () => {
    const res = await request(app).get('/api/aflat/consents/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recorded: false });
  });

  it('reports recorded: true after the user consented', async () => {
    await request(app).post('/api/aflat/consents').send(validBody);
    const res = await request(app).get('/api/aflat/consents/me');
    expect(res.body).toEqual({ recorded: true });
  });

  it("does not report another user's consent", async () => {
    await request(app).post('/api/aflat/consents').send(validBody);

    mockCurrentUser = userB;
    const res = await request(app).get('/api/aflat/consents/me');
    expect(res.body).toEqual({ recorded: false });
  });
});
