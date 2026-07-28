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

export default anonQuestionSchema;
