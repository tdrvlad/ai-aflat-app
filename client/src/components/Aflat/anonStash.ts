/**
 * Local persistence for the anonymous ask gate (`/intreaba`).
 *
 * Two independent pieces of state, both deliberately in `localStorage` so they
 * survive the round trip through the identity provider:
 *  - the parked question (`aflat_anon_q`), read back after signup so the new
 *    account can claim it;
 *  - the acknowledgement of the legal-information framing (`ACK_KEY`), whose
 *    name carries the wording version so a copy change re-asks.
 */
const STASH_KEY = 'aflat_anon_q';

/** Acknowledgement version — bump the suffix when the ack wording changes. */
export const ACK_VERSION = 'v1-2026-07';
export const ACK_KEY = `aflat_ack_${ACK_VERSION}`;

export type AnonStash = { id: string; text: string };

/**
 * Returns false instead of throwing when storage is unavailable (all site data
 * blocked, quota exceeded). Callers must treat that as non-fatal: by the time
 * this runs the question is already parked server-side, and losing the stash
 * only costs the post-signup auto-link, which Task 8 handles as optional.
 * Throwing here would surface a "couldn't save your question" error after a
 * 201 and invite retries that orphan a document each time.
 */
export const saveStash = (q: AnonStash): boolean => {
  try {
    localStorage.setItem(STASH_KEY, JSON.stringify(q));
    return true;
  } catch {
    return false;
  }
};

export const readStash = (): AnonStash | null => {
  try {
    return JSON.parse(localStorage.getItem(STASH_KEY) ?? 'null');
  } catch {
    return null;
  }
};

export const clearStash = () => {
  try {
    localStorage.removeItem(STASH_KEY);
  } catch {
    /* same reasoning as saveStash — never block the caller's flow */
  }
};

/** True once the visitor has acknowledged the current framing wording. */
export const hasAcked = (): boolean => {
  try {
    return localStorage.getItem(ACK_KEY) != null;
  } catch {
    return false;
  }
};

/** Records the acknowledgement as an ISO timestamp. */
export const saveAck = () => {
  try {
    localStorage.setItem(ACK_KEY, new Date().toISOString());
  } catch {
    /* private-mode storage failures must not block the send */
  }
};
