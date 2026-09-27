import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSpikeServer } from '../src/api.js';

const client = new MongoClient('mongodb://127.0.0.1:27018/?replicaSet=gh29');
const db = client.db(`gh29_test_${randomUUID().replaceAll('-', '')}`);
let server: Server;
let base: string;
let alice: string;
let bob: string;
const content = JSON.stringify({ title: 'Packing', items: [{ id: randomUUID(), text: 'Passport', checked: false }] });

async function upload(token: string, id: string, data: unknown) {
  return fetch(`${base}/checklists/${id}`, {
    method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
}

beforeAll(async () => {
  await client.connect();
  server = await createSpikeServer(db);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const account of ['alice', 'bob']) {
    const response = await fetch(`${base}/dev/session?account=${account}`);
    expect(response.status).toBe(200);
    const session = await response.json();
    if (account === 'alice') alice = session.token;
    else bob = session.token;
  }
});

afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  // This randomly named database belongs exclusively to this test run.
  await db.dropDatabase();
  await client.close();
});

describe('local checklist upload boundary', () => {
  it('commits a whole checklist document before acknowledging the upload', async () => {
    const id = randomUUID();
    expect((await upload(alice, id, { content })).status).toBe(200);
    const saved = await db.collection<{ _id: string; owner_id: string; content: unknown }>('checklists').findOne({ _id: id });
    expect(saved?.content).toEqual(JSON.parse(content));
    expect(saved?.owner_id).toBe('spike-alice');
  });

  it('takes ownership from the verified token and prevents cross-account replacement', async () => {
    const id = randomUUID();
    await upload(alice, id, { content });
    expect((await upload(bob, id, { content })).status).toBe(403);
    expect((await upload(alice, randomUUID(), { content, owner_id: 'spike-bob' })).status).toBe(400);
  });

  it('replaces the aggregate in server arrival order', async () => {
    const id = randomUUID();
    await upload(alice, id, { content });
    const later = { title: 'New packing list', items: [] };
    await upload(alice, id, { content: JSON.stringify(later) });
    expect((await db.collection<{ _id: string; content: unknown }>('checklists').findOne({ _id: id }))?.content).toEqual(later);
  });

  it('rejects missing and tampered tokens without committing a document', async () => {
    const id = randomUUID();
    expect((await upload('', id, { content })).status).toBe(401);
    expect((await upload(`${alice}broken`, id, { content })).status).toBe(401);
    expect(await db.collection<{ _id: string }>('checklists').findOne({ _id: id })).toBeNull();
  });

  it.each([
    { content: 'not json' },
    { content: JSON.stringify({ title: '', items: [] }) },
    { content: JSON.stringify({ title: 'Packing', items: [{ id: 'not-a-uuid', text: 'Passport', checked: false }] }) },
    { content: JSON.stringify({ title: 'Packing', items: Array.from({ length: 201 }, () => ({ id: randomUUID(), text: 'Item', checked: false })) }) },
    null,
  ])('rejects invalid checklist data without writing it: %j', async data => {
    const id = randomUUID();
    expect((await upload(alice, id, data)).status).toBe(400);
    expect(await db.collection<{ _id: string }>('checklists').findOne({ _id: id })).toBeNull();
  });

  it('does not mint arbitrary account identities', async () => {
    expect((await fetch(`${base}/dev/session?account=someone-else`)).status).toBe(400);
  });

  it('returns a permanent size error instead of a retryable broken connection for oversized uploads', async () => {
    const id = randomUUID();
    expect((await upload(alice, id, { content: 'x'.repeat(400 * 1024) })).status).toBe(413);
    expect(await db.collection<{ _id: string }>('checklists').findOne({ _id: id })).toBeNull();
  });
});
