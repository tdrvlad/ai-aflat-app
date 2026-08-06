import { useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks';

const STARTER_KEYS: TranslationKeys[] = [
  'com_aflat_starter_preaviz',
  'com_aflat_starter_constructie',
  'com_aflat_starter_zbor',
];

/**
 * Example questions. Tapping one asks it.
 *
 * They sit above the composer and send on tap, so the first thing a visitor
 * meets is a question they can ask rather than a field they have to fill. That
 * reverses the earlier behaviour, where a chip only populated the composer and
 * the send stayed a separate act. Nothing about the send itself is skipped: on a
 * first visit the acknowledgement gate still interposes before anything is
 * stored, and the chosen question is written into the composer where the visitor
 * can see it.
 *
 * Laid out as a vertical list rather than wrapped chips, and narrower than the
 * composer below them — they read as suggestions offered next to the input, not
 * as a second input. They carry no affordance icon: the whole row is the target,
 * and an arrow only competed with the send button for the same meaning.
 *
 * Half width applies from `sm` up. Below that they stay full width, because half
 * of a phone viewport is roughly 180px and these questions are a full sentence —
 * the narrow column would wrap every one of them to three or four lines.
 */
export default function StarterChips({ onPick }: { onPick: (text: string) => void }) {
  const localize = useLocalize();

  return (
    <div
      role="group"
      aria-label={localize('com_aflat_starters_label')}
      className="mx-auto mt-3 flex w-full flex-col gap-2 px-4 sm:w-1/2"
    >
      {STARTER_KEYS.map((key, index) => {
        const text = localize(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onPick(text)}
            style={{ animationDelay: `${index * 45}ms` }}
            className="aa-rise-slow flex min-h-[52px] w-full cursor-pointer items-center rounded-2xl border border-border-light bg-surface-secondary px-4 py-3 text-left transition-colors duration-150 hover:border-border-heavy hover:bg-surface-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary motion-reduce:transition-none"
          >
            <span className="text-sm leading-snug text-text-primary">{text}</span>
          </button>
        );
      })}
    </div>
  );
}
