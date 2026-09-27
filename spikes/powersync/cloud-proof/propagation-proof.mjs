// Reversible Atlas -> PowerSync Cloud -> authenticated SQLite propagation proof.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { MongoClient } from 'mongodb';

import { onlyRow, openClient, proofSessions } from './powersync-client.mjs';

const databaseName = 'voice_checklist_dev';
const collectionName = 'gh29_cloud_checklists';
const fixture = 'gh29-cloud-proof-2026-09-19';
const sdkRoot = process.env.GH29_POWERSYNC_NODE_SDK_ROOT;
assert(sdkRoot, 'Set GH29_POWERSYNC_NODE_SDK_ROOT to the isolated SDK directory');

assert(process.env.GH29_ATLAS_APP_ENV_FILE, 'Set GH29_ATLAS_APP_ENV_FILE');
const appValues = parseEnv(readFileSync(process.env.GH29_ATLAS_APP_ENV_FILE, 'utf8'));
assert.equal(appValues.MONGODB_USERNAME, 'voice_checklist_app_dev');
assert.equal(appValues.MONGODB_DATABASE, databaseName);
const suppliedUri = new URL(appValues.MONGODB_URI);
assert.equal(suppliedUri.hostname, 'voicechecklist.0hbva2h.mongodb.net');

const mongo = new MongoClient(`mongodb+srv://${suppliedUri.hostname}/`, {
  appName: 'gh29-cloud-propagation-proof',
  authSource: 'admin',
  auth: { username: appValues.MONGODB_USERNAME, password: appValues.MONGODB_PASSWORD },
  tls: true,
  serverSelectionTimeoutMS: 15_000,
  writeConcern: { w: 'majority' },
});

async function waitForContent(database, subject, expected) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const row = await onlyRow(database, subject);
    if (row.content === expected) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for propagated content');
}

const sessions = proofSessions();
const workDirectory = mkdtempSync(join(tmpdir(), 'gh29-powersync-propagation-'));
const clients = [];
let originalContent;
let changedContent;
let sourceRestored = false;
try {
  for (const session of sessions) {
    clients.push(await openClient({
      accessToken: session.accessToken,
      filename: join(workDirectory, `${session.label}.db`),
      sdkRoot,
    }));
  }
  const [aliceSession, bobSession] = sessions;
  const [alice, bob] = clients;
  const aliceBefore = await onlyRow(alice, aliceSession.subject);
  const bobBefore = await onlyRow(bob, bobSession.subject);

  await mongo.connect();
  const source = mongo.db(databaseName).collection(collectionName);
  const sourceRows = await source.find({ fixture }).toArray();
  assert.equal(sourceRows.length, 2, 'Unexpected synthetic source row count');
  const sourceAlice = sourceRows.find(row => row.owner_id === aliceSession.subject);
  assert(sourceAlice, 'Synthetic Alice source document is missing');
  assert.equal(sourceAlice.content, aliceBefore.content, 'Alice source and client disagree before mutation');
  originalContent = sourceAlice.content;
  const changed = JSON.parse(originalContent);
  changed.propagationProbe = randomUUID();
  changedContent = JSON.stringify(changed);

  const mutation = await source.updateOne(
    { _id: sourceAlice._id, fixture, owner_id: aliceSession.subject, content: originalContent },
    { $set: { content: changedContent } },
  );
  assert.equal(mutation.matchedCount, 1, 'Alice source changed concurrently; mutation refused');
  assert.equal(mutation.modifiedCount, 1, 'Alice source mutation did not apply');

  await waitForContent(alice, aliceSession.subject, changedContent);
  assert.equal((await onlyRow(bob, bobSession.subject)).content, bobBefore.content);

  const restoration = await source.updateOne(
    { _id: sourceAlice._id, fixture, owner_id: aliceSession.subject, content: changedContent },
    { $set: { content: originalContent } },
  );
  assert.equal(restoration.matchedCount, 1, 'Alice source changed concurrently; restoration refused');
  assert.equal(restoration.modifiedCount, 1, 'Alice source restoration did not apply');
  sourceRestored = true;
  await waitForContent(alice, aliceSession.subject, originalContent);
  assert.equal((await onlyRow(bob, bobSession.subject)).content, bobBefore.content);

  console.log(JSON.stringify({
    accountIsolation: 'verified',
    aliceRows: 1,
    bobRows: 1,
    sourceMutation: 'propagated',
    sourceRestoration: 'propagated',
  }));
} finally {
  if (originalContent && changedContent && !sourceRestored) {
    await mongo.db(databaseName).collection(collectionName).updateOne(
      { fixture, owner_id: sessions[0].subject, content: changedContent },
      { $set: { content: originalContent } },
    ).catch(() => {});
  }
  for (const client of clients) {
    await client.disconnect().catch(() => {});
    await client.close().catch(() => {});
  }
  await mongo.close().catch(() => {});
  rmSync(workDirectory, { recursive: true, force: true });
}
