import React from 'react';
import fs from 'fs';
import path from 'path';
import { RecoilRoot } from 'recoil';
import '@testing-library/jest-dom/extend-expect';
import { render, screen, renderHook } from '@testing-library/react';
import { ActivePanelProvider, resolveActivePanel } from '~/Providers/ActivePanelContext';

/**
 * The conversation-history panel is the product's chat history. It is prepended in
 * `useUnifiedSidebarLinks` *outside* `useSideNavLinks`, so none of the `interface:`
 * flags this deployment sets to false (modelSelect / presets / prompts / bookmarks /
 * multiConvo / agents) can take it away. These tests pin that, and pin the light-theme
 * token that made the panel invisible once `--presentation` moved onto the linen ground.
 */

jest.mock('~/components/UnifiedSidebar/ConversationsSection', () => ({
  __esModule: true,
  default: () => <div data-testid="conversations-panel" />,
}));

/**
 * What `useSideNavLinks` actually returns under this deployment's librechat.yaml:
 * agents/prompts/bookmarks/parameters are all gated off, only the unconditional
 * files link survives.
 */
jest.mock('~/hooks/Nav/useSideNavLinks', () => {
  const { Paperclip } = jest.requireActual('lucide-react');
  return {
    __esModule: true,
    default: () => [
      {
        title: 'com_sidepanel_attach_files',
        label: '',
        icon: Paperclip,
        id: 'files',
        Component: () => <div data-testid="files-panel" />,
      },
    ],
  };
});

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({
    data: {
      interface: {
        modelSelect: false,
        presets: false,
        prompts: false,
        bookmarks: false,
        multiConvo: false,
        agents: false,
      },
    },
  }),
  useGetEndpointsQuery: () => ({ data: { 'ai-aflat': { type: 'custom' } } }),
}));

jest.mock('librechat-data-provider/react-query', () => ({
  useUserKeyQuery: () => ({ data: { expiresAt: undefined } }),
}));

jest.mock('~/store', () => {
  const { atom } = jest.requireActual('recoil');
  let counter = 0;
  return {
    __esModule: true,
    default: {
      conversationByIndex: () =>
        atom({ key: `convo-panel-mock-${counter++}`, default: { endpoint: 'ai-aflat' } }),
    },
  };
});

import useUnifiedSidebarLinks from '~/hooks/Nav/useUnifiedSidebarLinks';
import SidePanelNav from '~/components/SidePanel/Nav';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <RecoilRoot>{children}</RecoilRoot>
);

describe('conversation-history panel survives the disabled interface flags', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('is the first sidebar link even with every optional surface disabled', () => {
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });

    expect(result.current[0].id).toBe('conversations');
    expect(result.current[0].title).toBe('com_ui_chat_history');
    expect(result.current[0].Component).toBeDefined();
    expect(result.current.map((l) => l.id)).toEqual(['conversations', 'files']);
  });

  it('mounts by default through the real SidePanelNav', () => {
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });

    render(
      <RecoilRoot>
        <ActivePanelProvider>
          <SidePanelNav links={result.current} />
        </ActivePanelProvider>
      </RecoilRoot>,
    );

    expect(screen.getByTestId('conversations-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('files-panel')).not.toBeInTheDocument();
  });

  it('falls back to it when localStorage still points at a now-disabled panel', () => {
    localStorage.setItem('side:active-panel', 'prompts');
    const { result } = renderHook(() => useUnifiedSidebarLinks(), { wrapper });

    expect(resolveActivePanel('prompts', result.current)).toBe('conversations');

    render(
      <RecoilRoot>
        <ActivePanelProvider>
          <SidePanelNav links={result.current} />
        </ActivePanelProvider>
      </RecoilRoot>,
    );

    expect(screen.getByTestId('conversations-panel')).toBeInTheDocument();
  });
});

describe('the sidebar keeps a ground of its own in both themes', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../../style.css'), 'utf8');

  const themeBlock = (selector: string) => {
    const start = css.indexOf(`\n${selector} {`);
    expect(start).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf('\n}', start));
  };

  const tokenOf = (block: string, name: string) => {
    const match = block.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm'));
    expect(match).not.toBeNull();
    return (match as RegExpMatchArray)[1].trim();
  };

  /** `bg-surface-primary-alt` is the sidebar ground; the chat pane is `bg-presentation`. */
  it.each([
    ['light', 'html'],
    ['dark', '.dark'],
  ])('%s: --surface-primary-alt is not the chat ground', (_theme, selector) => {
    const block = themeBlock(selector);
    const sidebar = tokenOf(block, '--surface-primary-alt');

    expect(sidebar).not.toBe(tokenOf(block, '--presentation'));
    expect(sidebar).not.toBe(tokenOf(block, '--surface-primary'));
    expect(sidebar).not.toBe(tokenOf(block, '--surface-chat'));
  });

  it.each([
    ['light', 'html'],
    ['dark', '.dark'],
  ])('%s: the active-conversation highlight is not the sidebar ground', (_theme, selector) => {
    const block = themeBlock(selector);

    expect(tokenOf(block, '--surface-active-alt')).not.toBe(
      tokenOf(block, '--surface-primary-alt'),
    );
  });
});
