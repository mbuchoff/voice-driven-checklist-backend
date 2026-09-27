import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const endpoint = 'https://6aaef0eb02481fb31b97e80b.powersync.journeyapps.com';
const backendEndpoint = 'https://3rtgxivb53.execute-api.us-east-1.amazonaws.com';

function accessTokenSubject(accessToken) {
  const payloadPart = accessToken.split('.')[1];
  assert(payloadPart, 'Cognito access token is not a JWT');
  const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  assert.equal(payload.token_use, 'access', 'Cloud proof requires Cognito access tokens');
  assert.equal(typeof payload.sub, 'string', 'Cognito access token has no subject');
  return payload.sub;
}

export function proofSessions(environment = process.env) {
  const sessions = [
    {
      accessToken: environment.GH29_ALICE_ACCESS_TOKEN,
      label: 'alice',
      title: 'Packing 1 · café 🧳',
    },
    {
      accessToken: environment.GH29_BOB_ACCESS_TOKEN,
      label: 'bob',
      title: 'Packing 2 · café 🧳',
    },
  ].map((session) => {
    assert(session.accessToken, `Set GH29_${session.label.toUpperCase()}_ACCESS_TOKEN`);
    return { ...session, subject: accessTokenSubject(session.accessToken) };
  });
  assert.notEqual(sessions[0].subject, sessions[1].subject, 'Proof subjects must be distinct');
  return sessions;
}

async function exchangeCredential(accessToken) {
  const response = await fetch(`${backendEndpoint}/v1/powersync/credentials`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const body = await response.json();
  assert.equal(response.status, 200, `Backend credential exchange returned ${response.status}`);
  assert.equal(body.endpoint, endpoint, 'Backend returned an unexpected PowerSync endpoint');
  assert.equal(typeof body.token, 'string', 'Backend returned no PowerSync credential');
  return body;
}

export async function openClient({ accessToken, filename, sdkRoot }) {
  const { PowerSyncDatabase, Schema, Table, column } = await import(pathToFileURL(
    join(sdkRoot, 'node_modules/@powersync/node/lib/index.js')).href);
  const database = new PowerSyncDatabase({
    schema: new Schema({
      gh29_cloud_checklists: new Table({ owner_id: column.text, content: column.text }),
    }),
    database: { dbFilename: filename },
  });
  try {
    await database.connect({
      fetchCredentials: async () => exchangeCredential(accessToken),
      uploadData: async () => { throw new Error('Read-only proof must not upload data'); },
    });
    let syncTimeout;
    try {
      await Promise.race([
        database.waitForFirstSync(),
        new Promise((_, reject) => {
          syncTimeout = setTimeout(() => reject(new Error('PowerSync first sync timed out')), 45_000);
        }),
      ]);
    } finally {
      clearTimeout(syncTimeout);
    }
    return database;
  } catch (error) {
    await database.disconnect().catch(() => {});
    await database.close().catch(() => {});
    throw error;
  }
}

export async function onlyRow(database, subject) {
  const rows = await database.getAll('SELECT id, owner_id, content FROM gh29_cloud_checklists');
  assert.equal(rows.length, 1, 'Authorized client received an unexpected row count');
  assert.equal(rows[0].owner_id, subject, 'Authorized client received another account\'s data');
  return rows[0];
}
