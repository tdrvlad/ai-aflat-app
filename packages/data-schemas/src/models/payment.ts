import { Model } from 'mongoose';
import paymentSchema, { IPayment } from '~/schema/payment';

/**
 * ai-aflat: payments are keyed by `userId` and every query is already scoped by
 * the owner, so the tenant-isolation plugin is intentionally not applied — the
 * same reasoning as the credit collections.
 */
export function createPaymentModel(mongoose: typeof import('mongoose')): Model<IPayment> {
  return mongoose.models.Payment || mongoose.model<IPayment>('Payment', paymentSchema);
}
