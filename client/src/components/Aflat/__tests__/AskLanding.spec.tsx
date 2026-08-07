import React from 'react';
import { render, screen, fireEvent, act } from 'test/layout-test-utils';
import AskLanding from '../AskLanding';
import Landing from '~/components/Chat/Landing';

/**
 * The anonymous shell and the signed-in shell must show the SAME empty-chat
 * screen. They were separately authored once, drifted, and a new account's first
 * sight of the product was a different screen from the one that had just talked
 * them into creating it. This suite is what makes that a build failure rather
 * than a thing someone notices in a browser three weeks later.
 *
 * Test language is pinned to `en` in `client/test/setupTests.js`.
 */

const mockSubmitMessage = jest.fn();
const mockSetValue = jest.fn();

/**
 * The leaf modules, not the barrels. Spreading `requireActual` over `~/hooks` or
 * `~/Providers` pulls the whole app graph through a circular require and the
 * suite dies before a single case runs.
 */
jest.mock('~/hooks/Messages/useSubmitMessage', () => ({
  __esModule: true,
  default: () => ({ submitMessage: mockSubmitMessage, submitPrompt: jest.fn() }),
}));

jest.mock('~/Providers/ChatFormContext', () => ({
  __esModule: true,
  ChatFormProvider: ({ children }: { children: React.ReactNode }) => children,
  useChatFormContext: () => ({ setValue: mockSetValue }),
}));

/** Everything the screen promises, in the order it promises it. */
const landingContents = (container: HTMLElement) => ({
  heading: screen.getByRole('heading', { level: 1 }).textContent,
  subheading: container.querySelector('h1 + p')?.textContent,
  starters: screen
    .getAllByRole('button')
    .map((button) => button.textContent)
    .filter((text): text is string => text != null && text.length > 0),
  hasMark: container.querySelector('svg, img') != null,
});

describe('AskLanding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the mark, the invitation and the examples', () => {
    const { container } = render(<AskLanding onPick={() => undefined} />);

    const contents = landingContents(container);
    expect(contents.heading).toBe('Ask anything about Romanian legislation');
    expect(contents.subheading).toBeTruthy();
    expect(contents.hasMark).toBe(true);
    expect(contents.starters.length).toBeGreaterThan(0);
  });

  it('drops the examples once a question is on its way', () => {
    render(<AskLanding />);

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  // THE POINT OF THE COMPONENT. If this fails, the two shells have diverged again.
  it('renders the identical screen in the signed-in shell', () => {
    const anon = render(<AskLanding onPick={() => undefined} />);
    const anonContents = landingContents(anon.container);
    anon.unmount();

    const signedIn = render(<Landing centerFormOnLanding={false} />);
    const signedInContents = landingContents(signedIn.container);

    expect(signedInContents).toEqual(anonContents);
  });

  it('writes a tapped example into the composer before sending it', () => {
    jest.useFakeTimers();
    try {
      render(<Landing centerFormOnLanding={false} />);
      const starter = screen.getAllByRole('button')[0];
      const question = starter.textContent as string;

      fireEvent.click(starter);
      // Written first, so the send is never silent…
      expect(mockSetValue).toHaveBeenCalledWith('text', question, expect.anything());
      expect(mockSubmitMessage).not.toHaveBeenCalled();

      // …and sent after the dwell.
      act(() => {
        jest.advanceTimersByTime(400);
      });
      expect(mockSubmitMessage).toHaveBeenCalledWith({ text: question });
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores a second tap while one is already on its way', () => {
    jest.useFakeTimers();
    try {
      render(<Landing centerFormOnLanding={false} />);
      const starters = screen.getAllByRole('button');

      fireEvent.click(starters[0]);
      fireEvent.click(starters[1]);
      act(() => {
        jest.advanceTimersByTime(400);
      });

      expect(mockSubmitMessage).toHaveBeenCalledTimes(1);
      expect(mockSubmitMessage).toHaveBeenCalledWith({ text: starters[0].textContent });
    } finally {
      jest.useRealTimers();
    }
  });
});
