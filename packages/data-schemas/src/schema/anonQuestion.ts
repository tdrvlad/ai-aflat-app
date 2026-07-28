import { Schema, Document, Types } from 'mongoose';

/**
 * ai-aflat: a question parked by an anonymous visitor before signup ("colectorul").
 *
 * GDPR invariant: this document must never carry a network identifier. No `ip`,
 * no `userAgent`, no fingerprint — the only identity it ever gains is
 * `linkedUserId`, written when the visitor signs up and claims the question.
 * Abuse control is handled entirely inside rate-limiter state, which is
 * ephemeral and never persisted here.
 */
export interface IAnonQuestion extends Document {
  text: string;
  ackVersion: string;
  ackTs: Date;
  claimTokenHash?: string | null;
  linkedUserId?: Types.ObjectId | null;
  linkedConvoId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const anonQuestionSchema: Schema<IAnonQuestion> = new Schema(
  {
    text: {
      type: String,
      required: true,
      maxlength: 4000,
    },
    /** Wording version of the acknowledgement the visitor accepted (client-supplied). */
    ackVersion: {
      type: String,
      required: true,
    },
    ackTs: {
      type: Date,
      required: true,
      default: Date.now,
    },
    /**
     * SHA-256 of the one-time claim token handed to the visitor's browser as an
     * httpOnly cookie, and the key the claim looks this document up by. The
     * token itself is never stored, so a dump of this collection cannot be
     * replayed into a claim; SHA-256 (not bcrypt/argon2) is right because the
     * input is a 32-byte random secret, not a low-entropy password — there is
     * nothing for a work factor to protect against.
     *
     * Not `unique`: it defaults to null for any document created outside the
     * mint route, and a unique index would reject the second such document.
     */
    claimTokenHash: {
      type: String,
      default: null,
      index: true,
    },
    linkedUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    linkedConvoId: {
      type: String,
      default: null,
    },
  },
  { timestamps: true, collection: 'anon_questions' },
);

/**
 * Retention for a question nobody ever claimed: 24 months, matching the period
 * the phase-1 plan set for the `retention.sh` cron this index replaces.
 */
const UNCLAIMED_TTL_SECONDS = 60 * 60 * 24 * 365 * 2;

/**
 * Expire unclaimed questions; keep claimed ones forever.
 *
 * A parked question that was never claimed is a stranger's free-text legal
 * problem attached to no account — nobody can ask for it, correct it, or have it
 * erased, because there is no subject to authenticate. Keeping it indefinitely is
 * the one storage decision here with no defensible basis, so the expiry is a
 * property of the collection rather than a cron job: an index ships with the
 * code, survives a rebuild or a restore into a fresh database, and cannot be
 * forgotten the way a hand-typed `db.anon_questions.createIndex(...)` can.
 *
 * `partialFilterExpression` is what keeps it from eating the claimed ones. Once
 * `linkedUserId` is set the document leaves the index entirely and stops being a
 * TTL candidate — MongoDB drops a document from a partial index the moment it
 * stops matching the filter, so the claim itself is the reprieve, with no second
 * write needed to grant it. The filter is an equality on `null`, which also
 * covers a document written before `linkedUserId` had a default and therefore
 * lacks the field.
 *
 * TTL applies to `createdAt` (schema `timestamps`), not `updatedAt`: the clock
 * must run from when the visitor gave us the text, and must not be reset by any
 * later write to the document.
 */
anonQuestionSchema.index(
  { createdAt: 1 },
  {
    name: 'anon_questions_unclaimed_ttl',
    expireAfterSeconds: UNCLAIMED_TTL_SECONDS,
    partialFilterExpression: { linkedUserId: null },
  },
);

export default anonQuestionSchema;
