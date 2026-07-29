import { getChatFormPlaceholder } from '../getChatFormPlaceholder';
import type { LocalizeFunction } from '~/common';

/**
 * The chat composer's placeholder used to be `undefined` outside a project
 * landing page, which meant it fell through to `useTextarea`'s generic
 * per-endpoint fallback ("Mesaj ai-aflat") instead of the product's own
 * Romanian prompt. These cases pin the product default and make sure the
 * project-landing override (which names the project) still wins there.
 */
describe('getChatFormPlaceholder', () => {
  const localize: LocalizeFunction = ((key: string, options?: Record<string, string | number>) =>
    options ? `${key}:${JSON.stringify(options)}` : key) as LocalizeFunction;

  it('returns the product default outside a project landing page', () => {
    const result = getChatFormPlaceholder({ isProjectLandingPage: false, localize });
    expect(result).toBe('com_aflat_chat_placeholder');
  });

  it('returns the product default when isProjectLandingPage is true but no project name is given', () => {
    const result = getChatFormPlaceholder({ isProjectLandingPage: true, localize });
    expect(result).toBe('com_aflat_chat_placeholder');
  });

  it('returns the product default for an empty project name', () => {
    const result = getChatFormPlaceholder({
      isProjectLandingPage: true,
      projectName: '',
      localize,
    });
    expect(result).toBe('com_aflat_chat_placeholder');
  });

  it('names the project on a project landing page', () => {
    const result = getChatFormPlaceholder({
      isProjectLandingPage: true,
      projectName: 'Litigii civile',
      localize,
    });
    expect(result).toBe('com_ui_new_chat_in_project:{"name":"Litigii civile"}');
  });

  it('ignores a project name when not on a project landing page', () => {
    const result = getChatFormPlaceholder({
      isProjectLandingPage: false,
      projectName: 'Litigii civile',
      localize,
    });
    expect(result).toBe('com_aflat_chat_placeholder');
  });
});
