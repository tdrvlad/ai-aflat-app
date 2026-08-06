/**
 * Where an anonymous visitor's question lives between asking it and having an
 * account to ask it with.
 *
 * `localStorage`, and *only* `localStorage`, because the question is held before
 * any consent to hold it exists. Free-text legal questions routinely carry
 * health, criminal and family detail — Article 9 and Article 10 material — so a
 * server-side copy taken before the visitor has agreed to anything would need a
 * lawful basis this product does not have. Keeping it in the browser means the
 * only pre-consent record is one the person can clear themselves, and it still
 * survives the round trip through the identity provider, which is all the
 * handoff needs.
 *
 * The stash is **display state, not a credential.** Nothing here authorises
 * anything: `id` is never sent anywhere, and a visitor who hand-edits this key
 * buys exactly what typing into the composer buys.
 */
const STASH_KEY = 'aflat_anon_q';

/**
 * How long a stash survives at all.
 *
 * Only the legacy claim path — a question parked server-side by an earlier build
 * — can still be this old, and there the server's own claim window is the real
 * gate; this is the local half of it, expiring together with the claim cookie.
 * A browser-held question is subject to the much shorter window below.
 */
export const STASH_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * How long a browser-held question may still be asked automatically on sign-in.
 *
 * Shared browsers are the reason. A question that was never parked server-side
 * has no owner recorded anywhere, so nothing but its age can tell whether the
 * person now signing in is the person who typed it — the 404 that used to refuse
 * a stranger's claim does not exist on this path. On a family PC, a library
 * machine or a kiosk, a day-old stash would open the next person's first
 * conversation with someone else's legal question.
 *
 * Half an hour is the sitting this flow actually describes: type a question, see
 * the login modal, create the account, get the answer. Anything older is left
 * alone rather than asked.
 */
export const HANDOFF_MAX_AGE_MS = 30 * 60 * 1000;

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
  /**
   * The account a `claimed` question was confirmed to belong to. Persisted
   * whenever it is set, though the only caller that sets it writes it beside
   * that flag — a `uid` without `claimed` is inert, since nothing reads one
   * without the other. Direct delivery skips the server, so this is the only
   * thing left that can tell the owner from the next person to sign in on a
   * shared browser — where the question is already stamped with the *first*
   * account's id server-side, and would be shown to, and stored under, the
   * second. It grants nothing either: forging it buys exactly what typing into
   * the composer buys.
   */
  uid?: string;
};

/**
 * Returns false instead of throwing when storage is unavailable (all site data
 * blocked, quota exceeded). Callers must treat that as non-fatal: it costs the
 * visitor the automatic re-ask after sign-up, and nothing else — they still get
 * the account they came for and a composer that works. Reporting it as a failed
 * send would claim something broke when nothing did, and invite a retry that
 * cannot succeed.
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
        ...(q.uid != null ? { uid: q.uid } : {}),
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
