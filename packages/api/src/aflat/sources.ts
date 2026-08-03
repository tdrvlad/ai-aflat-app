import { logger } from '@librechat/data-schemas';
import { ContentTypes, extractEnvVariable, normalizeEndpointName } from 'librechat-data-provider';
import type { SourcesContentPart, TAflatSource } from 'librechat-data-provider';
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
 * Nothing here ever constructs, completes or repairs a citation URL. `url` is
 * copied verbatim when it is a string and omitted otherwise.
 */

/** The `endpoints.custom[].name` in `librechat.yaml` this transport applies to. */
export const AFLAT_ENDPOINT_NAME = 'ai-aflat';

/** Localhost round-trip against an already-finished job; it should never be slow. */
export const AFLAT_SOURCES_TIMEOUT_MS = 5000;

const ENTITY_TYPES = new Set(['article', 'chapter', 'act']);

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

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Copies a single source across the wire boundary field by field, so an unexpected
 * payload can never reach the renderer as-is. Values are never rewritten — a `url`
 * is either passed through exactly as retrieval returned it, or left out.
 */
function normalizeSource(raw: unknown): TAflatSource | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  const source: TAflatSource = {};

  const entityId = optionalString(candidate.entity_id);
  if (entityId != null) {
    source.entity_id = entityId;
  }

  const entityType = optionalString(candidate.entity_type);
  if (entityType != null && ENTITY_TYPES.has(entityType)) {
    source.entity_type = entityType as TAflatSource['entity_type'];
  }

  const title = optionalString(candidate.title);
  if (title != null) {
    source.title = title;
  }

  const actTitle = optionalString(candidate.act_title);
  if (actTitle != null) {
    source.act_title = actTitle;
  }

  const snippet = optionalString(candidate.snippet);
  if (snippet != null) {
    source.snippet = snippet;
  }

  const url = optionalString(candidate.url);
  if (url != null) {
    source.url = url;
  }

  if (typeof candidate.in_force === 'boolean') {
    source.in_force = candidate.in_force;
  }

  if (typeof candidate.cited === 'boolean') {
    source.cited = candidate.cited;
  }

  return Object.keys(source).length > 0 ? source : null;
}

function normalizeSources(payload: unknown): TAflatSource[] {
  if (payload == null || typeof payload !== 'object') {
    return [];
  }
  const list = (payload as { sources?: unknown }).sources;
  if (!Array.isArray(list)) {
    return [];
  }
  const sources: TAflatSource[] = [];
  for (const entry of list) {
    const source = normalizeSource(entry);
    if (source != null) {
      sources.push(source);
    }
  }
  return sources;
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
}: AflatSourcesLookup): Promise<TAflatSource[]> {
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
      return [];
    }

    return normalizeSources(await response.json());
  } catch (error) {
    logger.warn(`[aflat/sources] could not fetch sources for ${responseMessageId}`, error);
    return [];
  }
}

/** An empty list renders nothing, so it never becomes a content part. */
export function buildAflatSourcesPart(sources: TAflatSource[]): SourcesContentPart | null {
  if (sources.length === 0) {
    return null;
  }
  return { type: ContentTypes.SOURCES, sources };
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

  const sources = await fetchAflatSources({ baseURL, apiKey, responseMessageId, timeoutMs });
  return buildAflatSourcesPart(sources);
}
