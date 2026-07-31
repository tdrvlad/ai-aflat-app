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

  return (
    <li
      data-testid="aflat-source-box"
      className={cn(
        'flex gap-3 rounded-[14px] border border-l-[3px] bg-surface-secondary px-[15px] py-[13px]',
        repealed ? 'border-border-destructive border-l-border-destructive' : 'border-border-light',
        !repealed && (muted ? 'border-l-border-light' : 'border-l-[color:var(--stitch)]'),
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'shrink-0 font-display text-base font-semibold tabular-nums leading-tight',
          repealed ? 'text-text-destructive' : 'text-text-tertiary',
        )}
      >
        {index}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-[5px]">
        {source.act_title != null && source.act_title !== '' && (
          <span
            data-testid="aflat-source-act"
            className={cn(
              'text-sm font-semibold leading-snug',
              muted ? 'text-text-secondary' : 'text-text-primary',
            )}
          >
            {source.act_title}
          </span>
        )}

        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {source.title != null && source.title !== '' && (
            <span className="text-xs text-text-secondary">{source.title}</span>
          )}
          {repealed && (
            <span
              data-testid="aflat-source-repealed"
              className="rounded border border-border-destructive px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.08em] text-text-destructive"
            >
              {localize('com_aflat_sources_repealed')}
            </span>
          )}
          {href == null && (
            <span
              data-testid="aflat-source-unlinked"
              className="rounded border border-border-light px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.06em] text-text-tertiary"
            >
              {localize('com_aflat_sources_unlinked')}
            </span>
          )}
        </span>

        {repealed && (
          <span className="text-[12.5px] font-semibold leading-snug text-text-destructive">
            {localize('com_aflat_sources_repealed_note')}
          </span>
        )}

        {source.snippet != null && source.snippet !== '' && (
          <span
            className={cn(
              'text-[12.5px] leading-relaxed',
              muted ? 'line-clamp-2 text-text-secondary' : 'text-text-secondary',
            )}
          >
            {source.snippet}
          </span>
        )}

        {/* Secondary sources stay a quiet disclosure — the act is named, but the
            answer did not lean on it, so it does not get an action of its own. */}
        {href != null && !muted && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 flex items-center gap-1.5 self-start text-[12.5px] font-semibold text-link underline underline-offset-[3px] hover:text-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
          >
            {localize('com_aflat_sources_open_law')}
            <ExternalLink aria-hidden="true" className="h-[13px] w-[13px] shrink-0" />
          </a>
        )}
      </div>
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
    <ol className="grid list-none gap-3 [grid-template-columns:repeat(auto-fit,minmax(272px,1fr))]">
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
      <div className="mb-3 flex items-center gap-3">
        <h3
          id={headingId}
          className="whitespace-nowrap text-xs font-bold uppercase tracking-[0.1em] text-text-destructive"
        >
          {localize('com_aflat_sources_heading')}
        </h3>
        <span aria-hidden="true" className="aa-stitch flex-1" />
      </div>

      {cited.length > 0 && <SourceList sources={cited} offset={0} />}

      {others.length > 0 && (
        <details data-testid="aflat-sources-secondary" className="group/others mt-3">
          <summary className="flex cursor-pointer list-none items-center gap-3 text-[12.5px] text-text-tertiary transition-colors marker:content-none hover:text-text-secondary [&::-webkit-details-marker]:hidden">
            <span className="whitespace-nowrap">
              {localize('com_aflat_sources_other_heading')} ({others.length})
            </span>
            <span aria-hidden="true" className="h-px flex-1 bg-border-light" />
          </summary>
          <div className="mt-3">
            <SourceList sources={others} offset={cited.length} muted />
          </div>
        </details>
      )}
    </section>
  );
});

export default Sources;
