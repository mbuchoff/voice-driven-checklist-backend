// Disposable Cloud-to-SQLite proof for the two synthetic source documents.
// Install @powersync/node and better-sqlite3 in an isolated directory and set
// GH29_POWERSYNC_NODE_SDK_ROOT to that directory. Never print the dev JWTs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

const instanceId = '6aaef0eb02481fb31b97e80b';
const endpoint = `https://${instanceId}.powersync.journeyapps.com`;
const cli = process.env.GH29_POWERSYNC_CLI;
const sdkRoot = process.env.GH29_POWERSYNC_NODE_SDK_ROOT;
assert(cli, 'Set GH29_POWERSYNC_CLI to the installed PowerSync CLI');
assert(sdkRoot, 'Set GH29_POWERSYNC_NODE_SDK_ROOT to the isolated SDK directory');

const { PS_ADMIN_TOKEN } = parseEnv(readFileSync(new URL('../../../../powersync-credentials.env', import.meta.url), 'utf8'));
assert(PS_ADMIN_TOKEN, 'PowerSync admin token missing');
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

const workDir = mkdtempSync(join(tmpdir(), 'gh29-powersync-sqlite-'));
try {
  for (const [subject, title] of [
    ['gh29-alice', 'Packing 1 · café 🧳'],
    ['gh29-bob', 'Packing 2 · café 🧳'],
  ]) {
    const token = generateToken(subject);
    const db = new PowerSyncDatabase({
      schema, database: { dbFilename: join(workDir, `${subject}.db`) },
    });
    try {
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
      } finally {
        clearTimeout(syncTimeout);
      }
      const rows = await db.getAll('SELECT id, owner_id, content FROM gh29_cloud_checklists');
      assert.equal(rows.length, 1, `${subject} received an unexpected row count`);
      assert.equal(rows[0].owner_id, subject, `${subject} received another account's data`);
      const content = JSON.parse(rows[0].content);
      assert.equal(content.title, title);
      assert.equal(content.items.length, 1);
      assert.equal(content.items[0].text, 'Passport');
      console.log(JSON.stringify({ subject, rowCount: rows.length, ownerIsSelf: true,
        contentVerified: true, firstSyncComplete: true }));
    } finally {
      await db.disconnect();
      await db.close();
    }
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
