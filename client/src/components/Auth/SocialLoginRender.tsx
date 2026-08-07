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
 *
 * Gated on `openidLoginEnabled` ALONE. It used to also require
 * `socialLoginEnabled` (`ALLOW_SOCIAL_LOGIN`), which made sense when that flag
 * meant "offer third-party providers alongside our own email form" — there is no
 * email form any more, and no other provider, so the flag's only remaining
 * effect was to hide the last door on `/login` and render the page with no way
 * to sign in at all. `.env.example` ships `ALLOW_SOCIAL_LOGIN=false`, and
 * `isEnabled(undefined)` is also false, so the failure was the default rather
 * than an unlucky setting. `/login` is reachable: `Root` sends users there when
 * they decline the terms modal.
 *
 * This is the second silent gate on the same button — `OPENID_SESSION_SECRET`
 * being unset is the first (see TOC.md). Both fail closed and neither logs.
 */
function SocialLoginRender({
  startupConfig,
}: {
  startupConfig: TStartupConfig | null | undefined;
}) {
  if (startupConfig?.openidLoginEnabled !== true) {
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
