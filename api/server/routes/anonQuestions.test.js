const crypto = require('node:crypto');
const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
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

/**
 * The claim cookie follows the fork's own auth cookies for the `secure` flag —
 * `shouldUseSecureCookie()` — so it still works on `http://localhost:3080`.
 * Mocked here so both sides of that switch can be asserted.
 */
let mockSecureCookie = false;
jest.mock('@librechat/api', () => ({
  ...jest.requireActual('@librechat/api'),
  shouldUseSecureCookie: () => mockSecureCookie,
}));

let app;
let mongoServer;
let AnonQuestion, ProductEvent;

const CLAIM_COOKIE = 'aflat_claim';
/** The readable flag that tells the client a claim is worth attempting. */
const CLAIM_MARKER_COOKIE = 'aflat_claim_present';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/**
 * Distinct source IPs keep each test's rate-limiter bucket isolated. Both
 * limiters here are per-IP and both windows are an hour, so a shared IP would
 * leak budget between cases.
 */
let ipCounter = 0;
const freshIp = () => {
  ipCounter += 1;
  return `10.${Math.floor(ipCounter / 250)}.${ipCounter % 250}.1`;
};

const post = (path, ip) => request(app).post(path).set('X-Forwarded-For', ip);

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  const dbModels = require('~/db/models');
  AnonQuestion = dbModels.AnonQuestion;
  ProductEvent = dbModels.ProductEvent;

  app = express();
  app.use(express.json());
  /* The claim reads its authorisation out of a cookie — same as the real app. */
  app.use(cookieParser());
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
  mockSecureCookie = false;
  await AnonQuestion.deleteMany({});
  await ProductEvent.deleteMany({});
});

/** The `Set-Cookie` entry for `name`, or undefined. */
const setCookieFor = (res, name) =>
  (res.headers['set-cookie'] ?? []).find((cookie) => cookie.startsWith(`${name}=`));

const claimTokenFrom = (res) => {
  const header = setCookieFor(res, CLAIM_COOKIE);
  if (header == null) {
    return undefined;
  }
  const value = header.split(';')[0].slice(CLAIM_COOKIE.length + 1);
  return decodeURIComponent(value);
};

const mint = (body, ip = freshIp()) => post('/api/aflat/anon-questions', ip).send(body);

/** Parks a question the way a visitor's browser does, keeping what it keeps. */
const park = async (text = 'Cât preaviz am la demisie?') => {
  const res = await mint({ text, ackVersion: 'v1-2026-07' });
  expect(res.status).toBe(201);
  return { id: res.body.id, token: claimTokenFrom(res), res };
};

/** `undefined` token = a browser that presents no claim cookie at all. */
const claim = (token, ip = freshIp()) => {
  const req = request(app).post('/api/aflat/anon-questions/claim').set('X-Forwarded-For', ip);
  return token === undefined ? req : req.set('Cookie', `${CLAIM_COOKIE}=${token}`);
};

describe('POST /api/aflat/anon-questions', () => {
  it('writes to the anon_questions collection', () => {
    expect(AnonQuestion.collection.name).toBe('anon_questions');
    expect(ProductEvent.collection.name).toBe('product_events');
  });

  it('creates the question, returns 201 with its id, and emits question_submitted', async () => {
    const res = await mint({
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
    const res = await mint({ text: 'Întrebare', ackVersion: 'v9-2099-12' });

    expect(res.status).toBe(201);
    const doc = await AnonQuestion.findById(res.body.id).lean();
    expect(doc.ackVersion).toBe('v9-2099-12');
  });

  it('persists no network identifier of any kind', async () => {
    const res = await mint({ text: 'Întrebare', ackVersion: 'v1-2026-07' }, '203.0.113.7');

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
    const res = await mint(body);
    expect(res.status).toBe(400);
    expect(await AnonQuestion.countDocuments({})).toBe(0);
    /* A rejected question hands out no claim credential either. */
    expect(setCookieFor(res, CLAIM_COOKIE)).toBeUndefined();
  });

  it('rejects text longer than 4000 characters with 400', async () => {
    const res = await mint({ text: 'a'.repeat(4001), ackVersion: 'v1-2026-07' });

    expect(res.status).toBe(400);
    expect(await AnonQuestion.countDocuments({})).toBe(0);
  });

  it('accepts text of exactly 4000 characters', async () => {
    const res = await mint({ text: 'a'.repeat(4000), ackVersion: 'v1-2026-07' });

    expect(res.status).toBe(201);
  });

  it('returns 429 on the sixth request from the same IP within the window', async () => {
    const ip = '198.51.100.10';
    for (let i = 0; i < 5; i++) {
      const ok = await mint({ text: `Întrebarea ${i}`, ackVersion: 'v1-2026-07' }, ip);
      expect(ok.status).toBe(201);
    }

    const blocked = await mint({ text: 'A șasea', ackVersion: 'v1-2026-07' }, ip);
    expect(blocked.status).toBe(429);
    expect(await AnonQuestion.countDocuments({})).toBe(5);

    /* A different IP is unaffected — the limit is per-IP, not global. */
    const other = await mint({ text: 'Alt IP', ackVersion: 'v1-2026-07' }, '198.51.100.11');
    expect(other.status).toBe(201);
  });

  /**
   * The claim credential. Everything about the parked question's confidentiality
   * rests on these four properties: the token is unguessable, it reaches the
   * browser only as an httpOnly cookie, it is never echoed in a body, and what
   * the database keeps is a hash — so neither a response log nor a database dump
   * can be replayed into a claim.
   */
  describe('the claim cookie', () => {
    it('returns the token only as an httpOnly cookie, never in the body', async () => {
      const { res, token } = await park();

      expect(token).toEqual(expect.any(String));
      expect(Object.keys(res.body)).toEqual(['id']);
      expect(res.text).not.toContain(token);

      const header = setCookieFor(res, CLAIM_COOKIE);
      expect(header).toContain('HttpOnly');
      expect(header).toContain('SameSite=Lax');
      expect(header).toContain('Path=/api/aflat');
      /* 24h, matching the client stash's own maximum age. */
      expect(header).toContain('Max-Age=86400');
    });

    /**
     * The marker is what lets the client know a claim is worth making without
     * being able to read the credential. It must be readable — no `HttpOnly` —
     * and at `path=/`, because `document.cookie` only exposes cookies matching
     * the reading page's path and the page that reads it is `/c/new`, not
     * `/api/aflat`. It must also carry nothing: possession of the flag says only
     * "this browser parked something", never what.
     */
    it('sets a readable, contentless marker cookie at the site root', async () => {
      const { res } = await park();

      const header = setCookieFor(res, CLAIM_MARKER_COOKIE);
      expect(header).toBeDefined();
      expect(header).not.toContain('HttpOnly');
      expect(header).toContain('Path=/');
      expect(header).not.toContain('Path=/api/aflat');
      expect(header).toContain('Max-Age=86400');
      expect(header).toMatch(new RegExp(`^${CLAIM_MARKER_COOKIE}=1(;|$)`));
    });

    it('carries at least 32 bytes of entropy and differs every time', async () => {
      const first = await park();
      const second = await park();

      /* base64url of 32 random bytes — 43 chars, no padding, url-safe alphabet. */
      expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(second.token).not.toBe(first.token);
    });

    /** Dev runs on `http://localhost:3080`; a `Secure` cookie would never arrive. */
    it('omits Secure off TLS and sets it behind TLS', async () => {
      mockSecureCookie = false;
      const plain = await park();
      expect(setCookieFor(plain.res, CLAIM_COOKIE)).not.toContain('Secure');

      mockSecureCookie = true;
      const tls = await park();
      expect(setCookieFor(tls.res, CLAIM_COOKIE)).toContain('Secure');
    });

    it('stores only the SHA-256 of the token, never the token itself', async () => {
      const { id, token } = await park();

      const doc = await AnonQuestion.findById(id).lean();
      expect(doc.claimTokenHash).toBe(sha256(token));
      expect(JSON.stringify(doc)).not.toContain(token);
    });
  });
});

describe('POST /api/aflat/anon-questions/claim', () => {
  const userA = { id: new mongoose.Types.ObjectId().toString() };
  const userB = { id: new mongoose.Types.ObjectId().toString() };

  it('requires authentication even with a valid token', async () => {
    const { token } = await park();

    const res = await claim(token);

    expect(res.status).toBe(401);
    expect(await AnonQuestion.countDocuments({ linkedUserId: { $ne: null } })).toBe(0);
  });

  /**
   * The whole point of the redesign: there is no id in the request, so there is
   * nothing to enumerate. Authorisation is possession of the cookie and nothing
   * else — no cookie, no claim, however many valid questions are parked.
   */
  it('rejects a caller who presents no claim cookie', async () => {
    const { id } = await park();
    mockCurrentUser = userA;

    const res = await claim(undefined);

    expect(res.status).toBe(404);
    expect(res.body.text).toBeUndefined();
    expect((await AnonQuestion.findById(id).lean()).linkedUserId).toBeNull();
  });

  it('rejects an empty claim cookie', async () => {
    const { id } = await park();
    mockCurrentUser = userA;

    const res = await claim('');

    expect(res.status).toBe(404);
    expect((await AnonQuestion.findById(id).lean()).linkedUserId).toBeNull();
  });

  it.each([
    ['garbage', 'not-a-token'],
    ['a Mongo id', '000000000000000000000000'],
    ['a well-formed but unissued token', crypto.randomBytes(32).toString('base64url')],
    ['the SHA-256 of a real token instead of the token', null],
  ])('rejects %s', async (_label, candidate) => {
    const { id, token } = await park();
    mockCurrentUser = userA;

    const res = await claim(candidate ?? sha256(token));

    expect(res.status).toBe(404);
    expect(res.body.text).toBeUndefined();
    expect((await AnonQuestion.findById(id).lean()).linkedUserId).toBeNull();
  });

  /** A token in the body or the query string is not a credential — only the cookie is. */
  it('ignores a token presented anywhere but the cookie', async () => {
    const { id, token } = await park();
    mockCurrentUser = userA;

    const res = await request(app)
      .post(`/api/aflat/anon-questions/claim?token=${token}`)
      .set('X-Forwarded-For', freshIp())
      .send({ token, claimToken: token });

    expect(res.status).toBe(404);
    expect((await AnonQuestion.findById(id).lean()).linkedUserId).toBeNull();
  });

  it('links the question to the caller, returns its text, and emits gate_converted', async () => {
    const { id, token } = await park();
    mockCurrentUser = userA;

    const res = await claim(token);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, text: 'Cât preaviz am la demisie?' });

    const linked = await AnonQuestion.findById(id).lean();
    expect(String(linked.linkedUserId)).toBe(userA.id);

    const events = await ProductEvent.find({ name: 'gate_converted' }).lean();
    expect(events).toHaveLength(1);
    expect(String(events[0].userId)).toBe(userA.id);
  });

  it('never puts the token or its hash in the claim response', async () => {
    const { token } = await park();
    mockCurrentUser = userA;

    const res = await claim(token);

    expect(res.status).toBe(200);
    expect(res.text).not.toContain(token);
    expect(res.text).not.toContain(sha256(token));
    expect(Object.keys(res.body).sort()).toEqual(['id', 'text']);
  });

  /** Spent on success: the credential must not outlive the handoff it authorised. */
  it('clears the claim cookie once the question is claimed', async () => {
    const { token } = await park();
    mockCurrentUser = userA;

    const res = await claim(token);

    const header = setCookieFor(res, CLAIM_COOKIE);
    expect(header).toBeDefined();
    expect(claimTokenFrom(res)).toBe('');
    expect(header).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    expect(header).toContain('Path=/api/aflat');
  });

  /**
   * A 404 is never transient here — it means no token, or a question that is
   * gone or already someone else's — so the browser is told to stop presenting
   * a credential that can no longer work. Leaving it would keep the marker alive
   * for 24h and have every page load spend another shared claim attempt.
   */
  it('clears both cookies when the claim is rejected, so the browser stops asking', async () => {
    await park();
    mockCurrentUser = userA;

    const res = await claim('not-a-token');

    expect(res.status).toBe(404);
    expect(claimTokenFrom(res)).toBe('');
    expect(setCookieFor(res, CLAIM_MARKER_COOKIE)).toContain(
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    );
  });

  it('is idempotent when the same user claims twice', async () => {
    const { id, token } = await park();
    mockCurrentUser = userA;

    const first = await claim(token);
    const second = await claim(token);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.text).toBe('Cât preaviz am la demisie?');
    expect(String((await AnonQuestion.findById(id).lean()).linkedUserId)).toBe(userA.id);
    /* The second claim is a no-op: it must not emit a duplicate conversion. */
    expect(await ProductEvent.countDocuments({ name: 'gate_converted' })).toBe(1);
  });

  it('refuses a second account holding the same token', async () => {
    const { id, token } = await park();
    mockCurrentUser = userA;
    await claim(token);

    mockCurrentUser = userB;
    const res = await claim(token);

    expect(res.status).toBe(404);
    expect(res.body.text).toBeUndefined();
    expect(String((await AnonQuestion.findById(id).lean()).linkedUserId)).toBe(userA.id);
  });

  /**
   * The claim is a single conditional update, so a losing claimer matches
   * nothing rather than overwriting the winner. This asserts those semantics
   * directly (no need to reproduce a real race): once claimed, another user
   * gets 404 and the owner keeps getting 200 — with exactly one conversion
   * event for the whole sequence.
   */
  it('claims conditionally: only the owner keeps winning, and only once', async () => {
    const { id, token } = await park();

    mockCurrentUser = userA;
    const claimed = await claim(token);
    expect(claimed.status).toBe(200);

    mockCurrentUser = userB;
    const stolen = await claim(token);
    expect(stolen.status).toBe(404);
    expect(stolen.body.text).toBeUndefined();

    mockCurrentUser = userA;
    const reclaimed = await claim(token);
    expect(reclaimed.status).toBe(200);
    expect(reclaimed.body.text).toBe('Cât preaviz am la demisie?');

    expect(String((await AnonQuestion.findById(id).lean()).linkedUserId)).toBe(userA.id);
    const events = await ProductEvent.find({ name: 'gate_converted' }).lean();
    expect(events).toHaveLength(1);
    expect(String(events[0].userId)).toBe(userA.id);
  });

  /** One visitor's token must never reach another visitor's question. */
  it('claims the question the token was issued for and no other', async () => {
    const mine = await park('Întrebarea mea');
    const theirs = await park('Întrebarea altcuiva');
    mockCurrentUser = userA;

    const res = await claim(mine.token);

    expect(res.body.text).toBe('Întrebarea mea');
    expect((await AnonQuestion.findById(theirs.id).lean()).linkedUserId).toBeNull();
  });

  /**
   * The id-based route is deleted, not deprecated. Nothing is deployed, so there
   * is no data and no compatibility burden — and leaving it mounted would leave
   * the enumeration oracle it exists to remove.
   */
  it('no longer answers the id-based link route', async () => {
    const { id, token } = await park();
    mockCurrentUser = userA;

    const res = await request(app)
      .post(`/api/aflat/anon-questions/${id}/link`)
      .set('X-Forwarded-For', freshIp())
      .set('Cookie', `${CLAIM_COOKIE}=${token}`);

    expect(res.status).toBe(404);
    expect(res.body.text).toBeUndefined();
    expect((await AnonQuestion.findById(id).lean()).linkedUserId).toBeNull();
  });

  it('returns 429 on the eleventh claim attempt from the same IP within the window', async () => {
    const ip = '198.51.100.50';
    mockCurrentUser = userA;

    for (let i = 0; i < 10; i++) {
      const miss = await claim(crypto.randomBytes(32).toString('base64url'), ip);
      expect(miss.status).toBe(404);
    }

    const { id, token } = await park();
    const blocked = await claim(token, ip);
    expect(blocked.status).toBe(429);
    /* Throttled before the handler ran — nothing was claimed or leaked. */
    expect(blocked.body.text).toBeUndefined();
    expect((await AnonQuestion.findById(id).lean()).linkedUserId).toBeNull();

    /* A different IP is unaffected — the limit is per-IP, not global. */
    const other = await claim(token, '198.51.100.51');
    expect(other.status).toBe(200);
  });

  /**
   * The limiter deliberately sits in front of `requireJwtAuth`: failed auth must
   * spend the same per-IP budget, or the throttle is bypassed by simply not
   * presenting a JWT. It also keeps `req.user` unset at limiter time, which is
   * what makes the "no IP in any log" guarantee structural.
   */
  it('counts unauthenticated attempts against the same per-IP budget', async () => {
    const ip = '198.51.100.60';
    mockCurrentUser = null;

    for (let i = 0; i < 10; i++) {
      const rejected = await claim(crypto.randomBytes(32).toString('base64url'), ip);
      expect(rejected.status).toBe(401);
    }

    mockCurrentUser = userA;
    const { token } = await park();
    expect((await claim(token, ip)).status).toBe(429);
  });
});
