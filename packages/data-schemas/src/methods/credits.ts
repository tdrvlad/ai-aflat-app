import type { Model, Types } from 'mongoose';
import type { ICreditLedger, ICreditAllocation } from '~/schema/creditLedger';
import type { ICreditLot, CreditLotSource } from '~/schema/creditLot';
import type { ICostLog, JobOutcome } from '~/schema/costLog';
import type { ICreditBalance } from '~/schema/creditBalance';
import logger from '~/config/winston';

/**
 * ai-aflat credit ledger primitives.
 *
 * These deal in credits only. Resolving *how many* credits an action costs is the
 * price list's job and lives in `@librechat/api`; this layer never reads a price.
 *
 * **Atomicity.** The production database is a standalone `mongod`, so multi-document
 * transactions are not available. Correctness therefore rests on two things: every
 * lot decrement is an individually guarded atomic update (`creditsRemaining: {$gte}`),
 * which is the real double-spend protection; and the write order is chosen so that
 * any crash leaves credits *temporarily reserved* rather than spent twice. The
 * balance snapshot is derived and `rebuildBalance` repairs it from the ledger.
 */

export class InsufficientCreditsError extends Error {
  public readonly available: number;
  public readonly required: number;

  constructor(available: number, required: number) {
    super(`Insufficient credits: ${available} available, ${required} required`);
    this.name = 'InsufficientCreditsError';
    this.available = available;
    this.required = required;
  }
}

export interface GrantCreditsParams {
  userId: string | Types.ObjectId;
  credits: number;
  reasonCode: string;
  source?: CreditLotSource;
  costBasisMicroRon?: number;
  expiresAt?: Date | null;
  refId?: string | null;
  idempotencyKey?: string | null;
  priceListVersion?: string | null;
  note?: string | null;
}

export interface HoldCreditsParams {
  userId: string | Types.ObjectId;
  credits: number;
  reasonCode: string;
  actionType: string;
  effort: string;
  jobId: string;
  priceListVersion?: string | null;
}

export interface RecordJobCostParams {
  jobId: string;
  userId?: string | Types.ObjectId | null;
  actionType: string;
  effort: string;
  outcome: JobOutcome;
  legdbQueryIds?: string[];
  legdbCostMicroUsd?: number;
  synthesisInputTokens?: number;
  synthesisOutputTokens?: number;
  synthesisCostMicroUsd?: number;
  fxMicroRonPerUsd: number;
  latencyMs?: number | null;
  priceListVersion?: string | null;
}

export interface CreditBalanceView {
  available: number;
  reserved: number;
}

export interface LedgerPage {
  entries: ICreditLedger[];
  nextCursor: string | null;
}

export interface CreditMethods {
  ensureCreditBalance: (userId: string | Types.ObjectId) => Promise<ICreditBalance>;
  getCreditBalance: (userId: string | Types.ObjectId) => Promise<CreditBalanceView>;
  grantCredits: (params: GrantCreditsParams) => Promise<ICreditLedger | null>;
  holdCredits: (params: HoldCreditsParams) => Promise<ICreditLedger>;
  settleHold: (holdId: string | Types.ObjectId) => Promise<ICreditLedger | null>;
  releaseHold: (
    holdId: string | Types.ObjectId,
    reasonCode?: string,
    note?: string | null,
  ) => Promise<ICreditLedger | null>;
  releaseStaleHolds: (olderThanMs: number) => Promise<number>;
  reverseGrant: (
    entryId: string | Types.ObjectId,
    reasonCode: string,
    note?: string | null,
  ) => Promise<ICreditLedger | null>;
  expireCredits: () => Promise<number>;
  getCreditLedgerPage: (
    userId: string | Types.ObjectId,
    limit?: number,
    cursor?: string | null,
  ) => Promise<LedgerPage>;
  rebuildBalance: (userId: string | Types.ObjectId) => Promise<CreditBalanceView>;
  recordJobCost: (params: RecordJobCostParams) => Promise<ICostLog>;
  correctLotCostBasis: (
    lotId: string | Types.ObjectId,
    costBasisMicroRon: number,
  ) => Promise<boolean>;
}

export function createCreditMethods(mongoose: typeof import('mongoose')): CreditMethods {
  const getLot = () => mongoose.models.CreditLot as Model<ICreditLot>;
  const getLedger = () => mongoose.models.CreditLedger as Model<ICreditLedger>;
  const getBalanceModel = () => mongoose.models.CreditBalance as Model<ICreditBalance>;
  const getCostLog = () => mongoose.models.CostLog as Model<ICostLog>;

  async function ensureCreditBalance(userId: string | Types.ObjectId): Promise<ICreditBalance> {
    return getBalanceModel().findOneAndUpdate(
      { userId },
      { $setOnInsert: { userId, available: 0, reserved: 0, version: 0 } },
      { new: true, upsert: true },
    );
  }

  async function getCreditBalance(userId: string | Types.ObjectId): Promise<CreditBalanceView> {
    const balance = await getBalanceModel().findOne({ userId }).lean();
    if (!balance) {
      return { available: 0, reserved: 0 };
    }
    return { available: balance.available, reserved: balance.reserved };
  }

  /**
   * Reserve credits against a user's lots, cheapest-basis first.
   *
   * Free lots are drawn before purchased ones because every grant carries a basis
   * of zero and the sort is ascending — the "spend free credits first" rule is a
   * property of the index, not a branch in this function.
   *
   * A lot whose guarded decrement fails was taken by a concurrent request; we skip
   * it and continue rather than failing, and only give up once no lot can supply
   * the remainder. Partial allocations are rolled back before throwing, so a
   * refusal never leaves credits stranded.
   */
  async function allocateFromLots(
    userId: string | Types.ObjectId,
    credits: number,
  ): Promise<ICreditAllocation[]> {
    const Lot = getLot();
    const now = new Date();
    const candidates = await Lot.find({
      userId,
      creditsRemaining: { $gt: 0 },
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    })
      .sort({ costBasisMicroRon: 1, expiresAt: 1, createdAt: 1 })
      .lean();

    const allocations: ICreditAllocation[] = [];
    let remaining = credits;

    for (const lot of candidates) {
      if (remaining <= 0) {
        break;
      }
      const take = Math.min(lot.creditsRemaining, remaining);
      const claimed = await Lot.findOneAndUpdate(
        { _id: lot._id, creditsRemaining: { $gte: take } },
        { $inc: { creditsRemaining: -take } },
        { new: true },
      );
      if (!claimed) {
        continue;
      }
      allocations.push({
        lotId: lot._id as Types.ObjectId,
        credits: take,
        costBasisMicroRon: lot.costBasisMicroRon,
      });
      remaining -= take;
    }

    if (remaining > 0) {
      await returnToLots(allocations);
      const { available } = await getCreditBalance(userId);
      throw new InsufficientCreditsError(available, credits);
    }

    return allocations;
  }

  async function returnToLots(allocations: ICreditAllocation[]): Promise<void> {
    const Lot = getLot();
    for (const allocation of allocations) {
      await Lot.updateOne(
        { _id: allocation.lotId },
        { $inc: { creditsRemaining: allocation.credits } },
      );
    }
  }

  /**
   * Add credits. Every entry point that creates credits comes through here,
   * including purchases — there is no side door, which is what keeps the lot
   * cost-basis complete enough for margin reporting to mean anything.
   *
   * `idempotencyKey` makes a replayed webhook, a double-submitted form or a re-run
   * scheduled job a no-op rather than a second grant.
   */
  async function grantCredits(params: GrantCreditsParams): Promise<ICreditLedger | null> {
    const {
      userId,
      credits,
      reasonCode,
      source = 'grant',
      costBasisMicroRon = 0,
      expiresAt = null,
      refId = null,
      idempotencyKey = null,
      priceListVersion = null,
      note = null,
    } = params;

    if (credits <= 0) {
      throw new Error('grantCredits requires a positive credit amount');
    }

    if (idempotencyKey) {
      const existing = await getLedger().findOne({ idempotencyKey });
      if (existing) {
        return null;
      }
    }

    const lot = await getLot().create({
      userId,
      source,
      reasonCode,
      creditsGranted: credits,
      creditsRemaining: credits,
      costBasisMicroRon,
      priceListVersion,
      expiresAt,
      refId,
    });

    let entry: ICreditLedger;
    try {
      entry = await getLedger().create({
        userId,
        type: source === 'purchase' ? 'purchase' : 'grant',
        credits,
        allocations: [{ lotId: lot._id, credits, costBasisMicroRon }],
        reasonCode,
        priceListVersion,
        refId,
        idempotencyKey,
        note,
      });
    } catch (error) {
      await getLot().deleteOne({ _id: lot._id });
      const isDuplicate =
        typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
      if (isDuplicate) {
        return null;
      }
      throw error;
    }

    await ensureCreditBalance(userId);
    await getBalanceModel().updateOne({ userId }, { $inc: { available: credits, version: 1 } });

    return entry;
  }

  /**
   * Reserve the price of an action before the job starts.
   *
   * Reserving rather than debiting is what makes "we never charge for a non-answer"
   * enforceable: nothing becomes revenue until an answer is actually delivered.
   */
  async function holdCredits(params: HoldCreditsParams): Promise<ICreditLedger> {
    const {
      userId,
      credits,
      reasonCode,
      actionType,
      effort,
      jobId,
      priceListVersion = null,
    } = params;

    if (credits <= 0) {
      throw new Error('holdCredits requires a positive credit amount');
    }

    await ensureCreditBalance(userId);
    const allocations = await allocateFromLots(userId, credits);

    let entry: ICreditLedger;
    try {
      entry = await getLedger().create({
        userId,
        type: 'hold',
        credits: -credits,
        allocations,
        reasonCode,
        actionType,
        effort,
        jobId,
        priceListVersion,
      });
    } catch (error) {
      await returnToLots(allocations);
      throw error;
    }

    await getBalanceModel().updateOne(
      { userId },
      { $inc: { available: -credits, reserved: credits, version: 1 } },
    );

    return entry;
  }

  async function loadOpenHold(holdId: string | Types.ObjectId): Promise<ICreditLedger | null> {
    return getLedger().findOne({ _id: holdId, type: 'hold', settledBy: null });
  }

  /** Convert a hold into revenue. Only an actually delivered answer gets here. */
  async function settleHold(holdId: string | Types.ObjectId): Promise<ICreditLedger | null> {
    const hold = await loadOpenHold(holdId);
    if (!hold) {
      return null;
    }

    const debit = await getLedger().create({
      userId: hold.userId,
      type: 'debit',
      credits: hold.credits,
      allocations: hold.allocations,
      reasonCode: hold.reasonCode,
      actionType: hold.actionType,
      effort: hold.effort,
      jobId: hold.jobId,
      priceListVersion: hold.priceListVersion,
    });

    await getLedger().updateOne({ _id: hold._id }, { $set: { settledBy: debit._id } });
    await getBalanceModel().updateOne(
      { userId: hold.userId },
      { $inc: { reserved: hold.credits, version: 1 } },
    );

    return debit;
  }

  /**
   * Return a hold to the user untouched. Every outcome that is not a delivered
   * answer ends here — failures, empty retrieval, and clarifying questions the
   * system asked rather than answered.
   */
  async function releaseHold(
    holdId: string | Types.ObjectId,
    reasonCode = 'not_answered',
    note: string | null = null,
  ): Promise<ICreditLedger | null> {
    const hold = await loadOpenHold(holdId);
    if (!hold) {
      return null;
    }

    const credits = Math.abs(hold.credits);
    await returnToLots(hold.allocations);

    const release = await getLedger().create({
      userId: hold.userId,
      type: 'release',
      credits,
      allocations: hold.allocations,
      reasonCode,
      actionType: hold.actionType,
      effort: hold.effort,
      jobId: hold.jobId,
      priceListVersion: hold.priceListVersion,
      note,
    });

    await getLedger().updateOne({ _id: hold._id }, { $set: { settledBy: release._id } });
    await getBalanceModel().updateOne(
      { userId: hold.userId },
      { $inc: { available: credits, reserved: -credits, version: 1 } },
    );

    return release;
  }

  /**
   * Sweep holds whose job never reported back. An orphaned hold that sits forever
   * is indistinguishable from a silent charge as far as the user is concerned.
   */
  async function releaseStaleHolds(olderThanMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const stale = await getLedger()
      .find({ type: 'hold', settledBy: null, createdAt: { $lt: cutoff } })
      .select('_id')
      .lean();

    let released = 0;
    for (const hold of stale) {
      const result = await releaseHold(hold._id as Types.ObjectId, 'hold_expired');
      if (result) {
        released += 1;
      }
    }
    if (released > 0) {
      logger.info(`[credits] released ${released} stale hold(s)`);
    }
    return released;
  }

  /** Undo a grant that should not have happened — referral abuse, mistaken support credit. */
  async function reverseGrant(
    entryId: string | Types.ObjectId,
    reasonCode: string,
    note: string | null = null,
  ): Promise<ICreditLedger | null> {
    const original = await getLedger().findOne({
      _id: entryId,
      type: { $in: ['grant', 'purchase'] },
    });
    if (!original) {
      return null;
    }
    const alreadyReversed = await getLedger().findOne({ reversalOf: original._id });
    if (alreadyReversed) {
      return null;
    }

    const Lot = getLot();
    let clawedBack = 0;
    for (const allocation of original.allocations) {
      const lot = await Lot.findOne({ _id: allocation.lotId });
      if (!lot) {
        continue;
      }
      const recoverable = Math.min(lot.creditsRemaining, allocation.credits);
      if (recoverable > 0) {
        await Lot.updateOne({ _id: lot._id }, { $inc: { creditsRemaining: -recoverable } });
        clawedBack += recoverable;
      }
    }

    const reversal = await getLedger().create({
      userId: original.userId,
      type: 'reversal',
      credits: -clawedBack,
      allocations: original.allocations,
      reasonCode,
      refId: original.refId,
      reversalOf: original._id,
      note,
    });

    if (clawedBack > 0) {
      await getBalanceModel().updateOne(
        { userId: original.userId },
        { $inc: { available: -clawedBack, version: 1 } },
      );
    }

    return reversal;
  }

  /** Retire grant lots past their expiry. Purchased lots never match this filter. */
  async function expireCredits(): Promise<number> {
    const Lot = getLot();
    const now = new Date();
    const expired = await Lot.find({
      creditsRemaining: { $gt: 0 },
      expiresAt: { $ne: null, $lte: now },
    }).lean();

    let total = 0;
    for (const lot of expired) {
      const claimed = await Lot.findOneAndUpdate(
        { _id: lot._id, creditsRemaining: lot.creditsRemaining },
        { $set: { creditsRemaining: 0 } },
      );
      if (!claimed) {
        continue;
      }
      const credits = lot.creditsRemaining;
      await getLedger().create({
        userId: lot.userId,
        type: 'expire',
        credits: -credits,
        allocations: [
          { lotId: lot._id as Types.ObjectId, credits, costBasisMicroRon: lot.costBasisMicroRon },
        ],
        reasonCode: lot.reasonCode,
      });
      await getBalanceModel().updateOne(
        { userId: lot.userId },
        { $inc: { available: -credits, version: 1 } },
      );
      total += credits;
    }
    return total;
  }

  async function getCreditLedgerPage(
    userId: string | Types.ObjectId,
    limit = 25,
    cursor?: string | null,
  ): Promise<LedgerPage> {
    const query: Record<string, unknown> = { userId };
    if (cursor) {
      query._id = { $lt: cursor };
    }
    const entries = await getLedger()
      .find(query)
      .sort({ _id: -1 })
      .limit(limit + 1);

    const hasMore = entries.length > limit;
    const page = hasMore ? entries.slice(0, limit) : entries;
    return {
      entries: page,
      nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
    };
  }

  /**
   * Rebuild a snapshot from the ledger. The ledger is truth; this is how we prove
   * it, and how a snapshot damaged by a crash mid-write gets repaired.
   */
  async function rebuildBalance(userId: string | Types.ObjectId): Promise<CreditBalanceView> {
    const lots = await getLot().find({ userId }).select('creditsRemaining').lean();
    const available = lots.reduce((sum, lot) => sum + lot.creditsRemaining, 0);

    const openHolds = await getLedger()
      .find({ userId, type: 'hold', settledBy: null })
      .select('credits')
      .lean();
    const reserved = openHolds.reduce((sum, hold) => sum + Math.abs(hold.credits), 0);

    await ensureCreditBalance(userId);
    await getBalanceModel().updateOne(
      { userId },
      { $set: { available, reserved }, $inc: { version: 1 } },
    );
    return { available, reserved };
  }

  /**
   * Record what a job really cost, whatever its outcome. A failed job is not billed
   * but it still burned tokens, and a free tier whose failures are invisible looks
   * cheaper than it is.
   */
  async function recordJobCost(params: RecordJobCostParams): Promise<ICostLog> {
    const {
      jobId,
      userId = null,
      actionType,
      effort,
      outcome,
      legdbQueryIds = [],
      legdbCostMicroUsd = 0,
      synthesisInputTokens = 0,
      synthesisOutputTokens = 0,
      synthesisCostMicroUsd = 0,
      fxMicroRonPerUsd,
      latencyMs = null,
      priceListVersion = null,
    } = params;

    const totalCostMicroUsd = legdbCostMicroUsd + synthesisCostMicroUsd;
    const totalCostMicroRon = Math.round((totalCostMicroUsd * fxMicroRonPerUsd) / 1_000_000);

    return getCostLog().findOneAndUpdate(
      { jobId },
      {
        $set: {
          userId,
          actionType,
          effort,
          outcome,
          legdbQueryIds,
          legdbCostMicroUsd,
          synthesisInputTokens,
          synthesisOutputTokens,
          synthesisCostMicroUsd,
          totalCostMicroUsd,
          fxMicroRonPerUsd,
          totalCostMicroRon,
          latencyMs,
          priceListVersion,
        },
      },
      { new: true, upsert: true },
    );
  }

  /**
   * Replaces an estimated cost basis with the real one, once Stripe's balance
   * transaction has settled.
   *
   * **Refuses on a lot that has already been spent against**, and says so by
   * returning false. The ledger is append-only and its `allocations` copy the basis
   * at the moment of spend; correcting the lot after a debit would leave the two
   * disagreeing, and a margin report reading a basis that no allocation reflects is
   * worse than one reading a slightly stale estimate.
   *
   * The `creditsRemaining: creditsGranted` guard is expressed in the query rather
   * than checked first, so a concurrent spend cannot slip between the check and the
   * write.
   */
  async function correctLotCostBasis(
    lotId: string | Types.ObjectId,
    costBasisMicroRon: number,
  ): Promise<boolean> {
    const lot = await getLot().findById(lotId).lean();
    if (!lot) {
      return false;
    }

    const result = await getLot().updateOne(
      { _id: lotId, creditsRemaining: lot.creditsGranted },
      { $set: { costBasisMicroRon } },
    );

    if (result.modifiedCount !== 1) {
      return false;
    }

    await getLedger().updateOne(
      { 'allocations.lotId': lotId, type: 'purchase' },
      { $set: { 'allocations.$[entry].costBasisMicroRon': costBasisMicroRon } },
      { arrayFilters: [{ 'entry.lotId': lotId }] },
    );

    return true;
  }

  return {
    ensureCreditBalance,
    getCreditBalance,
    grantCredits,
    correctLotCostBasis,
    holdCredits,
    settleHold,
    releaseHold,
    releaseStaleHolds,
    reverseGrant,
    expireCredits,
    getCreditLedgerPage,
    rebuildBalance,
    recordJobCost,
  };
}

export type { CreditLedgerType, ICreditAllocation, ICreditLedger } from '~/schema/creditLedger';
export type { CreditLotSource, ICreditLot } from '~/schema/creditLot';
export type { ICreditBalance } from '~/schema/creditBalance';
export type { ICostLog, JobOutcome } from '~/schema/costLog';
