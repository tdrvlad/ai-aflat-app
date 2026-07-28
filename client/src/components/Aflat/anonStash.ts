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

export const saveStash = (q: AnonStash) => localStorage.setItem(STASH_KEY, JSON.stringify(q));

export const readStash = (): AnonStash | null => {
  try {
    return JSON.parse(localStorage.getItem(STASH_KEY) ?? 'null');
  } catch {
    return null;
  }
};

export const clearStash = () => localStorage.removeItem(STASH_KEY);

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
