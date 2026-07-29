import { useLocalize } from '~/hooks';
import { TStartupConfig } from 'librechat-data-provider';

/**
 * The tagline is a legal-framing statement, not decoration: ai-aflat informs about
 * legislation and must never read as personalised counsel. It therefore stays on the
 * sign-in screen even when startupConfig is absent or carries no policy links —
 * hence the fallback URL and the removal of the old early return.
 */
const PRIVACY_POLICY_URL = 'https://ai-aflat.ro/confidentialitate';

const linkClass =
  'text-sm text-link underline decoration-transparent transition-all duration-200 hover:decoration-current focus:decoration-current';

function Footer({ startupConfig }: { startupConfig: TStartupConfig | null | undefined }) {
  const localize = useLocalize();

  const privacyPolicyUrl =
    startupConfig?.interface?.privacyPolicy?.externalUrl ?? PRIVACY_POLICY_URL;
  const termsOfServiceUrl = startupConfig?.interface?.termsOfService?.externalUrl;

  return (
    <div
      className="align-end m-4 flex flex-col items-center justify-center gap-1 text-center"
      role="contentinfo"
    >
      <p className="m-0 text-sm text-text-secondary">{localize('com_aflat_footer_tagline')}</p>
      <div className="flex items-center justify-center gap-2">
        <a
          className={linkClass}
          href={privacyPolicyUrl}
          // Removed for WCAG compliance
          // target={privacyPolicy.openNewTab ? '_blank' : undefined}
          rel="noreferrer"
        >
          {localize('com_ui_privacy_policy')}
        </a>
        {termsOfServiceUrl != null && termsOfServiceUrl !== '' && (
          <>
            <div className="h-4 border-r-[1px] border-border-medium" />
            <a
              className={linkClass}
              href={termsOfServiceUrl}
              // Removed for WCAG compliance
              // target={termsOfService.openNewTab ? '_blank' : undefined}
              rel="noreferrer"
            >
              {localize('com_ui_terms_of_service')}
            </a>
          </>
        )}
      </div>
    </div>
  );
}

export default Footer;
