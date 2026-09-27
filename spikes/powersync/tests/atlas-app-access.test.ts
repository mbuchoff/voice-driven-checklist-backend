import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sourceProbeTarget } from '../src/source-target.js';

// Never run live writes merely because credentials are present in the environment.
describe.skipIf(process.env.GH29_ATLAS_APP_ACCESS !== '1')('Atlas application-user access', () => {
  let client: MongoClient;
  const database = 'voice_checklist_dev';
  const prefix = `gh29_access_${randomBytes(10).toString('hex')}`;
  const documentsName = `${prefix}_documents`;
  const countersName = `${prefix}_counters`;
  const created: string[] = [];
  type Document = { _id: string; owner: string; checklistId: string; title: string; items: string[] };

  beforeAll(async () => {
    const target = sourceProbeTarget();
    expect(target.label).toBe('atlas');
    expect(new URL(target.uri).hostname).toBe('voicechecklist.0hbva2h.mongodb.net');
    expect(process.env.MONGODB_USERNAME).toBe('voice_checklist_app_dev');
    expect(process.env.MONGODB_DATABASE).toBe(database);
    client = new MongoClient(target.uri, target.options);
    try { await client.connect(); }
    catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : 'unknown';
      throw new Error(`Application-user connection failed (MongoDB code ${code}); diagnostics suppressed`);
    }
    const db = client.db(database);
    for (const name of [documentsName, countersName]) {
      expect(await db.listCollections({ name }, { nameOnly: true }).toArray()).toEqual([]);
      await db.createCollection(name);
      created.push(name);
    }
  });

  afterAll(async () => {
    if (!client) return;
    try {
      const cleanup = await Promise.allSettled(created.map(name => client.db(database).collection(name).drop()));
      expect(cleanup.every(result => result.status === 'fulfilled')).toBe(true);
      if (created.length) {
        const remaining = await client.db(database).listCollections({}, { nameOnly: true }).toArray();
        expect(remaining.filter(value => created.includes(value.name))).toEqual([]);
        console.log(JSON.stringify({ probe: 'atlas-app-access', database, cleanup: 'verified',
          droppedFixtureCollections: created.length }));
      }
    } finally { await client.close(); }
  });

  it('authenticates with only the application database read/write role', async () => {
    const status = await client.db('admin').command({ connectionStatus: 1 });
    expect(status.authInfo.authenticatedUserRoles).toEqual([{ role: 'readWrite', db: database }]);
  });

  it('supports document CRUD and owner-scoped uniqueness within the application database', async () => {
    const collection = client.db(database).collection<Document>(documentsName);
    await collection.createIndex({ owner: 1, checklistId: 1 }, { unique: true });
    const checklistId = randomUUID();
    const alice = { _id: randomUUID(), owner: 'probe-alice', checklistId, title: '旅行 · café', items: ['Passport'] };
    const bob = { ...alice, _id: randomUUID(), owner: 'probe-bob' };
    await collection.insertMany([alice, bob]);
    await expect(collection.insertOne({ ...alice, _id: randomUUID() })).rejects.toMatchObject({ code: 11000 });
    expect(await collection.findOne({ _id: alice._id })).toEqual(alice);
    await collection.updateOne({ _id: alice._id }, { $set: { title: 'Updated', items: [] } });
    expect(await collection.findOne({ _id: alice._id })).toEqual({ ...alice, title: 'Updated', items: [] });
    expect(await collection.findOne({ _id: bob._id })).toEqual(bob);
    expect((await collection.deleteMany({ _id: { $in: [alice._id, bob._id] } })).deletedCount).toBe(2);
    expect(await collection.findOne({ _id: alice._id })).toBeNull();
  });

  it('commits and aborts cross-collection transactions with the scoped credential', async () => {
    const db = client.db(database);
    const documents = db.collection<Document>(documentsName);
    const counters = db.collection<{ _id: string; count: number }>(countersName);
    const session = client.startSession();
    try {
      for (const commit of [true, false]) {
        const id = randomUUID();
        const document = { _id: id, owner: 'probe-transaction', checklistId: id,
          title: 'Transaction fixture', items: [] };
        session.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
        await documents.insertOne(document, { session });
        await counters.insertOne({ _id: id, count: 1 }, { session });
        expect(await documents.findOne({ _id: id })).toBeNull();
        expect(await counters.findOne({ _id: id })).toBeNull();
        if (commit) await session.commitTransaction();
        else await session.abortTransaction();
        expect(await documents.findOne({ _id: id })).toEqual(commit ? document : null);
        expect(await counters.findOne({ _id: id })).toEqual(commit ? { _id: id, count: 1 } : null);
      }
    } finally {
      if (session.inTransaction()) await session.abortTransaction();
      await session.endSession();
    }
  });

  it('rejects reading another database even for a nonexistent document', async () => {
    // Read-only, random selector: never returns existing sample data if overprivileged.
    await expect(client.db('sample_mflix').collection<{ _id: string }>('movies').findOne({ _id: randomUUID() }))
      .rejects.toMatchObject({ code: 8000, codeName: 'AtlasError',
        message: expect.stringMatching(/user is not allowed to do action \[find\]/i) });
  });

  it('rejects collection-administration changes even within the application database', async () => {
    await expect(client.db(database).command({ collMod: documentsName,
      changeStreamPreAndPostImages: { enabled: true } })).rejects.toMatchObject({
      code: 8000, codeName: 'AtlasError',
      message: expect.stringMatching(/user is not allowed to do action \[collMod\]/i),
    });
  });
});
