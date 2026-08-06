import { OpenIDIcon } from '@librechat/client';

import SocialButton from './SocialButton';

import { TStartupConfig } from 'librechat-data-provider';

/**
 * ai-aflat: OpenID is the only provider left.
 *
 * The Apple, Discord, Facebook, GitHub, Google and SAML strategies were deleted
 * from the server (see `api/strategies/index.js`), so `/oauth/<provider>` no
 * longer exists for any of them — rendering their buttons would have offered
 * doors that answer 404. Google and the rest are still reachable, but through
 * Clerk's embedded widget, not through LibreChat.
 *
 * OpenID *is* Clerk: this is the redirect fallback the embedded flow degrades to
 * when `clerkPublishableKey` is unset (design 2026-08-04 §4).
 */
function SocialLoginRender({
  startupConfig,
}: {
  startupConfig: TStartupConfig | null | undefined;
}) {
  if (!startupConfig?.socialLoginEnabled || !startupConfig.openidLoginEnabled) {
    return null;
  }

  return (
    <div className="mt-2">
      <SocialButton
        key="openid"
        enabled={startupConfig.openidLoginEnabled}
        serverDomain={startupConfig.serverDomain}
        oauthPath="openid"
        Icon={() =>
          startupConfig.openidImageUrl ? (
            <img src={startupConfig.openidImageUrl} alt="OpenID Logo" className="h-5 w-5" />
          ) : (
            <OpenIDIcon />
          )
        }
        label={startupConfig.openidLabel}
        id="openid"
      />
    </div>
  );
}

export default SocialLoginRender;
