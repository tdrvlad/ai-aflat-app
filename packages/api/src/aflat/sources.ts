import { logger } from '@librechat/data-schemas';
import { ContentTypes, extractEnvVariable, normalizeEndpointName } from 'librechat-data-provider';
import type { SourcesContentPart, TAflatSource, TAflatSourceAct } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { getCustomEndpointConfig } from '~/app/config';

/**
 * ai-aflat: the side-channel that carries legislative citations from the
 * orchestrator onto the assistant message.
 *
 * The orchestrator speaks OpenAI `/v1/chat/completions`, and `@langchain/openai`
 * rebuilds every SSE chunk from a fixed allowlist — so an out-of-band field on the
 * stream (`x_aflat.sources`) is dropped before any fork-owned code can see it.
 * Instead of fighting that allowlist, the fork asks for the citations directly once
 * the stream is done: the orchestrator has already committed them to its own job
 * store keyed by the response message id it received on the request.
 *
 * Two properties this buys, both load-bearing for the product:
 * - citations never travel inside the token stream, so they can never be
 *   model-authored;
 * - what the UI renders is exactly the record the orchestrator persisted, not a
 *   half-parsed stream artifact.
 *
 * Nothing here ever constructs, completes or repairs a citation URL. `url` and
 * `viewer_url` are copied verbatim when they are already absolute `http(s)`
 * addresses and omitted otherwise.
 */

/** The `endpoints.custom[].name` in `librechat.yaml` this transport applies to. */
export const AFLAT_ENDPOINT_NAME = 'ai-aflat';

/** Localhost round-trip against an already-finished job; it should never be slow. */
export const AFLAT_SOURCES_TIMEOUT_MS = 5000;

/**
 * The allowlist IS the boundary: a key absent from these tables never crosses,
 * whatever the orchestrator sends.
 *
 * "Keep them in step with `TAflatSource`" used to be a comment asking a human to
 * remember, and the human did not: measured 2026-08-07, the orchestrator emitted
 * `act_short`, `article_label`, `cite_as` and `amends` and every one of them was
 * silently dropped here — including `article_label`, which is half the citation of
 * record. In the other direction this list declared `anchor`, which the
 * orchestrator has never sent (it sends `retrieved_anchor`, deliberately named so
 * that building a link from it reads as the mistake it is) and nothing ever read.
 *
 * So the comment is now a compile error instead — see ALL_SOURCE_FIELDS below.
 *
 * `retrieved_anchor` and `anchor_resolution` stay off this list ON PURPOSE. They
 * are diagnostics: an anchor is only valid against the exact blob it was rendered
 * from, so nothing downstream may compose a URL out of one. `viewer_url` arrives
 * already resolved, or stays act-level.
 */
const SOURCE_STRING_FIELDS = [
  'ref',
  'entity_id',
  'entity_type',
  'act_title',
  'act_short',
  'title',
  'article_first',
  'article_last',
  'article_label',
  'path',
  'snippet',
  'why',
  'legdb_status',
  'band',
  'degraded',
  'amends',
  'cite_as',
] as const;

const SOURCE_NUMBER_FIELDS = ['act_id', 'rank'] as const;
const SOURCE_BOOLEAN_FIELDS = ['in_force', 'likely_amending', 'cited'] as const;
const SOURCE_URL_FIELDS = ['url', 'viewer_url'] as const;

/**
 * The drift guard. Every key of `TAflatSource` must appear in exactly one of the
 * four tables above; adding a field to the shared type without deciding how it
 * crosses is now a build failure rather than a citation that quietly loses half
 * its identity somewhere between two repositories.
 *
 * `Exclude` in both directions, because both are real failures: a type key with
 * no table drops silently, and a table key with no type is a field we validate
 * and then hand to a renderer that has never heard of it.
 */
type AllSourceFields =
  | (typeof SOURCE_STRING_FIELDS)[number]
  | (typeof SOURCE_NUMBER_FIELDS)[number]
  | (typeof SOURCE_BOOLEAN_FIELDS)[number]
  | (typeof SOURCE_URL_FIELDS)[number];

/**
 * `AssertNever<T>` fails to compile unless `T` is `never`, and the compiler names
 * the offending field in the error. It must be this shape rather than a
 * `const x: [A, B] = [null as never, null as never]` — `never` is assignable to
 * every type, so that form type-checks no matter what and guards nothing. It was
 * written that way first and verified to catch nothing.
 */
type AssertNever<T extends never> = T;

/** A field on `TAflatSource` that no table carries: it would be silently dropped. */
type _NoTableForTypeField = AssertNever<Exclude<keyof TAflatSource, AllSourceFields>>;
/** A field in a table that the type does not declare: validated, then unrenderable. */
type _NoTypeForTableField = AssertNever<Exclude<AllSourceFields, keyof TAflatSource>>;

const ACT_STRING_FIELDS = ['act_title', 'legdb_status', 'band'] as const;
const ACT_NUMBER_FIELDS = ['act_id'] as const;
const ACT_BOOLEAN_FIELDS = ['in_force', 'likely_amending', 'cited'] as const;
const ACT_URL_FIELDS = ['url', 'viewer_url'] as const;

/** Envelope identity keys carried for the `usage_events` writer, verbatim strings only. */
const ENVELOPE_STRING_FIELDS = ['job_id', 'query_id', 'outcome'] as const;

const USAGE_STRING_FIELDS = ['effort', 'model', 'created_at'] as const;
const USAGE_NUMBER_FIELDS = ['engine_cost_usd', 'latency_ms'] as const;
const USAGE_BOOLEAN_FIELDS = ['engine_cost_is_complete'] as const;

/**
 * The `usage` block of the orchestrator's terminal envelope (telemetry spec
 * 2026-08-06 §1). Every key is always present; `null` means "not recorded".
 * A failed job's null cost must NEVER be coerced to 0 by any reader, and
 * `engine_cost_is_complete` travels with the cost because one is useless
 * without the other.
 */
export interface TAflatUsage {
  effort: string | null;
  model: string | null;
  engine_cost_usd: number | null;
  engine_cost_is_complete: boolean | null;
  latency_ms: number | null;
  created_at: string | null;
}

export interface AflatSourcesPayload {
  sources: TAflatSource[];
  sources_by_act?: TAflatSourceAct[];
  /** Orchestrator job id — the join key to its SQLite log. Absent when no job answered. */
  job_id?: string;
  /** LegDB's audit key for the query behind this job. */
  query_id?: string;
  /**
   * The orchestrator's terminal outcome, verbatim ('answered'/'failed'/…).
   * Never flattened here or downstream: collapsing "found nothing" into
   * "broke" would let a failure be billed as an answer.
   */
  outcome?: string;
  usage?: TAflatUsage;
}

export interface AflatSourcesLookup {
  /** Orchestrator base URL, e.g. `http://127.0.0.1:8085/v1` */
  baseURL: string;
  apiKey: string;
  /** The id the fork sent as `x-aflat-response-message-id` on the completion request. */
  responseMessageId: string;
  timeoutMs?: number;
}

export interface AflatSourcesPartParams {
  appConfig?: AppConfig;
  endpoint?: string;
  responseMessageId?: string;
  timeoutMs?: number;
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  return raw as Record<string, unknown>;
}

function pickStrings<K extends string>(
  candidate: Record<string, unknown>,
  keys: readonly K[],
): Partial<Record<K, string>> {
  const picked: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const value = candidate[key];
    if (typeof value === 'string' && value.length > 0) {
      picked[key] = value;
    }
  }
  return picked;
}

function pickNumbers<K extends string>(
  candidate: Record<string, unknown>,
  keys: readonly K[],
): Partial<Record<K, number>> {
  const picked: Partial<Record<K, number>> = {};
  for (const key of keys) {
    const value = candidate[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      picked[key] = value;
    }
  }
  return picked;
}

function pickBooleans<K extends string>(
  candidate: Record<string, unknown>,
  keys: readonly K[],
): Partial<Record<K, boolean>> {
  const picked: Partial<Record<K, boolean>> = {};
  for (const key of keys) {
    const value = candidate[key];
    if (typeof value === 'boolean') {
      picked[key] = value;
    }
  }
  return picked;
}

/**
 * The one place a citation link may cross. A value that is not already an absolute
 * `http(s)` address is left out rather than completed, prefixed or otherwise made
 * to work — a legal reference the user can follow must be one retrieval returned.
 */
function pickUrls<K extends string>(
  candidate: Record<string, unknown>,
  keys: readonly K[],
): Partial<Record<K, string>> {
  const picked: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const value = candidate[key];
    if (typeof value === 'string' && /^https?:\/\/\S/i.test(value.trim())) {
      picked[key] = value;
    }
  }
  return picked;
}

/**
 * Copies a single provision across the wire boundary field by field, so an
 * unexpected payload can never reach the renderer as-is. Values are never
 * rewritten: each is passed through exactly as retrieval returned it, or left out.
 */
function normalizeSource(raw: unknown): TAflatSource | null {
  const candidate = asRecord(raw);
  if (candidate == null) {
    return null;
  }

  const source: TAflatSource = {
    ...pickStrings(candidate, SOURCE_STRING_FIELDS),
    ...pickNumbers(candidate, SOURCE_NUMBER_FIELDS),
    ...pickBooleans(candidate, SOURCE_BOOLEAN_FIELDS),
    ...pickUrls(candidate, SOURCE_URL_FIELDS),
  };

  return Object.keys(source).length > 0 ? source : null;
}

/** An act with no provisions left after normalization has nothing to render. */
function normalizeSourceAct(raw: unknown): TAflatSourceAct | null {
  const candidate = asRecord(raw);
  if (candidate == null || !Array.isArray(candidate.provisions)) {
    return null;
  }

  const provisions: TAflatSource[] = [];
  for (const entry of candidate.provisions) {
    const provision = normalizeSource(entry);
    if (provision != null) {
      provisions.push(provision);
    }
  }

  if (provisions.length === 0) {
    return null;
  }

  return {
    ...pickStrings(candidate, ACT_STRING_FIELDS),
    ...pickNumbers(candidate, ACT_NUMBER_FIELDS),
    ...pickBooleans(candidate, ACT_BOOLEAN_FIELDS),
    ...pickUrls(candidate, ACT_URL_FIELDS),
    provisions,
  };
}

/**
 * The `usage` block crosses the same allowlist boundary as everything else:
 * validated primitives verbatim, a wrong-typed value becomes `null` rather
 * than being repaired, and in particular a null cost stays null — never 0.
 */
function normalizeUsage(raw: unknown): TAflatUsage | null {
  const candidate = asRecord(raw);
  if (candidate == null) {
    return null;
  }

  const strings = pickStrings(candidate, USAGE_STRING_FIELDS);
  const numbers = pickNumbers(candidate, USAGE_NUMBER_FIELDS);
  const booleans = pickBooleans(candidate, USAGE_BOOLEAN_FIELDS);

  return {
    effort: strings.effort ?? null,
    model: strings.model ?? null,
    engine_cost_usd: numbers.engine_cost_usd ?? null,
    engine_cost_is_complete: booleans.engine_cost_is_complete ?? null,
    latency_ms: numbers.latency_ms ?? null,
    created_at: strings.created_at ?? null,
  };
}

function normalizeSources(payload: unknown): AflatSourcesPayload {
  const record = asRecord(payload);
  if (record == null) {
    return { sources: [] };
  }

  const sources: TAflatSource[] = [];
  if (Array.isArray(record.sources)) {
    for (const entry of record.sources) {
      const source = normalizeSource(entry);
      if (source != null) {
        sources.push(source);
      }
    }
  }

  const acts: TAflatSourceAct[] = [];
  if (Array.isArray(record.sources_by_act)) {
    for (const entry of record.sources_by_act) {
      const act = normalizeSourceAct(entry);
      if (act != null) {
        acts.push(act);
      }
    }
  }

  const normalized: AflatSourcesPayload =
    acts.length > 0 ? { sources, sources_by_act: acts } : { sources };

  const envelope = pickStrings(record, ENVELOPE_STRING_FIELDS);
  if (envelope.job_id != null) {
    normalized.job_id = envelope.job_id;
  }
  if (envelope.query_id != null) {
    normalized.query_id = envelope.query_id;
  }
  if (envelope.outcome != null) {
    normalized.outcome = envelope.outcome;
  }

  const usage = normalizeUsage(record.usage);
  if (usage != null) {
    normalized.usage = usage;
  }

  return normalized;
}

/** `GET {baseURL}/messages/{responseMessageId}/sources` — see FORK-NOTES for the contract. */
export function buildSourcesUrl(baseURL: string, responseMessageId: string): string {
  return `${baseURL.replace(/\/+$/, '')}/messages/${encodeURIComponent(responseMessageId)}/sources`;
}

/**
 * Asks the orchestrator for the citations it recorded against this response.
 * Never throws and never rejects: an unreachable orchestrator, a 404 (no job, or a
 * job that produced nothing) and a malformed payload all mean "no sources", which
 * is a normal outcome — empty retrieval is an answer, not an error.
 */
export async function fetchAflatSources({
  baseURL,
  apiKey,
  responseMessageId,
  timeoutMs = AFLAT_SOURCES_TIMEOUT_MS,
}: AflatSourcesLookup): Promise<AflatSourcesPayload> {
  const url = buildSourcesUrl(baseURL, responseMessageId);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      if (response.status !== 404) {
        logger.warn(
          `[aflat/sources] orchestrator returned ${response.status} for ${responseMessageId}`,
        );
      }
      return { sources: [] };
    }

    return normalizeSources(await response.json());
  } catch (error) {
    logger.warn(`[aflat/sources] could not fetch sources for ${responseMessageId}`, error);
    return { sources: [] };
  }
}

/** An empty list renders nothing, so it never becomes a content part. */
export function buildAflatSourcesPart(payload: AflatSourcesPayload): SourcesContentPart | null {
  if (payload.sources.length === 0) {
    return null;
  }
  const part: SourcesContentPart = { type: ContentTypes.SOURCES, sources: payload.sources };
  if (payload.sources_by_act != null && payload.sources_by_act.length > 0) {
    part.sources_by_act = payload.sources_by_act;
  }
  return part;
}

export interface AflatCompletionEnvelope {
  /** The renderable SOURCES content part, or null when there is nothing to render. */
  part: SourcesContentPart | null;
  /**
   * The normalized envelope the orchestrator returned, handed to the
   * `usage_events` writer. `null` when the endpoint is not ai-aflat or is
   * misconfigured — the writer must then skip, not synthesize a row.
   */
  payload: AflatSourcesPayload | null;
}

/**
 * The one entry point `/api` calls: resolve the ai-aflat endpoint's own baseURL and
 * key from the app config, fetch the record the orchestrator persisted for this
 * response, and hand back both the renderable content part and the raw payload
 * (identity + usage) for the telemetry writer. `payload` is `null` for every
 * endpoint that is not ai-aflat and for a misconfigured endpoint; an empty
 * retrieval still yields a payload — empty is an outcome, not an absence.
 */
export async function getAflatCompletion({
  appConfig,
  endpoint,
  responseMessageId,
  timeoutMs,
}: AflatSourcesPartParams): Promise<AflatCompletionEnvelope> {
  if (appConfig == null || endpoint == null || !responseMessageId) {
    return { part: null, payload: null };
  }
  if (normalizeEndpointName(endpoint) !== normalizeEndpointName(AFLAT_ENDPOINT_NAME)) {
    return { part: null, payload: null };
  }

  const endpointConfig = getCustomEndpointConfig({ endpoint, appConfig });
  if (endpointConfig == null) {
    return { part: null, payload: null };
  }

  const baseURL = extractEnvVariable(endpointConfig.baseURL ?? '');
  const apiKey = extractEnvVariable(endpointConfig.apiKey ?? '');
  if (!baseURL || !apiKey || !baseURL.startsWith('http')) {
    logger.warn('[aflat/sources] ai-aflat endpoint has no usable baseURL/apiKey; skipping');
    return { part: null, payload: null };
  }

  const payload = await fetchAflatSources({ baseURL, apiKey, responseMessageId, timeoutMs });
  return { part: buildAflatSourcesPart(payload), payload };
}

/** The citation-only view of {@link getAflatCompletion}, kept for existing callers. */
export async function getAflatSourcesPart(
  params: AflatSourcesPartParams,
): Promise<SourcesContentPart | null> {
  const { part } = await getAflatCompletion(params);
  return part;
}
