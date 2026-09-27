import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sourceProbeTarget } from '../src/source-target.js';

// Local by default; the Atlas mode needs explicit host selection and separate
// approval for live fixture writes/cleanup. It never loads a credential file.
const target = sourceProbeTarget();
const client = new MongoClient(target.uri, target.options);
// Atlas Free limits database names to 38 bytes; retain 80 random bits within it.
const db = client.db(`gh29_source_probe_${randomBytes(10).toString('hex')}`);
const createdCollections: string[] = [];

// This is a capability fixture, not the eventual generated API contract.
type Definition = { title: string; items: { id: string; text: string; order: number }[] };
type ChecklistDocument = {
  _id: string;
  owner: string;
  checklistId: string;
  definition: Definition;
};

function document(owner = 'probe-alice', checklistId: string = randomUUID()): ChecklistDocument {
  return {
    _id: randomUUID(), owner, checklistId,
    definition: {
      title: '旅行 · café 🧳',
      items: [
        { id: randomUUID(), text: 'Passport', order: 0 },
        { id: randomUUID(), text: 'Cafe\u0301 supplies', order: 1 },
      ],
    },
  };
}

async function createCollection<T extends object>(name: string, postImages = false) {
  const collection = await db.createCollection<T>(name);
  // Record ownership only after creation succeeds. Never drop an existing target.
  createdCollections.push(name);
  if (postImages) {
    await db.command({ collMod: name, changeStreamPreAndPostImages: { enabled: true } });
  }
  return collection;
}

beforeAll(async () => {
  await client.connect();
  const admin = client.db('admin');
  const version = await admin.command({ buildInfo: 1 });
  const hello = await admin.command({ hello: 1 });
  expect(await db.listCollections({}, { nameOnly: true }).toArray()).toEqual([]);
  console.log(JSON.stringify({
    probe: 'source-capabilities', target: target.label, host: new URL(target.uri).hostname,
    database: db.databaseName, mongoVersion: version.version,
    provider: hello.tags?.provider, region: hello.tags?.region,
  }));
});

afterAll(async () => {
  try {
    if (createdCollections.length === 0) return;
    const cleanup = await Promise.allSettled(createdCollections.map(name => db.collection(name).drop()));
    const failed = createdCollections.filter((_, index) => cleanup[index].status === 'rejected');
    if (failed.length) throw new Error(`Fixture cleanup failed in ${db.databaseName}: ${failed.join(', ')}`);
    expect(await db.listCollections({}, { nameOnly: true }).toArray()).toEqual([]);
    console.log(JSON.stringify({ database: db.databaseName, cleanup: 'verified', droppedFixtureCollections: createdCollections.length }));
  } finally {
    await client.close();
  }
});

describe(`MongoDB source capabilities (${target.label})`, () => {
  it('allows the same logical checklist ID for different owners, but not twice for one owner', async () => {
    const collection = await createCollection<ChecklistDocument>('owner_identity');
    await collection.createIndex({ owner: 1, checklistId: 1 }, { unique: true });
    const alice = document();
    const bob = document('probe-bob', alice.checklistId);
    await collection.insertMany([alice, bob]);
    await expect(collection.insertOne(document(alice.owner, alice.checklistId)))
      .rejects.toMatchObject({ code: 11000 });
    expect(await collection.find({ checklistId: alice.checklistId }).sort({ owner: 1 }).toArray())
      .toEqual([alice, bob]);
  });

  it('publishes a document and its counter together only after transaction commit', async () => {
    const collection = await createCollection<ChecklistDocument>('committed_checklists');
    const counters = await createCollection<{ _id: string; active: number }>('committed_counters');
    const checklist = document();
    const session = client.startSession();
    try {
      session.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
      await collection.insertOne(checklist, { session });
      await counters.insertOne({ _id: checklist.owner, active: 1 }, { session });
      expect(await collection.findOne({ _id: checklist._id })).toBeNull();
      expect(await counters.findOne({ _id: checklist.owner })).toBeNull();
      await session.commitTransaction();
      expect(await collection.findOne({ _id: checklist._id })).toEqual(checklist);
      expect(await counters.findOne({ _id: checklist.owner })).toEqual({ _id: checklist.owner, active: 1 });
    } finally {
      if (session.inTransaction()) await session.abortTransaction();
      await session.endSession();
    }
  });

  it('rolls back both the document and counter when the transaction aborts', async () => {
    const collection = await createCollection<ChecklistDocument>('aborted_checklists');
    const counters = await createCollection<{ _id: string; active: number }>('aborted_counters');
    const checklist = document();
    const session = client.startSession();
    try {
      session.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
      await collection.insertOne(checklist, { session });
      await counters.insertOne({ _id: checklist.owner, active: 1 }, { session });
      await session.abortTransaction();
      expect(await collection.findOne({ _id: checklist._id })).toBeNull();
      expect(await counters.findOne({ _id: checklist.owner })).toBeNull();
    } finally {
      if (session.inTransaction()) await session.abortTransaction();
      await session.endSession();
    }
  });

  it('retains each exact post-image through later edits and deletion, and resumes after a saved event', async () => {
    const collection = await createCollection<ChecklistDocument>('post_images', true);
    // Database-level stream matches the connector boundary, not just a collection watch.
    const stream = db.watch<ChecklistDocument>([{ $match: { 'ns.coll': collection.collectionName } }], {
      fullDocument: 'required', batchSize: 1, maxAwaitTimeMS: 1000, timeoutMS: 10000,
    });
    try {
      // Initialize the cursor before writing; no timing-based listener race.
      expect(await stream.tryNext()).toBeNull();
      const original = document();
      const replacement = { ...original, definition: { title: 'Empty checklist', items: [] } };
      const edited = { ...replacement, definition: { title: 'Later edit', items: original.definition.items } };
      const finalEdit = { ...edited, definition: { ...edited.definition, title: 'Last edit' } };
      await collection.insertOne(original);
      await collection.replaceOne({ _id: original._id }, replacement);
      await collection.updateOne({ _id: original._id }, { $set: { definition: edited.definition } });
      await collection.updateOne({ _id: original._id }, { $set: { 'definition.title': finalEdit.definition.title } });
      await collection.deleteOne({ _id: original._id });

      // Consume only after the source document is gone: updateLookup cannot
      // satisfy this oracle by fetching the current/latest document instead.
      const events = [];
      for (let i = 0; i < 5; i++) events.push(await stream.next());
      expect(events.map(event => event.operationType)).toEqual(['insert', 'replace', 'update', 'update', 'delete']);
      for (const [index, expected] of [original, replacement, edited, finalEdit].entries()) {
        const event = events[index];
        expect('fullDocument' in event ? event.fullDocument : undefined).toEqual(expected);
      }
      expect(events[4]).toMatchObject({ documentKey: { _id: original._id } });

      const resumed = db.watch<ChecklistDocument>([{ $match: { 'ns.coll': collection.collectionName } }], {
        fullDocument: 'required', resumeAfter: events[2]._id, maxAwaitTimeMS: 1000, timeoutMS: 10000,
      });
      try {
        expect(await resumed.next()).toMatchObject({ operationType: 'update', fullDocument: finalEdit });
        expect(await resumed.next()).toMatchObject({ operationType: 'delete', documentKey: { _id: original._id } });
      } finally {
        await resumed.close();
      }
    } finally {
      await stream.close();
    }
  });

  it('fails required-post-image reads when collection post-images are not enabled', async () => {
    const collection = await createCollection<ChecklistDocument>('missing_post_images');
    const stream = collection.watch([], {
      fullDocument: 'required', batchSize: 1, maxAwaitTimeMS: 1000, timeoutMS: 10000,
    });
    try {
      expect(await stream.tryNext()).toBeNull();
      const checklist = document();
      await collection.insertOne(checklist);
      expect(await stream.next()).toMatchObject({ operationType: 'insert', fullDocument: checklist });
      await collection.updateOne({ _id: checklist._id }, { $set: { 'definition.title': 'Changed' } });
      await expect(stream.next()).rejects.toThrow(/post-image.*not found/i);
    } finally {
      await stream.close();
    }
  });

  it('supports creating, updating, reading and removing checkpoint records', async () => {
    const checkpoints = await createCollection<{ _id: string; position: number }>('_powersync_checkpoints');
    const id = randomUUID();
    await checkpoints.insertOne({ _id: id, position: 1 });
    await checkpoints.updateOne({ _id: id }, { $set: { position: 2 } });
    expect(await checkpoints.findOne({ _id: id })).toEqual({ _id: id, position: 2 });
    expect((await checkpoints.deleteOne({ _id: id })).deletedCount).toBe(1);
    expect(await checkpoints.findOne({ _id: id })).toBeNull();
  });
});
