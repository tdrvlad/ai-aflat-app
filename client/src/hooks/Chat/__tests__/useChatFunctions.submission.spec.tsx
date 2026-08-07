import { renderHook, act } from '@testing-library/react';
import { Constants, QueryKeys } from 'librechat-data-provider';
import type { TConversation, TMessage, TSubmission } from 'librechat-data-provider';
import useChatFunctions from '../useChatFunctions';

/**
 * CHARACTERIZATION of what `ask()` actually puts on the wire.
 *
 * `useChatFunctions` builds every outgoing message in the product, and until
 * now its only tests covered regenerate *history* selection — four cases about
 * which messages get resubmitted, nothing about the submission itself. A change
 * to payload construction could not be caught by the suite, which is why the
 * LibreChat `manualSkills` plumbing was left in place during the 2026-08-07
 * feature removals rather than deleted blind.
 *
 * These cases pin the shape as it is TODAY. They are deliberately assertions
 * about the contract with the backend rather than about internals: the text the
 * user typed, which conversation it belongs to, which flags mark a fresh submit
 * apart from a regenerate/continue/edit, and which optional fields are omitted
 * when empty rather than sent as empty arrays.
 */

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

/**
 * `ai-aflat` is a CUSTOM endpoint, and `parseCompactConvo` resolves its schema
 * through `endpointsConfig[endpoint].type`. Without the type it throws
 * "Unknown endpoint" — which is exactly what production would do if the
 * endpoints query had not landed, so the config is modelled rather than stubbed
 * empty.
 */
const mockGetQueryData = jest.fn((key: unknown) => {
  const name = Array.isArray(key) ? key[0] : key;
  return name === QueryKeys.endpoints ? { 'ai-aflat': { type: 'custom' } } : {};
});
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ getQueryData: mockGetQueryData, setQueryData: jest.fn() }),
}));

/**
 * Recoil is replaced rather than wrapped in a RecoilRoot so the two `drain`
 * callbacks — manual skills and quoted excerpts — can be driven directly. Both
 * resolve to empty here, which is the state of every real submit since the
 * Skills feature was removed: nothing fills those queues any more.
 */
const mockReset = jest.fn();
let mockPendingByAtom: Record<string, string[]> = {};
jest.mock('recoil', () => ({
  useRecoilValue: () => false,
  useSetRecoilState: () => jest.fn(),
  useRecoilCallback:
    (factory: (ctx: unknown) => unknown) =>
    (...args: unknown[]) => {
      const ctx = {
        snapshot: {
          getLoadable: (atomKey: string) => ({
            state: 'hasValue',
            contents: mockPendingByAtom[String(atomKey)] ?? [],
          }),
        },
        reset: mockReset,
        set: jest.fn(),
      };
      return (factory(ctx) as (...a: unknown[]) => unknown)(...args);
    },
}));

/**
 * A Proxy rather than a list of atoms: this hook touches a dozen of them and
 * enumerating each only produces a test that breaks when an unrelated atom is
 * added. Every property resolves to a stable key, callable as an atom family.
 */
jest.mock('~/store', () => ({
  __esModule: true,
  default: new Proxy(
    {},
    {
      get: (_target, prop: string) => {
        const key = String(prop);
        const atom = (param?: unknown) => `${key}-${String(param)}`;
        atom.toString = () => key;
        return atom;
      },
    },
  ),
  useGetEphemeralAgent: () => () => null,
}));

jest.mock('~/hooks/Chat/useFocusRegeneratedResponse', () => ({
  __esModule: true,
  default: () => jest.fn(),
}));
jest.mock('~/hooks/Files/useSetFilesToDelete', () => ({
  __esModule: true,
  default: () => jest.fn(),
}));
jest.mock('~/hooks/Conversations/useGetSender', () => ({
  __esModule: true,
  default: () => () => 'Assistant',
}));
jest.mock('~/hooks/Input/useUserKey', () => ({
  __esModule: true,
  default: () => ({ getExpiry: () => null }),
}));
jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ user: { id: 'user-1', name: 'Vlad' } }),
}));

const conversation = {
  conversationId: Constants.NEW_CONVO,
  endpoint: 'ai-aflat',
  model: 'standard-search',
  title: null,
} as unknown as TConversation;

const setup = (overrides: Partial<Parameters<typeof useChatFunctions>[0]> = {}) => {
  const setSubmission = jest.fn();
  const setMessages = jest.fn();
  const { result } = renderHook(() =>
    useChatFunctions({
      index: 0,
      isSubmitting: false,
      conversation,
      latestMessage: null,
      getMessages: () => [] as TMessage[],
      setMessages,
      setSubmission: setSubmission as never,
      ...overrides,
    }),
  );
  return { ask: result.current.ask, setSubmission, setMessages };
};

const submissionFrom = (setSubmission: jest.Mock): TSubmission =>
  setSubmission.mock.calls.at(-1)?.[0] as TSubmission;

describe('ask() — what actually goes on the wire', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPendingByAtom = {};
  });

  it('carries the typed text verbatim on the user message', () => {
    const { ask, setSubmission } = setup();

    act(() => {
      ask({ text: 'Câte zile de preaviz am la demisie?' });
    });

    expect(setSubmission).toHaveBeenCalledTimes(1);
    expect(submissionFrom(setSubmission).userMessage.text).toBe(
      'Câte zile de preaviz am la demisie?',
    );
  });

  it('marks a fresh submit as neither regenerate, continue nor edit', () => {
    const { ask, setSubmission } = setup();

    act(() => {
      ask({ text: 'o întrebare' });
    });

    expect(submissionFrom(setSubmission)).toMatchObject({
      isRegenerate: false,
      isContinued: false,
      isEdited: false,
    });
  });

  it('sends the message as created by the user, with the conversation endpoint', () => {
    const { ask, setSubmission } = setup();

    act(() => {
      ask({ text: 'o întrebare' });
    });

    const submission = submissionFrom(setSubmission);
    expect(submission.userMessage.isCreatedByUser).toBe(true);
    expect(submission.userMessage.sender).toBe('User');
    expect(submission.endpointOption.endpoint).toBe('ai-aflat');
  });

  /**
   * A new conversation is submitted with a null id — the server mints it — and
   * the route is pushed to /c/new. Sending `NEW_CONVO` as a literal id would
   * create a conversation actually called "new".
   */
  it('submits a new conversation with a null id and routes to /c/new', () => {
    const { ask, setSubmission } = setup();

    act(() => {
      ask({ text: 'o întrebare' });
    });

    expect(submissionFrom(setSubmission).conversation.conversationId).toBeNull();
    expect(mockNavigate).toHaveBeenCalledWith('/c/new', { state: { focusChat: true } });
  });

  /**
   * Projects were removed on 2026-08-07. Nothing sets `?projectId` any more, so
   * no submission may carry a project scope — and the route must not grow a
   * query string.
   */
  it('never scopes a submission to a chat project', () => {
    const { ask, setSubmission } = setup();

    act(() => {
      ask({ text: 'o întrebare' });
    });

    expect(submissionFrom(setSubmission).conversation).not.toHaveProperty('chatProjectId');
    expect(mockNavigate).toHaveBeenCalledWith('/c/new', expect.anything());
  });

  /**
   * Empty means ABSENT, not `[]`. The backend distinguishes the two, and this is
   * the property that makes the leftover `manualSkills` plumbing inert: with the
   * Skills feature gone nothing fills the queue, so the field is omitted from
   * every real submit.
   */
  it('omits manualSkills and quotes entirely when nothing is queued', () => {
    const { ask, setSubmission } = setup();

    act(() => {
      ask({ text: 'o întrebare' });
    });

    const submission = submissionFrom(setSubmission);
    expect(submission.manualSkills).toBeUndefined();
    expect(submission.userMessage.manualSkills).toBeUndefined();
    expect(submission.userMessage.quotes).toBeUndefined();
  });

  /**
   * The optimistic pair the UI renders while the answer streams: the user's own
   * message, then a placeholder response. Losing either is what makes a sent
   * question appear to vanish.
   */
  it('optimistically renders the user message and a placeholder response', () => {
    const { ask, setMessages } = setup();

    act(() => {
      ask({ text: 'o întrebare' });
    });

    const rendered = setMessages.mock.calls.at(-1)?.[0] as TMessage[];
    expect(rendered).toHaveLength(2);
    expect(rendered[0]).toMatchObject({ text: 'o întrebare', isCreatedByUser: true });
    expect(rendered[1].isCreatedByUser).toBe(false);
    expect(rendered[1].messageId).toBe(submissionFromMessages(rendered));
  });

  it('refuses to submit while a submission is already in flight', () => {
    const { ask, setSubmission } = setup({ isSubmitting: true });

    act(() => {
      ask({ text: 'o întrebare' });
    });

    expect(setSubmission).not.toHaveBeenCalled();
  });

  it('refuses an empty message rather than sending a blank turn', () => {
    const { ask, setSubmission } = setup();

    act(() => {
      ask({ text: '   ' });
    });

    expect(setSubmission).not.toHaveBeenCalled();
  });
});

/** The placeholder's id is the one the submission reserves for the response. */
function submissionFromMessages(rendered: TMessage[]): string {
  return rendered[1].messageId;
}
