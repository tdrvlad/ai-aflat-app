import {
  HANDOFF_MAX_AGE_MS,
  STASH_MAX_AGE_MS,
  clearStash,
  readStash,
  saveStash,
} from '../anonStash';

describe('anonStash', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  /**
   * A question that was never parked server-side has no owner recorded anywhere,
   * so its age is the only thing standing between it and the next person to sign
   * in on a shared browser. It must stay far shorter than the outer stash TTL,
   * which only the legacy server-parked path still relies on.
   */
  it('bounds the automatic re-ask to a single sitting', () => {
    expect(HANDOFF_MAX_AGE_MS).toBe(30 * 60 * 1000);
    expect(HANDOFF_MAX_AGE_MS).toBeLessThan(STASH_MAX_AGE_MS);
  });

  it('round-trips a stashed question through the contract key', () => {
    const before = Date.now();
    saveStash({ id: 'abc123', text: 'Câte zile de preaviz am?' });

    const stored = JSON.parse(localStorage.getItem('aflat_anon_q')!);
    expect(stored).toMatchObject({ id: 'abc123', text: 'Câte zile de preaviz am?' });
    expect(stored.ts).toBeGreaterThanOrEqual(before);
    expect(stored.ts).toBeLessThanOrEqual(Date.now());
    expect(readStash()).toEqual(stored);
  });

  /**
   * The stash is display state, not a credential: authorisation to read a parked
   * question back is the `aflat_claim` httpOnly cookie, and `id` is never sent
   * anywhere. A question the post-login claim recovered from the server has no
   * local id to carry, so the text has to stand on its own.
   */
  it('stashes a question that has no id', () => {
    expect(saveStash({ text: 'Recuperată de la server' })).toBe(true);

    expect(readStash()).toMatchObject({ text: 'Recuperată de la server' });
    expect(readStash()!.id).toBeUndefined();
  });

  it('returns null when nothing is stashed', () => {
    expect(readStash()).toBeNull();
  });

  it('returns null instead of throwing on corrupt stash contents', () => {
    localStorage.setItem('aflat_anon_q', 'not json');
    expect(readStash()).toBeNull();
  });

  /**
   * The stash outlives the visit that created it, and browsers are shared —
   * a family PC, a library machine, a kiosk. Without an age limit, the next
   * person to sign up here inherits a stranger's question: it is shown to them,
   * asked as theirs, and `anon_questions.linkedUserId` is stamped with the wrong
   * subject. These four cases are that boundary.
   */
  describe('expiry', () => {
    const stashAged = (ageMs: number) =>
      localStorage.setItem(
        'aflat_anon_q',
        JSON.stringify({ id: 'abc123', text: 'x', ts: Date.now() - ageMs }),
      );

    it('still returns a question parked just inside the window', () => {
      stashAged(STASH_MAX_AGE_MS - 60_000);
      expect(readStash()).toMatchObject({ id: 'abc123', text: 'x' });
    });

    it('drops a question parked longer ago than the maximum age', () => {
      stashAged(STASH_MAX_AGE_MS + 60_000);

      expect(readStash()).toBeNull();
      expect(localStorage.getItem('aflat_anon_q')).toBeNull();
    });

    /** Written by the deployed build that predates `ts`: age unknown, so expired. */
    it('drops a legacy stash that carries no timestamp', () => {
      localStorage.setItem('aflat_anon_q', JSON.stringify({ id: 'abc123', text: 'x' }));

      expect(readStash()).toBeNull();
      expect(localStorage.getItem('aflat_anon_q')).toBeNull();
    });

    it('drops a stash whose timestamp is not a usable number', () => {
      localStorage.setItem(
        'aflat_anon_q',
        JSON.stringify({ id: 'abc123', text: 'x', ts: 'yesterday' }),
      );

      expect(readStash()).toBeNull();
      expect(localStorage.getItem('aflat_anon_q')).toBeNull();
    });

    /** A corrected clock must not make a stash immortal. */
    it('drops a stash stamped far in the future', () => {
      stashAged(-(STASH_MAX_AGE_MS + 60_000));

      expect(readStash()).toBeNull();
      expect(localStorage.getItem('aflat_anon_q')).toBeNull();
    });

    /**
     * The post-login claim re-parks a question it could not deliver. Restarting
     * the clock on every retry would let a stash live indefinitely, one failed
     * claim at a time.
     */
    it('keeps a supplied timestamp instead of restarting the clock', () => {
      const ts = Date.now() - STASH_MAX_AGE_MS / 2;
      saveStash({ id: 'abc123', text: 'x', ts });

      expect(readStash()).toEqual({ id: 'abc123', text: 'x', ts });
    });
  });

  it('clears the stash', () => {
    saveStash({ id: 'abc123', text: 'x' });
    clearStash();
    expect(readStash()).toBeNull();
    expect(localStorage.getItem('aflat_anon_q')).toBeNull();
  });

  it('reports a successful stash on a healthy store', () => {
    expect(saveStash({ id: 'abc123', text: 'x' })).toBe(true);
  });

  /**
   * Blocked or full storage must never propagate. It costs the visitor the
   * automatic re-ask after sign-up and nothing else, so a throw here would be
   * reported as a failed send — claiming something broke when nothing did, and
   * inviting a retry that cannot succeed.
   */
  describe('when localStorage throws (site data blocked / quota exceeded)', () => {
    const realSetItem = Storage.prototype.setItem;
    const realRemoveItem = Storage.prototype.removeItem;

    beforeEach(() => {
      Storage.prototype.setItem = jest.fn(() => {
        throw new DOMException('QuotaExceededError');
      });
      Storage.prototype.removeItem = jest.fn(() => {
        throw new DOMException('SecurityError');
      });
    });

    afterEach(() => {
      Storage.prototype.setItem = realSetItem;
      Storage.prototype.removeItem = realRemoveItem;
    });

    it('saveStash reports failure instead of throwing', () => {
      expect(() => saveStash({ id: 'abc123', text: 'x' })).not.toThrow();
      expect(saveStash({ id: 'abc123', text: 'x' })).toBe(false);
    });

    it('clearStash swallows the failure', () => {
      expect(() => clearStash()).not.toThrow();
    });
  });
});
