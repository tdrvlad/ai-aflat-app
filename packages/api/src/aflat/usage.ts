import type { AflatSourcesPayload } from './sources';

/**
 * ai-aflat: the `usage_events` row, built ONLY from the terminal envelope the
 * orchestrator returned (telemetry spec 2026-08-06 §1, rule 2: write from the
 * envelope, don't re-derive). Nothing here is computed, converted or repaired —
 * every value is the envelope's value or `null`.
 *
 * Deliberate divergence from spec §1 (ruled 2026-08-06): the spec names
 * `engineCostMicroRon`, but the envelope carries USD, and converting currency
 * at write time would need an FX rate that is NOT in the envelope — a second
 * source of truth, the exact drift rule 2 forbids. `engineCostUsd` +
 * `engineCostIsComplete` are stored verbatim instead; a failed job's null cost
 * stays null, never 0. `creditsCharged`/`priceListVersion` stay null until
 * credits phase 2 wires them.
 */
export interface AflatUsageEvent {
  userId: string;
  conversationId: string | null;
  messageId: string;
  jobId: string | null;
  queryId: string | null;
  effort: string | null;
  model: string | null;
  /** Verbatim ('answered'/'failed'/…) — flattening it would let us bill for a failure. */
  outcome: string | null;
  engineCostUsd: number | null;
  engineCostIsComplete: boolean | null;
  latencyMs: number | null;
  hits: number;
  candidates: number;
  creditsCharged: null;
  priceListVersion: null;
}

export interface AflatUsageEventParams {
  payload: AflatSourcesPayload | null;
  userId?: string;
  conversationId?: string | null;
  messageId?: string;
}

/**
 * Maps the completion envelope onto a `usage_events` row, or `null` when there
 * is nothing to record: no payload (not the ai-aflat endpoint), no envelope
 * identity (the orchestrator had no job for this message), or no subject to
 * key the row on.
 */
export function buildAflatUsageEvent({
  payload,
  userId,
  conversationId,
  messageId,
}: AflatUsageEventParams): AflatUsageEvent | null {
  if (payload == null || !userId || !messageId) {
    return null;
  }
  if (payload.usage == null && payload.job_id == null) {
    return null;
  }

  const usage = payload.usage;
  return {
    userId,
    conversationId: conversationId ?? null,
    messageId,
    jobId: payload.job_id ?? null,
    queryId: payload.query_id ?? null,
    effort: usage?.effort ?? null,
    model: usage?.model ?? null,
    outcome: payload.outcome ?? null,
    engineCostUsd: usage?.engine_cost_usd ?? null,
    engineCostIsComplete: usage?.engine_cost_is_complete ?? null,
    latencyMs: usage?.latency_ms ?? null,
    hits: payload.sources.length,
    candidates: payload.sources_by_act?.length ?? 0,
    creditsCharged: null,
    priceListVersion: null,
  };
}
