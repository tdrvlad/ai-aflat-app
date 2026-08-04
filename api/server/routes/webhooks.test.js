const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let app;
let mongoServer;

/**
 * The webhook's whole security model is the Stripe signature check, so these tests
 * are mostly about what happens when it fails. The router is mounted exactly as
 * `server/index.js` mounts it — **without** `express.json()` — because mounting it
 * behind a JSON parser is the failure this test exists to catch: it breaks every
 * webhook with an error that reads like a Stripe misconfiguration.
 */
beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  require('~/db/models');

  app = express();
  app.use('/api/aflat/webhooks', require('./webhooks'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

describe('POST /api/aflat/webhooks/stripe', () => {
  it('reports unavailable rather than broken when Stripe is unconfigured', async () => {
    const res = await request(app)
      .post('/api/aflat/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(res.status).toBe(503);
  });

  it('rejects a request with no signature header', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_x';

    const res = await request(app)
      .post('/api/aflat/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing signature');
  });

  it('rejects a forged signature and never grants credits', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_x';

    const res = await request(app)
      .post('/api/aflat/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 't=1,v1=deadbeef')
      .send(JSON.stringify({ id: 'evt_forged', type: 'checkout.session.completed' }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid signature');
    /* Nothing may reach the ledger from an unverified request. */
    expect(await mongoose.models.CreditLedger.countDocuments({})).toBe(0);
    expect(await mongoose.models.PaymentEvent.countDocuments({})).toBe(0);
  });

  it('does not leak why verification failed', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_x';

    const res = await request(app)
      .post('/api/aflat/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 't=1,v1=deadbeef')
      .send('{}');

    /* A prober must not learn how close a forgery got. */
    expect(JSON.stringify(res.body)).not.toMatch(/timestamp|payload|expected/i);
  });
});
