import { Schema, Document, Types } from 'mongoose';

export type JobOutcome = 'answered' | 'clarification' | 'empty' | 'failed';

/**
 * ai-aflat: what a job actually cost us, in real money.
 *
 * Entirely separate from the user's balance: this side is spend, the ledger side
 * is realized revenue, and margin is the join of the two on `jobId`. Keeping them
 * apart is what lets the price list be wrong without the accounting being wrong.
 *
 * Written for every job regardless of outcome — a failed job is not billed but it
 * still burned tokens, and a free tier whose failures are invisible will look
 * cheaper than it is.
 *
 * Amounts are integer micro-units (1 unit = 1_000_000).
 */
export interface ICostLog extends Document {
  jobId: string;
  userId?: Types.ObjectId | null;
  actionType: string;
  effort: string;
  legdbQueryIds: string[];
  legdbCostMicroUsd: number;
  synthesisInputTokens: number;
  synthesisOutputTokens: number;
  synthesisCostMicroUsd: number;
  totalCostMicroUsd: number;
  fxMicroRonPerUsd: number;
  totalCostMicroRon: number;
  outcome: JobOutcome;
  latencyMs?: number | null;
  priceListVersion?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const costLogSchema: Schema<ICostLog> = new Schema(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    actionType: {
      type: String,
      required: true,
    },
    effort: {
      type: String,
      required: true,
      index: true,
    },
    /**
     * Every `X-LegDB-Query-Id` this job touched. The search engine reconciles spend
     * against our key by query id, so this array is the only handle we have for
     * disputing or auditing a bill. One job can span several ids.
     */
    legdbQueryIds: {
      type: [String],
      default: [],
    },
    legdbCostMicroUsd: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    synthesisInputTokens: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    synthesisOutputTokens: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    synthesisCostMicroUsd: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    totalCostMicroUsd: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    /**
     * Stored on the row, never looked up at report time. Costs are USD and revenue
     * is RON; a margin figure computed at today's rate against last quarter's spend
     * is a fiction.
     */
    fxMicroRonPerUsd: {
      type: Number,
      required: true,
      min: 0,
    },
    totalCostMicroRon: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    outcome: {
      type: String,
      enum: ['answered', 'clarification', 'empty', 'failed'],
      required: true,
      index: true,
    },
    latencyMs: {
      type: Number,
      default: null,
    },
    priceListVersion: {
      type: String,
      default: null,
    },
  },
  { timestamps: true, collection: 'cost_logs' },
);

costLogSchema.index({ createdAt: -1 }, { name: 'cost_logs_recent' });

export default costLogSchema;
