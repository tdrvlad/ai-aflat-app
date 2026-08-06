import type { AflatSourcesPayload, TAflatUsage } from './sources';
import { buildAflatUsageEvent } from './usage';

const usage: TAflatUsage = {
  effort: 'medium',
  model: 'standard-search',
  engine_cost_usd: 0.0125,
  engine_cost_is_complete: true,
  latency_ms: 6421,
  created_at: '2026-08-06 12:34:56',
};

const answeredPayload: AflatSourcesPayload = {
  sources: [{ ref: 'S1' }, { ref: 'S2' }, { ref: 'S3' }],
  sources_by_act: [{ act_id: 41627, provisions: [{ ref: 'S1' }] }],
  job_id: 'job-1',
  query_id: 'q-1',
  outcome: 'answered',
  usage,
};

const identity = {
  userId: '64a000000000000000000001',
  conversationId: 'convo-uuid-1',
  messageId: 'msg-uuid-1',
};

describe('buildAflatUsageEvent', () => {
  it('maps the envelope onto the row verbatim — nothing re-derived (spec §1 rule 2)', () => {
    expect(buildAflatUsageEvent({ payload: answeredPayload, ...identity })).toEqual({
      userId: identity.userId,
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
  });

  it("keeps a failed job's null cost null — never coerced to 0", () => {
    const failed: AflatSourcesPayload = {
      sources: [],
      job_id: 'job-2',
      outcome: 'failed',
      usage: { ...usage, engine_cost_usd: null, engine_cost_is_complete: null, latency_ms: null },
    };

    const event = buildAflatUsageEvent({ payload: failed, ...identity });

    expect(event?.outcome).toBe('failed');
    expect(event?.engineCostUsd).toBeNull();
    expect(event?.engineCostIsComplete).toBeNull();
    expect(event?.latencyMs).toBeNull();
    expect(event?.hits).toBe(0);
    expect(event?.candidates).toBe(0);
  });

  it('carries the outcome verbatim without flattening it', () => {
    for (const outcome of ['answered', 'empty', 'clarification', 'failed']) {
      const event = buildAflatUsageEvent({
        payload: { ...answeredPayload, outcome },
        ...identity,
      });
      expect(event?.outcome).toBe(outcome);
    }
  });

  it('builds nothing without a payload — the endpoint was not ai-aflat', () => {
    expect(buildAflatUsageEvent({ payload: null, ...identity })).toBeNull();
  });

  it('builds nothing when the payload has no envelope identity (orchestrator 404/unreachable)', () => {
    expect(buildAflatUsageEvent({ payload: { sources: [] }, ...identity })).toBeNull();
  });

  it('builds nothing without a subject or a message to key the row on', () => {
    expect(
      buildAflatUsageEvent({ payload: answeredPayload, ...identity, userId: undefined }),
    ).toBeNull();
    expect(
      buildAflatUsageEvent({ payload: answeredPayload, ...identity, messageId: '' }),
    ).toBeNull();
  });
});
