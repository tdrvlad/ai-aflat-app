import { Model } from 'mongoose';
import paymentEventSchema, { IPaymentEvent } from '~/schema/paymentEvent';

/**
 * ai-aflat: webhook events are not user-scoped — they arrive from Stripe before
 * we know who they belong to — so the tenant-isolation plugin does not apply.
 */
export function createPaymentEventModel(mongoose: typeof import('mongoose')): Model<IPaymentEvent> {
  return (
    mongoose.models.PaymentEvent ||
    mongoose.model<IPaymentEvent>('PaymentEvent', paymentEventSchema)
  );
}
