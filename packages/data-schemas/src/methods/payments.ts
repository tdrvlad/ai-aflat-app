import type { Model, Types } from 'mongoose';
import type { IPayment, PaymentStatus } from '~/schema/payment';
import type { IPaymentEvent } from '~/schema/paymentEvent';

/**
 * ai-aflat: the database primitives behind purchasing.
 *
 * These deliberately know nothing about Stripe. Stripe's shapes stay in
 * `packages/api/src/payments`, and this layer sees only ids and amounts — which is
 * what would let a second processor arrive later without touching the ledger.
 */

export interface CreatePaymentParams {
  userId: string | Types.ObjectId;
  bundleId: string;
  credits: number;
  grossMicroRon: number;
  priceListVersion: string;
  consentVersion: string;
  consentAt: Date;
}

export interface MarkPaymentPaidParams {
  paymentId: string | Types.ObjectId;
  lotId: string | Types.ObjectId;
  stripePaymentIntent?: string | null;
  costBasisPending: boolean;
}

export interface PaymentMethods {
  createPayment: (params: CreatePaymentParams) => Promise<IPayment>;
  attachStripeSession: (
    paymentId: string | Types.ObjectId,
    sessionId: string,
  ) => Promise<IPayment | null>;
  findPaymentById: (paymentId: string | Types.ObjectId) => Promise<IPayment | null>;
  findPaymentBySessionId: (sessionId: string) => Promise<IPayment | null>;
  markPaymentPaid: (params: MarkPaymentPaidParams) => Promise<IPayment | null>;
  setPaymentStatus: (
    paymentId: string | Types.ObjectId,
    status: PaymentStatus,
  ) => Promise<IPayment | null>;
  claimPaymentEvent: (eventId: string, type: string) => Promise<boolean>;
  completePaymentEvent: (
    eventId: string,
    handled: boolean,
    error?: string | null,
  ) => Promise<IPaymentEvent | null>;
  listPendingCostBasis: (limit?: number) => Promise<IPayment[]>;
  clearCostBasisPending: (paymentId: string | Types.ObjectId) => Promise<IPayment | null>;
}

export function createPaymentMethods(mongoose: typeof import('mongoose')): PaymentMethods {
  const getPayment = () => mongoose.models.Payment as Model<IPayment>;
  const getPaymentEvent = () => mongoose.models.PaymentEvent as Model<IPaymentEvent>;

  async function createPayment(params: CreatePaymentParams): Promise<IPayment> {
    return getPayment().create({ ...params, status: 'pending', costBasisPending: false });
  }

  async function attachStripeSession(
    paymentId: string | Types.ObjectId,
    sessionId: string,
  ): Promise<IPayment | null> {
    return getPayment().findByIdAndUpdate(
      paymentId,
      { $set: { stripeSessionId: sessionId } },
      { new: true },
    );
  }

  async function findPaymentById(paymentId: string | Types.ObjectId): Promise<IPayment | null> {
    return getPayment().findById(paymentId);
  }

  async function findPaymentBySessionId(sessionId: string): Promise<IPayment | null> {
    return getPayment().findOne({ stripeSessionId: sessionId });
  }

  async function markPaymentPaid({
    paymentId,
    lotId,
    stripePaymentIntent = null,
    costBasisPending,
  }: MarkPaymentPaidParams): Promise<IPayment | null> {
    return getPayment().findByIdAndUpdate(
      paymentId,
      { $set: { status: 'paid', lotId, stripePaymentIntent, costBasisPending } },
      { new: true },
    );
  }

  async function setPaymentStatus(
    paymentId: string | Types.ObjectId,
    status: PaymentStatus,
  ): Promise<IPayment | null> {
    return getPayment().findByIdAndUpdate(paymentId, { $set: { status } }, { new: true });
  }

  /**
   * Claims a webhook event for processing, returning false if it has been seen.
   *
   * The atomicity matters: Stripe retries, and two deliveries of the same event can
   * be in flight simultaneously. A read-then-write check would let both pass. Here
   * the unique index on `eventId` decides the winner — a duplicate-key error *is*
   * the replay signal, so exactly one caller is ever told to proceed.
   */
  async function claimPaymentEvent(eventId: string, type: string): Promise<boolean> {
    try {
      await getPaymentEvent().create({ eventId, type, handled: false });
      return true;
    } catch (error) {
      const isDuplicate =
        typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
      if (isDuplicate) {
        return false;
      }
      throw error;
    }
  }

  async function completePaymentEvent(
    eventId: string,
    handled: boolean,
    error: string | null = null,
  ): Promise<IPaymentEvent | null> {
    return getPaymentEvent().findOneAndUpdate(
      { eventId },
      { $set: { handled, error } },
      { new: true },
    );
  }

  /** Feeds the reconciliation pass that replaces estimated cost bases with real ones. */
  async function listPendingCostBasis(limit = 100): Promise<IPayment[]> {
    return getPayment().find({ status: 'paid', costBasisPending: true }).limit(limit);
  }

  async function clearCostBasisPending(
    paymentId: string | Types.ObjectId,
  ): Promise<IPayment | null> {
    return getPayment().findByIdAndUpdate(
      paymentId,
      { $set: { costBasisPending: false } },
      { new: true },
    );
  }

  return {
    createPayment,
    attachStripeSession,
    findPaymentById,
    findPaymentBySessionId,
    markPaymentPaid,
    setPaymentStatus,
    claimPaymentEvent,
    completePaymentEvent,
    listPendingCostBasis,
    clearCostBasisPending,
  };
}

export type { IPayment, PaymentStatus } from '~/schema/payment';
export type { IPaymentEvent } from '~/schema/paymentEvent';
