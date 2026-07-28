/**
 * Local persistence for the anonymous ask gate (`/ask`).
 *
 * Two independent pieces of state, both deliberately in `localStorage` so they
 * survive the round trip through the identity provider:
 *  - the parked question (`aflat_anon_q`), kept so the app can show the visitor
 *    their own question back;
 *  - the acknowledgement of the legal-information framing (`ACK_KEY`), whose
 *    name carries the wording version so a copy change re-asks.
 *
 * The stash is **display state, not a credential.** Authorisation to read a
 * parked question back lives entirely in the `aflat_claim` httpOnly cookie the
 * server sets when the question is parked: `id` is never sent anywhere and
 * proves nothing, and a visitor who hand-edits this key gains no access to
 * anyone's question — the worst they can do is change the text shown to
 * themselves before the server's own copy replaces it.
 */
const STASH_KEY = 'aflat_anon_q';

/** Acknowledgement version — bump the suffix when the ack wording changes. */
export const ACK_VERSION = 'v1-2026-07';
export const ACK_KEY = `aflat_ack_${ACK_VERSION}`;

/**
 * How long a parked question stays claimable. Shared browsers are the reason:
 * a visitor who asks and never signs up leaves their question behind, and on a
 * family PC, a library machine or a kiosk the *next* person to sign up would
 * otherwise open their first conversation with a stranger's question — showing
 * them text they never wrote and stamping `anon_questions.linkedUserId` with
 * the wrong subject. A day is long enough for "sign up, confirm the email, come
 * back", short enough that the browser is still the same person's.
 *
 * The claim cookie is given the same 24h lifetime server-side, so both halves
 * of the handoff expire together.
 */
export const STASH_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * `id` is retained for continuity (it is what `/ask` gets back when it parks the
 * question, and it makes a stash entry legible in a debugging session) but it is
 * inert: nothing reads it as authorisation and it is never put in a request. It
 * is optional because the post-login handoff can learn a question's text from
 * the claim response on a browser where `/ask` could not write here at all.
 */
export type AnonStash = {
  id?: string;
  text: string;
  ts?: number;
  /**
   * Set once the server has confirmed this question belongs to the signed-in
   * account but it could not be asked yet — the chat had moved on, or the user
   * was mid-send. The claim credential is spent by then, so going back to the
   * server would 404 and the text kept here is the only copy left; this flag is
   * what tells the handoff to deliver it directly instead of re-claiming.
   * Without it, a page reload inside that window threw the question away.
   *
   * It is not a credential and grants nothing — anyone who can set it can
   * already type whatever they like into the composer.
   */
  claimed?: boolean;
};

/**
 * Returns false instead of throwing when storage is unavailable (all site data
 * blocked, quota exceeded). Callers must treat that as non-fatal: by the time
 * this runs the question is already parked server-side and the claim cookie is
 * already set, so a failed stash costs nothing but the local display copy —
 * the post-signup handoff runs off the cookie either way.
 * Throwing here would surface a "couldn't save your question" error after a
 * 201 and invite retries that orphan a document each time.
 *
 * `ts` is stamped on write unless the caller supplies one: the post-login
 * handoff re-parks a question it could not deliver, and re-parking must not
 * restart the expiry clock — that would let a stash outlive the visit it
 * belongs to.
 */
export const saveStash = (q: AnonStash): boolean => {
  try {
    localStorage.setItem(
      STASH_KEY,
      JSON.stringify({
        id: q.id,
        text: q.text,
        ts: q.ts ?? Date.now(),
        ...(q.claimed === true ? { claimed: true } : {}),
      }),
    );
    return true;
  } catch {
    return false;
  }
};

export const clearStash = () => {
  try {
    localStorage.removeItem(STASH_KEY);
  } catch {
    /* same reasoning as saveStash — never block the caller's flow */
  }
};

/**
 * The parked question, or null — including when it is too old to belong to
 * whoever is at the keyboard now, in which case it is dropped on the way out so
 * it stops being offered on every later mount.
 *
 * A stash written before `ts` existed carries no proof of age, so it counts as
 * expired rather than as fresh: the only builds that wrote one are older than
 * this code, and treating an unknown age as claimable is exactly the leak the
 * timestamp exists to close. A stamp far in the *future* is just as untrustworthy
 * (a corrected clock, a hand-edited value) and is dropped the same way.
 */
export const readStash = (): AnonStash | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(localStorage.getItem(STASH_KEY) ?? 'null');
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== 'object') {
    return null;
  }

  const stash = parsed as AnonStash;
  const { ts } = stash;
  if (typeof ts !== 'number' || !(Math.abs(Date.now() - ts) <= STASH_MAX_AGE_MS)) {
    clearStash();
    return null;
  }
  return stash;
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
