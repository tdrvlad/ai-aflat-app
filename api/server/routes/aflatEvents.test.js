const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let app;
let mongoServer;
let ProductEvent;

/** Distinct source IPs keep each test's rate-limiter bucket isolated. */
const post = (ip) => request(app).post('/api/aflat/events').set('X-Forwarded-For', ip);

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  ProductEvent = require('~/db/models').ProductEvent;

  app = express();
  app.use(express.json());
  /* `X-Forwarded-For` drives `req.ip`, which is what the limiter keys on. */
  app.set('trust proxy', true);
  app.use('/api/aflat/events', require('./aflatEvents'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await ProductEvent.deleteMany({});
});

describe('POST /api/aflat/events', () => {
  it.each(['gate_shown', 'gate_login_clicked'])(
    'accepts %s without auth and returns 204',
    async (name) => {
      const res = await post('10.1.0.1').send({ name, meta: { source: 'landing' } });

      expect(res.status).toBe(204);
      const docs = await ProductEvent.find({ name }).lean();
      expect(docs).toHaveLength(1);
      expect(docs[0].meta).toMatchObject({ source: 'landing' });
      expect(docs[0].userId).toBeNull();
    },
  );

  it('accepts an event with no meta', async () => {
    const res = await post('10.1.0.2').send({ name: 'gate_shown' });
    expect(res.status).toBe(204);
    expect(await ProductEvent.countDocuments({ name: 'gate_shown' })).toBe(1);
  });

  it('persists no network identifier', async () => {
    await post('203.0.113.9').send({ name: 'gate_shown', meta: { source: 'landing' } });
    const docs = await ProductEvent.find({}).lean();
    expect(JSON.stringify(docs)).not.toContain('203.0.113.9');
    expect(Object.keys(docs[0])).not.toEqual(expect.arrayContaining(['ip', 'userAgent']));
  });

  it.each([
    ['an unlisted event name', { name: 'question_submitted' }],
    ['an arbitrary event name', { name: 'whatever' }],
    ['a missing name', { meta: {} }],
    ['a non-string name', { name: 42 }],
    ['an array meta', { name: 'gate_shown', meta: ['landing'] }],
    ['a non-object meta', { name: 'gate_shown', meta: 'landing' }],
    ['an oversized meta', { name: 'gate_shown', meta: { blob: 'x'.repeat(4096) } }],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await post('10.1.1.1').send(body);
    expect(res.status).toBe(400);
    expect(await ProductEvent.countDocuments({})).toBe(0);
  });

  it('returns 429 on the thirty-first request from the same IP within the window', async () => {
    const ip = '198.51.100.30';
    for (let i = 0; i < 30; i++) {
      const ok = await post(ip).send({ name: 'gate_shown' });
      expect(ok.status).toBe(204);
    }

    const blocked = await post(ip).send({ name: 'gate_shown' });
    expect(blocked.status).toBe(429);
    expect(await ProductEvent.countDocuments({})).toBe(30);

    /* A different IP is unaffected — the limit is per-IP, not global. */
    const other = await post('198.51.100.31').send({ name: 'gate_shown' });
    expect(other.status).toBe(204);
  });
});
