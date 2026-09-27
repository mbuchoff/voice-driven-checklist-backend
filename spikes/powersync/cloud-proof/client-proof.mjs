// Disposable Cognito -> backend exchange -> PowerSync Cloud -> SQLite proof.
// Install @powersync/node and better-sqlite3 in an isolated directory and set
// GH29_POWERSYNC_NODE_SDK_ROOT. Never print the supplied Cognito access tokens.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { onlyRow, openClient, proofSessions } from './powersync-client.mjs';

const sdkRoot = process.env.GH29_POWERSYNC_NODE_SDK_ROOT;
assert(sdkRoot, 'Set GH29_POWERSYNC_NODE_SDK_ROOT to the isolated SDK directory');

const workDirectory = mkdtempSync(join(tmpdir(), 'gh29-powersync-sqlite-'));
try {
  for (const session of proofSessions()) {
    const database = await openClient({
      accessToken: session.accessToken,
      filename: join(workDirectory, `${session.label}.db`),
      sdkRoot,
    });
    try {
      const row = await onlyRow(database, session.subject);
      const content = JSON.parse(row.content);
      assert.equal(content.title, session.title);
      assert.equal(content.items.length, 1);
      assert.equal(content.items[0].text, 'Passport');
      console.log(JSON.stringify({
        account: session.label,
        contentVerified: true,
        firstSyncComplete: true,
        ownerIsSelf: true,
        rowCount: 1,
      }));
    } finally {
      await database.disconnect().catch(() => {});
      await database.close().catch(() => {});
    }
  }
} finally {
  rmSync(workDirectory, { recursive: true, force: true });
}
