import { Schema, Document, Types } from 'mongoose';

/**
 * ai-aflat: the record that a signed-in user accepted the GDPR notice and the
 * legal-information framing ("this informs about legislation, it is not legal
 * advice"), plus an optional marketing opt-in.
 *
 * `wordingVersion` is the version string of the text the user was actually
 * shown; it is supplied by the client and stored verbatim, never validated
 * against a hardcoded constant — pinning it in code would silently rewrite
 * history the next time the wording changes.
 */
export interface IConsentLog extends Document {
  userId: Types.ObjectId;
  gdprAccepted: boolean;
  framingAccepted: boolean;
  marketingOptIn: boolean;
  wordingVersion: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const consentLogSchema: Schema<IConsentLog> = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    gdprAccepted: {
      type: Boolean,
      required: true,
    },
    framingAccepted: {
      type: Boolean,
      required: true,
    },
    marketingOptIn: {
      type: Boolean,
      default: false,
    },
    wordingVersion: {
      type: String,
      required: true,
    },
  },
  { timestamps: true, collection: 'consent_logs' },
);

export default consentLogSchema;
