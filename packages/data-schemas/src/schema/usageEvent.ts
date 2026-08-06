import { Schema, Document, Types } from 'mongoose';

/**
 * ai-aflat: one row per answered request — the app-side copy of the
 * orchestrator's terminal envelope (telemetry spec 2026-08-06 §1). Every value
 * is written from the envelope, never re-derived (spec §1 rule 2); `null`
 * everywhere means "not recorded", and a failed job's null cost must never be
 * coerced to 0.
 *
 * Deliberate divergences from the spec's field list, ruled 2026-08-06:
 * - `engineCostUsd` + `engineCostIsComplete` instead of `engineCostMicroRon`:
 *   the envelope carries USD, and a write-time currency conversion would need
 *   an FX rate that is not in the envelope — the second source of truth rule 2
 *   forbids.
 * - `conversationId` is a String: this fork's conversation ids are UUIDs, not
 *   ObjectIds.
 *
 * `outcome` is stored verbatim ('answered'/'failed'/…) and must never be
 * flattened — collapsing "found nothing" into "broke" would let us bill for a
 * failure. `creditsCharged`/`priceListVersion` stay null until credits phase 2.
 */
export interface IUsageEvent extends Omit<Document, 'model'> {
  userId: Types.ObjectId;
  conversationId?: string | null;
  messageId: string;
  jobId?: string | null;
  queryId?: string | null;
  effort?: string | null;
  model?: string | null;
  outcome?: string | null;
  engineCostUsd?: number | null;
  engineCostIsComplete?: boolean | null;
  latencyMs?: number | null;
  hits: number;
  candidates: number;
  creditsCharged?: number | null;
  priceListVersion?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/** 24 months (telemetry spec §5: margin analysis across a full year plus comparison). */
export const USAGE_EVENT_TTL_SECONDS: number = 730 * 24 * 60 * 60;

const usageEventSchema: Schema<IUsageEvent> = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    conversationId: {
      type: String,
      default: null,
      index: true,
    },
    messageId: {
      type: String,
      required: true,
      index: true,
    },
    jobId: {
      type: String,
      default: null,
    },
    queryId: {
      type: String,
      default: null,
    },
    effort: {
      type: String,
      default: null,
    },
    model: {
      type: String,
      default: null,
    },
    outcome: {
      type: String,
      default: null,
    },
    engineCostUsd: {
      type: Number,
      default: null,
    },
    engineCostIsComplete: {
      type: Boolean,
      default: null,
    },
    latencyMs: {
      type: Number,
      default: null,
    },
    hits: {
      type: Number,
      required: true,
    },
    candidates: {
      type: Number,
      required: true,
    },
    creditsCharged: {
      type: Number,
      default: null,
    },
    priceListVersion: {
      type: String,
      default: null,
    },
  },
  { timestamps: true, collection: 'usage_events' },
);

usageEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: USAGE_EVENT_TTL_SECONDS });

export default usageEventSchema;
