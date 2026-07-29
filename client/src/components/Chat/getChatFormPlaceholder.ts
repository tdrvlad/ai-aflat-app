import type { LocalizeFunction } from '~/common';

/**
 * The authenticated chat composer's placeholder. Split out from `ChatView`
 * so the project-vs-default choice is unit-testable without the component's
 * provider stack (recoil/react-query/chat contexts).
 *
 * A project landing page keeps its own placeholder (names the project); every
 * other case — including the plain new-chat landing page, which previously
 * passed `undefined` and fell through to the generic per-endpoint
 * `useTextarea` fallback ("Mesaj ai-aflat") — gets the product's own
 * Romanian prompt instead.
 */
export function getChatFormPlaceholder({
  isProjectLandingPage,
  projectName,
  localize,
}: {
  isProjectLandingPage: boolean;
  projectName?: string;
  localize: LocalizeFunction;
}): string {
  if (isProjectLandingPage && projectName != null && projectName !== '') {
    return localize('com_ui_new_chat_in_project', { name: projectName });
  }
  return localize('com_aflat_chat_placeholder');
}
