import { memo, useId, useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import type { TAflatSource } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type SourcesProps = {
  sources: TAflatSource[];
};

type SourceBoxProps = {
  source: TAflatSource;
  index: number;
  muted?: boolean;
};

/**
 * The link the box shows is the one retrieval returned, or none at all. A URL is
 * never constructed, completed or repaired here: anything that is not already an
 * absolute http(s) address renders as a box without a link, exactly like a
 * missing one. Every legal reference a user sees has to trace back to something
 * the search engine actually returned.
 */
const linkHref = (url?: string): string | undefined => {
  if (typeof url !== 'string') {
    return undefined;
  }
  return /^https?:\/\//i.test(url.trim()) ? url : undefined;
};

const SourceBox = memo(function SourceBox({ source, index, muted = false }: SourceBoxProps) {
  const localize = useLocalize();
  const href = linkHref(source.url);
  const repealed = source.in_force === false;

  const body = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'w-6 shrink-0 self-stretch border-r pr-2 pt-px font-display text-base tabular-nums leading-tight',
          repealed ? 'border-border-destructive text-text-destructive' : 'border-border-light',
          muted ? 'text-text-tertiary' : 'text-text-secondary',
        )}
      >
        {index}
      </span>
      <span className="min-w-0 flex-1">
        {source.act_title != null && source.act_title !== '' && (
          <span
            data-testid="aflat-source-act"
            className="line-clamp-2 text-sm font-semibold leading-snug text-text-primary underline-offset-2 group-hover/source:underline"
          >
            {source.act_title}
          </span>
        )}
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {source.title != null && source.title !== '' && (
            <span className="text-xs font-medium text-text-secondary">{source.title}</span>
          )}
          {repealed && (
            <span
              data-testid="aflat-source-repealed"
              className="rounded border border-border-destructive px-1 py-px text-[11px] font-semibold uppercase tracking-wide text-text-destructive"
            >
              {localize('com_aflat_sources_repealed')}
            </span>
          )}
        </span>
        {repealed && (
          <span className="mt-1 block text-xs leading-snug text-text-destructive">
            {localize('com_aflat_sources_repealed_note')}
          </span>
        )}
        {source.snippet != null && source.snippet !== '' && (
          <span
            className={cn(
              'mt-1.5 text-xs leading-relaxed text-text-secondary',
              muted ? 'line-clamp-1' : 'line-clamp-2',
            )}
          >
            {source.snippet}
          </span>
        )}
        {href != null && <span className="sr-only">{localize('com_aflat_sources_open')}</span>}
      </span>
      {href != null && (
        <ExternalLink
          aria-hidden="true"
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-tertiary opacity-60 transition-opacity group-hover/source:opacity-100"
        />
      )}
    </>
  );

  const shared = cn(
    'group/source flex w-full gap-3 rounded-xl border border-l-2 border-border-light p-3 text-left no-underline transition-colors duration-150 motion-reduce:transition-none',
    repealed ? 'border-l-border-destructive' : 'border-l-border-light',
    muted ? 'bg-transparent' : 'bg-surface-secondary',
  );

  return (
    <li data-testid="aflat-source-box">
      {href != null ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            shared,
            'hover:border-border-medium hover:bg-surface-tertiary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary',
          )}
        >
          {body}
        </a>
      ) : (
        <div className={shared}>{body}</div>
      )}
    </li>
  );
});

const SourceList = memo(function SourceList({
  sources,
  offset,
  muted,
}: {
  sources: TAflatSource[];
  offset: number;
  muted?: boolean;
}) {
  return (
    <ol className="grid list-none grid-cols-1 gap-2 sm:grid-cols-2">
      {sources.map((source, i) => (
        <SourceBox
          key={`source-${offset + i}-${source.entity_id ?? source.url ?? i}`}
          source={source}
          index={offset + i + 1}
          muted={muted}
        />
      ))}
    </ol>
  );
});

/**
 * Sources — the legislative citation boxes shown under an answer.
 *
 * Renders the `sources` content part (`ContentTypes.SOURCES`) exactly as
 * retrieval delivered it: one numbered box per source, numbered continuously so
 * a later phase can reference a box from the answer text. Sources the answer did
 * not lean on (`cited: false`) sit apart under a quieter disclosure; when no item
 * carries a `cited` field, every source counts as cited. An empty array renders
 * nothing at all — empty retrieval is a normal outcome, not something to announce.
 */
const Sources = memo(function Sources({ sources }: SourcesProps) {
  const localize = useLocalize();
  const headingId = useId();

  const { cited, others } = useMemo(() => {
    const list = Array.isArray(sources) ? sources.filter((source) => source != null) : [];
    return {
      cited: list.filter((source) => source.cited !== false),
      others: list.filter((source) => source.cited === false),
    };
  }, [sources]);

  if (cited.length === 0 && others.length === 0) {
    return null;
  }

  return (
    <section
      data-testid="aflat-sources"
      aria-labelledby={headingId}
      className="mb-2 mt-4 w-full [.text-message+&]:mt-4"
    >
      <div className="mb-2 flex items-center gap-3">
        <h3
          id={headingId}
          className="text-xs font-semibold uppercase tracking-[0.14em] text-text-tertiary"
        >
          {localize('com_aflat_sources_heading')}
        </h3>
        <span aria-hidden="true" className="h-px flex-1 bg-border-light" />
      </div>

      {cited.length > 0 && <SourceList sources={cited} offset={0} />}

      {others.length > 0 && (
        <details data-testid="aflat-sources-secondary" className="group/others mt-3">
          <summary className="flex cursor-pointer list-none items-center gap-3 text-xs font-medium text-text-tertiary transition-colors marker:content-none hover:text-text-secondary [&::-webkit-details-marker]:hidden">
            <span>
              {localize('com_aflat_sources_other_heading')} ({others.length})
            </span>
            <span aria-hidden="true" className="h-px flex-1 bg-border-light" />
          </summary>
          <div className="mt-2">
            <SourceList sources={others} offset={cited.length} muted />
          </div>
        </details>
      )}
    </section>
  );
});

export default Sources;
