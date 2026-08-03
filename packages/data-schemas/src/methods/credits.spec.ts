import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { ICreditBalance } from '~/schema/creditBalance';
import type { ICreditLedger } from '~/schema/creditLedger';
import type { ICreditLot } from '~/schema/creditLot';
import { createCreditMethods, InsufficientCreditsError, type CreditMethods } from './credits';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let credits: CreditMethods;
let CreditLot: mongoose.Model<ICreditLot>;
let CreditLedger: mongoose.Model<ICreditLedger>;
let CreditBalance: mongoose.Model<ICreditBalance>;

const userId = () => new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  credits = createCreditMethods(mongoose);
  CreditLot = mongoose.models.CreditLot as mongoose.Model<ICreditLot>;
  CreditLedger = mongoose.models.CreditLedger as mongoose.Model<ICreditLedger>;
  CreditBalance = mongoose.models.CreditBalance as mongoose.Model<ICreditBalance>;
  await CreditLedger.syncIndexes();
  await CreditLot.syncIndexes();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    CreditLot.deleteMany({}),
    CreditLedger.deleteMany({}),
    CreditBalance.deleteMany({}),
  ]);
});

/** A purchased lot, so tests can distinguish paid credits from granted ones. */
async function purchase(user: string, amount: number, costBasisMicroRon = 99_000) {
  return credits.grantCredits({
    userId: user,
    credits: amount,
    reasonCode: 'purchase',
    source: 'purchase',
    costBasisMicroRon,
  });
}

describe('grantCredits', () => {
  it('opens a lot with a zero cost basis and makes credits available', async () => {
    const user = userId();
    await credits.grantCredits({ userId: user, credits: 100, reasonCode: 'signup_bonus' });

    const lot = await CreditLot.findOne({ userId: user });
    expect(lot?.creditsGranted).toBe(100);
    expect(lot?.creditsRemaining).toBe(100);
    expect(lot?.costBasisMicroRon).toBe(0);
    expect(lot?.source).toBe('grant');

    await expect(credits.getCreditBalance(user)).resolves.toEqual({
      available: 100,
      reserved: 0,
    });
  });

  it('is a no-op when the same idempotency key is replayed', async () => {
    const user = userId();
    const key = `signup_bonus:${user}`;

    const first = await credits.grantCredits({
      userId: user,
      credits: 100,
      reasonCode: 'signup_bonus',
      idempotencyKey: key,
    });
    const second = await credits.grantCredits({
      userId: user,
      credits: 100,
      reasonCode: 'signup_bonus',
      idempotencyKey: key,
    });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    await expect(credits.getCreditBalance(user)).resolves.toEqual({
      available: 100,
      reserved: 0,
    });
    expect(await CreditLot.countDocuments({ userId: user })).toBe(1);
  });

  it('rejects a non-positive amount', async () => {
    await expect(
      credits.grantCredits({ userId: userId(), credits: 0, reasonCode: 'signup_bonus' }),
    ).rejects.toThrow(/positive/);
  });
});

describe('allocation order', () => {
  it('spends granted credits before purchased ones', async () => {
    const user = userId();
    await purchase(user, 100);
    await credits.grantCredits({ userId: user, credits: 20, reasonCode: 'monthly_refill' });

    const hold = await credits.holdCredits({
      userId: user,
      credits: 25,
      reasonCode: 'simple_question',
      actionType: 'simple_question',
      effort: 'high',
      jobId: 'job-1',
    });

    const byBasis = new Map(
      hold.allocations.map((allocation) => [allocation.costBasisMicroRon, allocation.credits]),
    );
    expect(byBasis.get(0)).toBe(20);
    expect(byBasis.get(99_000)).toBe(5);
  });

  it('draws older grants first when several are free', async () => {
    const user = userId();
    const older = await credits.grantCredits({
      userId: user,
      credits: 10,
      reasonCode: 'signup_bonus',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    await credits.grantCredits({
      userId: user,
      credits: 10,
      reasonCode: 'monthly_refill',
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });

    const hold = await credits.holdCredits({
      userId: user,
      credits: 10,
      reasonCode: 'simple_question',
      actionType: 'simple_question',
      effort: 'medium',
      jobId: 'job-2',
    });

    expect(hold.allocations).toHaveLength(1);
    expect(String(hold.allocations[0].lotId)).toBe(String(older?.allocations[0].lotId));
  });

  it('ignores expired lots', async () => {
    const user = userId();
    await credits.grantCredits({
      userId: user,
      credits: 50,
      reasonCode: 'monthly_refill',
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(
      credits.holdCredits({
        userId: user,
        credits: 5,
        reasonCode: 'simple_question',
        actionType: 'simple_question',
        effort: 'low',
        jobId: 'job-3',
      }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
  });
});

describe('holdCredits', () => {
  it('moves credits from available to reserved without spending them', async () => {
    const user = userId();
    await credits.grantCredits({ userId: user, credits: 100, reasonCode: 'signup_bonus' });

    await credits.holdCredits({
      userId: user,
      credits: 20,
      reasonCode: 'simple_question',
      actionType: 'simple_question',
      effort: 'high',
      jobId: 'job-4',
    });

    await expect(credits.getCreditBalance(user)).resolves.toEqual({
      available: 80,
      reserved: 20,
    });
  });

  it('refuses when the balance is short and strands nothing', async () => {
    const user = userId();
    await credits.grantCredits({ userId: user, credits: 15, reasonCode: 'monthly_refill' });

    await expect(
      credits.holdCredits({
        userId: user,
        credits: 20,
        reasonCode: 'simple_question',
        actionType: 'simple_question',
        effort: 'high',
        jobId: 'job-5',
      }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);

    const lot = await CreditLot.findOne({ userId: user });
    expect(lot?.creditsRemaining).toBe(15);
    expect(await CreditLedger.countDocuments({ userId: user, type: 'hold' })).toBe(0);
  });

  it('cannot be overdrawn by concurrent requests', async () => {
    const user = userId();
    await credits.grantCredits({ userId: user, credits: 20, reasonCode: 'signup_bonus' });

    const attempts = await Promise.allSettled(
      Array.from({ length: 4 }, (_, index) =>
        credits.holdCredits({
          userId: user,
          credits: 10,
          reasonCode: 'simple_question',
          actionType: 'simple_question',
          effort: 'medium',
          jobId: `concurrent-${index}`,
        }),
      ),
    );

    const succeeded = attempts.filter((attempt) => attempt.status === 'fulfilled');
    expect(succeeded).toHaveLength(2);

    const lots = await CreditLot.find({ userId: user });
    const remaining = lots.reduce((sum, lot) => sum + lot.creditsRemaining, 0);
    expect(remaining).toBe(0);
  });
});

describe('settleHold', () => {
  it('converts a hold into a debit and clears the reservation', async () => {
    const user = userId();
    await credits.grantCredits({ userId: user, credits: 100, reasonCode: 'signup_bonus' });
    const hold = await credits.holdCredits({
      userId: user,
      credits: 10,
      reasonCode: 'simple_question',
      actionType: 'simple_question',
      effort: 'medium',
      jobId: 'job-6',
    });

    const debit = await credits.settleHold(hold._id as mongoose.Types.ObjectId);

    expect(debit?.type).toBe('debit');
    expect(debit?.credits).toBe(-10);
    await expect(credits.getCreditBalance(user)).resolves.toEqual({
      available: 90,
      reserved: 0,
    });
  });

  it('cannot settle the same hold twice', async () => {
    const user = userId();
    await credits.grantCredits({ userId: user, credits: 100, reasonCode: 'signup_bonus' });
    const hold = await credits.holdCredits({
      userId: user,
      credits: 10,
      reasonCode: 'simple_question',
      actionType: 'simple_question',
      effort: 'medium',
      jobId: 'job-7',
    });

    await credits.settleHold(hold._id as mongoose.Types.ObjectId);
    const second = await credits.settleHold(hold._id as mongoose.Types.ObjectId);

    expect(second).toBeNull();
    await expect(credits.getCreditBalance(user)).resolves.toEqual({
      available: 90,
      reserved: 0,
    });
  });
});

describe('releaseHold', () => {
  it('returns credits exactly, to the same lots', async () => {
    const user = userId();
    await credits.grantCredits({ userId: user, credits: 20, reasonCode: 'monthly_refill' });
    await purchase(user, 100);

    const hold = await credits.holdCredits({
      userId: user,
      credits: 25,
      reasonCode: 'simple_question',
      actionType: 'simple_question',
      effort: 'high',
      jobId: 'job-8',
    });
    await credits.releaseHold(hold._id as mongoose.Types.ObjectId, 'not_answered:failed');

    await expect(credits.getCreditBalance(user)).resolves.toEqual({
      available: 120,
      reserved: 0,
    });

    const grantLot = await CreditLot.findOne({ userId: user, source: 'grant' });
    const purchaseLot = await CreditLot.findOne({ userId: user, source: 'purchase' });
    expect(grantLot?.creditsRemaining).toBe(20);
    expect(purchaseLot?.creditsRemaining).toBe(100);
  });

  it('cannot release a settled hold', async () => {
    const user = userId();
    await credits.grantCredits({ userId: user, credits: 50, reasonCode: 'signup_bonus' });
    const hold = await credits.holdCredits({
      userId: user,
      credits: 10,
      reasonCode: 'simple_question',
      actionType: 'simple_question',
      effort: 'medium',
      jobId: 'job-9',
    });

    await credits.settleHold(hold._id as mongoose.Types.ObjectId);
    await expect(credits.releaseHold(hold._id as mongoose.Types.ObjectId)).resolves.toBeNull();
    await expect(credits.getCreditBalance(user)).resolves.toEqual({
      available: 40,
      reserved: 0,
    });
  });
});

describe('releaseStaleHolds', () => {
  it('sweeps a hold whose job never reported back', async () => {
    const user = userId();
    await credits.grantCredits({ userId: user, credits: 50, reasonCode: 'signup_bonus' });
    const hold = await credits.holdCredits({
      userId: user,
      credits: 20,
      reasonCode: 'simple_question',
      actionType: 'simple_question',
      effort: 'high',
      jobId: 'job-10',
    });

    /* `createdAt` is immutable under schema timestamps, so backdate through the driver. */
    await CreditLedger.collection.updateOne(
      { _id: hold._id },
      { $set: { createdAt: new Date(Date.now() - 60 * 60 * 1000) } },
    );

    await expect(credits.releaseStaleHolds(15 * 60 * 1000)).resolves.toBe(1);
    await expect(credits.getCreditBalance(user)).resolves.toEqual({
      available: 50,
      reserved: 0,
    });
  });

  it('leaves a fresh hold alone', async () => {
    const user = userId();
    await credits.grantCredits({ userId: user, credits: 50, reasonCode: 'signup_bonus' });
    await credits.holdCredits({
      userId: user,
      credits: 20,
      reasonCode: 'simple_question',
      actionType: 'simple_question',
      effort: 'high',
      jobId: 'job-11',
    });

    await expect(credits.releaseStaleHolds(15 * 60 * 1000)).resolves.toBe(0);
    await expect(credits.getCreditBalance(user)).resolves.toEqual({
      available: 30,
      reserved: 20,
    });
  });
});

describe('reverseGrant', () => {
  it('claws back an unspent grant exactly once', async () => {
    const user = userId();
    const grant = await credits.grantCredits({
      userId: user,
      credits: 50,
      reasonCode: 'referral_referrer',
    });

    const reversal = await credits.reverseGrant(
      grant?._id as mongoose.Types.ObjectId,
      'referral_abuse',
    );
    expect(reversal?.credits).toBe(-50);
    await expect(credits.getCreditBalance(user)).resolves.toEqual({
      available: 0,
      reserved: 0,
    });

    await expect(
      credits.reverseGrant(grant?._id as mongoose.Types.ObjectId, 'referral_abuse'),
    ).resolves.toBeNull();
  });

  it('claws back only what is left when part was already spent', async () => {
    const user = userId();
    const grant = await credits.grantCredits({
      userId: user,
      credits: 50,
      reasonCode: 'referral_referrer',
    });
    const hold = await credits.holdCredits({
      userId: user,
      credits: 20,
      reasonCode: 'simple_question',
      actionType: 'simple_question',
      effort: 'high',
      jobId: 'job-12',
    });
    await credits.settleHold(hold._id as mongoose.Types.ObjectId);

    const reversal = await credits.reverseGrant(
      grant?._id as mongoose.Types.ObjectId,
      'referral_abuse',
    );

    expect(reversal?.credits).toBe(-30);
    await expect(credits.getCreditBalance(user)).resolves.toEqual({
      available: 0,
      reserved: 0,
    });
  });
});

describe('expireCredits', () => {
  it('retires expired grant lots and leaves purchases alone', async () => {
    const user = userId();
    await credits.grantCredits({
      userId: user,
      credits: 40,
      reasonCode: 'monthly_refill',
      expiresAt: new Date(Date.now() - 1000),
    });
    await purchase(user, 100);

    await expect(credits.expireCredits()).resolves.toBe(40);
    await expect(credits.getCreditBalance(user)).resolves.toEqual({
      available: 100,
      reserved: 0,
    });

    const expiry = await CreditLedger.findOne({ userId: user, type: 'expire' });
    expect(expiry?.credits).toBe(-40);
  });
});

describe('rebuildBalance', () => {
  it('repairs a snapshot that drifted from the ledger', async () => {
    const user = userId();
    await credits.grantCredits({ userId: user, credits: 100, reasonCode: 'signup_bonus' });
    await credits.holdCredits({
      userId: user,
      credits: 20,
      reasonCode: 'simple_question',
      actionType: 'simple_question',
      effort: 'high',
      jobId: 'job-13',
    });

    await CreditBalance.updateOne({ userId: user }, { $set: { available: 9999, reserved: 0 } });

    await expect(credits.rebuildBalance(user)).resolves.toEqual({
      available: 80,
      reserved: 20,
    });
  });
});

describe('recordJobCost', () => {
  it('totals both cost sides and converts to RON at the stored rate', async () => {
    const cost = await credits.recordJobCost({
      jobId: 'job-14',
      userId: userId(),
      actionType: 'simple_question',
      effort: 'high',
      outcome: 'answered',
      legdbQueryIds: ['q-1', 'q-2'],
      legdbCostMicroUsd: 30_000,
      synthesisInputTokens: 45_000,
      synthesisOutputTokens: 1_200,
      synthesisCostMicroUsd: 70_000,
      fxMicroRonPerUsd: 4_600_000,
    });

    expect(cost.totalCostMicroUsd).toBe(100_000);
    expect(cost.totalCostMicroRon).toBe(460_000);
    expect(cost.legdbQueryIds).toEqual(['q-1', 'q-2']);
  });

  it('records a failed job, which is unbilled but not free', async () => {
    const cost = await credits.recordJobCost({
      jobId: 'job-15',
      actionType: 'simple_question',
      effort: 'medium',
      outcome: 'failed',
      legdbCostMicroUsd: 12_000,
      synthesisCostMicroUsd: 8_000,
      fxMicroRonPerUsd: 4_600_000,
    });

    expect(cost.outcome).toBe('failed');
    expect(cost.totalCostMicroRon).toBe(92_000);
  });

  it('is idempotent on jobId', async () => {
    const params = {
      jobId: 'job-16',
      actionType: 'simple_question',
      effort: 'low' as const,
      outcome: 'answered' as const,
      legdbCostMicroUsd: 4_000,
      synthesisCostMicroUsd: 3_000,
      fxMicroRonPerUsd: 4_600_000,
    };
    await credits.recordJobCost(params);
    await credits.recordJobCost(params);

    expect(await mongoose.models.CostLog.countDocuments({ jobId: 'job-16' })).toBe(1);
  });
});
