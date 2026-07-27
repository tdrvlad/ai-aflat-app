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
