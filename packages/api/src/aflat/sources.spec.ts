import { createServer } from 'node:http';
import { ContentTypes } from 'librechat-data-provider';
import type { AddressInfo } from 'node:net';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import type { TAflatSource, TAflatSourceAct } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { resolveHeaders } from '~/utils/env';
import type { TAflatUsage } from './sources';
import {
  AFLAT_ENDPOINT_NAME,
  buildSourcesUrl,
  fetchAflatSources,
  buildAflatSourcesPart,
  getAflatCompletion,
  getAflatSourcesPart,
} from './sources';

jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * A real HTTP server standing in for the orchestrator. The transport's whole job is
 * an HTTP round-trip, so mocking `fetch` would test nothing that matters.
 */
class StubOrchestrator {
  server!: Server;
  handler: Handler = (_req, res) => res.end();
  requests: Array<{ url: string; auth: string | undefined }> = [];

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      this.requests.push({ url: req.url ?? '', auth: req.headers.authorization });
      this.handler(req, res);
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
  }

  get baseURL(): string {
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/v1`;
  }

  json(body: unknown, status = 200): void {
    this.handler = (_req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
  }

  status(code: number): void {
    this.handler = (_req, res) => {
      res.writeHead(code);
      res.end();
    };
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

/** The exact shape the envelope proposal specifies, with a real retrieval URL. */
const realSource: TAflatSource = {
  entity_id: 'art-307791-26',
  entity_type: 'article',
  title: 'Art. 26',
  act_title: 'Legea nr. 50/1991 privind autorizarea executării lucrărilor de construcții',
  snippet: 'Constituie contravenții următoarele fapte…',
  url: 'https://legislatie.just.ro/Public/DetaliiDocument/307791#id_artA26_ttl',
  in_force: true,
  cited: true,
};

/**
 * Every field the live orchestrator emits per source, copied from a real probe on
 * 2026-08-04 (`POST /v1/chat/completions` then `GET /v1/messages/{id}/sources`).
 * If the seam ever narrows again, this fixture is what catches it.
 */
const measuredSource: TAflatSource = {
  ref: 'S1',
  entity_id: '41627:id_artA620:132816:136035',
  entity_type: 'provision',
  act_id: 41627,
  act_title: 'CODUL MUNCII din 24 ianuarie 2003 (**republicat**) ( Legea nr. 53/2003 )',
  title: 'art. 78–81',
  article_first: '78',
  article_last: '81',
  path: 'Titlul II › Capitolul V',
  article_label: '78',
  snippet: 'Articolul 78 Concedierea dispusă cu nerespectarea procedurii…',
  why: 'Codul muncii › Titlul II › Capitolul V — matched: termen, preaviz, concedier',
  url: 'https://legislatie.just.ro/Public/DetaliiDocument/41627',
  viewer_url: 'https://legislatie.ai-aflat.ro/viewer/41627?a=id_artA620',
  in_force: true,
  legdb_status: 'ACTIVE',
  band: 'A+',
  rank: 1,
  degraded: 'rerank_budget_exhausted',
  likely_amending: false,
  cited: false,
};

const measuredAct: TAflatSourceAct = {
  act_id: 41627,
  act_title: 'CODUL MUNCII din 24 ianuarie 2003 (**republicat**) ( Legea nr. 53/2003 )',
  url: 'https://legislatie.just.ro/Public/DetaliiDocument/41627',
  viewer_url: 'https://legislatie.ai-aflat.ro/viewer/41627',
  in_force: true,
  legdb_status: 'ACTIVE',
  band: 'A+',
  likely_amending: false,
  cited: true,
  provisions: [measuredSource],
};

/** The `usage` block exactly as the orchestrator's job store emits it (jobs.js `sources()`). */
const measuredUsage: TAflatUsage = {
  effort: 'medium',
  model: 'standard-search',
  engine_cost_usd: 0.0125,
  engine_cost_is_complete: true,
  latency_ms: 6421,
  created_at: '2026-08-06 12:34:56',
};

const appConfigFor = (baseURL: string, apiKey = 'test-key'): AppConfig =>
  ({
    endpoints: {
      custom: [{ name: AFLAT_ENDPOINT_NAME, baseURL, apiKey }],
    },
  }) as unknown as AppConfig;

let orchestrator: StubOrchestrator;

beforeEach(async () => {
  orchestrator = new StubOrchestrator();
  await orchestrator.start();
});

afterEach(async () => {
  await orchestrator.stop();
});

describe('the correlation header librechat.yaml sends', () => {
  it('resolves {{LIBRECHAT_BODY_MESSAGEID}} to the response message id', () => {
    const resolved = resolveHeaders({
      headers: {
        'x-aflat-conversation-id': '{{LIBRECHAT_BODY_CONVERSATIONID}}',
        'x-aflat-response-message-id': '{{LIBRECHAT_BODY_MESSAGEID}}',
      },
      body: { conversationId: 'convo-1', messageId: 'response-message-1' },
    });

    expect(resolved['x-aflat-response-message-id']).toBe('response-message-1');
    expect(resolved['x-aflat-conversation-id']).toBe('convo-1');
  });
});

describe('buildSourcesUrl', () => {
  it('appends the lookup path to the orchestrator base URL', () => {
    expect(buildSourcesUrl('http://127.0.0.1:8085/v1', 'abc-123')).toBe(
      'http://127.0.0.1:8085/v1/messages/abc-123/sources',
    );
  });

  it('tolerates a trailing slash and encodes the id', () => {
    expect(buildSourcesUrl('http://127.0.0.1:8085/v1/', 'a b/c')).toBe(
      'http://127.0.0.1:8085/v1/messages/a%20b%2Fc/sources',
    );
  });
});

describe('fetchAflatSources', () => {
  it('returns the orchestrator payload verbatim, URL untouched', async () => {
    orchestrator.json({ job_id: 'job-1', query_id: 'q-1', sources: [realSource] });

    const payload = await fetchAflatSources({
      baseURL: orchestrator.baseURL,
      apiKey: 'test-key',
      responseMessageId: 'msg-1',
    });

    expect(payload).toEqual({ sources: [realSource], job_id: 'job-1', query_id: 'q-1' });
    expect(payload.sources[0].url).toBe(realSource.url);
  });

  it('authenticates with the orchestrator API key and hits the message route', async () => {
    orchestrator.json({ sources: [] });

    await fetchAflatSources({
      baseURL: orchestrator.baseURL,
      apiKey: 'secret-key',
      responseMessageId: 'msg-42',
    });

    expect(orchestrator.requests).toHaveLength(1);
    expect(orchestrator.requests[0].url).toBe('/v1/messages/msg-42/sources');
    expect(orchestrator.requests[0].auth).toBe('Bearer secret-key');
  });

  it('returns an empty list for an empty retrieval', async () => {
    orchestrator.json({ job_id: 'job-2', query_id: null, sources: [] });

    await expect(
      fetchAflatSources({
        baseURL: orchestrator.baseURL,
        apiKey: 'test-key',
        responseMessageId: 'msg-2',
      }),
    ).resolves.toEqual({ sources: [], job_id: 'job-2' });
  });

  it('returns an empty list on 404 (no job for this message)', async () => {
    orchestrator.status(404);

    await expect(
      fetchAflatSources({
        baseURL: orchestrator.baseURL,
        apiKey: 'test-key',
        responseMessageId: 'missing',
      }),
    ).resolves.toEqual({ sources: [] });
  });

  it('returns an empty list on a server error rather than throwing', async () => {
    orchestrator.status(500);

    await expect(
      fetchAflatSources({
        baseURL: orchestrator.baseURL,
        apiKey: 'test-key',
        responseMessageId: 'msg-3',
      }),
    ).resolves.toEqual({ sources: [] });
  });

  it('returns an empty list when the orchestrator is unreachable', async () => {
    const baseURL = orchestrator.baseURL;
    await orchestrator.stop();
    await orchestrator.start();

    await expect(
      fetchAflatSources({ baseURL, apiKey: 'test-key', responseMessageId: 'msg-4' }),
    ).resolves.toEqual({ sources: [] });
  });

  it('drops fields it does not recognise and entries that are not objects', async () => {
    orchestrator.json({
      sources: [
        { ...realSource, injected_html: '<script>', cited: 'yes' },
        'not-an-object',
        null,
        {},
      ],
    });

    const { sources } = await fetchAflatSources({
      baseURL: orchestrator.baseURL,
      apiKey: 'test-key',
      responseMessageId: 'msg-5',
    });

    expect(sources).toHaveLength(1);
    expect(sources[0]).not.toHaveProperty('injected_html');
    expect(sources[0]).not.toHaveProperty('cited');
  });

  it('omits a non-string url instead of repairing it', async () => {
    orchestrator.json({ sources: [{ ...realSource, url: { href: 'https://example.com' } }] });

    const { sources } = await fetchAflatSources({
      baseURL: orchestrator.baseURL,
      apiKey: 'test-key',
      responseMessageId: 'msg-6',
    });

    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBeUndefined();
  });

  it('carries every field the live orchestrator emits, unchanged', async () => {
    orchestrator.json({ job_id: 'job-4', query_id: 'q-4', sources: [measuredSource] });

    const { sources } = await fetchAflatSources({
      baseURL: orchestrator.baseURL,
      apiKey: 'test-key',
      responseMessageId: 'msg-live',
    });

    expect(sources).toEqual([measuredSource]);
    expect(Object.keys(sources[0]).sort()).toEqual(Object.keys(measuredSource).sort());
  });

  it('carries the act grouping, provisions and all', async () => {
    orchestrator.json({ sources: [measuredSource], sources_by_act: [measuredAct] });

    const payload = await fetchAflatSources({
      baseURL: orchestrator.baseURL,
      apiKey: 'test-key',
      responseMessageId: 'msg-by-act',
    });

    expect(payload.sources_by_act).toEqual([measuredAct]);
    expect(payload.sources_by_act?.[0].provisions[0].viewer_url).toBe(measuredSource.viewer_url);
  });

  it('drops an act group with no usable provisions rather than rendering an empty card', async () => {
    orchestrator.json({
      sources: [measuredSource],
      sources_by_act: [
        { ...measuredAct, provisions: ['not-an-object', null] },
        { ...measuredAct, provisions: 'nope' },
      ],
    });

    const payload = await fetchAflatSources({
      baseURL: orchestrator.baseURL,
      apiKey: 'test-key',
      responseMessageId: 'msg-empty-act',
    });

    expect(payload.sources_by_act).toBeUndefined();
  });

  it('omits a viewer_url that is not an absolute http(s) address instead of repairing it', async () => {
    orchestrator.json({
      sources: [
        { ...measuredSource, viewer_url: '/viewer/41627?a=id_artA620' },
        { ...measuredSource, ref: 'S2', viewer_url: 'javascript:alert(1)' },
        { ...measuredSource, ref: 'S3', url: 'legislatie.just.ro/Public/DetaliiDocument/41627' },
      ],
    });

    const { sources } = await fetchAflatSources({
      baseURL: orchestrator.baseURL,
      apiKey: 'test-key',
      responseMessageId: 'msg-bad-urls',
    });

    expect(sources[0].viewer_url).toBeUndefined();
    expect(sources[1].viewer_url).toBeUndefined();
    expect(sources[2].url).toBeUndefined();
    expect(sources[0].url).toBe(measuredSource.url);
  });

  it('drops an article label that is not a string rather than inventing one', async () => {
    orchestrator.json({ sources: [{ ...measuredSource, article_label: 620, act_id: '41627' }] });

    const { sources } = await fetchAflatSources({
      baseURL: orchestrator.baseURL,
      apiKey: 'test-key',
      responseMessageId: 'msg-label',
    });

    expect(sources[0].article_label).toBeUndefined();
    expect(sources[0].act_id).toBeUndefined();
  });

  /**
   * The four fields the orchestrator emits that this boundary silently dropped
   * until 2026-08-07. `article_label` is the one that matters most: with `act_id`
   * it IS the citation of record, and the rule that an unresolvable anchor links
   * act-level and prints the label as text cannot be honoured without it.
   */
  it('carries act_short, article_label, amends and cite_as across the boundary', async () => {
    orchestrator.json({
      sources: [
        {
          ...measuredSource,
          act_short: 'Legea nr. 53/2003',
          article_label: 'ART. 78',
          amends: 'Legea nr. 53/2003 - Codul muncii',
          cite_as: 'Legea nr. 53/2003, art. 78',
        },
      ],
    });

    const { sources } = await fetchAflatSources({
      baseURL: orchestrator.baseURL,
      apiKey: 'test-key',
      responseMessageId: 'msg-contract',
    });

    expect(sources[0]).toMatchObject({
      act_short: 'Legea nr. 53/2003',
      article_label: 'ART. 78',
      amends: 'Legea nr. 53/2003 - Codul muncii',
      cite_as: 'Legea nr. 53/2003, art. 78',
    });
  });

  /**
   * The other half of the boundary, and the reason it is not simply a spread:
   * an anchor is only valid against the exact blob it was rendered from, so it
   * must never reach anything that could compose a URL out of it.
   */
  it('never carries retrieved_anchor or anchor_resolution — they are diagnostics, not links', async () => {
    orchestrator.json({
      sources: [
        { ...measuredSource, retrieved_anchor: 'id_artA620', anchor_resolution: 'matched' },
      ],
    });

    const { sources } = await fetchAflatSources({
      baseURL: orchestrator.baseURL,
      apiKey: 'test-key',
      responseMessageId: 'msg-diagnostics',
    });

    expect(sources[0]).not.toHaveProperty('retrieved_anchor');
    expect(sources[0]).not.toHaveProperty('anchor_resolution');
  });

  it('returns an empty list when the payload has no sources array', async () => {
    orchestrator.json({ job_id: 'job-3' });

    await expect(
      fetchAflatSources({
        baseURL: orchestrator.baseURL,
        apiKey: 'test-key',
        responseMessageId: 'msg-7',
      }),
    ).resolves.toEqual({ sources: [], job_id: 'job-3' });
  });
});

describe('the telemetry envelope (usage_events spec §1)', () => {
  it('carries job_id, query_id, outcome and the usage block verbatim', async () => {
    orchestrator.json({
      job_id: 'job-t1',
      query_id: 'q-t1',
      outcome: 'answered',
      sources: [measuredSource],
      usage: measuredUsage,
    });

    const payload = await fetchAflatSources({
      baseURL: orchestrator.baseURL,
      apiKey: 'test-key',
      responseMessageId: 'msg-t1',
    });

    expect(payload.job_id).toBe('job-t1');
    expect(payload.query_id).toBe('q-t1');
    expect(payload.outcome).toBe('answered');
    expect(payload.usage).toEqual(measuredUsage);
  });

  it("keeps a failed job's null cost null — never 0", async () => {
    orchestrator.json({
      job_id: 'job-t2',
      query_id: null,
      outcome: 'failed',
      sources: [],
      usage: {
        effort: null,
        model: 'standard-search',
        engine_cost_usd: null,
        engine_cost_is_complete: null,
        latency_ms: null,
        created_at: '2026-08-06 12:00:00',
      },
    });

    const payload = await fetchAflatSources({
      baseURL: orchestrator.baseURL,
      apiKey: 'test-key',
      responseMessageId: 'msg-t2',
    });

    expect(payload.outcome).toBe('failed');
    expect(payload.usage?.engine_cost_usd).toBeNull();
    expect(payload.usage?.engine_cost_is_complete).toBeNull();
    expect(payload.usage?.effort).toBeNull();
    expect(payload.usage?.model).toBe('standard-search');
  });

  it('nulls a wrong-typed usage value instead of repairing it, and drops unknown keys', async () => {
    orchestrator.json({
      job_id: 'job-t3',
      outcome: 'answered',
      sources: [],
      usage: {
        effort: 5,
        model: 'standard-search',
        engine_cost_usd: '0.0125',
        engine_cost_is_complete: 'yes',
        latency_ms: 6421,
        created_at: '2026-08-06 12:34:56',
        injected: '<script>',
      },
    });

    const payload = await fetchAflatSources({
      baseURL: orchestrator.baseURL,
      apiKey: 'test-key',
      responseMessageId: 'msg-t3',
    });

    expect(payload.usage).toEqual({
      effort: null,
      model: 'standard-search',
      engine_cost_usd: null,
      engine_cost_is_complete: null,
      latency_ms: 6421,
      created_at: '2026-08-06 12:34:56',
    });
  });

  it('drops a non-string outcome and a non-object usage block', async () => {
    orchestrator.json({ job_id: 'job-t4', outcome: 7, usage: 'nope', sources: [] });

    const payload = await fetchAflatSources({
      baseURL: orchestrator.baseURL,
      apiKey: 'test-key',
      responseMessageId: 'msg-t4',
    });

    expect(payload).toEqual({ sources: [], job_id: 'job-t4' });
  });
});

describe('buildAflatSourcesPart', () => {
  it('builds the SOURCES content part the renderer dispatches on', () => {
    expect(buildAflatSourcesPart({ sources: [realSource] })).toEqual({
      type: ContentTypes.SOURCES,
      sources: [realSource],
    });
  });

  it('carries the act grouping onto the part when the orchestrator sent one', () => {
    expect(
      buildAflatSourcesPart({ sources: [measuredSource], sources_by_act: [measuredAct] }),
    ).toEqual({
      type: ContentTypes.SOURCES,
      sources: [measuredSource],
      sources_by_act: [measuredAct],
    });
  });

  it('leaves sources_by_act off the part when there is no grouping', () => {
    expect(buildAflatSourcesPart({ sources: [realSource], sources_by_act: [] })).not.toHaveProperty(
      'sources_by_act',
    );
  });

  it('builds nothing for an empty list', () => {
    expect(buildAflatSourcesPart({ sources: [] })).toBeNull();
  });
});

describe('getAflatSourcesPart', () => {
  it('produces a content part from a live orchestrator response', async () => {
    orchestrator.json({ job_id: 'job-9', query_id: 'q-9', sources: [realSource] });

    await expect(
      getAflatSourcesPart({
        appConfig: appConfigFor(orchestrator.baseURL),
        endpoint: AFLAT_ENDPOINT_NAME,
        responseMessageId: 'msg-9',
      }),
    ).resolves.toEqual({ type: ContentTypes.SOURCES, sources: [realSource] });
  });

  it('produces nothing when retrieval was empty', async () => {
    orchestrator.json({ sources: [] });

    await expect(
      getAflatSourcesPart({
        appConfig: appConfigFor(orchestrator.baseURL),
        endpoint: AFLAT_ENDPOINT_NAME,
        responseMessageId: 'msg-10',
      }),
    ).resolves.toBeNull();
  });

  it('never calls out for a different endpoint', async () => {
    orchestrator.json({ sources: [realSource] });

    await expect(
      getAflatSourcesPart({
        appConfig: appConfigFor(orchestrator.baseURL),
        endpoint: 'some-other-endpoint',
        responseMessageId: 'msg-11',
      }),
    ).resolves.toBeNull();
    expect(orchestrator.requests).toHaveLength(0);
  });

  it('never calls out without a response message id', async () => {
    orchestrator.json({ sources: [realSource] });

    await expect(
      getAflatSourcesPart({
        appConfig: appConfigFor(orchestrator.baseURL),
        endpoint: AFLAT_ENDPOINT_NAME,
        responseMessageId: '',
      }),
    ).resolves.toBeNull();
    expect(orchestrator.requests).toHaveLength(0);
  });

  it('resolves ${VAR} references in the endpoint baseURL and apiKey', async () => {
    process.env.TEST_AFLAT_BASE_URL = orchestrator.baseURL;
    process.env.TEST_AFLAT_API_KEY = 'env-key';
    orchestrator.json({ sources: [realSource] });

    const part = await getAflatSourcesPart({
      appConfig: appConfigFor('${TEST_AFLAT_BASE_URL}', '${TEST_AFLAT_API_KEY}'),
      endpoint: AFLAT_ENDPOINT_NAME,
      responseMessageId: 'msg-12',
    });

    expect(part).not.toBeNull();
    expect(orchestrator.requests[0].auth).toBe('Bearer env-key');

    delete process.env.TEST_AFLAT_BASE_URL;
    delete process.env.TEST_AFLAT_API_KEY;
  });

  it('produces nothing when the endpoint is unconfigured', async () => {
    await expect(
      getAflatSourcesPart({
        appConfig: { endpoints: {} } as unknown as AppConfig,
        endpoint: AFLAT_ENDPOINT_NAME,
        responseMessageId: 'msg-13',
      }),
    ).resolves.toBeNull();
  });

  it('produces nothing when the baseURL is an unresolved env reference', async () => {
    await expect(
      getAflatSourcesPart({
        appConfig: appConfigFor('${MISSING_ORCHESTRATOR_BASE_URL}'),
        endpoint: AFLAT_ENDPOINT_NAME,
        responseMessageId: 'msg-14',
      }),
    ).resolves.toBeNull();
  });
});

describe('getAflatCompletion', () => {
  it('hands back both the content part and the envelope for the usage writer', async () => {
    orchestrator.json({
      job_id: 'job-c1',
      query_id: 'q-c1',
      outcome: 'answered',
      sources: [realSource],
      usage: measuredUsage,
    });

    const { part, payload } = await getAflatCompletion({
      appConfig: appConfigFor(orchestrator.baseURL),
      endpoint: AFLAT_ENDPOINT_NAME,
      responseMessageId: 'msg-c1',
    });

    expect(part).toEqual({ type: ContentTypes.SOURCES, sources: [realSource] });
    expect(payload).toEqual({
      sources: [realSource],
      job_id: 'job-c1',
      query_id: 'q-c1',
      outcome: 'answered',
      usage: measuredUsage,
    });
  });

  it('still yields the envelope when retrieval was empty — empty is an outcome, not an absence', async () => {
    orchestrator.json({
      job_id: 'job-c2',
      outcome: 'failed',
      sources: [],
      usage: { ...measuredUsage, engine_cost_usd: null, engine_cost_is_complete: null },
    });

    const { part, payload } = await getAflatCompletion({
      appConfig: appConfigFor(orchestrator.baseURL),
      endpoint: AFLAT_ENDPOINT_NAME,
      responseMessageId: 'msg-c2',
    });

    expect(part).toBeNull();
    expect(payload?.outcome).toBe('failed');
    expect(payload?.usage?.engine_cost_usd).toBeNull();
  });

  it('yields a null payload for a different endpoint, so the writer skips', async () => {
    orchestrator.json({ sources: [realSource], usage: measuredUsage });

    await expect(
      getAflatCompletion({
        appConfig: appConfigFor(orchestrator.baseURL),
        endpoint: 'some-other-endpoint',
        responseMessageId: 'msg-c3',
      }),
    ).resolves.toEqual({ part: null, payload: null });
    expect(orchestrator.requests).toHaveLength(0);
  });
});
