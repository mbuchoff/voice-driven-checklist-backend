import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sourceProbeTarget } from '../src/source-target.js';

// A separate opt-in test: ordinary npm test must never touch Atlas.
describe.skipIf(process.env.GH29_ATLAS_SYNC_ACCESS !== '1')('Atlas PowerSync source-user access', () => {
  const database = 'voice_checklist_dev';
  const sourceName = `gh29_sync_source_${randomBytes(8).toString('hex')}`;
  const checkpointName = '_powersync_checkpoints';
  const clients: MongoClient[] = [];
  const created: { client: MongoClient; name: string }[] = [];
  let sync: MongoClient;
  let app: MongoClient;
  let admin: MongoClient;

  function privilegedClient(path: string, target: ReturnType<typeof sourceProbeTarget>) {
    const values = parseEnv(readFileSync(path, 'utf8'));
    const supplied = new URL(values.MONGODB_URI ?? '');
    expect(supplied.protocol).toBe('mongodb+srv:');
    expect(supplied.hostname).toBe(new URL(target.uri).hostname);
    expect(supplied.port).toBe('');
    expect(values.MONGODB_USERNAME).toBeTruthy();
    expect(values.MONGODB_PASSWORD).toBeTruthy();
    return new MongoClient(target.uri, {
      ...target.options, auth: { username: values.MONGODB_USERNAME, password: values.MONGODB_PASSWORD },
    });
  }

  beforeAll(async () => {
    const target = sourceProbeTarget();
    expect(target.label).toBe('atlas');
    expect(new URL(target.uri).hostname).toBe('voicechecklist.0hbva2h.mongodb.net');
    expect(process.env.MONGODB_USERNAME).toBe('voice_checklist_sync_dev');
    expect(process.env.MONGODB_DATABASE).toBe(database);
    sync = new MongoClient(target.uri, target.options);
    clients.push(sync);
    try { await sync.connect(); }
    catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : 'unknown';
      throw new Error(`Sync-user connection failed (MongoDB code ${code}); diagnostics suppressed`);
    }
    app = privilegedClient('../../../atlas-app-dev.env', target);
    admin = privilegedClient('../../../atlas-credentials.env', target);
    clients.push(app, admin);
    await app.connect();
    await admin.connect();
    expect(await app.db(database).listCollections({ name: sourceName }, { nameOnly: true }).toArray()).toEqual([]);
    expect(await admin.db(database).listCollections({ name: checkpointName }, { nameOnly: true }).toArray()).toEqual([]);
    await app.db(database).createCollection(sourceName);
    created.push({ client: app, name: sourceName });
    await admin.db(database).command({ collMod: sourceName,
      changeStreamPreAndPostImages: { enabled: true } });
  });

  afterAll(async () => {
    try {
      const drops = await Promise.allSettled(created.map(({ client, name }) => client.db(database).collection(name).drop()));
      expect(drops.every(result => result.status === 'fulfilled')).toBe(true);
      if (created.length && app) {
        const remaining = await app.db(database).listCollections({}, { nameOnly: true }).toArray();
        expect(remaining.filter(value => created.some(item => item.name === value.name))).toEqual([]);
        console.log(JSON.stringify({ probe: 'atlas-sync-access', cleanup: 'verified',
          droppedFixtureCollections: created.length }));
      }
    } finally { await Promise.all(clients.map(client => client.close())); }
  });

  it('sees only read access to the application database and write access to checkpoints', async () => {
    const status = await sync.db('admin').command({ connectionStatus: 1 });
    expect(status.authInfo.authenticatedUserRoles).toEqual(expect.arrayContaining([
      { role: 'read', db: database },
      { role: 'readWrite', db: database, collection: checkpointName },
    ]));
    expect(status.authInfo.authenticatedUserRoles).toHaveLength(2);
  });

  it('reads source documents and receives exact post-images through a database stream', async () => {
    const source = app.db(database).collection<{ _id: string; title: string }>(sourceName);
    const id = randomUUID();
    const stream = sync.db(database).watch([{ $match: { 'ns.coll': sourceName } }], {
      fullDocument: 'required', batchSize: 1, maxAwaitTimeMS: 1000, timeoutMS: 10000,
    });
    try {
      expect(await stream.tryNext()).toBeNull();
      await source.insertOne({ _id: id, title: 'Original' });
      await source.updateOne({ _id: id }, { $set: { title: 'Latest' } });
      await source.deleteOne({ _id: id });
      const first = await stream.next();
      const second = await stream.next();
      expect('fullDocument' in first ? first.fullDocument : undefined).toEqual({ _id: id, title: 'Original' });
      expect('fullDocument' in second ? second.fullDocument : undefined).toEqual({ _id: id, title: 'Latest' });
      expect((await stream.next()).operationType).toBe('delete');
      expect(await sync.db(database).collection<{ _id: string }>(sourceName).findOne({ _id: id })).toBeNull();
    } finally { await stream.close(); }
  });

  it('creates, updates and removes only its checkpoint records', async () => {
    const db = sync.db(database);
    await db.createCollection(checkpointName);
    created.push({ client: sync, name: checkpointName });
    const checkpoints = db.collection<{ _id: string; position: number }>(checkpointName);
    const id = randomUUID();
    await checkpoints.insertOne({ _id: id, position: 1 });
    await checkpoints.updateOne({ _id: id }, { $set: { position: 2 } });
    expect(await checkpoints.findOne({ _id: id })).toEqual({ _id: id, position: 2 });
    expect((await checkpoints.deleteOne({ _id: id })).deletedCount).toBe(1);
  });

  it('cannot change source documents or read an unrelated database', async () => {
    await expect(sync.db(database).collection<{ _id: string }>(sourceName).updateOne({ _id: randomUUID() },
      { $set: { title: 'Never applied' } })).rejects.toMatchObject({
      code: 8000, codeName: 'AtlasError',
      message: expect.stringMatching(/user is not allowed to do action \[update\]/i),
    });
    await expect(sync.db('sample_mflix').collection<{ _id: string }>('movies').findOne({ _id: randomUUID() }))
      .rejects.toMatchObject({ code: 8000, codeName: 'AtlasError',
        message: expect.stringMatching(/user is not allowed to do action \[find\]/i) });
  });
});
