import { Schema, Document, Types } from 'mongoose';

/**
 * ai-aflat: a derived snapshot of a user's credit position.
 *
 * The ledger is truth; this is speed. Every read path uses it and no write path
 * trusts it: mutations go through an atomic `findOneAndUpdate` guarded on
 * `version`, so two browser tabs sending at the same moment cannot both pass the
 * same balance check. A reconciliation job rebuilds these from the ledger and
 * alerts on drift.
 *
 * Deliberately NOT LibreChat's `Balance`: that one is denominated in dollar-mills
 * and auto-debited by upstream's token-spend machinery. Two units behind one
 * mutable number is how billing bugs are born.
 */
export interface ICreditBalance extends Document {
  userId: Types.ObjectId;
  available: number;
  reserved: number;
  version: number;
  lastRefillAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const creditBalanceSchema: Schema<ICreditBalance> = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    /** Spendable now. Excludes anything held against an in-flight job. */
    available: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    /** Held against jobs that have not yet settled or released. */
    reserved: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    version: {
      type: Number,
      required: true,
      default: 0,
    },
    /** Drives the monthly refill job; null until the first refill lands. */
    lastRefillAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true, collection: 'credit_balances' },
);

export default creditBalanceSchema;
