import { Model } from 'mongoose';
import anonQuestionSchema, { IAnonQuestion } from '~/schema/anonQuestion';

/**
 * ai-aflat: the tenant-isolation plugin is intentionally NOT applied.
 * An anonymous question is created on an unauthenticated request, so no tenant
 * context exists at write time; the plugin would stamp/filter a `tenantId` the
 * writer can never supply and the later authenticated `claim` read (which
 * DOES run inside a tenant context) would then never find the document.
 */
export function createAnonQuestionModel(mongoose: typeof import('mongoose')): Model<IAnonQuestion> {
  return (
    mongoose.models.AnonQuestion ||
    mongoose.model<IAnonQuestion>('AnonQuestion', anonQuestionSchema)
  );
}
