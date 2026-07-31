import { ArrowRight } from 'lucide-react';
import { useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks';

const STARTER_KEYS: TranslationKeys[] = [
  'com_aflat_starter_preaviz',
  'com_aflat_starter_constructie',
  'com_aflat_starter_zbor',
];

/**
 * Example questions. They only fill the composer — sending stays an explicit
 * act, because the send is what parks the question server-side.
 *
 * Laid out as a vertical list rather than wrapped chips: on a phone these are
 * the dominant element under the composer, and a full-width row is both a
 * bigger touch target and easier to scan than a ragged two-line wrap.
 */
export default function StarterChips({ onPick }: { onPick: (text: string) => void }) {
  const localize = useLocalize();

  return (
    <div
      role="group"
      aria-label={localize('com_aflat_starters_label')}
      className="mt-3 flex w-full flex-col gap-2 px-4"
    >
      {STARTER_KEYS.map((key, index) => {
        const text = localize(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onPick(text)}
            style={{ animationDelay: `${index * 45}ms` }}
            className="aa-rise-slow flex min-h-[52px] w-full cursor-pointer items-center justify-between gap-3 rounded-2xl border border-border-light bg-surface-secondary px-4 py-3 text-left transition-colors duration-150 hover:border-border-heavy hover:bg-surface-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary motion-reduce:transition-none"
          >
            <span className="text-sm leading-snug text-text-primary">{text}</span>
            <ArrowRight
              aria-hidden="true"
              className="h-[15px] w-[15px] shrink-0 text-text-tertiary"
            />
          </button>
        );
      })}
    </div>
  );
}
