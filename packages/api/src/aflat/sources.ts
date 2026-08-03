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
 * whatever the orchestrator sends. Keep them in step with `TAflatSource` /
 * `TAflatSourceAct` — a field added there but not here is silently dropped, which
 * is exactly the failure this seam was widened to fix.
 */
const SOURCE_STRING_FIELDS = [
  'ref',
  'entity_id',
  'entity_type',
  'act_title',
  'title',
  'article_first',
  'article_last',
  'path',
  'anchor',
  'snippet',
  'why',
  'legdb_status',
  'band',
  'degraded',
] as const;

const SOURCE_NUMBER_FIELDS = ['act_id', 'rank'] as const;
const SOURCE_BOOLEAN_FIELDS = ['in_force', 'likely_amending', 'cited'] as const;
const SOURCE_URL_FIELDS = ['url', 'viewer_url'] as const;

const ACT_STRING_FIELDS = ['act_title', 'legdb_status', 'band'] as const;
const ACT_NUMBER_FIELDS = ['act_id'] as const;
const ACT_BOOLEAN_FIELDS = ['in_force', 'likely_amending', 'cited'] as const;
const ACT_URL_FIELDS = ['url', 'viewer_url'] as const;

export interface AflatSourcesPayload {
  sources: TAflatSource[];
  sources_by_act?: TAflatSourceAct[];
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

  return acts.length > 0 ? { sources, sources_by_act: acts } : { sources };
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

/**
 * The one entry point `/api` calls: resolve the ai-aflat endpoint's own baseURL and
 * key from the app config, fetch the citations for this response, and hand back a
 * content part ready to push onto the message. Returns `null` for every endpoint
 * that is not ai-aflat, for a misconfigured endpoint, and for an empty result.
 */
export async function getAflatSourcesPart({
  appConfig,
  endpoint,
  responseMessageId,
  timeoutMs,
}: AflatSourcesPartParams): Promise<SourcesContentPart | null> {
  if (appConfig == null || endpoint == null || !responseMessageId) {
    return null;
  }
  if (normalizeEndpointName(endpoint) !== normalizeEndpointName(AFLAT_ENDPOINT_NAME)) {
    return null;
  }

  const endpointConfig = getCustomEndpointConfig({ endpoint, appConfig });
  if (endpointConfig == null) {
    return null;
  }

  const baseURL = extractEnvVariable(endpointConfig.baseURL ?? '');
  const apiKey = extractEnvVariable(endpointConfig.apiKey ?? '');
  if (!baseURL || !apiKey || !baseURL.startsWith('http')) {
    logger.warn('[aflat/sources] ai-aflat endpoint has no usable baseURL/apiKey; skipping');
    return null;
  }

  const payload = await fetchAflatSources({ baseURL, apiKey, responseMessageId, timeoutMs });
  return buildAflatSourcesPart(payload);
}
