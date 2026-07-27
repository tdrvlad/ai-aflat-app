import { Model } from 'mongoose';
import productEventSchema, { IProductEvent } from '~/schema/productEvent';

/**
 * ai-aflat: product events are written from both authenticated and anonymous
 * requests, so — as with AnonQuestion — the tenant-isolation plugin is
 * intentionally not applied; an anonymous emit has no tenant context to stamp.
 */
export function createProductEventModel(mongoose: typeof import('mongoose')): Model<IProductEvent> {
  return (
    mongoose.models.ProductEvent ||
    mongoose.model<IProductEvent>('ProductEvent', productEventSchema)
  );
}
