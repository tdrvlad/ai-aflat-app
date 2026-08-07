import { render, screen } from '@testing-library/react';
import type { TStartupConfig } from 'librechat-data-provider';
import SocialLoginRender from '../SocialLoginRender';

/**
 * `/login` has exactly one door left — the OIDC button, which is Clerk. These
 * cases pin what may and may not hide it, because every way it disappears is
 * silent: no error, no log, just a sign-in page with nothing to click.
 *
 * The regression these guard against was live: the button also required
 * `socialLoginEnabled` (`ALLOW_SOCIAL_LOGIN`), which `.env.example` ships as
 * `false` and which `isEnabled(undefined)` also resolves to false. The default
 * configuration hid the only door.
 */

jest.mock('@librechat/client', () => ({
  OpenIDIcon: () => <span data-testid="openid-icon" />,
}));

jest.mock('../SocialButton', () => ({
  __esModule: true,
  default: ({ label, oauthPath }: { label?: string; oauthPath: string }) => (
    <button type="button" data-testid="social-button" data-oauth-path={oauthPath}>
      {label}
    </button>
  ),
}));

const config = (overrides: Partial<TStartupConfig> = {}) =>
  ({
    openidLoginEnabled: true,
    openidLabel: 'Continuă cu Clerk',
    serverDomain: 'https://app.ai-aflat.ro',
    ...overrides,
  }) as TStartupConfig;

describe('SocialLoginRender', () => {
  it('renders the OIDC button when openid login is enabled', () => {
    render(<SocialLoginRender startupConfig={config()} />);

    expect(screen.getByTestId('social-button')).toHaveAttribute('data-oauth-path', 'openid');
    expect(screen.getByText('Continuă cu Clerk')).toBeInTheDocument();
  });

  /**
   * The actual regression. `ALLOW_SOCIAL_LOGIN` describes third-party providers
   * offered *alongside* a local email form; neither exists here, so it must not
   * be able to suppress the only remaining sign-in path.
   */
  it('still renders when socialLoginEnabled is false — OpenID is not a social add-on', () => {
    render(<SocialLoginRender startupConfig={config({ socialLoginEnabled: false })} />);

    expect(screen.getByTestId('social-button')).toBeInTheDocument();
  });

  it('renders nothing when openid login is genuinely disabled', () => {
    const { container } = render(
      <SocialLoginRender startupConfig={config({ openidLoginEnabled: false })} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  /**
   * Before the startup config query resolves there is no answer yet — rendering
   * a door that may not exist is worse than rendering none for one frame.
   */
  it('renders nothing while the startup config is still unknown', () => {
    const { container: nullConfig } = render(<SocialLoginRender startupConfig={null} />);
    const { container: undefinedConfig } = render(<SocialLoginRender startupConfig={undefined} />);

    expect(nullConfig).toBeEmptyDOMElement();
    expect(undefinedConfig).toBeEmptyDOMElement();
  });
});
