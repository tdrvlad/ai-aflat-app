import { cn } from '~/utils';

/** The product name as it is written everywhere in the UI — lowercase, one hyphen. */
export const APP_NAME = 'ai-aflat';

/**
 * The „Pânza” wordmark, swapped by theme the same way the website does it: the navy
 * lockup on the linen ground, the white lockup on the night ground.
 *
 * The swap is CSS, not state, so it also holds for the `system` theme setting, where
 * no React code knows which way the OS is leaning. Both files therefore sit in the
 * DOM at once — only the visible one carries the alt text, so assistive technology
 * announces the brand a single time.
 */
export default function BrandLockup({ className, alt }: { className?: string; alt: string }) {
  return (
    <span className={cn('inline-flex items-center justify-center', className)}>
      <img
        src="assets/logo-lockup-dark.png"
        className="h-full w-auto max-w-full object-contain dark:hidden"
        alt={alt}
      />
      <img
        src="assets/logo-lockup-light.png"
        className="hidden h-full w-auto max-w-full object-contain dark:block"
        alt=""
        aria-hidden="true"
      />
    </span>
  );
}
