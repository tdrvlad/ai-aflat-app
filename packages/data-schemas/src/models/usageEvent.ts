import { Model } from 'mongoose';
import usageEventSchema, { IUsageEvent } from '~/schema/usageEvent';

/**
 * ai-aflat: usage telemetry is a cost ledger keyed by `userId` — like
 * ConsentLog and AuditLog, every query is already scoped by the subject, so
 * the tenant-isolation plugin is intentionally not applied.
 */
export function createUsageEventModel(mongoose: typeof import('mongoose')): Model<IUsageEvent> {
  return mongoose.models.UsageEvent || mongoose.model<IUsageEvent>('UsageEvent', usageEventSchema);
}
