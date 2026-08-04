import { Schema, Document, Types } from 'mongoose';

/**
 * ai-aflat: every Stripe webhook event we have ever seen, append-only.
 *
 * `grantCredits` already refuses a replayed grant by idempotency key, so this is
 * not the guard for double-granting. It exists for the events that grant
 * *nothing* — `payment_intent.payment_failed`, `charge.refunded`,
 * `charge.dispute.created` — which have no idempotency key to collide on and
 * would otherwise be reprocessed silently on every Stripe retry.
 *
 * It is also the audit trail. When someone asks why a balance looks the way it
 * does, the answer has to be reconstructable from what Stripe actually sent, not
 * from what we believe we did with it.
 *
 * Insertion is guarded by the unique index on `eventId`: a duplicate key error on
 * insert *is* the replay signal, which makes the check atomic rather than a
 * read-then-write race across concurrent webhook deliveries.
 */
export interface IPaymentEvent extends Document {
  eventId: string;
  type: string;
  paymentId?: Types.ObjectId | null;
  handled: boolean;
  error?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const paymentEventSchema: Schema<IPaymentEvent> = new Schema(
  {
    /** Stripe's event id. The unique index here is the replay guard. */
    eventId: {
      type: String,
      required: true,
      unique: true,
    },
    type: {
      type: String,
      required: true,
      index: true,
    },
    paymentId: {
      type: Schema.Types.ObjectId,
      ref: 'Payment',
      default: null,
    },
    /**
     * False means we recorded the event but failed to process it. Stripe retries
     * on a non-2xx, so a row with `handled: false` and an `error` is a genuine
     * alert, not merely a log line.
     */
    handled: {
      type: Boolean,
      required: true,
      default: false,
      index: true,
    },
    error: {
      type: String,
      default: null,
    },
  },
  /* Named explicitly, like every other ai-aflat collection — Mongoose's automatic
     pluralisation would give `paymentevents`, breaking the snake_case convention. */
  { timestamps: true, collection: 'payment_events' },
);

export default paymentEventSchema;
