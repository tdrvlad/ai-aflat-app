import type { LocalizeFunction } from '~/common';

/**
 * The authenticated chat composer's placeholder.
 *
 * A one-line function on purpose. It exists because the composer used to pass
 * `undefined` here and fall through to `useTextarea`'s generic per-endpoint
 * fallback ("Mesaj ai-aflat") instead of the product's own Romanian prompt —
 * so this is the place that guarantees the product default, and it is unit
 * tested away from the component's provider stack.
 *
 * It took a project name until 2026-08-07, when the LibreChat projects feature
 * was removed; there is exactly one placeholder now.
 */
export function getChatFormPlaceholder({ localize }: { localize: LocalizeFunction }): string {
  return localize('com_aflat_chat_placeholder');
}
