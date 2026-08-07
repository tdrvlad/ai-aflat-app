import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { Login, ApiErrorWatcher } from '~/components/Auth';
import { OAuthSuccess, OAuthError } from '~/components/OAuth';
import { AuthContextProvider } from '~/hooks/AuthContext';
import WithRum from '~/lib/rum/WithRum';
import RouteErrorBoundary from './RouteErrorBoundary';
import LoginLayout from './Layouts/Login';
import dashboardRoutes from './Dashboard';
import ShareRoute from './ShareRoute';
import ChatRoute from './ChatRoute';
import Search from './Search';
import Root from './Root';

const AuthLayout = () => (
  <AuthContextProvider>
    <WithRum>
      <Outlet />
    </WithRum>
    <ApiErrorWatcher />
  </AuthContextProvider>
);

const loadInlinePromptsView = () =>
  import('~/components/Prompts/layouts/InlinePromptsView').then((m) => ({
    Component: m.default,
  }));

const loadSkillsView = () =>
  import('~/components/Skills/layouts/SkillsView').then((m) => ({
    Component: m.default,
  }));

/** ai-aflat wallet. Lazy: most sessions never open it. */
const loadWallet = () =>
  import('~/components/Aflat/Wallet').then((m) => ({
    Component: m.Wallet,
  }));

const baseEl = document.querySelector('base');
const baseHref = baseEl?.getAttribute('href') || '/';

export const router = createBrowserRouter(
  [
    /**
     * Tombstones for the two screens the redesign removed.
     *
     * `/ask` and `/welcome` were the „defined twice" problem — separate front
     * doors for a signed-out visitor, when being signed out is a state of the
     * chat screen rather than a different destination. The screens are gone, but
     * the URLs survive in browser history and bookmarks, and without these they
     * would land on the router's raw 404 instead of the app.
     *
     * They redirect rather than render, and sit above the auth layout so nothing
     * boots on the way through. Safe to delete once no one is holding the links.
     */
    {
      path: 'ask',
      element: <Navigate to="/c/new" replace={true} />,
    },
    {
      path: 'welcome',
      element: <Navigate to="/c/new" replace={true} />,
    },
    {
      path: 'share/:shareId',
      element: <ShareRoute />,
      errorElement: <RouteErrorBoundary />,
    },
    {
      path: 'oauth',
      errorElement: <RouteErrorBoundary />,
      children: [
        {
          path: 'success',
          element: <OAuthSuccess />,
        },
        {
          path: 'error',
          element: <OAuthError />,
        },
      ],
    },
    {
      element: <AuthLayout />,
      errorElement: <RouteErrorBoundary />,
      children: [
        {
          path: '/',
          element: <LoginLayout />,
          children: [
            {
              path: 'login',
              element: <Login />,
            },
          ],
        },
        dashboardRoutes,
        {
          path: '/',
          element: <Root />,
          children: [
            {
              index: true,
              element: <Navigate to="/c/new" replace={true} />,
            },
            {
              path: 'c/:conversationId?',
              element: <ChatRoute />,
            },
            {
              path: 'search',
              element: <Search />,
            },
            {
              /* ai-aflat — the wallet. English slug, Romanian labels. */
              path: 'credits',
              lazy: loadWallet,
            },
            {
              path: 'prompts',
              element: <Navigate to="/prompts/new" replace={true} />,
            },
            {
              path: 'prompts/new',
              lazy: loadInlinePromptsView,
            },
            {
              path: 'prompts/:promptId',
              lazy: loadInlinePromptsView,
            },
            {
              path: 'skills',
              lazy: loadSkillsView,
            },
            {
              path: 'skills/new',
              lazy: loadSkillsView,
            },
            {
              path: 'skills/:skillId',
              lazy: loadSkillsView,
            },
            {
              path: 'skills/:skillId/edit',
              lazy: loadSkillsView,
            },
          ],
        },
      ],
    },
  ],
  { basename: baseHref },
);
