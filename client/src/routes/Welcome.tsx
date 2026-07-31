import { useNavigate } from 'react-router-dom';
import { loginPage } from 'librechat-data-provider';
import { ThemeSelector } from '@librechat/client';
import { BrandLockup, APP_NAME } from '~/components/Brand';
import { useLocalize } from '~/hooks';

/**
 * Welcome — the first screen an unauthenticated visitor sees.
 *
 * It exists to remove an interruption, not to add one. Before this screen the
 * product's framing („informații despre legislație, nu consultanță juridică")
 * was delivered as a bar that swallowed the visitor's first send; here it is
 * stated up front, in the open, and the visitor chooses their own door:
 * sign in now, or ask first and sign in when there is an answer to read.
 *
 * Deliberately outside the authenticated shell — no session, no auth context,
 * no authenticated queries — exactly like `/ask`.
 */
export default function Welcome() {
  const localize = useLocalize();
  const navigate = useNavigate();

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-presentation text-text-primary">
      {/* Folk field — decorative, faded out well before the reading column. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[color:var(--motif)]"
        style={{
          maskImage:
            'url(assets/motif/tile-folk.png), linear-gradient(180deg, #000 0%, #000 26%, transparent 72%)',
          WebkitMaskImage:
            'url(assets/motif/tile-folk.png), linear-gradient(180deg, #000 0%, #000 26%, transparent 72%)',
          maskSize: '232px 114px, 100% 100%',
          WebkitMaskSize: '232px 114px, 100% 100%',
          maskRepeat: 'repeat, no-repeat',
          WebkitMaskRepeat: 'repeat, no-repeat',
          maskComposite: 'intersect',
          WebkitMaskComposite: 'source-in',
        }}
      />

      <header className="relative flex items-center justify-between gap-4 px-6 py-5">
        <BrandLockup className="h-[34px]" alt={localize('com_ui_logo', { 0: APP_NAME })} />
        <a
          href={loginPage()}
          data-testid="aflat-welcome-signin"
          className="text-sm font-semibold text-link underline underline-offset-[3px] transition-colors hover:text-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
        >
          {localize('com_aflat_welcome_signin')}
        </a>
      </header>

      <main className="relative flex flex-1 flex-col items-center justify-center px-6 pb-10 pt-4 text-center">
        <div className="aa-rise-slow flex max-w-[640px] flex-col items-center gap-[18px]">
          <h1 className="m-0 text-balance font-display text-[clamp(30px,5vw,52px)] font-semibold leading-[1.1] tracking-[-0.01em]">
            {localize('com_aflat_ask_heading')}
          </h1>
          <p className="m-0 max-w-[34em] text-balance text-[clamp(15px,1.4vw,18px)] leading-relaxed text-text-secondary">
            {localize('com_aflat_ask_subheading')}
          </p>

          {/* The framing invariant, stated where it can be read — not as a gate. */}
          <div className="mt-1.5 max-w-[36em] rounded-[18px] border border-border-light bg-surface-secondary px-5 py-4">
            <div className="text-xs font-bold uppercase tracking-[0.1em] text-text-destructive">
              {localize('com_aflat_welcome_framing_title')}
            </div>
            <p className="m-0 mt-2 text-sm leading-relaxed text-text-secondary">
              {localize('com_aflat_welcome_framing_body')}
            </p>
          </div>

          <div className="mt-1 flex w-full flex-wrap justify-center gap-2.5">
            <a
              href={loginPage()}
              data-testid="aflat-welcome-create"
              className="flex min-h-[48px] flex-1 basis-[220px] items-center justify-center rounded-xl bg-cta px-4 text-[15px] font-semibold text-white transition-colors hover:bg-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary motion-reduce:transition-none"
            >
              {localize('com_aflat_welcome_create_account')}
            </a>
            <button
              type="button"
              data-testid="aflat-welcome-anon"
              onClick={() => navigate('/ask')}
              className="flex min-h-[48px] flex-1 basis-[220px] cursor-pointer items-center justify-center rounded-xl border border-border-light bg-surface-primary px-4 text-[15px] font-semibold text-text-primary transition-colors hover:border-cta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary motion-reduce:transition-none"
            >
              {localize('com_aflat_welcome_try_anon')}
            </button>
          </div>

          <div className="mt-2.5 flex flex-wrap justify-center gap-x-[22px] gap-y-2 text-[13px] text-text-secondary">
            <span>{localize('com_aflat_welcome_stat_acts')}</span>
            <span aria-hidden="true" className="text-border-medium">
              ·
            </span>
            <span>{localize('com_aflat_welcome_stat_daily')}</span>
            <span aria-hidden="true" className="text-border-medium">
              ·
            </span>
            <span>{localize('com_aflat_welcome_stat_source')}</span>
          </div>
        </div>
      </main>

      <footer className="relative flex items-center justify-between gap-4 px-6 pb-5 pt-4 text-[13px] text-text-secondary">
        <ThemeSelector returnThemeOnly={true} />
        <div className="flex gap-4">
          <a
            href="https://ai-aflat.ro/termeni"
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-[3px] hover:underline"
          >
            {localize('com_aflat_welcome_terms')}
          </a>
          <a
            href="https://ai-aflat.ro/confidentialitate"
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-[3px] hover:underline"
          >
            {localize('com_aflat_ack_privacy_link')}
          </a>
        </div>
      </footer>
    </div>
  );
}
