import { createServer, type IncomingMessage } from 'node:http';
import { exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import type { Db } from 'mongodb';
import { z } from 'zod';

const audience = 'gh29-local-proof';
const issuer = 'gh29-local-proof-api';
const checklist = z.strictObject({
  title: z.string().min(1).max(200),
  items: z.array(z.strictObject({
    id: z.uuid(), text: z.string().min(1).max(1000), checked: z.boolean(),
  })).max(200),
}).refine(value => new Set(value.items.map(item => item.id)).size === value.items.length);
const upload = z.strictObject({ content: z.string() });

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    length += Buffer.byteLength(chunk as Buffer);
    if (length > 350 * 1024) throw new HttpError(413, 'body_too_large');
    chunks.push(Buffer.from(chunk as Buffer));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'invalid_json'); }
}

// A deliberately local fixture issuer. This is NOT a Cognito substitute and
// must never be exposed as an application authentication endpoint.
export async function createSpikeServer(db: Db) {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicJwk = { ...await exportJWK(publicKey), kid: 'local-proof', alg: 'RS256', use: 'sig' };
  const documents = db.collection<{ _id: string; owner_id: string; content: z.infer<typeof checklist> }>('checklists');
  const server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    response.setHeader('cache-control', 'no-store');
    const origin = request.headers.origin;
    if (origin) {
      const allowed = ['http://localhost:4014', 'http://127.0.0.1:4014', 'http://host.docker.internal:4014'];
      if (!allowed.includes(origin)) { response.writeHead(403).end('{}'); return; }
      response.setHeader('access-control-allow-origin', origin);
      response.setHeader('vary', 'Origin');
      response.setHeader('access-control-allow-headers', 'authorization, content-type');
      response.setHeader('access-control-allow-methods', 'GET, PUT, OPTIONS');
    }
    const reply = (status: number, body: unknown) => { response.writeHead(status).end(JSON.stringify(body)); };
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
      if (request.method === 'GET' && url.pathname === '/health') {
        await db.command({ ping: 1 });
        reply(200, { mode: 'local-synthetic-data-only' }); return;
      }
      if (request.method === 'GET' && url.pathname === '/jwks') {
        reply(200, { keys: [publicJwk] }); return;
      }
      if (request.method === 'GET' && url.pathname === '/dev/session') {
        const account = z.enum(['alice', 'bob']).parse(url.searchParams.get('account'));
        const token = await new SignJWT({})
          .setProtectedHeader({ alg: 'RS256', kid: 'local-proof' })
          .setSubject(`spike-${account}`).setIssuer(issuer).setAudience(audience)
          .setIssuedAt().setExpirationTime('5m').sign(privateKey);
        reply(200, { token }); return;
      }
      const match = /^\/checklists\/([^/]+)$/.exec(url.pathname);
      if (request.method !== 'PUT' || !match) throw new HttpError(404, 'not_found');
      let subject: string;
      try {
        const token = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
        const { payload } = await jwtVerify(token, publicKey, { issuer, audience, algorithms: ['RS256'] });
        subject = z.enum(['spike-alice', 'spike-bob']).parse(payload.sub);
      } catch { throw new HttpError(401, 'unauthorized'); }
      const id = z.uuid().parse(match[1]);
      const body = upload.parse(await readJson(request));
      if (Buffer.byteLength(body.content, 'utf8') > 300 * 1024) throw new HttpError(413, 'checklist_too_large');
      let content: z.infer<typeof checklist>;
      try { content = checklist.parse(JSON.parse(body.content)); }
      catch { throw new HttpError(400, 'invalid_checklist'); }
      try {
        // The owner filter plus unique _id also protects a concurrent first write.
        await documents.updateOne({ _id: id, owner_id: subject }, { $set: { owner_id: subject, content } }, { upsert: true });
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
          throw new HttpError(403, 'not_owner');
        }
        throw error;
      }
      reply(200, { committed: true });
    } catch (error) {
      if (error instanceof HttpError) reply(error.status, { code: error.code });
      else if (error instanceof z.ZodError) reply(400, { code: 'invalid_request' });
      else reply(503, { code: 'temporarily_unavailable' });
    }
  });
  server.requestTimeout = 15000;
  return server;
}
