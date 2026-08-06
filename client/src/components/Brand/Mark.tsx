import { cn } from '~/utils';

/**
 * The icon mark — the scales inside the speech bubble.
 *
 * Swapped by theme the same way {@link BrandLockup} handles the wordmark: the
 * navy contour on the linen ground, the white fill on the night ground. Both
 * files sit in the DOM at once and the swap is CSS rather than state, so it also
 * holds under the `system` theme setting, where no React code knows which way
 * the OS is leaning.
 *
 * These are the transparent marks, not the PWA tile (`icon-192x192.png`). The
 * tile carries its own navy square, which reads as a pasted-on app icon
 * wherever it sits on the page rather than as part of it.
 *
 * Decorative by default. Wherever the lockup already names the product in the
 * same view — the header sits above every one of these screens — a second
 * announcement of „ai-aflat" is noise to a screen reader, so `alt` is only worth
 * passing when the mark is the sole identification on screen.
 */
export default function BrandMark({ className, alt = '' }: { className?: string; alt?: string }) {
  const decorative = alt === '';

  return (
    <span className={cn('inline-flex items-center justify-center', className)}>
      <img
        src="assets/mark-contour.png"
        className="h-full w-auto max-w-full object-contain dark:hidden"
        alt={alt}
        aria-hidden={decorative ? true : undefined}
      />
      <img
        src="assets/mark-white.png"
        className="hidden h-full w-auto max-w-full object-contain dark:block"
        alt=""
        aria-hidden="true"
      />
    </span>
  );
}
