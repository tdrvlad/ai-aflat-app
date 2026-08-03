import { createServer } from 'node:http';
import { ContentTypes } from 'librechat-data-provider';
import type { AddressInfo } from 'node:net';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import type { TAflatSource } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { resolveHeaders } from '~/utils/env';
import {
  AFLAT_ENDPOINT_NAME,
  buildSourcesUrl,
  fetchAflatSources,
  buildAflatSourcesPart,
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

    const sources = await fetchAflatSources({
      baseURL: orchestrator.baseURL,
      apiKey: 'test-key',
      responseMessageId: 'msg-1',
    });

    expect(sources).toEqual([realSource]);
    expect(sources[0].url).toBe(realSource.url);
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
    ).resolves.toEqual([]);
  });

  it('returns an empty list on 404 (no job for this message)', async () => {
    orchestrator.status(404);

    await expect(
      fetchAflatSources({
        baseURL: orchestrator.baseURL,
        apiKey: 'test-key',
        responseMessageId: 'missing',
      }),
    ).resolves.toEqual([]);
  });

  it('returns an empty list on a server error rather than throwing', async () => {
    orchestrator.status(500);

    await expect(
      fetchAflatSources({
        baseURL: orchestrator.baseURL,
        apiKey: 'test-key',
        responseMessageId: 'msg-3',
      }),
    ).resolves.toEqual([]);
  });

  it('returns an empty list when the orchestrator is unreachable', async () => {
    const baseURL = orchestrator.baseURL;
    await orchestrator.stop();
    await orchestrator.start();

    await expect(
      fetchAflatSources({ baseURL, apiKey: 'test-key', responseMessageId: 'msg-4' }),
    ).resolves.toEqual([]);
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

    const sources = await fetchAflatSources({
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

    const sources = await fetchAflatSources({
      baseURL: orchestrator.baseURL,
      apiKey: 'test-key',
      responseMessageId: 'msg-6',
    });

    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBeUndefined();
  });

  it('returns an empty list when the payload has no sources array', async () => {
    orchestrator.json({ job_id: 'job-3' });

    await expect(
      fetchAflatSources({
        baseURL: orchestrator.baseURL,
        apiKey: 'test-key',
        responseMessageId: 'msg-7',
      }),
    ).resolves.toEqual([]);
  });
});

describe('buildAflatSourcesPart', () => {
  it('builds the SOURCES content part the renderer dispatches on', () => {
    expect(buildAflatSourcesPart([realSource])).toEqual({
      type: ContentTypes.SOURCES,
      sources: [realSource],
    });
  });

  it('builds nothing for an empty list', () => {
    expect(buildAflatSourcesPart([])).toBeNull();
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
