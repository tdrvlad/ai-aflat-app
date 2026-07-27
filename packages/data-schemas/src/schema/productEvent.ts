import { Schema, Document, Types } from 'mongoose';

/**
 * ai-aflat: a product-funnel telemetry row (gate shown, gate converted, consent
 * recorded, question submitted).
 *
 * GDPR invariant: no network identifier here either. `userId` is set only when
 * the event was emitted inside an authenticated request; anonymous events carry
 * no subject at all. `meta` is open by design for small funnel attributes
 * (`{ anon: true }`) — never put request IPs, user agents, or question text in it.
 */
export interface IProductEvent extends Document {
  name: string;
  userId?: Types.ObjectId | null;
  meta?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
}

const productEventSchema: Schema<IProductEvent> = new Schema(
  {
    name: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    meta: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true, collection: 'product_events' },
);

export default productEventSchema;
