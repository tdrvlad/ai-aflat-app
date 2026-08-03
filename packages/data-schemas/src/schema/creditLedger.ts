import { Schema, Document, Types } from 'mongoose';

export type CreditLedgerType =
  | 'grant'
  | 'purchase'
  | 'hold'
  | 'debit'
  | 'release'
  | 'refund'
  | 'expire'
  | 'reversal';

export interface ICreditAllocation {
  lotId: Types.ObjectId;
  credits: number;
  costBasisMicroRon: number;
}

/**
 * ai-aflat: the append-only record of every credit movement.
 *
 * Nothing here is ever updated after write. A correction is a new row
 * (`reversal`), never an edit — which is what makes support arguments, Stripe
 * reconciliation and revenue recognition possible at all. `creditBalance` is a
 * derived cache of these rows and can always be rebuilt from them.
 */
export interface ICreditLedger extends Document {
  userId: Types.ObjectId;
  type: CreditLedgerType;
  credits: number;
  allocations: ICreditAllocation[];
  reasonCode: string;
  actionType?: string | null;
  effort?: string | null;
  priceListVersion?: string | null;
  jobId?: string | null;
  refId?: string | null;
  idempotencyKey?: string | null;
  reversalOf?: Types.ObjectId | null;
  settledBy?: Types.ObjectId | null;
  note?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const allocationSchema = new Schema<ICreditAllocation>(
  {
    lotId: { type: Schema.Types.ObjectId, ref: 'CreditLot', required: true },
    credits: { type: Number, required: true },
    costBasisMicroRon: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const creditLedgerSchema: Schema<ICreditLedger> = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['grant', 'purchase', 'hold', 'debit', 'release', 'refund', 'expire', 'reversal'],
      required: true,
    },
    /** Signed: positive adds spendable credits, negative reserves or consumes them. */
    credits: {
      type: Number,
      required: true,
    },
    /**
     * Which lots this movement drew from, and at what cost basis. Copied onto the
     * row rather than joined at read time, because the lot's basis must not appear
     * to change retroactively if the lot is ever corrected.
     */
    allocations: {
      type: [allocationSchema],
      default: [],
    },
    reasonCode: {
      type: String,
      required: true,
      index: true,
    },
    actionType: {
      type: String,
      default: null,
    },
    effort: {
      type: String,
      default: null,
    },
    priceListVersion: {
      type: String,
      default: null,
    },
    /** Joins to `costLog`: realized revenue on this side, real spend on the other. */
    jobId: {
      type: String,
      default: null,
      index: true,
    },
    refId: {
      type: String,
      default: null,
    },
    /**
     * Replay guard. Every path that adds credits supplies one, so a retried webhook,
     * a double-submitted form or a re-run scheduled job is a no-op rather than a
     * second grant. Sparse because spends do not need it.
     */
    idempotencyKey: {
      type: String,
      default: null,
    },
    reversalOf: {
      type: Schema.Types.ObjectId,
      ref: 'CreditLedger',
      default: null,
    },
    /** On a hold: the debit or release row that terminated it. */
    settledBy: {
      type: Schema.Types.ObjectId,
      ref: 'CreditLedger',
      default: null,
    },
    note: {
      type: String,
      default: null,
    },
  },
  { timestamps: true, collection: 'credit_ledger' },
);

creditLedgerSchema.index(
  { idempotencyKey: 1 },
  {
    name: 'credit_ledger_idempotency',
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  },
);

creditLedgerSchema.index({ userId: 1, createdAt: -1 }, { name: 'credit_ledger_user_history' });

/** Finds holds still awaiting settlement, for both settlement and the orphan sweep. */
creditLedgerSchema.index(
  { createdAt: 1 },
  {
    name: 'credit_ledger_open_holds',
    partialFilterExpression: { type: 'hold', settledBy: null },
  },
);

export default creditLedgerSchema;
