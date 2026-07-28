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
let AnonQuestion, ProductEvent;

/** Distinct source IPs keep each test's rate-limiter bucket isolated. */
const post = (path, ip) => request(app).post(path).set('X-Forwarded-For', ip);

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  const dbModels = require('~/db/models');
  AnonQuestion = dbModels.AnonQuestion;
  ProductEvent = dbModels.ProductEvent;

  app = express();
  app.use(express.json());
  /* `X-Forwarded-For` drives `req.ip`, which is what the limiter keys on. */
  app.set('trust proxy', true);
  app.use('/api/aflat/anon-questions', require('./anonQuestions'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  mockCurrentUser = null;
  await AnonQuestion.deleteMany({});
  await ProductEvent.deleteMany({});
});

describe('POST /api/aflat/anon-questions', () => {
  it('writes to the anon_questions collection', () => {
    expect(AnonQuestion.collection.name).toBe('anon_questions');
    expect(ProductEvent.collection.name).toBe('product_events');
  });

  it('creates the question, returns 201 with its id, and emits question_submitted', async () => {
    const res = await post('/api/aflat/anon-questions', '10.0.0.1').send({
      text: '  Cât preaviz am la demisie?  ',
      ackVersion: 'v1-2026-07',
    });

    expect(res.status).toBe(201);
    expect(res.body.id).toEqual(expect.any(String));

    const doc = await AnonQuestion.findById(res.body.id).lean();
    expect(doc).toMatchObject({
      text: 'Cât preaviz am la demisie?',
      ackVersion: 'v1-2026-07',
      linkedUserId: null,
      linkedConvoId: null,
    });
    expect(doc.ackTs).toBeInstanceOf(Date);

    const events = await ProductEvent.find({ name: 'question_submitted' }).lean();
    expect(events).toHaveLength(1);
    expect(events[0].meta).toMatchObject({ anon: true });
    expect(events[0].userId).toBeNull();
  });

  it('stores the client-supplied ackVersion verbatim, whatever it is', async () => {
    const res = await post('/api/aflat/anon-questions', '10.0.0.2').send({
      text: 'Întrebare',
      ackVersion: 'v9-2099-12',
    });

    expect(res.status).toBe(201);
    const doc = await AnonQuestion.findById(res.body.id).lean();
    expect(doc.ackVersion).toBe('v9-2099-12');
  });

  it('persists no network identifier of any kind', async () => {
    const res = await post('/api/aflat/anon-questions', '203.0.113.7').send({
      text: 'Întrebare',
      ackVersion: 'v1-2026-07',
    });

    const doc = await AnonQuestion.findById(res.body.id).lean();
    const serialized = JSON.stringify(doc);
    expect(Object.keys(doc)).not.toEqual(expect.arrayContaining(['ip', 'userAgent', 'ipAddress']));
    expect(serialized).not.toContain('203.0.113.7');

    const events = await ProductEvent.find({}).lean();
    expect(JSON.stringify(events)).not.toContain('203.0.113.7');
  });

  it.each([
    ['empty text', { text: '', ackVersion: 'v1-2026-07' }],
    ['whitespace-only text', { text: '   ', ackVersion: 'v1-2026-07' }],
    ['missing text', { ackVersion: 'v1-2026-07' }],
    ['non-string text', { text: 42, ackVersion: 'v1-2026-07' }],
    ['missing ackVersion', { text: 'Întrebare' }],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await post('/api/aflat/anon-questions', '10.0.1.1').send(body);
    expect(res.status).toBe(400);
    expect(await AnonQuestion.countDocuments({})).toBe(0);
  });

  it('rejects text longer than 4000 characters with 400', async () => {
    const res = await post('/api/aflat/anon-questions', '10.0.1.2').send({
      text: 'a'.repeat(4001),
      ackVersion: 'v1-2026-07',
    });

    expect(res.status).toBe(400);
    expect(await AnonQuestion.countDocuments({})).toBe(0);
  });

  it('accepts text of exactly 4000 characters', async () => {
    const res = await post('/api/aflat/anon-questions', '10.0.1.3').send({
      text: 'a'.repeat(4000),
      ackVersion: 'v1-2026-07',
    });

    expect(res.status).toBe(201);
  });

  it('returns 429 on the sixth request from the same IP within the window', async () => {
    const ip = '198.51.100.10';
    for (let i = 0; i < 5; i++) {
      const ok = await post('/api/aflat/anon-questions', ip).send({
        text: `Întrebarea ${i}`,
        ackVersion: 'v1-2026-07',
      });
      expect(ok.status).toBe(201);
    }

    const blocked = await post('/api/aflat/anon-questions', ip).send({
      text: 'A șasea',
      ackVersion: 'v1-2026-07',
    });
    expect(blocked.status).toBe(429);
    expect(await AnonQuestion.countDocuments({})).toBe(5);

    /* A different IP is unaffected — the limit is per-IP, not global. */
    const other = await post('/api/aflat/anon-questions', '198.51.100.11').send({
      text: 'Alt IP',
      ackVersion: 'v1-2026-07',
    });
    expect(other.status).toBe(201);
  });
});

describe('POST /api/aflat/anon-questions/:id/link', () => {
  const userA = { id: new mongoose.Types.ObjectId().toString() };
  const userB = { id: new mongoose.Types.ObjectId().toString() };

  const createQuestion = () =>
    AnonQuestion.create({ text: 'Cât preaviz am la demisie?', ackVersion: 'v1-2026-07' });

  /* Every test claims from its own source IP so the 10/hour link limiter — which
   * counts failed-auth attempts too — cannot leak budget between cases. */
  const link = (id, ip) =>
    request(app).post(`/api/aflat/anon-questions/${id}/link`).set('X-Forwarded-For', ip);

  it('requires authentication', async () => {
    const doc = await createQuestion();
    const res = await link(doc._id, '10.2.0.1');
    expect(res.status).toBe(401);
  });

  it('links the question to the caller, returns its text, and emits gate_converted', async () => {
    const doc = await createQuestion();
    mockCurrentUser = userA;

    const res = await link(doc._id, '10.2.0.2');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: doc._id.toString(), text: 'Cât preaviz am la demisie?' });

    const linked = await AnonQuestion.findById(doc._id).lean();
    expect(String(linked.linkedUserId)).toBe(userA.id);

    const events = await ProductEvent.find({ name: 'gate_converted' }).lean();
    expect(events).toHaveLength(1);
    expect(String(events[0].userId)).toBe(userA.id);
  });

  it('is idempotent when the same user links twice', async () => {
    const doc = await createQuestion();
    mockCurrentUser = userA;

    const first = await link(doc._id, '10.2.0.3');
    const second = await link(doc._id, '10.2.0.3');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.text).toBe('Cât preaviz am la demisie?');
    expect(String((await AnonQuestion.findById(doc._id).lean()).linkedUserId)).toBe(userA.id);
    /* The second claim is a no-op: it must not emit a duplicate conversion. */
    expect(await ProductEvent.countDocuments({ name: 'gate_converted' })).toBe(1);
  });

  it('returns 404 when a different user tries to link an already-linked question', async () => {
    const doc = await createQuestion();
    mockCurrentUser = userA;
    await link(doc._id, '10.2.0.4');

    mockCurrentUser = userB;
    const res = await link(doc._id, '10.2.0.4');

    expect(res.status).toBe(404);
    expect(String((await AnonQuestion.findById(doc._id).lean()).linkedUserId)).toBe(userA.id);
  });

  /**
   * The claim is a single conditional update, so a losing claimer matches
   * nothing rather than overwriting the winner. This asserts those semantics
   * directly (no need to reproduce a real race): once claimed, another user
   * gets 404 and the owner keeps getting 200 — with exactly one conversion
   * event for the whole sequence.
   */
  it('claims conditionally: only the owner keeps winning, and only once', async () => {
    const doc = await createQuestion();

    mockCurrentUser = userA;
    const claimed = await link(doc._id, '10.2.0.5');
    expect(claimed.status).toBe(200);

    mockCurrentUser = userB;
    const stolen = await link(doc._id, '10.2.0.6');
    expect(stolen.status).toBe(404);
    expect(stolen.body.text).toBeUndefined();

    mockCurrentUser = userA;
    const reclaimed = await link(doc._id, '10.2.0.5');
    expect(reclaimed.status).toBe(200);
    expect(reclaimed.body.text).toBe('Cât preaviz am la demisie?');

    expect(String((await AnonQuestion.findById(doc._id).lean()).linkedUserId)).toBe(userA.id);
    const events = await ProductEvent.find({ name: 'gate_converted' }).lean();
    expect(events).toHaveLength(1);
    expect(String(events[0].userId)).toBe(userA.id);
  });

  it('returns 404 for an unknown id', async () => {
    mockCurrentUser = userA;
    const res = await link(new mongoose.Types.ObjectId(), '10.2.0.7');
    expect(res.status).toBe(404);
  });

  it('returns 404 for a malformed id instead of throwing', async () => {
    mockCurrentUser = userA;
    const res = await link('not-an-object-id', '10.2.0.8');
    expect(res.status).toBe(404);
  });

  it('returns 429 on the eleventh claim attempt from the same IP within the window', async () => {
    const ip = '198.51.100.50';
    mockCurrentUser = userA;

    /* Enumeration is exactly this shape: repeated misses against guessed ids. */
    for (let i = 0; i < 10; i++) {
      const miss = await link(new mongoose.Types.ObjectId(), ip);
      expect(miss.status).toBe(404);
    }

    const doc = await createQuestion();
    const blocked = await link(doc._id, ip);
    expect(blocked.status).toBe(429);
    /* Throttled before the handler ran — nothing was claimed or leaked. */
    expect(blocked.body.text).toBeUndefined();
    expect((await AnonQuestion.findById(doc._id).lean()).linkedUserId).toBeNull();

    /* A different IP is unaffected — the limit is per-IP, not global. */
    const other = await link(doc._id, '198.51.100.51');
    expect(other.status).toBe(200);
  });
});
