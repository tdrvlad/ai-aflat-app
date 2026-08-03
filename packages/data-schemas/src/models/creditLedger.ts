import { Model } from 'mongoose';
import creditLedgerSchema, { ICreditLedger } from '~/schema/creditLedger';

/**
 * ai-aflat: the credit ledger is scoped by `userId` on every query, so the
 * tenant-isolation plugin is intentionally not applied.
 */
export function createCreditLedgerModel(mongoose: typeof import('mongoose')): Model<ICreditLedger> {
  return (
    mongoose.models.CreditLedger ||
    mongoose.model<ICreditLedger>('CreditLedger', creditLedgerSchema)
  );
}
