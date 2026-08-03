import { Model } from 'mongoose';
import creditBalanceSchema, { ICreditBalance } from '~/schema/creditBalance';

/**
 * ai-aflat: one document per user, always read and written by `userId`, so the
 * tenant-isolation plugin is intentionally not applied.
 */
export function createCreditBalanceModel(
  mongoose: typeof import('mongoose'),
): Model<ICreditBalance> {
  return (
    mongoose.models.CreditBalance ||
    mongoose.model<ICreditBalance>('CreditBalance', creditBalanceSchema)
  );
}
