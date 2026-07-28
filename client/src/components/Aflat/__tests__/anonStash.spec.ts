import {
  ACK_KEY,
  ACK_VERSION,
  clearStash,
  hasAcked,
  readStash,
  saveAck,
  saveStash,
} from '../anonStash';

describe('anonStash', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('pins the acknowledgement key to the wording version', () => {
    /**
     * Task 8 reads this key by name and the server stores `ackVersion` verbatim,
     * so both halves of the contract are pinned here.
     */
    expect(ACK_VERSION).toBe('v1-2026-07');
    expect(ACK_KEY).toBe('aflat_ack_v1-2026-07');
  });

  it('round-trips a stashed question through the contract key', () => {
    saveStash({ id: 'abc123', text: 'Câte zile de preaviz am?' });

    expect(localStorage.getItem('aflat_anon_q')).toBe(
      JSON.stringify({ id: 'abc123', text: 'Câte zile de preaviz am?' }),
    );
    expect(readStash()).toEqual({ id: 'abc123', text: 'Câte zile de preaviz am?' });
  });

  it('returns null when nothing is stashed', () => {
    expect(readStash()).toBeNull();
  });

  it('returns null instead of throwing on corrupt stash contents', () => {
    localStorage.setItem('aflat_anon_q', 'not json');
    expect(readStash()).toBeNull();
  });

  it('clears the stash', () => {
    saveStash({ id: 'abc123', text: 'x' });
    clearStash();
    expect(readStash()).toBeNull();
    expect(localStorage.getItem('aflat_anon_q')).toBeNull();
  });

  it('records the acknowledgement as an ISO timestamp under the versioned key', () => {
    expect(hasAcked()).toBe(false);

    saveAck();

    const stored = localStorage.getItem(ACK_KEY);
    expect(stored).not.toBeNull();
    expect(new Date(stored!).toISOString()).toBe(stored);
    expect(hasAcked()).toBe(true);
  });

  it('does not treat an acknowledgement of another wording version as current', () => {
    localStorage.setItem('aflat_ack_v0-2026-01', new Date().toISOString());
    expect(hasAcked()).toBe(false);
  });
});
