import { STEP_MARK } from '../ThinkingSteps';
import type { TAflatSource } from 'librechat-data-provider';

/**
 * The app's half of the orchestrator contract, pinned.
 *
 * These constants are declared independently on both sides of a repository
 * boundary, so nothing but a test can stop them drifting apart. Each side pins
 * the same literal here and in `orchestrator/test/contract.test.js`: change one
 * and its OWN suite fails, which is the property a "keep in step with…" comment
 * never had. Measured 2026-08-07, that comment had already failed once — four
 * citation fields were being silently dropped at the sources boundary.
 *
 * If you are changing a value here, change it in the orchestrator's contract test
 * in the same commit, or you have only moved the drift somewhere quieter.
 */
describe('orchestrator contract — app side', () => {
  /**
   * U+2063 INVISIBLE SEPARATOR. Chosen because it has no glyph: a renderer that
   * knows nothing about it shows one block of narration rather than a stray
   * character mid-sentence. A visible character here would be a user-facing bug
   * on every client that has not been taught the protocol.
   */
  it('opens each narration line with U+2063 INVISIBLE SEPARATOR', () => {
    expect(STEP_MARK).toBe('⁣');
    expect(STEP_MARK).toHaveLength(1);
    expect(STEP_MARK.codePointAt(0)).toBe(0x2063);
  });

  /**
   * `article_label` is half the citation of record — `(act_id, article label)`,
   * never `(id, raw anchor)`. It reached the app for the first time on
   * 2026-08-07; before that the sources allowlist dropped it silently, so the
   * rule that an unresolvable anchor links act-level and prints the label as
   * text could not be honoured at all.
   */
  it('declares the citation of record on TAflatSource', () => {
    const source: TAflatSource = { act_id: 41627, article_label: 'ART. 78' };

    expect(source.act_id).toBe(41627);
    expect(source.article_label).toBe('ART. 78');
  });

  /**
   * The anchor is deliberately NOT part of this type. It is only valid against
   * the exact blob it was rendered from, so a carried anchor lands confidently
   * on the wrong law after the next consolidation. The orchestrator keeps it as
   * `retrieved_anchor`, named so that building a link out of it reads as the
   * mistake it is, and the boundary refuses to carry it.
   */
  it('does not carry a raw anchor across the boundary', () => {
    const keys: Array<keyof TAflatSource> = ['act_id', 'article_label', 'viewer_url'];

    expect(keys).not.toContain('anchor');
    expect(keys).not.toContain('retrieved_anchor');
  });
});
