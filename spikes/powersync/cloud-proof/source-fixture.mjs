// Synthetic source data for the GH-29 Cloud stream proof. Operates only on the
// dedicated development collection after verifying that it is absent or owned.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { MongoClient } from 'mongodb';

const host = 'voicechecklist.0hbva2h.mongodb.net';
const database = 'voice_checklist_dev';
const collectionName = 'gh29_cloud_checklists';
const marker = 'gh29-cloud-proof-2026-09-19';
const expectedOwners = ['gh29-alice', 'gh29-bob'];

function clientFor(path, expectedUsername) {
  const values = parseEnv(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const supplied = new URL(values.MONGODB_URI);
  assert.equal(supplied.protocol, 'mongodb+srv:');
  assert.equal(supplied.hostname, host);
  assert.equal(supplied.port, '');
  assert.equal(values.MONGODB_USERNAME, expectedUsername);
  assert(values.MONGODB_PASSWORD);
  return new MongoClient(`mongodb+srv://${host}/`, {
    authSource: 'admin', auth: { username: values.MONGODB_USERNAME, password: values.MONGODB_PASSWORD },
    tls: true, writeConcern: { w: 'majority' }, serverSelectionTimeoutMS: 10000,
    appName: 'gh29-cloud-source-fixture',
  });
}

const app = clientFor('../../../../atlas-app-dev.env', 'voice_checklist_app_dev');
const adminValues = parseEnv(readFileSync(new URL('../../../../atlas-credentials.env', import.meta.url), 'utf8'));
const adminUri = new URL(adminValues.MONGODB_URI);
assert.equal(adminUri.protocol, 'mongodb+srv:');
assert.equal(adminUri.hostname, host);
const admin = new MongoClient(`mongodb+srv://${host}/`, {
  authSource: 'admin', auth: { username: adminValues.MONGODB_USERNAME, password: adminValues.MONGODB_PASSWORD },
  tls: true, writeConcern: { w: 'majority' }, serverSelectionTimeoutMS: 10000,
  appName: 'gh29-cloud-source-fixture-admin',
});

try {
  await app.connect();
  await admin.connect();
  const db = app.db(database);
  const source = db.collection(collectionName);
  const exists = (await db.listCollections({ name: collectionName }, { nameOnly: true }).toArray()).length > 0;
  if (process.argv[2] === 'prepare') {
    assert(!exists, 'Proof collection already exists; refusing to overwrite');
    const collection = await db.createCollection(collectionName);
    await admin.db(database).command({ collMod: collectionName,
      changeStreamPreAndPostImages: { enabled: true } });
    const checklistId = randomUUID();
    const docs = expectedOwners.map((owner_id, index) => ({
      _id: randomUUID(), owner_id, checklistId, fixture: marker,
      content: JSON.stringify({ title: `Packing ${index + 1} · café 🧳`,
        items: [{ id: randomUUID(), text: 'Passport', order: 0 }] }),
    }));
    await collection.insertMany(docs);
    assert.equal(await collection.countDocuments({ fixture: marker }), 2);
    console.log(JSON.stringify({ prepared: true, database, collection: collectionName,
      owners: expectedOwners, docs: 2, postImages: true }));
  } else if (process.argv[2] === 'cleanup') {
    assert(exists, 'Proof collection absent; no cleanup needed');
    const docs = await source.find({}, { projection: { _id: 1, owner_id: 1, fixture: 1 } }).toArray();
    assert.equal(docs.length, 2, 'Unexpected document count; refusing to drop');
    assert(docs.every(value => value.fixture === marker), 'Unexpected document marker; refusing to drop');
    assert.deepEqual(docs.map(value => value.owner_id).sort(), expectedOwners,
      'Unexpected owner; refusing to drop');
    await source.drop();
    assert.deepEqual(await db.listCollections({ name: collectionName }, { nameOnly: true }).toArray(), []);
    console.log(JSON.stringify({ cleanup: 'verified', database, collection: collectionName }));
  } else {
    throw new Error('Use prepare or cleanup');
  }
} finally {
  await app.close();
  await admin.close();
}
