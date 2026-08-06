import { memo, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks';
import { cn } from '~/utils';

/**
 * ai-aflat: the thinking view — what the assistant is doing while the user waits.
 *
 * Implements the Claude Design prototype "The thinking view, in motion" (1g). Two things about it
 * are the design, not decoration:
 *
 * **Four steps, not ten.** The engine's pipeline is route → plan → gather → refine → hydrate →
 * diversity → articles → select → zoom → assemble. Those are names for its own internals, and a
 * person asking about collective redundancy has no use for any of them. The design collapses them
 * to the four things that person actually cares about: I rephrased your question, I searched the
 * corpus, I chose which acts answer it, I read the exact articles. The folding happens on the
 * server (`orchestrator/src/thinkingView.js`) so the shape is one decision in one place.
 *
 * **Every number is measured.** Nothing here is a placeholder or an estimate. Act titles appear
 * only once a retrieval lane returned them, counts are the engine's own `len()`s, and a count that
 * did not arrive renders as nothing rather than as a zero — "0 acte" and "we have not looked yet"
 * are different claims and only one is true. This is the screen that has to earn the citations
 * underneath it.
 *
 * The wire format is one JSON object per line in the reasoning text, each line opened by
 * `STEP_MARK`; see `orchestrator/src/narration.js` for why that channel and not `stage_label`.
 * A line that does not parse is shown as plain text, so any other model's thinking still renders.
 */

/** Keep in step with `STEP_MARK` in orchestrator/src/narration.js. */
export const STEP_MARK = '\u2063';

type StepKey = 'plan' | 'gather' | 'select' | 'zoom' | 'answer';

const ORDER: StepKey[] = ['plan', 'gather', 'select', 'zoom'];

/** How many act titles stay on screen. See the note where they are rendered. */
const MAX_VISIBLE_ACTS = 6;

type Update =
  | { k: 'step'; s: StepKey }
  | { k: 'plan'; q?: string[]; total?: number; lex?: string; intent?: string; filters?: Filter[] }
  | {
      k: 'search';
      done?: number;
      total?: number;
      results?: number;
      inspected?: number;
      force?: boolean;
    }
  | { k: 'act'; t: string }
  | { k: 'dedup'; kept?: number; from?: number }
  | { k: 'chosen'; n?: number; from?: number }
  | { k: 'articles'; n?: number }
  | { k: 'summary'; articles?: number; acts?: number; ms?: number };

type Filter = { t: string; force?: boolean };

export type ThinkingModel = {
  current: StepKey | null;
  queries: string[];
  lexical?: string;
  intent?: string;
  filters: Filter[];
  inForce: boolean;
  searchesDone?: number;
  searchesTotal?: number;
  inspected?: number;
  acts: string[];
  dedup?: { kept?: number; from?: number };
  chosen?: { n?: number; from?: number };
  articles?: number;
  summary?: { articles?: number; acts?: number; ms?: number };
  /** Lines that were not view updates — another model's thinking, or a future field. */
  text: string[];
};

const EMPTY: ThinkingModel = {
  current: null,
  queries: [],
  filters: [],
  inForce: false,
  acts: [],
  text: [],
};

/**
 * Folds the append-only update log into the view's state.
 *
 * Later updates overwrite earlier ones of the same kind rather than accumulating, because the
 * engine re-reports running totals rather than deltas — `sub_queries_done` counts up, it does not
 * increment. Acts are the exception and are appended, deduplicated by title: a lane can return the
 * same act for two different sub-queries, and listing it twice would overstate what was found.
 */
export function buildThinkingModel(text: string): ThinkingModel {
  const model: ThinkingModel = { ...EMPTY, queries: [], filters: [], acts: [], text: [] };
  const seenActs = new Set<string>();

  for (const chunk of text.split(STEP_MARK)) {
    const line = chunk.trim();
    if (line === '') {
      continue;
    }

    let update: Update | null = null;
    try {
      update = JSON.parse(line) as Update;
    } catch {
      /* Not ours. Kept verbatim so nothing a model said is silently dropped. */
      model.text.push(line);
      continue;
    }

    switch (update.k) {
      case 'step':
        model.current = update.s;
        break;
      case 'plan':
        model.queries = update.q ?? [];
        model.lexical = update.lex;
        model.intent = update.intent;
        model.filters = update.filters ?? [];
        if (update.total != null) {
          model.searchesTotal = update.total;
        }
        break;
      case 'search':
        model.searchesDone = update.done ?? model.searchesDone;
        model.searchesTotal = update.total ?? model.searchesTotal;
        model.inspected = update.inspected ?? model.inspected;
        model.inForce = model.inForce || update.force === true;
        break;
      case 'act':
        if (!seenActs.has(update.t)) {
          seenActs.add(update.t);
          model.acts.push(update.t);
        }
        break;
      case 'dedup':
        model.dedup = { kept: update.kept, from: update.from };
        break;
      case 'chosen':
        model.chosen = { n: update.n, from: update.from };
        break;
      case 'articles':
        model.articles = update.n;
        break;
      case 'summary':
        model.summary = { articles: update.articles, acts: update.acts, ms: update.ms };
        break;
      default:
        break;
    }
  }

  return model;
}

export const hasThinkingSteps = (text: string): boolean => text.includes(STEP_MARK);

type Unit = 'search' | 'result' | 'article' | 'act';

/**
 * Romanian takes „de" before a noun from twenty up: 4 rezultate, but 24 *de* rezultate. Getting
 * this wrong is the single most obvious tell that copy was written by a machine, and this view is
 * full of counts.
 */
const usePlural = () => {
  const localize = useLocalize();
  return (n: number, unit: Unit): string => {
    const word = localize(
      n === 1 ? (`com_aflat_unit_${unit}_one` as const) : (`com_aflat_unit_${unit}_few` as const),
    );
    return n >= 20 ? `${n} de ${word}` : `${n} ${word}`;
  };
};

const seconds = (ms?: number) => (ms == null ? null : `${Math.round(ms / 1000)}s`);

/** One heading per step. `answer` never reaches here — `finished` wins first. */
const HEAD_KEYS: Record<StepKey, TranslationKeys> = {
  plan: 'com_aflat_think_planning',
  gather: 'com_aflat_think_searching',
  select: 'com_aflat_think_choosing',
  zoom: 'com_aflat_think_reading',
  answer: 'com_aflat_think_done',
};

type StepState = 'done' | 'active' | 'pending';

const stateOf = (key: StepKey, current: StepKey | null): StepState => {
  if (current == null) {
    return 'pending';
  }
  if (current === 'answer') {
    return 'done';
  }
  const here = ORDER.indexOf(key);
  const now = ORDER.indexOf(current);
  if (here < now) {
    return 'done';
  }
  return here === now ? 'active' : 'pending';
};

/** The rail marker: a filled tick when finished, a ring while working, an outline before. */
function StepDot({ state }: { state: StepState }) {
  if (state === 'done') {
    return (
      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--panza-ok,#1C7A3D)] text-white">
        <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'h-[18px] w-[18px] shrink-0 rounded-full border-2',
        state === 'active'
          ? 'animate-spin border-border-medium border-t-[var(--panza-cta)]'
          : 'border-border-medium',
      )}
    />
  );
}

function Step({
  state,
  title,
  meta,
  last,
  children,
}: {
  state: StepState;
  title: string;
  meta?: string | null;
  last?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li className={cn('flex gap-3.5', state === 'pending' && 'opacity-45')}>
      <div className="flex flex-col items-center gap-1">
        <StepDot state={state} />
        {/* The rail. Drawn on every step but the last, so the list reads as finished when it is. */}
        {!last && <span className="w-px flex-1 bg-border-light" />}
      </div>
      <div className={cn('min-w-0 flex-1', last ? 'pb-0' : 'pb-4')}>
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="text-sm font-semibold text-text-primary">{title}</span>
          {meta != null && meta !== '' && (
            <span className="font-mono text-xs text-text-tertiary">{meta}</span>
          )}
        </div>
        {children}
      </div>
    </li>
  );
}

/**
 * The live card while retrieval runs, and a one-line summary once it has finished.
 *
 * Collapsing on completion is the design's call and the right one: during the wait this is the
 * only thing on screen and has to hold attention; afterwards the answer and its citations are what
 * matter, and eight steps of retrieval detail sitting above them is noise. It stays one click
 * away, because the person who wants to check our work is exactly the person this product is for.
 */
const ThinkingSteps = memo(({ text, isStreaming }: { text: string; isStreaming: boolean }) => {
  const localize = useLocalize();
  const plural = usePlural();
  const model = useMemo(() => buildThinkingModel(text), [text]);
  const [expanded, setExpanded] = useState(false);

  const finished = !isStreaming || model.current === 'answer';
  /**
   * The card's own heading, which names what is happening right now rather than the whole process.
   * A table rather than a chain of ternaries: the mapping is data, and one row per step is easier
   * to check against the design than a nested conditional is.
   */
  const headKey = finished ? 'com_aflat_think_done' : HEAD_KEYS[model.current ?? 'plan'];
  const showCard = !finished || expanded;

  const searchCount = model.searchesTotal ?? model.queries.length + (model.lexical ? 1 : 0);
  const visibleActs = model.acts.slice(-MAX_VISIBLE_ACTS);
  const hiddenActs = model.acts.length - visibleActs.length;

  const gatherMeta = [
    searchCount > 0 ? plural(searchCount, 'search') : null,
    model.inspected != null ? plural(model.inspected, 'result') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  /**
   * Two different sentences from two different `progress` events. Once selection has run the
   * interesting number is what survived it; before that, all we honestly know is what
   * de-duplication left. Neither is invented when its event has not arrived.
   */
  const selectMeta = (() => {
    if (model.dedup?.kept == null) {
      return '';
    }
    if (model.chosen?.n != null) {
      return localize('com_aflat_think_dedup', { 0: model.dedup.kept, 1: model.chosen.n });
    }
    return model.dedup.from == null
      ? ''
      : localize('com_aflat_think_dedup_from', { 0: model.dedup.kept, 1: model.dedup.from });
  })();

  const zoomMeta = model.articles != null ? plural(model.articles, 'article') : '';

  const gatherPct =
    model.searchesTotal && model.searchesDone != null
      ? Math.min(100, Math.round((model.searchesDone / model.searchesTotal) * 100))
      : null;

  /**
   * The closing line, assembled only from what actually arrived. Two different measurements —
   * article-level hits, and the acts they came from — never one number counted twice.
   */
  const found = [
    model.summary?.articles != null ? plural(model.summary.articles, 'article') : null,
    model.summary?.acts != null
      ? localize('com_aflat_think_from_acts', { 0: plural(model.summary.acts, 'act') })
      : null,
  ]
    .filter(Boolean)
    /* „10 articole din 4 acte" is one fact, so it reads as one phrase — the dot separator goes
       between facts, not inside this one. */
    .join(' ');
  const summaryMeta = [found, seconds(model.summary?.ms)].filter(Boolean).join(' · ');

  if (model.current == null && model.text.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2.5">
      {showCard && (
        <div
          data-testid="aflat-thinking-steps"
          className="overflow-hidden rounded-2xl border border-border-light bg-surface-primary"
        >
          <div className="flex items-center gap-2.5 border-b border-border-light bg-surface-secondary px-5 py-3">
            {!finished && (
              <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-border-medium border-t-[var(--panza-cta)]" />
            )}
            <span className="text-sm font-semibold text-text-primary">{localize(headKey)}</span>
          </div>

          <ol className="m-0 flex list-none flex-col px-5 py-4">
            <Step
              state={stateOf('plan', model.current)}
              title={
                model.queries.length > 0
                  ? localize('com_aflat_think_plan_title', { 0: plural(searchCount, 'search') })
                  : localize('com_aflat_think_planning')
              }
            >
              {model.intent != null && (
                <p className="m-0 mt-2 text-sm leading-relaxed text-text-secondary">
                  {localize('com_aflat_think_intent', { 0: model.intent })}
                </p>
              )}
              {(model.queries.length > 0 || model.lexical != null) && (
                <div className="mt-2.5 flex flex-col gap-1.5">
                  {model.queries.map((q) => (
                    <p
                      key={q}
                      className="m-0 rounded-r-lg border border-l-[3px] border-border-light border-l-[var(--panza-link)] bg-surface-secondary px-3 py-2 text-sm leading-snug text-text-primary"
                    >
                      {q}
                    </p>
                  ))}
                  {/* Keywords, not a sentence — drawn as keywords so it does not read as bad prose. */}
                  {model.lexical != null && (
                    <p className="m-0 rounded-lg border border-border-light bg-surface-secondary px-3 py-2 font-mono text-xs leading-snug text-text-secondary">
                      {model.lexical}
                    </p>
                  )}
                </div>
              )}
              {(model.filters.length > 0 || model.inForce) && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {model.filters.map((f) => (
                    <span
                      key={f.t}
                      className="rounded-full border border-border-light bg-surface-secondary px-2.5 py-1 text-xs font-medium text-text-secondary"
                    >
                      {f.t}
                    </span>
                  ))}
                  {/**
                   * The only outlined pill in the view. It is the single most reassuring thing the
                   * pipeline does — the answer describes the law as it stands today, not a repealed
                   * version of it — and unlike everything else here it is applied on every query.
                   */}
                  {model.inForce && (
                    <span
                      data-testid="aflat-think-inforce"
                      className="rounded-full border border-[var(--panza-ok,#1C7A3D)] bg-surface-primary px-2.5 py-1 text-xs font-medium text-text-primary"
                    >
                      {localize('com_aflat_think_inforce')}
                    </span>
                  )}
                </div>
              )}
            </Step>

            <Step
              state={stateOf('gather', model.current)}
              title={localize('com_aflat_think_searching')}
              meta={gatherMeta}
            >
              {model.acts.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  {/**
                   * The tail, not the whole list. A medium run returns around thirty acts and a
                   * deep one more; printed in full they bury the three steps underneath and the
                   * card stops being a summary of the wait. The newest are kept because movement
                   * is the point — something has to change every couple of seconds or the view
                   * reads as frozen — and the ones that survive selection are named again, in
                   * full, in the sources under the answer.
                   */}
                  {hiddenActs > 0 && (
                    <p className="m-0 text-xs text-text-tertiary">
                      {localize('com_aflat_think_more_acts', { 0: hiddenActs })}
                    </p>
                  )}
                  {visibleActs.map((title) => (
                    <div
                      key={title}
                      className="flex items-center gap-2 text-sm text-text-secondary"
                    >
                      <Check
                        className="h-3 w-3 shrink-0 text-[var(--panza-ok,#1C7A3D)]"
                        strokeWidth={3}
                        aria-hidden="true"
                      />
                      <span className="truncate">{title}</span>
                    </div>
                  ))}
                </div>
              )}
              {gatherPct != null && (
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-tertiary">
                  <div
                    className="h-full rounded-full bg-[var(--panza-cta)] transition-[width] duration-500"
                    style={{ width: `${gatherPct}%` }}
                  />
                </div>
              )}
            </Step>

            <Step
              state={stateOf('select', model.current)}
              title={localize('com_aflat_think_choosing')}
              meta={selectMeta}
            />

            <Step
              state={stateOf('zoom', model.current)}
              title={localize('com_aflat_think_zoom_title')}
              meta={zoomMeta}
              last={true}
            />
          </ol>

          {/* Anything that was not a view update — another model's thinking, or a field we do not
              model yet. Shown rather than dropped. */}
          {model.text.length > 0 && (
            <div className="border-t border-border-light px-5 py-3">
              {model.text.map((line, i) => (
                <p
                  key={i}
                  className="m-0 whitespace-pre-wrap break-words text-sm text-text-secondary"
                >
                  {line}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {finished && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          data-testid="aflat-thinking-summary"
          aria-expanded={expanded}
          className="flex w-full flex-wrap items-center gap-2.5 rounded-xl border border-border-light bg-surface-secondary px-4 py-2.5 text-left transition-colors hover:bg-surface-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-primary"
        >
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--panza-ok,#1C7A3D)] text-white">
            <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden="true" />
          </span>
          <span className="text-sm text-text-secondary">
            {localize('com_aflat_think_summary')}
            {summaryMeta !== '' ? ` · ${summaryMeta}` : ''}
          </span>
          <span className="flex-1" />
          <span className="text-xs font-semibold text-[var(--panza-link)]">
            {localize(expanded ? 'com_aflat_think_hide_steps' : 'com_aflat_think_show_steps')}
          </span>
        </button>
      )}
    </div>
  );
});

ThinkingSteps.displayName = 'ThinkingSteps';

export default ThinkingSteps;
