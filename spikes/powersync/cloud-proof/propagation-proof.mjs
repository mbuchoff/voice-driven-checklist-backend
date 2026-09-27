// Reversible Atlas -> PowerSync Cloud -> SQLite propagation proof.
// Uses only the dedicated synthetic collection and restores the source document.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { MongoClient } from 'mongodb';

const instanceId = '6aaef0eb02481fb31b97e80b';
const endpoint = `https://${instanceId}.powersync.journeyapps.com`;
const database = 'voice_checklist_dev';
const collectionName = 'gh29_cloud_checklists';
const fixture = 'gh29-cloud-proof-2026-09-19';
const cli = process.env.GH29_POWERSYNC_CLI;
const sdkRoot = process.env.GH29_POWERSYNC_NODE_SDK_ROOT;
assert(cli, 'Set GH29_POWERSYNC_CLI to the installed PowerSync CLI');
assert(sdkRoot, 'Set GH29_POWERSYNC_NODE_SDK_ROOT to the isolated SDK directory');

const { PS_ADMIN_TOKEN } = parseEnv(readFileSync(new URL('../../../../powersync-credentials.env', import.meta.url), 'utf8'));
const appValues = parseEnv(readFileSync(new URL('../../../../atlas-app-dev.env', import.meta.url), 'utf8'));
assert(PS_ADMIN_TOKEN, 'PowerSync admin token missing');
assert.equal(appValues.MONGODB_USERNAME, 'voice_checklist_app_dev');
assert.equal(appValues.MONGODB_DATABASE, database);
const suppliedUri = new URL(appValues.MONGODB_URI);
assert.equal(suppliedUri.hostname, 'voicechecklist.0hbva2h.mongodb.net');

const { PowerSyncDatabase, Schema, Table, column } = await import(pathToFileURL(
  join(sdkRoot, 'node_modules/@powersync/node/lib/index.js')).href);
const schema = new Schema({
  gh29_cloud_checklists: new Table({ owner_id: column.text, content: column.text }),
});

function generateToken(subject) {
  const result = spawnSync(cli, [
    'generate', 'token', `--subject=${subject}`, '--expires-in-seconds=3600',
    `--directory=${new URL('.', import.meta.url).pathname}`, `--instance-id=${instanceId}`,
  ], {
    env: { ...process.env, PS_ADMIN_TOKEN }, encoding: 'utf8', timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, `Development token generation failed for ${subject}`);
  const token = result.stdout.trim();
  assert.equal(token.split('.').length, 3, 'Development token is not a JWT');
  return token;
}

async function openClient(subject, directory) {
  const token = generateToken(subject);
  const db = new PowerSyncDatabase({
    schema, database: { dbFilename: join(directory, `${subject}.db`) },
  });
  await db.connect({
    fetchCredentials: async () => ({ endpoint, token }),
    uploadData: async () => { throw new Error('Read-only proof must not upload data'); },
  });
  let syncTimeout;
  try {
    await Promise.race([
      db.waitForFirstSync(),
      new Promise((_, reject) => {
        syncTimeout = setTimeout(() => reject(new Error(`First sync timeout for ${subject}`)), 45000);
      }),
    ]);
  } catch (error) {
    await db.disconnect();
    await db.close();
    throw error;
  } finally {
    clearTimeout(syncTimeout);
  }
  return db;
}

async function onlyRow(db, subject) {
  const rows = await db.getAll('SELECT id, owner_id, content FROM gh29_cloud_checklists');
  assert.equal(rows.length, 1, `${subject} received an unexpected row count`);
  assert.equal(rows[0].owner_id, subject, `${subject} received another account's data`);
  return rows[0];
}

async function waitForContent(db, subject, expected) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const row = await onlyRow(db, subject);
    if (row.content === expected) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for propagated content for ${subject}`);
}

const workDir = mkdtempSync(join(tmpdir(), 'gh29-powersync-propagation-'));
const mongo = new MongoClient(`mongodb+srv://${suppliedUri.hostname}/`, {
  authSource: 'admin',
  auth: { username: appValues.MONGODB_USERNAME, password: appValues.MONGODB_PASSWORD },
  tls: true,
  serverSelectionTimeoutMS: 15000,
  writeConcern: { w: 'majority' },
  appName: 'gh29-cloud-propagation-proof',
});
let alice;
let bob;
let originalContent;
let changedContent;
let sourceRestored = false;
try {
  [alice, bob] = await Promise.all([
    openClient('gh29-alice', workDir),
    openClient('gh29-bob', workDir),
  ]);
  const aliceBefore = await onlyRow(alice, 'gh29-alice');
  const bobBefore = await onlyRow(bob, 'gh29-bob');

  await mongo.connect();
  const source = mongo.db(database).collection(collectionName);
  const sourceRows = await source.find({ fixture }).toArray();
  assert.equal(sourceRows.length, 2, 'Unexpected synthetic source row count');
  const sourceAlice = sourceRows.find(row => row.owner_id === 'gh29-alice');
  assert(sourceAlice, 'Synthetic Alice source document is missing');
  assert.equal(sourceAlice.content, aliceBefore.content, 'Alice source and client disagree before mutation');
  originalContent = sourceAlice.content;
  const changed = JSON.parse(originalContent);
  changed.propagationProbe = randomUUID();
  changedContent = JSON.stringify(changed);

  const mutation = await source.updateOne(
    { _id: sourceAlice._id, fixture, owner_id: 'gh29-alice', content: originalContent },
    { $set: { content: changedContent } },
  );
  assert.equal(mutation.matchedCount, 1, 'Alice source changed concurrently; mutation refused');
  assert.equal(mutation.modifiedCount, 1, 'Alice source mutation did not apply');

  await waitForContent(alice, 'gh29-alice', changedContent);
  const bobDuring = await onlyRow(bob, 'gh29-bob');
  assert.equal(bobDuring.content, bobBefore.content, 'Bob content changed during Alice update');

  const restoration = await source.updateOne(
    { _id: sourceAlice._id, fixture, owner_id: 'gh29-alice', content: changedContent },
    { $set: { content: originalContent } },
  );
  assert.equal(restoration.matchedCount, 1, 'Alice source changed concurrently; restoration refused');
  assert.equal(restoration.modifiedCount, 1, 'Alice source restoration did not apply');
  sourceRestored = true;
  await waitForContent(alice, 'gh29-alice', originalContent);
  assert.equal((await onlyRow(bob, 'gh29-bob')).content, bobBefore.content);

  console.log(JSON.stringify({ sourceMutation: 'propagated', aliceRows: 1,
    bobRows: 1, accountIsolation: 'verified', sourceRestoration: 'propagated' }));
} finally {
  if (originalContent && changedContent && !sourceRestored) {
    const source = mongo.db(database).collection(collectionName);
    await source.updateOne(
      { fixture, owner_id: 'gh29-alice', content: changedContent },
      { $set: { content: originalContent } },
    ).catch(() => {});
  }
  await Promise.allSettled([alice?.disconnect(), bob?.disconnect()]);
  await Promise.allSettled([alice?.close(), bob?.close(), mongo.close()]);
  rmSync(workDir, { recursive: true, force: true });
}
