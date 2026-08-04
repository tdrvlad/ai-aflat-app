import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods, type PaymentMethods } from '@librechat/data-schemas';
import { MICRO_RON } from './basis';
import { CheckoutError, createCheckoutSession } from './checkout';

const mockSessionCreate = jest.fn();
jest.mock('./client', () => ({
  getStripe: () => ({
    checkout: { sessions: { create: (...args: unknown[]) => mockSessionCreate(...args) } },
  }),
  resetStripeClient: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let methods: PaymentMethods;

const userId = () => new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  methods = createMethods(mongoose) as PaymentMethods;
  await mongoose.models.Payment.syncIndexes();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  jest.clearAllMocks();
  mockSessionCreate.mockResolvedValue({ id: 'cs_test_1', url: 'https://checkout.stripe.com/x' });
  await mongoose.models.Payment.deleteMany({});
});

describe('payments/checkout createCheckoutSession', () => {
  it('opens a session and records the payment', async () => {
    const result = await createCheckoutSession(methods, {
      userId: userId(),
      bundleId: 'uzual',
      consentImmediatePerformance: true,
    });

    expect(result.url).toBe('https://checkout.stripe.com/x');
    const payment = await methods.findPaymentById(result.paymentId);
    expect(payment?.credits).toBe(800);
    expect(payment?.grossMicroRon).toBe(99 * MICRO_RON);
    expect(payment?.status).toBe('pending');
    expect(payment?.stripeSessionId).toBe('cs_test_1');
  });

  /**
   * The reason this route exists rather than the frontend calling Stripe: a client
   * that can name its own price can buy 2500 credits for a leu.
   */
  it('prices from the server price list, ignoring anything the client sends', async () => {
    await createCheckoutSession(methods, {
      userId: userId(),
      bundleId: 'start',
      consentImmediatePerformance: true,
      /* A hostile client would send an amount here; there is nowhere for it to land. */
    } as Parameters<typeof createCheckoutSession>[1]);

    const [params] = mockSessionCreate.mock.calls[0];
    expect(params.line_items[0].price_data.unit_amount).toBe(2900);
    expect(params.line_items[0].price_data.currency).toBe('ron');
  });

  it('refuses without consent to immediate performance', async () => {
    await expect(
      createCheckoutSession(methods, {
        userId: userId(),
        bundleId: 'uzual',
        consentImmediatePerformance: false,
      }),
    ).rejects.toThrow(CheckoutError);

    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(await mongoose.models.Payment.countDocuments({})).toBe(0);
  });

  it('refuses an unknown bundle', async () => {
    await expect(
      createCheckoutSession(methods, {
        userId: userId(),
        bundleId: 'free-money',
        consentImmediatePerformance: true,
      }),
    ).rejects.toMatchObject({ code: 'unknown_bundle' });

    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  it('stores the consent version, not merely that consent happened', async () => {
    const result = await createCheckoutSession(methods, {
      userId: userId(),
      bundleId: 'extins',
      consentImmediatePerformance: true,
    });

    const payment = await methods.findPaymentById(result.paymentId);
    expect(payment?.consentVersion).toMatch(/withdrawal-waiver-/);
    expect(payment?.consentAt).toBeInstanceOf(Date);
  });

  it('prices VAT-inclusive, as Romanian law requires', async () => {
    await createCheckoutSession(methods, {
      userId: userId(),
      bundleId: 'uzual',
      consentImmediatePerformance: true,
    });

    const [params] = mockSessionCreate.mock.calls[0];
    expect(params.line_items[0].price_data.tax_behavior).toBe('inclusive');
  });

  /**
   * Omitting `payment_method_types` is what lets the Stripe Dashboard decide which
   * methods appear — and therefore what makes enabling Revolut Pay a toggle rather
   * than a deploy. Pinning it here would silently override the dashboard.
   */
  it('leaves the payment method set to the dashboard', async () => {
    await createCheckoutSession(methods, {
      userId: userId(),
      bundleId: 'start',
      consentImmediatePerformance: true,
    });

    const [params] = mockSessionCreate.mock.calls[0];
    expect(params.payment_method_types).toBeUndefined();
  });

  it('carries the payment id into metadata so the webhook never has to guess', async () => {
    const result = await createCheckoutSession(methods, {
      userId: userId(),
      bundleId: 'uzual',
      consentImmediatePerformance: true,
    });

    const [params] = mockSessionCreate.mock.calls[0];
    expect(params.metadata.paymentId).toBe(result.paymentId);
    expect(params.client_reference_id).toBe(result.paymentId);
  });
});
