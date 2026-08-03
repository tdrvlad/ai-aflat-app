import { Model } from 'mongoose';
import creditLotSchema, { ICreditLot } from '~/schema/creditLot';

/**
 * ai-aflat: credit lots are keyed by `userId` and every query is already scoped by
 * the owner, so the tenant-isolation plugin is intentionally not applied.
 */
export function createCreditLotModel(mongoose: typeof import('mongoose')): Model<ICreditLot> {
  return mongoose.models.CreditLot || mongoose.model<ICreditLot>('CreditLot', creditLotSchema);
}
