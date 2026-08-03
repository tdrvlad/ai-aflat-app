import { Model } from 'mongoose';
import costLogSchema, { ICostLog } from '~/schema/costLog';

/**
 * ai-aflat: operational cost telemetry, aggregated across all users for margin
 * reporting rather than read per tenant, so the tenant-isolation plugin is
 * intentionally not applied.
 */
export function createCostLogModel(mongoose: typeof import('mongoose')): Model<ICostLog> {
  return mongoose.models.CostLog || mongoose.model<ICostLog>('CostLog', costLogSchema);
}
