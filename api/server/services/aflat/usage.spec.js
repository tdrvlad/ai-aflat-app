const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

/**
 * The `usage_events` writer against a real in-memory MongoDB (same precedent
 * as `routes/clerkAuth.test.js`): the row a completed request produces is the
 * envelope verbatim, a failed job's null cost stays null, a write failure
 * never throws into the response path, and a non-aflat completion (null
 * payload) writes nothing.
 */

jest.mock('@librechat/data-schemas', () => {
  const actual = jest.requireActual('@librechat/data-schemas');
  return {
    ...actual,
    logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
  };
});

const { logger } = require('@librechat/data-schemas');

let mongoServer;
let UsageEvent;
let recordAflatUsageEvent;

/** The envelope exactly as `getAflatCompletion` normalizes it from the orchestrator. */
const answeredPayload = {
  sources: [{ ref: 'S1' }, { ref: 'S2' }, { ref: 'S3' }],
  sources_by_act: [{ act_id: 41627, provisions: [{ ref: 'S1' }] }],
  job_id: 'job-1',
  query_id: 'q-1',
  outcome: 'answered',
  usage: {
    effort: 'medium',
    model: 'standard-search',
    engine_cost_usd: 0.0125,
    engine_cost_is_complete: true,
    latency_ms: 6421,
    created_at: '2026-08-06 12:34:56',
  },
};

const identity = {
  userId: '64a000000000000000000001',
  conversationId: 'convo-uuid-1',
  messageId: 'msg-uuid-1',
};

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());

  UsageEvent = require('~/db/models').UsageEvent;
  ({ recordAflatUsageEvent } = require('./usage'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  jest.clearAllMocks();
  await UsageEvent.deleteMany({});
});

describe('recordAflatUsageEvent', () => {
  it('writes one row per completed request, with the envelope values verbatim', async () => {
    await recordAflatUsageEvent({ payload: answeredPayload, ...identity });

    const rows = await UsageEvent.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      conversationId: 'convo-uuid-1',
      messageId: 'msg-uuid-1',
      jobId: 'job-1',
      queryId: 'q-1',
      effort: 'medium',
      model: 'standard-search',
      outcome: 'answered',
      engineCostUsd: 0.0125,
      engineCostIsComplete: true,
      latencyMs: 6421,
      hits: 3,
      candidates: 1,
      creditsCharged: null,
      priceListVersion: null,
    });
    expect(rows[0].userId.toString()).toBe(identity.userId);
    expect(rows[0].createdAt).toBeInstanceOf(Date);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("keeps a failed job's null cost null in the stored row — never 0", async () => {
    await recordAflatUsageEvent({
      payload: {
        sources: [],
        job_id: 'job-2',
        outcome: 'failed',
        usage: {
          effort: null,
          model: 'standard-search',
          engine_cost_usd: null,
          engine_cost_is_complete: null,
          latency_ms: null,
          created_at: '2026-08-06 12:00:00',
        },
      },
      ...identity,
      messageId: 'msg-uuid-2',
    });

    const row = await UsageEvent.findOne({ messageId: 'msg-uuid-2' }).lean();
    expect(row.outcome).toBe('failed');
    expect(row.engineCostUsd).toBeNull();
    expect(row.engineCostUsd).not.toBe(0);
    expect(row.engineCostIsComplete).toBeNull();
    expect(row.latencyMs).toBeNull();
    expect(row.hits).toBe(0);
    expect(row.candidates).toBe(0);
  });

  it('never throws into the response path when the write fails — it logs and swallows', async () => {
    jest.spyOn(UsageEvent, 'create').mockRejectedValueOnce(new Error('mongo down'));

    await expect(
      recordAflatUsageEvent({ payload: answeredPayload, ...identity }),
    ).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('writes nothing for a non-aflat completion (null payload), with a debug log not an error', async () => {
    await expect(recordAflatUsageEvent({ payload: null, ...identity })).resolves.toBeNull();

    expect(await UsageEvent.countDocuments({})).toBe(0);
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('writes nothing when the orchestrator had no record for the message', async () => {
    await expect(
      recordAflatUsageEvent({ payload: { sources: [] }, ...identity }),
    ).resolves.toBeNull();
    expect(await UsageEvent.countDocuments({})).toBe(0);
  });

  it('expires rows after 24 months via the TTL index (spec §5)', () => {
    const ttlIndex = UsageEvent.schema.indexes().find(([fields]) => fields.createdAt === 1);
    expect(ttlIndex?.[1]?.expireAfterSeconds).toBe(730 * 24 * 60 * 60);
  });
});
