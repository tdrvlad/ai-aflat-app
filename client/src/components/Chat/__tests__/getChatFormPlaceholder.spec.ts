import { getChatFormPlaceholder } from '../getChatFormPlaceholder';
import type { LocalizeFunction } from '~/common';

/**
 * The chat composer's placeholder used to be `undefined`, which meant it fell
 * through to `useTextarea`'s generic per-endpoint fallback ("Mesaj ai-aflat")
 * instead of the product's own Romanian prompt. This pins the product default
 * so that regression cannot come back quietly.
 *
 * The project-landing override this also used to cover went away with the
 * LibreChat projects feature on 2026-08-07.
 */
describe('getChatFormPlaceholder', () => {
  const localize: LocalizeFunction = ((key: string, options?: Record<string, string | number>) =>
    options ? `${key}:${JSON.stringify(options)}` : key) as LocalizeFunction;

  it('returns the product default, never the generic per-endpoint fallback', () => {
    expect(getChatFormPlaceholder({ localize })).toBe('com_aflat_chat_placeholder');
  });
});
