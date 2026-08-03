import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { ContentTypes } from 'librechat-data-provider';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { TMessageContentParts } from 'librechat-data-provider';
import type { IMessage } from '..';
import { createMessageMethods } from './message';
import { createModels } from '../models';

/**
 * ai-aflat: the citation transport appends a `SOURCES` content part to the assistant
 * message (see `packages/api/src/aflat/sources.ts`). Citations have to survive a page
 * reload and be there when a user returns to an old conversation, so this pins the
 * persistence half of that: the part goes into Mongo through the normal message save
 * path and comes back out of `getMessages` byte-for-byte, ready for `Part.tsx` to
 * dispatch to `Sources.tsx`.
 */

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

let mongoServer: InstanceType<typeof MongoMemoryServer>;
let Message: mongoose.Model<IMessage>;
let methods: ReturnType<typeof createMessageMethods>;

const sourcesPart: TMessageContentParts = {
  type: ContentTypes.SOURCES,
  sources: [
    {
      entity_id: 'art-307791-26',
      entity_type: 'article',
      title: 'Art. 26',
      act_title: 'Legea nr. 50/1991 privind autorizarea executării lucrărilor de construcții',
      snippet: 'Constituie contravenții următoarele fapte…',
      url: 'https://legislatie.just.ro/Public/DetaliiDocument/307791#id_artA26_ttl',
      in_force: true,
      cited: true,
    },
    {
      entity_id: 'art-307791-27',
      title: 'Art. 27',
      act_title: 'Legea nr. 50/1991 privind autorizarea executării lucrărilor de construcții',
      url: 'https://legislatie.just.ro/Public/DetaliiDocument/307791#id_artA27_ttl',
      in_force: false,
      cited: false,
    },
  ],
};

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const models = createModels(mongoose);
  Object.assign(mongoose.models, models);
  Message = mongoose.models.Message;
  methods = createMessageMethods(mongoose);
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('SOURCES content part persistence', () => {
  const userId = 'user-aflat';
  let conversationId: string;

  beforeEach(async () => {
    await Message.deleteMany({});
    conversationId = uuidv4();
  });

  it('round-trips the citation part through save and reload', async () => {
    const content: TMessageContentParts[] = [
      { type: ContentTypes.TEXT, text: 'Autorizația de construire este obligatorie…' },
      sourcesPart,
    ];

    await methods.saveMessage(
      { userId },
      {
        messageId: uuidv4(),
        conversationId,
        user: userId,
        isCreatedByUser: false,
        content,
      },
    );

    const [reloaded] = await methods.getMessages({ conversationId, user: userId });

    expect(reloaded.content).toHaveLength(2);
    expect(reloaded.content?.[1]).toEqual(sourcesPart);
    const reloadedPart = reloaded.content?.[1] as typeof sourcesPart;
    expect(reloadedPart.sources.map((source) => source.url)).toEqual(
      sourcesPart.sources.map((source) => source.url),
    );
  });

  it('keeps the citation part last, under the answer text', async () => {
    await methods.saveMessage(
      { userId },
      {
        messageId: uuidv4(),
        conversationId,
        user: userId,
        isCreatedByUser: false,
        content: [{ type: ContentTypes.TEXT, text: 'Răspuns.' }, sourcesPart],
      },
    );

    const [reloaded] = await methods.getMessages({ conversationId, user: userId });
    const parts = (reloaded.content ?? []) as TMessageContentParts[];
    expect(parts[parts.length - 1].type).toBe(ContentTypes.SOURCES);
  });

  it('persists a message with no citation part unchanged', async () => {
    await methods.saveMessage(
      { userId },
      {
        messageId: uuidv4(),
        conversationId,
        user: userId,
        isCreatedByUser: false,
        content: [{ type: ContentTypes.TEXT, text: 'Nu am găsit legislație aplicabilă.' }],
      },
    );

    const [reloaded] = await methods.getMessages({ conversationId, user: userId });
    expect(reloaded.content).toHaveLength(1);
    const parts = (reloaded.content ?? []) as TMessageContentParts[];
    expect(parts.some((part) => part.type === ContentTypes.SOURCES)).toBe(false);
  });
});
