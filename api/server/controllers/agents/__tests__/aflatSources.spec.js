/**
 * ai-aflat: end-to-end proof for the citation transport's fork half.
 *
 * A real HTTP server stands in for the orchestrator (the real engine needs a key we
 * do not have). `AgentClient.sendCompletion` is driven for real, with only the agent
 * graph itself replaced, and the assertion is on the content parts that become the
 * persisted assistant message — the same array `Part.tsx` dispatches to `Sources.tsx`.
 */

const { createServer } = require('node:http');
const { ContentTypes, EModelEndpoint } = require('librechat-data-provider');

const mockCreateRun = jest.fn();

jest.mock('@librechat/agents', () => ({
  ...jest.requireActual('@librechat/agents'),
  createMetadataAggregator: () => ({ handleLLMEnd: jest.fn(), collected: [] }),
}));

jest.mock('@librechat/api', () => ({
  ...jest.requireActual('@librechat/api'),
  createRun: (...args) => mockCreateRun(...args),
  countTokens: jest.fn((text) => Math.ceil(String(text ?? '').length / 4)),
  countFormattedMessageTokens: jest.fn(() => 42),
  createTokenCounter: jest.fn(() => (text) => Math.ceil(String(text ?? '').length / 4)),
  checkAccess: jest.fn(),
  initializeAgent: jest.fn(),
  createMemoryProcessor: jest.fn(),
  loadAgent: jest.fn(),
}));

jest.mock('~/server/services/Config', () => ({ getMCPServerTools: jest.fn() }));
jest.mock('~/server/services/MCP', () => ({
  resolveConfigServers: jest.fn().mockResolvedValue({}),
}));
jest.mock('~/models', () => ({
  getAgent: jest.fn(),
  getRoleByName: jest.fn(),
  getFormattedMemories: jest.fn(),
}));
jest.mock('~/config', () => ({
  getMCPManager: jest.fn(() => ({ formatInstructionsForContext: jest.fn() })),
}));

const AgentClient = require('../client');

const RESPONSE_MESSAGE_ID = 'response-message-abc';

const source = {
  entity_id: 'art-307791-26',
  entity_type: 'article',
  title: 'Art. 26',
  act_title: 'Legea nr. 50/1991 privind autorizarea executării lucrărilor de construcții',
  snippet: 'Constituie contravenții următoarele fapte…',
  url: 'https://legislatie.just.ro/Public/DetaliiDocument/307791#id_artA26_ttl',
  in_force: true,
  cited: true,
};

describe('AgentClient — ai-aflat SOURCES content part', () => {
  let server;
  let baseURL;
  let requests;
  let respond;

  beforeAll(async () => {
    server = createServer((req, res) => {
      requests.push({ url: req.url, auth: req.headers.authorization });
      respond(req, res);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseURL = `http://127.0.0.1:${server.address().port}/v1`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    requests = [];
    respond = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ job_id: 'job-1', query_id: 'q-1', sources: [source] }));
    };
    mockCreateRun.mockResolvedValue({
      processStream: jest.fn().mockResolvedValue(undefined),
      getCalibrationRatio: () => 0,
      Graph: null,
    });
  });

  const buildClient = (endpointName) => {
    const req = {
      user: { id: 'user-123' },
      body: { model: 'simple-search', endpoint: endpointName },
      config: {
        endpoints: {
          [EModelEndpoint.custom]: [
            { name: 'ai-aflat', baseURL, apiKey: 'orchestrator-key', titleConvo: false },
          ],
        },
      },
    };

    const client = new AgentClient({
      req,
      res: {},
      agent: {
        id: 'agent-aflat',
        endpoint: endpointName,
        provider: EModelEndpoint.openAI,
        model_parameters: { model: 'simple-search' },
      },
      endpointTokenConfig: {},
    });

    client.responseMessageId = RESPONSE_MESSAGE_ID;
    client.conversationId = 'convo-123';
    client.parentMessageId = 'parent-123';
    client.contentParts = [{ type: ContentTypes.TEXT, text: 'Autorizația este obligatorie.' }];
    client.recordCollectedUsage = jest.fn().mockResolvedValue();
    return client;
  };

  const payload = [{ role: 'user', content: 'Am nevoie de autorizație de construire?' }];

  it('appends the orchestrator citations as the last content part', async () => {
    const client = buildClient('ai-aflat');

    const { completion } = await client.sendCompletion(payload);

    expect(requests).toEqual([
      { url: `/v1/messages/${RESPONSE_MESSAGE_ID}/sources`, auth: 'Bearer orchestrator-key' },
    ]);
    expect(completion).toHaveLength(2);
    expect(completion[0].type).toBe(ContentTypes.TEXT);
    expect(completion[1]).toEqual({ type: ContentTypes.SOURCES, sources: [source] });
  });

  it('appends nothing when retrieval came back empty', async () => {
    respond = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ job_id: 'job-2', query_id: null, sources: [] }));
    };
    const client = buildClient('ai-aflat');

    const { completion } = await client.sendCompletion(payload);

    expect(completion).toHaveLength(1);
    expect(completion.some((part) => part.type === ContentTypes.SOURCES)).toBe(false);
  });

  it('does not fail the message when the orchestrator has no record of it', async () => {
    respond = (_req, res) => {
      res.writeHead(404);
      res.end();
    };
    const client = buildClient('ai-aflat');

    const { completion } = await client.sendCompletion(payload);

    expect(completion).toHaveLength(1);
    expect(completion.some((part) => part.type === ContentTypes.ERROR)).toBe(false);
  });

  it('never calls the orchestrator for a different endpoint', async () => {
    const client = buildClient(EModelEndpoint.openAI);

    const { completion } = await client.sendCompletion(payload);

    expect(requests).toHaveLength(0);
    expect(completion).toHaveLength(1);
  });
});
