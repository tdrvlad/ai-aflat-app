import { Model } from 'mongoose';
import consentLogSchema, { IConsentLog } from '~/schema/consentLog';

/**
 * ai-aflat: consent records are a compliance ledger keyed by `userId` — like
 * AuditLog, every query is already scoped by the subject, so the
 * tenant-isolation plugin is intentionally not applied.
 */
export function createConsentLogModel(mongoose: typeof import('mongoose')): Model<IConsentLog> {
  return mongoose.models.ConsentLog || mongoose.model<IConsentLog>('ConsentLog', consentLogSchema);
}
