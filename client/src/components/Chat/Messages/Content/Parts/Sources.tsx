import { memo, useId, useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import type { TAflatSource, TAflatSourceAct } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type SourcesProps = {
  sources: TAflatSource[];
  sourcesByAct?: TAflatSourceAct[];
};

type ActCardProps = {
  act: TAflatSourceAct;
  numbering: Map<TAflatSource, number>;
  muted?: boolean;
};

type ProvisionProps = {
  provision: TAflatSource;
  index: number;
  actHref?: string;
  muted?: boolean;
};

/**
 * The link a box shows is the one retrieval returned, or none at all. A URL is
 * never constructed, completed or repaired here: anything that is not already an
 * absolute http(s) address renders without an anchor, exactly like a missing one.
 * Every legal reference a user sees has to trace back to something the search
 * engine actually returned.
 */
const linkHref = (url?: string): string | undefined => {
  if (typeof url !== 'string') {
    return undefined;
  }
  return /^https?:\/\//i.test(url.trim()) ? url : undefined;
};

const present = (value?: string): value is string => value != null && value !== '';

/**
 * The orchestrator's own reference for a source is `S1`, `S2`… — the user sees the
 * bare numeral so the boxes stay countable, but it is the engine's number, not one
 * this component invented, so a later phase can cite a box from the answer text.
 */
const refNumeral = (ref?: string, fallback = 0): number => {
  const match = typeof ref === 'string' ? /^S(\d+)$/.exec(ref.trim()) : null;
  return match != null ? Number(match[1]) : fallback;
};

/**
 * One act per card, its provisions nested — several provisions of a single act is
 * the normal shape of a retrieval, not a defect, so six boxes all headed
 * "Codul muncii" would read as broken.
 */
const groupByAct = (sources: TAflatSource[]): TAflatSourceAct[] => {
  const groups = new Map<string, TAflatSourceAct>();
  for (const source of sources) {
    const key = source.act_id != null ? `id:${source.act_id}` : `title:${source.act_title ?? ''}`;
    const existing = groups.get(key);
    if (existing != null) {
      existing.provisions.push(source);
      if (source.cited !== false) {
        existing.cited = true;
      }
      continue;
    }
    groups.set(key, {
      act_id: source.act_id,
      act_title: source.act_title,
      url: source.url,
      in_force: source.in_force,
      likely_amending: source.likely_amending,
      cited: source.cited !== false,
      provisions: [source],
    });
  }
  return [...groups.values()];
};

const Provision = memo(function Provision({
  provision,
  index,
  actHref,
  muted = false,
}: ProvisionProps) {
  const localize = useLocalize();
  const viewerHref = linkHref(provision.viewer_url);
  const officialHref = linkHref(provision.url);
  /* The official act link lives once in the card footer; a provision only repeats
     it when it is that provision's *only* way back to the source text. */
  const fallbackHref = viewerHref == null && officialHref !== actHref ? officialHref : undefined;
  const repealed = provision.in_force === false;

  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className={cn(
          'shrink-0 font-display text-sm font-semibold tabular-nums leading-6',
          repealed ? 'text-text-destructive' : 'text-text-tertiary',
        )}
      >
        {index}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {present(provision.title) && (
            <span
              data-testid="aflat-provision-title"
              className={cn(
                'text-sm font-semibold leading-snug',
                muted ? 'text-text-secondary' : 'text-text-primary',
              )}
            >
              {provision.title}
            </span>
          )}
          {present(provision.path) && (
            <span data-testid="aflat-provision-path" className="text-xs text-text-tertiary">
              {provision.path}
            </span>
          )}
          {repealed && (
            <span
              data-testid="aflat-source-repealed"
              className="rounded border border-border-destructive px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.08em] text-text-destructive"
            >
              {localize('com_aflat_sources_repealed')}
            </span>
          )}
          {viewerHref == null && fallbackHref == null && actHref == null && (
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

        {present(provision.snippet) && (
          <span
            className={cn(
              'text-[12.5px] leading-relaxed text-text-secondary',
              muted && 'line-clamp-2',
            )}
          >
            {provision.snippet}
          </span>
        )}

        {/* Provenance: the cheapest trust signal there is — why retrieval surfaced
            this provision at all. Quiet, but never hidden. */}
        {present(provision.why) && (
          <span
            data-testid="aflat-provision-why"
            className="text-[11.5px] leading-snug text-text-tertiary"
          >
            {provision.why}
          </span>
        )}

        {viewerHref != null && (
          <a
            data-testid="aflat-provision-link"
            href={viewerHref}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 flex items-center gap-1.5 self-start text-[12.5px] font-semibold text-link underline underline-offset-[3px] hover:text-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
          >
            {localize('com_aflat_sources_open_article')}
            <ExternalLink aria-hidden="true" className="h-[13px] w-[13px] shrink-0" />
          </a>
        )}

        {fallbackHref != null && (
          <a
            data-testid="aflat-provision-link"
            href={fallbackHref}
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

const ActCard = memo(function ActCard({ act, numbering, muted = false }: ActCardProps) {
  const localize = useLocalize();
  const repealed = act.in_force === false;
  const amending = act.likely_amending === true;
  const officialHref = linkHref(act.url);

  const provisions = useMemo(
    () => [...act.provisions].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity)),
    [act.provisions],
  );

  return (
    <li
      data-testid="aflat-source-act-card"
      className={cn(
        'flex flex-col gap-[9px] rounded-[14px] border border-l-[3px] bg-surface-secondary px-[15px] py-[13px]',
        repealed ? 'border-border-destructive border-l-border-destructive' : 'border-border-light',
        !repealed && (muted ? 'border-l-border-light' : 'border-l-[color:var(--stitch)]'),
      )}
    >
      <div className="flex flex-col gap-[5px]">
        {present(act.act_title) && (
          <span
            data-testid="aflat-source-act"
            title={act.act_title}
            className={cn(
              'line-clamp-3 text-sm font-semibold leading-snug',
              muted ? 'text-text-secondary' : 'text-text-primary',
            )}
          >
            {act.act_title}
          </span>
        )}

        {(repealed || amending) && (
          <span className="flex flex-wrap items-center gap-2">
            {repealed && (
              <span
                data-testid="aflat-act-repealed"
                className="rounded border border-border-destructive px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.08em] text-text-destructive"
              >
                {localize('com_aflat_sources_repealed')}
              </span>
            )}
            {amending && (
              <span
                data-testid="aflat-act-amending"
                className="rounded border border-border-medium px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.06em] text-text-secondary"
              >
                {localize('com_aflat_sources_amending')}
              </span>
            )}
          </span>
        )}

        {repealed && (
          <span className="text-[12.5px] font-semibold leading-snug text-text-destructive">
            {localize('com_aflat_sources_repealed_note')}
          </span>
        )}

        {/* An amending act carries the *change*, not the law being changed. Saying so
            is the difference between a correct citation and a misattributed one. */}
        {amending && (
          <span
            data-testid="aflat-act-amending-note"
            className="text-[12px] leading-snug text-text-secondary"
          >
            {localize('com_aflat_sources_amending_note')}
          </span>
        )}
      </div>

      <ol className="flex list-none flex-col gap-[11px]">
        {provisions.map((provision, i) => (
          <Provision
            key={`provision-${provision.entity_id ?? provision.ref ?? i}`}
            provision={provision}
            index={numbering.get(provision) ?? i + 1}
            actHref={officialHref}
            muted={muted}
          />
        ))}
      </ol>

      {officialHref != null && (
        <a
          data-testid="aflat-act-link"
          href={officialHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 self-start text-[11.5px] text-text-tertiary underline underline-offset-[3px] transition-colors hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
        >
          {localize('com_aflat_sources_open')}
          <ExternalLink aria-hidden="true" className="h-3 w-3 shrink-0" />
        </a>
      )}
    </li>
  );
});

const ActList = memo(function ActList({
  acts,
  numbering,
  muted,
}: {
  acts: TAflatSourceAct[];
  numbering: Map<TAflatSource, number>;
  muted?: boolean;
}) {
  return (
    <ol className="grid list-none gap-3">
      {acts.map((act, i) => (
        <ActCard
          key={`act-${act.act_id ?? act.act_title ?? i}`}
          act={act}
          numbering={numbering}
          muted={muted}
        />
      ))}
    </ol>
  );
});

/**
 * Sources — the legislative citation boxes shown under an answer.
 *
 * Renders the `sources` content part (`ContentTypes.SOURCES`) exactly as retrieval
 * delivered it, grouped one card per act with that act's provisions nested inside:
 * a query routinely returns five provisions of the Labour Code, and a flat list of
 * five boxes all headed "Codul muncii" reads as a bug. The orchestrator's own
 * `sources_by_act` grouping is used when it sent one; otherwise the flat list is
 * grouped here by act.
 *
 * Acts the answer did not lean on (`cited: false`) sit apart under a quieter
 * disclosure — unless nothing is marked cited at all, in which case everything is
 * treated as cited rather than hiding every citation the answer has. An empty
 * array renders nothing: empty retrieval is a normal outcome, not something to
 * announce.
 */
const Sources = memo(function Sources({ sources, sourcesByAct }: SourcesProps) {
  const localize = useLocalize();
  const headingId = useId();

  const { cited, others, numbering } = useMemo(() => {
    const flat = Array.isArray(sources) ? sources.filter((source) => source != null) : [];
    const grouped =
      Array.isArray(sourcesByAct) && sourcesByAct.length > 0
        ? sourcesByAct.filter((act) => act != null && Array.isArray(act.provisions))
        : groupByAct(flat);

    const acts = grouped.filter((act) => act.provisions.length > 0);
    const anyCited = acts.some((act) => act.cited !== false);

    /* The numeral is the orchestrator's `S<n>`; only sources that arrived without
       one fall back to a running count, so the two never collide. */
    const numbers = new Map<TAflatSource, number>();
    let next = 1;
    for (const act of acts) {
      for (const provision of act.provisions) {
        const numeral = refNumeral(provision.ref);
        numbers.set(provision, numeral > 0 ? numeral : next);
        next = Math.max(next, numeral) + 1;
      }
    }

    return {
      numbering: numbers,
      cited: anyCited ? acts.filter((act) => act.cited !== false) : acts,
      others: anyCited ? acts.filter((act) => act.cited === false) : [],
    };
  }, [sources, sourcesByAct]);

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

      {cited.length > 0 && <ActList acts={cited} numbering={numbering} />}

      {others.length > 0 && (
        <details data-testid="aflat-sources-secondary" className="group/others mt-3">
          <summary className="flex cursor-pointer list-none items-center gap-3 text-[12.5px] text-text-tertiary transition-colors marker:content-none hover:text-text-secondary [&::-webkit-details-marker]:hidden">
            <span className="whitespace-nowrap">
              {localize('com_aflat_sources_other_heading')} ({others.length})
            </span>
            <span aria-hidden="true" className="h-px flex-1 bg-border-light" />
          </summary>
          <div className="mt-3">
            <ActList acts={others} numbering={numbering} muted />
          </div>
        </details>
      )}
    </section>
  );
});

export default Sources;
