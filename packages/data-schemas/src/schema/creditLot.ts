import { Schema, Document, Types } from 'mongoose';

export type CreditLotSource = 'purchase' | 'grant';

/**
 * ai-aflat: a batch of credits entering a user's account, carrying the cost basis
 * that batch was acquired at.
 *
 * Lots exist so that "what did this answer actually earn us" has an answer. A
 * single mutable balance cannot distinguish a credit bought for 0.099 lei from a
 * credit given away for nothing, so it cannot tell us what the free tier or a
 * referral programme costs — which is the whole point of metering.
 *
 * Money is stored as integer **micro-lei** (1 leu = 1_000_000). Floating-point
 * currency drifts, and Decimal128 arithmetic in application code is worse than
 * integers; nothing here needs sub-micro precision.
 */
export interface ICreditLot extends Document {
  userId: Types.ObjectId;
  source: CreditLotSource;
  reasonCode: string;
  creditsGranted: number;
  creditsRemaining: number;
  costBasisMicroRon: number;
  priceListVersion?: string | null;
  expiresAt?: Date | null;
  refId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const creditLotSchema: Schema<ICreditLot> = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: ['purchase', 'grant'],
      required: true,
    },
    /** See the grants table in the design spec; every entry point names itself here. */
    reasonCode: {
      type: String,
      required: true,
      index: true,
    },
    creditsGranted: {
      type: Number,
      required: true,
      min: 1,
    },
    /**
     * Decremented when a hold reserves against this lot and when that hold settles;
     * restored when a hold is released. It is the reserved-and-spent frontier, not
     * merely the spent one, which is what stops two concurrent sessions reserving
     * the same credits.
     */
    creditsRemaining: {
      type: Number,
      required: true,
      min: 0,
    },
    /**
     * NET lei per credit, in micro-lei, after VAT and payment fees. Always 0 for a
     * grant — a given credit realizes no revenue when it is spent, and that zero is
     * exactly what makes giveaway cost measurable.
     */
    costBasisMicroRon: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    /** Price list in force when this lot opened, so a later repricing can grandfather it. */
    priceListVersion: {
      type: String,
      default: null,
    },
    /**
     * Grants may expire; purchases never do. A null expiry on a purchased lot is a
     * deliberate commitment, not an oversight: expiring prepaid balances are a
     * consumer-law problem in the EU and we do not want the argument.
     */
    expiresAt: {
      type: Date,
      default: null,
    },
    refId: {
      type: String,
      default: null,
    },
  },
  { timestamps: true, collection: 'credit_lots' },
);

/**
 * The allocation query: a user's spendable lots, in spend order.
 *
 * Sorting by `costBasisMicroRon` ascending *is* the free-first rule, because every
 * grant is 0 and every purchase is above it. Within grants, soonest-expiring goes
 * first so a user never loses credits they could have spent; within purchases all
 * expiries are null, so the tiebreak falls through to `createdAt` (FIFO).
 */
creditLotSchema.index(
  { userId: 1, costBasisMicroRon: 1, expiresAt: 1, createdAt: 1 },
  {
    name: 'credit_lots_allocation',
    partialFilterExpression: { creditsRemaining: { $gt: 0 } },
  },
);

export default creditLotSchema;
