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
 */
export default function StarterChips({ onPick }: { onPick: (text: string) => void }) {
  const localize = useLocalize();

  return (
    <div
      role="group"
      aria-label={localize('com_aflat_starters_label')}
      className="mt-2 flex w-full flex-wrap items-stretch justify-center gap-2 px-4"
    >
      {STARTER_KEYS.map((key, index) => {
        const text = localize(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onPick(text)}
            style={{ animationDelay: `${index * 75}ms`, animationFillMode: 'backwards' }}
            className="flex max-w-[16rem] cursor-pointer items-center justify-center rounded-2xl border border-border-medium bg-surface-secondary px-4 py-2.5 text-center text-sm text-text-secondary shadow-sm transition-colors duration-200 fade-in hover:border-border-heavy hover:bg-surface-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
          >
            <span className="line-clamp-2 text-balance break-words">{text}</span>
          </button>
        );
      })}
    </div>
  );
}
