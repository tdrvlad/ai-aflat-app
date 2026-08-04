import { Schema, Document, Types } from 'mongoose';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'expired';

/**
 * ai-aflat: one attempted purchase of a credit bundle.
 *
 * This row exists for three reasons, only one of which is Stripe's business.
 *
 * It is the **withdrawal-right record**. EU digital content carries a 14-day
 * withdrawal right unless the buyer explicitly consents to immediate performance
 * and acknowledges losing it. Stripe has no field for that, so it is ours to
 * capture and ours to produce if it is ever challenged — hence `consentVersion`
 * and `consentAt`, written before the Stripe session is created rather than after
 * payment succeeds.
 *
 * It is the **support surface**: what someone tried to buy, when, and what
 * happened, without reading Stripe's dashboard.
 *
 * And it is the **reconciliation handle** joining a Stripe session to the credit
 * lot it opened.
 *
 * `status` is emphatically **not an authority on anyone's balance**. The credit
 * ledger is the only source of truth for what a user holds; this field is a
 * convenience for the wallet UI and for support, and code that grants or spends
 * must never read it.
 *
 * Money is integer **micro-lei** (1 leu = 1_000_000), matching `creditLot`.
 * Splitting currency units across collections is how billing bugs are born.
 */
export interface IPayment extends Document {
  userId: Types.ObjectId;
  bundleId: string;
  credits: number;
  grossMicroRon: number;
  priceListVersion: string;
  status: PaymentStatus;
  stripeSessionId?: string | null;
  stripePaymentIntent?: string | null;
  consentVersion: string;
  consentAt: Date;
  lotId?: Types.ObjectId | null;
  costBasisPending: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const paymentSchema: Schema<IPayment> = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    /** Validated against `pricing.ts` server-side. A client-sent amount is never trusted. */
    bundleId: {
      type: String,
      required: true,
    },
    credits: {
      type: Number,
      required: true,
      min: 1,
    },
    /** VAT-inclusive, as Romanian law requires prices to be displayed. */
    grossMicroRon: {
      type: Number,
      required: true,
      min: 0,
    },
    /**
     * The price list in force when this was bought. Purchased credits are
     * grandfathered on it, so a later reprice cannot retroactively devalue them.
     */
    priceListVersion: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded', 'expired'],
      required: true,
      default: 'pending',
      index: true,
    },
    /**
     * Sparse-unique: a row exists before the Stripe session does, so nulls must be
     * allowed to coexist while completed sessions stay unique.
     */
    stripeSessionId: {
      type: String,
      default: null,
      unique: true,
      sparse: true,
    },
    stripePaymentIntent: {
      type: String,
      default: null,
    },
    /**
     * The exact version of the withdrawal-right text the buyer was shown. Storing
     * a boolean would be worthless — the question a regulator asks is *what did
     * they agree to*, and the wording changes over time.
     */
    consentVersion: {
      type: String,
      required: true,
    },
    consentAt: {
      type: Date,
      required: true,
    },
    /** Set once the webhook has granted. Joins this row to the credit lot it opened. */
    lotId: {
      type: Schema.Types.ObjectId,
      ref: 'CreditLot',
      default: null,
    },
    /**
     * True when credits were granted against an *estimated* cost basis because
     * Stripe's balance transaction was not yet available. The reconciliation pass
     * clears it once the real fee is known. Credits are never withheld over this:
     * a user must not wait on our accounting.
     */
    costBasisPending: {
      type: Boolean,
      required: true,
      default: false,
      index: true,
    },
  },
  /* Named explicitly, like every other ai-aflat collection. */
  { timestamps: true, collection: 'payments' },
);

export default paymentSchema;
