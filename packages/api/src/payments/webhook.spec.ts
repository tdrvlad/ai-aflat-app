import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods } from '@librechat/data-schemas';
import type { ICreditLot, IPaymentEvent } from '@librechat/data-schemas';
import type { Model } from 'mongoose';
import type Stripe from 'stripe';
import { PRICE_LIST_VERSION } from '../credits/pricing';
import { MICRO_RON } from './basis';
import { processEvent, type PaymentDeps } from './webhook';

/**
 * Only Stripe's HTTP surface is mocked — everything else runs against a real
 * in-memory Mongo, so these tests exercise the actual ledger, the actual unique
 * indexes and the actual idempotency behaviour rather than a description of them.
 */
const mockRetrievePaymentIntent = jest.fn();
jest.mock('./client', () => ({
  getStripe: () => ({
    paymentIntents: { retrieve: (...args: unknown[]) => mockRetrievePaymentIntent(...args) },
  }),
  resetStripeClient: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let methods: PaymentDeps;

const userId = () => new mongoose.Types.ObjectId().toString();

/** `mongoose.models.X` is untyped; these keep the assertions type-checked. */
const lots = () => mongoose.models.CreditLot as Model<ICreditLot>;
const paymentEvents = () => mongoose.models.PaymentEvent as Model<IPaymentEvent>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  methods = createMethods(mongoose) as PaymentDeps;
  await Promise.all([
    mongoose.models.CreditLedger.syncIndexes(),
    mongoose.models.Payment.syncIndexes(),
    mongoose.models.PaymentEvent.syncIndexes(),
  ]);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  jest.clearAllMocks();
  process.env.AFLAT_VAT_RATE = '0.21';
  await Promise.all([
    mongoose.models.CreditLot.deleteMany({}),
    mongoose.models.CreditLedger.deleteMany({}),
    mongoose.models.CreditBalance.deleteMany({}),
    mongoose.models.Payment.deleteMany({}),
    mongoose.models.PaymentEvent.deleteMany({}),
  ]);
});

async function seedPayment(user: string) {
  return methods.createPayment({
    userId: user,
    bundleId: 'uzual',
    credits: 800,
    grossMicroRon: 99 * MICRO_RON,
    priceListVersion: PRICE_LIST_VERSION,
    consentVersion: 'withdrawal-waiver-2026-08-04',
    consentAt: new Date(),
  });
}

function completedEvent(paymentId: string, eventId = 'evt_1'): Stripe.Event {
  return {
    id: eventId,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_1',
        payment_status: 'paid',
        payment_intent: 'pi_test_1',
        client_reference_id: paymentId,
        metadata: { paymentId },
      },
    },
  } as unknown as Stripe.Event;
}

function withBalanceTransaction(feeBani: number) {
  mockRetrievePaymentIntent.mockResolvedValue({
    latest_charge: { balance_transaction: { fee: feeBani } },
  });
}

describe('payments/webhook processEvent', () => {
  it('grants the bundle credits on a completed checkout', async () => {
    const user = userId();
    const payment = await seedPayment(user);
    withBalanceTransaction(250);

    const result = await processEvent(methods, completedEvent(String(payment._id)));

    expect(result.processed).toBe(true);
    const balance = await methods.getCreditBalance(user);
    expect(balance.available).toBe(800);
  });

  it('is a no-op on replay — Stripe retries, and a retry must not pay twice', async () => {
    const user = userId();
    const payment = await seedPayment(user);
    withBalanceTransaction(250);

    const event = completedEvent(String(payment._id));
    await processEvent(methods, event);
    const second = await processEvent(methods, event);

    expect(second.processed).toBe(false);
    const balance = await methods.getCreditBalance(user);
    expect(balance.available).toBe(800);
  });

  it('records the real Stripe fee as the lot cost basis', async () => {
    const user = userId();
    const payment = await seedPayment(user);
    /* 3.00 lei fee on a 99 lei gross. */
    withBalanceTransaction(300);

    await processEvent(methods, completedEvent(String(payment._id)));

    const lot = await lots().findOne({ userId: payment.userId }).lean();
    const vat = Math.round((99 * MICRO_RON * 0.21) / 1.21);
    const expected = Math.floor((99 * MICRO_RON - 3 * MICRO_RON - vat) / 800);
    expect(lot?.costBasisMicroRon).toBe(expected);
    expect(lot?.source).toBe('purchase');
  });

  it('grants immediately on an estimated basis when the balance transaction is not ready', async () => {
    const user = userId();
    const payment = await seedPayment(user);
    /* Stripe frequently has no balance transaction yet at session completion. */
    mockRetrievePaymentIntent.mockResolvedValue({ latest_charge: null });

    await processEvent(methods, completedEvent(String(payment._id)));

    const balance = await methods.getCreditBalance(user);
    expect(balance.available).toBe(800);

    const stored = await methods.findPaymentById(payment._id);
    expect(stored?.costBasisPending).toBe(true);
  });

  it('never expires purchased credits', async () => {
    const payment = await seedPayment(userId());
    withBalanceTransaction(250);

    await processEvent(methods, completedEvent(String(payment._id)));

    const lot = await lots().findOne({ userId: payment.userId }).lean();
    expect(lot?.expiresAt).toBeNull();
  });

  it('grants nothing when the session is not actually paid', async () => {
    const user = userId();
    const payment = await seedPayment(user);
    const event = completedEvent(String(payment._id));
    (event.data.object as Stripe.Checkout.Session).payment_status = 'unpaid';

    const result = await processEvent(methods, event);

    expect(result.processed).toBe(false);
    const balance = await methods.getCreditBalance(user);
    expect(balance.available).toBe(0);
  });

  it('grants nothing on a failed payment intent', async () => {
    const user = userId();
    const payment = await seedPayment(user);

    await processEvent(methods, {
      id: 'evt_failed',
      type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_x', metadata: { paymentId: String(payment._id) } } },
    } as unknown as Stripe.Event);

    const balance = await methods.getCreditBalance(user);
    expect(balance.available).toBe(0);
    const stored = await methods.findPaymentById(payment._id);
    expect(stored?.status).toBe('failed');
  });

  it('records a refund without clawing back spent credits', async () => {
    const user = userId();
    const payment = await seedPayment(user);
    withBalanceTransaction(250);
    await processEvent(methods, completedEvent(String(payment._id)));

    await processEvent(methods, {
      id: 'evt_refund',
      type: 'charge.refunded',
      data: { object: { id: 'ch_x', metadata: { paymentId: String(payment._id) } } },
    } as unknown as Stripe.Event);

    const stored = await methods.findPaymentById(payment._id);
    expect(stored?.status).toBe('refunded');
    /* Reversal is a support judgement — the balance is deliberately untouched. */
    const balance = await methods.getCreditBalance(user);
    expect(balance.available).toBe(800);
  });

  it('ignores event types it has no handler for', async () => {
    const result = await processEvent(methods, {
      id: 'evt_other',
      type: 'customer.created',
      data: { object: {} },
    } as unknown as Stripe.Event);

    expect(result.processed).toBe(false);
  });

  it('records the failure and rethrows so Stripe retries', async () => {
    const event = completedEvent(new mongoose.Types.ObjectId().toString(), 'evt_missing');

    await expect(processEvent(methods, event)).rejects.toThrow(/No payment row/);

    const stored = await paymentEvents().findOne({ eventId: 'evt_missing' }).lean();
    expect(stored?.handled).toBe(false);
    expect(stored?.error).toMatch(/No payment row/);
  });
});
