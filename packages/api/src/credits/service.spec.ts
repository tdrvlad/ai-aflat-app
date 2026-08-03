import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createModels, createMethods, type CreditMethods } from '@librechat/data-schemas';
import {
  ACTION_SIMPLE_QUESTION,
  GRANT_SIZES,
  getActionPrice,
  getUpgradePrice,
  isEffort,
} from './pricing';
import {
  currentRefillPeriod,
  grantSignupBonus,
  holdForAction,
  holdForUpgrade,
  runMonthlyRefill,
  settleForOutcome,
} from './service';

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let credits: CreditMethods;

const userId = () => new mongoose.Types.ObjectId().toString();

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  createModels(mongoose);
  /* Through the real composition, so the test also proves credits reach `AllMethods`. */
  credits = createMethods(mongoose);
  await mongoose.models.CreditLedger.syncIndexes();
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    mongoose.models.CreditLot.deleteMany({}),
    mongoose.models.CreditLedger.deleteMany({}),
    mongoose.models.CreditBalance.deleteMany({}),
  ]);
});

describe('pricing', () => {
  it('prices the three effort levels at 1x / 2x / 4x', () => {
    expect(getActionPrice(ACTION_SIMPLE_QUESTION, 'low')).toBe(5);
    expect(getActionPrice(ACTION_SIMPLE_QUESTION, 'medium')).toBe(10);
    expect(getActionPrice(ACTION_SIMPLE_QUESTION, 'high')).toBe(20);
  });

  it('charges only the difference to upgrade, and nothing to downgrade', () => {
    expect(getUpgradePrice(ACTION_SIMPLE_QUESTION, 'low', 'medium')).toBe(5);
    expect(getUpgradePrice(ACTION_SIMPLE_QUESTION, 'medium', 'high')).toBe(10);
    expect(getUpgradePrice(ACTION_SIMPLE_QUESTION, 'low', 'high')).toBe(15);
    expect(getUpgradePrice(ACTION_SIMPLE_QUESTION, 'high', 'low')).toBe(0);
  });

  it('rejects an unknown action rather than guessing a price', () => {
    expect(() => getActionPrice('deep_research', 'high')).toThrow(/Unknown billable action/);
  });

  it('validates effort from untrusted input', () => {
    expect(isEffort('high')).toBe(true);
    expect(isEffort('extreme')).toBe(false);
    expect(isEffort(undefined)).toBe(false);
  });
});

describe('grantSignupBonus', () => {
  it('grants the welcome credits once', async () => {
    const user = userId();
    await grantSignupBonus(credits, user);
    await grantSignupBonus(credits, user);

    await expect(credits.getCreditBalance(user)).resolves.toEqual({
      available: GRANT_SIZES.signup_bonus,
      reserved: 0,
    });
  });
});

describe('runMonthlyRefill', () => {
  it('tops a low balance up by the refill amount', async () => {
    const user = userId();
    await runMonthlyRefill(credits, user, '2026-08');

    await expect(credits.getCreditBalance(user)).resolves.toEqual({
      available: GRANT_SIZES.monthly_refill,
      reserved: 0,
    });
  });

  it('is a no-op within the same period', async () => {
    const user = userId();
    await runMonthlyRefill(credits, user, '2026-08');
    await runMonthlyRefill(credits, user, '2026-08');

    await expect(credits.getCreditBalance(user)).resolves.toEqual({
      available: GRANT_SIZES.monthly_refill,
      reserved: 0,
    });
  });

  it('stops at the ceiling instead of stacking forever', async () => {
    const user = userId();
    await credits.grantCredits({
      userId: user,
      credits: GRANT_SIZES.refill_ceiling - 5,
      reasonCode: 'seed',
    });

    await runMonthlyRefill(credits, user, '2026-09');

    await expect(credits.getCreditBalance(user)).resolves.toEqual({
      available: GRANT_SIZES.refill_ceiling,
      reserved: 0,
    });
  });

  it('grants nothing to a user already at the ceiling', async () => {
    const user = userId();
    await credits.grantCredits({
      userId: user,
      credits: GRANT_SIZES.refill_ceiling,
      reasonCode: 'seed',
    });

    await expect(runMonthlyRefill(credits, user, '2026-10')).resolves.toBeNull();
    await expect(credits.getCreditBalance(user)).resolves.toEqual({
      available: GRANT_SIZES.refill_ceiling,
      reserved: 0,
    });
  });

  it('scopes the refill period to UTC year-month', () => {
    expect(currentRefillPeriod(new Date('2026-01-09T23:30:00Z'))).toBe('2026-01');
    expect(currentRefillPeriod(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12');
  });
});

describe('settleForOutcome', () => {
  async function heldUser(effort: 'low' | 'medium' | 'high' = 'medium') {
    const user = userId();
    await grantSignupBonus(credits, user);
    const hold = await holdForAction(credits, { userId: user, jobId: `job-${user}`, effort });
    return { user, holdId: String(hold._id) };
  }

  it('charges an answered job', async () => {
    const { user, holdId } = await heldUser('medium');
    const entry = await settleForOutcome(credits, holdId, 'answered');

    expect(entry?.type).toBe('debit');
    await expect(credits.getCreditBalance(user)).resolves.toEqual({
      available: GRANT_SIZES.signup_bonus - 10,
      reserved: 0,
    });
  });

  it.each(['clarification', 'empty', 'failed'] as const)(
    'never charges a %s outcome',
    async (outcome) => {
      const { user, holdId } = await heldUser('high');
      const entry = await settleForOutcome(credits, holdId, outcome);

      expect(entry?.type).toBe('release');
      await expect(credits.getCreditBalance(user)).resolves.toEqual({
        available: GRANT_SIZES.signup_bonus,
        reserved: 0,
      });
    },
  );

  it.each([undefined, null])('treats a missing outcome (%p) as failed', async (outcome) => {
    const { user, holdId } = await heldUser('high');
    const entry = await settleForOutcome(credits, holdId, outcome);

    expect(entry?.type).toBe('release');
    await expect(credits.getCreditBalance(user)).resolves.toEqual({
      available: GRANT_SIZES.signup_bonus,
      reserved: 0,
    });
  });
});

describe('holdForUpgrade', () => {
  it('reserves only the difference', async () => {
    const user = userId();
    await grantSignupBonus(credits, user);

    const hold = await holdForUpgrade(credits, {
      userId: user,
      jobId: 'upgrade-1',
      from: 'medium',
      to: 'high',
    });

    expect(hold?.credits).toBe(-10);
    await expect(credits.getCreditBalance(user)).resolves.toEqual({
      available: GRANT_SIZES.signup_bonus - 10,
      reserved: 10,
    });
  });

  it('reserves nothing for a downgrade', async () => {
    const user = userId();
    await grantSignupBonus(credits, user);

    await expect(
      holdForUpgrade(credits, { userId: user, jobId: 'upgrade-2', from: 'high', to: 'low' }),
    ).resolves.toBeNull();
    await expect(credits.getCreditBalance(user)).resolves.toEqual({
      available: GRANT_SIZES.signup_bonus,
      reserved: 0,
    });
  });
});
