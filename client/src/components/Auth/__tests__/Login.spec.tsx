import reactRouter from 'react-router-dom';
import type { TStartupConfig } from 'librechat-data-provider';
import { render, queryByTestId } from 'test/layout-test-utils';
import * as endpointQueries from '~/data-provider/Endpoints/queries';
import * as miscDataProvider from '~/data-provider/Misc/queries';
import * as authMutations from '~/data-provider/Auth/mutations';
import * as authQueries from '~/data-provider/Auth/queries';
import AuthLayout from '~/components/Auth/AuthLayout';
import Login from '~/components/Auth/Login';

jest.mock('librechat-data-provider/react-query');

/**
 * ai-aflat: LibreChat's local auth is gone (design 2026-08-04 §3), so `/login`
 * has exactly two shapes — the embedded Clerk widget when a publishable key is
 * configured, and the OpenID redirect button when it is not. There is no email
 * field, no password field and no sign-up link to assert on any more; what these
 * tests guard is that none of them came back.
 */
const mockStartupConfig = {
  isFetching: false,
  isLoading: false,
  isError: false,
  data: {
    socialLogins: ['openid'],
    openidLoginEnabled: true,
    openidLabel: 'Test OpenID',
    openidImageUrl: 'http://test-server.com',
    ldap: {
      enabled: false,
    },
    registrationEnabled: false,
    emailLoginEnabled: false,
    socialLoginEnabled: true,
    serverDomain: 'mock-server',
  },
};

const setup = ({
  useGetUserQueryReturnValue = {
    isLoading: false,
    isError: false,
    data: {},
  },
  useRefreshTokenMutationReturnValue = {
    isLoading: false,
    isError: false,
    mutate: jest.fn(),
    data: {
      token: 'mock-token',
      user: {},
    },
  },
  useGetStartupConfigReturnValue = mockStartupConfig,
  useGetBannerQueryReturnValue = {
    isLoading: false,
    isError: false,
    data: {},
  },
} = {}) => {
  const mockUseGetUserQuery = jest
    .spyOn(authQueries, 'useGetUserQuery')
    //@ts-ignore - we don't need all parameters of the QueryObserverSuccessResult
    .mockReturnValue(useGetUserQueryReturnValue);
  const mockUseGetStartupConfig = jest
    .spyOn(endpointQueries, 'useGetStartupConfig')
    //@ts-ignore - we don't need all parameters of the QueryObserverSuccessResult
    .mockReturnValue(useGetStartupConfigReturnValue);
  const mockUseRefreshTokenMutation = jest
    .spyOn(authMutations, 'useRefreshTokenMutation')
    //@ts-ignore - we don't need all parameters of the QueryObserverSuccessResult
    .mockReturnValue(useRefreshTokenMutationReturnValue);
  const mockUseGetBannerQuery = jest
    .spyOn(miscDataProvider, 'useGetBannerQuery')
    //@ts-ignore - we don't need all parameters of the QueryObserverSuccessResult
    .mockReturnValue(useGetBannerQueryReturnValue);
  const mockUseOutletContext = jest.spyOn(reactRouter, 'useOutletContext').mockReturnValue({
    startupConfig: useGetStartupConfigReturnValue.data,
  });
  const renderResult = render(
    <AuthLayout
      startupConfig={useGetStartupConfigReturnValue.data as TStartupConfig}
      isFetching={useGetStartupConfigReturnValue.isFetching}
      error={null}
      startupConfigError={null}
      header={'Welcome back'}
      pathname="login"
    >
      <Login />
    </AuthLayout>,
  );
  return {
    ...renderResult,
    mockUseGetUserQuery,
    mockUseOutletContext,
    mockUseGetStartupConfig,
    mockUseRefreshTokenMutation,
    mockUseGetBannerQuery,
  };
};

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useOutletContext: () => ({
    startupConfig: mockStartupConfig,
  }),
}));

test('renders the OpenID redirect button when Clerk is not embedded', () => {
  const { getByRole } = setup();
  expect(getByRole('link', { name: /Test OpenID/i })).toBeInTheDocument();
  expect(getByRole('link', { name: /Test OpenID/i })).toHaveAttribute(
    'href',
    'mock-server/oauth/openid',
  );
});

test('renders no local email/password form', () => {
  const { queryByLabelText, queryByRole } = setup();
  expect(queryByLabelText(/password/i)).not.toBeInTheDocument();
  expect(queryByTestId(document.body, 'login-button')).not.toBeInTheDocument();
  expect(queryByRole('link', { name: /Sign up/i })).not.toBeInTheDocument();
});

test('offers no provider other than OpenID', () => {
  const { queryByRole } = setup({
    useGetStartupConfigReturnValue: {
      ...mockStartupConfig,
      data: {
        ...mockStartupConfig.data,
        socialLogins: ['google', 'facebook', 'openid', 'github', 'discord', 'saml'],
        // @ts-ignore - deleted strategies; the flags can no longer be true in production
        googleLoginEnabled: true,
        facebookLoginEnabled: true,
        githubLoginEnabled: true,
        discordLoginEnabled: true,
        samlLoginEnabled: true,
      },
    },
  });
  expect(queryByRole('link', { name: /Continue with Google/i })).not.toBeInTheDocument();
  expect(queryByRole('link', { name: /Continue with Facebook/i })).not.toBeInTheDocument();
  expect(queryByRole('link', { name: /Continue with Github/i })).not.toBeInTheDocument();
  expect(queryByRole('link', { name: /Continue with Discord/i })).not.toBeInTheDocument();
});
