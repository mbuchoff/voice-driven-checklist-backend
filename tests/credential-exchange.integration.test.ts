import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import {
  exportJWK,
  generateKeyPair,
  jwtVerify,
  SignJWT,
} from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import { createCognitoAccessTokenVerifier } from '../src/auth/cognito-access-token-verifier.js';
import {
  createPowerSyncCredentialIssuer,
  createPowerSyncCredentialService,
} from '../src/auth/powersync-credential-service.js';
import { createHandler } from '../src/handler.js';

const cognitoIssuer = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_example';
const powerSyncEndpoint = 'https://example.powersync.journeyapps.com';
const powerSyncIssuer = 'https://api.example.test';
const subject = 'd9ed16f8-78d1-4a61-8f4d-18bdbf31bb16';
let cognitoPrivateKey: CryptoKey;
let cognitoPublicKey: CryptoKey;
let powerSyncPrivateJwk: Record<string, unknown>;
let powerSyncPublicKey: CryptoKey;

beforeAll(async () => {
  const cognito = await generateKeyPair('RS256', { modulusLength: 2048 });
  cognitoPrivateKey = cognito.privateKey;
  cognitoPublicKey = cognito.publicKey;
  const powerSync = await generateKeyPair('RS256', {
    extractable: true,
    modulusLength: 2048,
  });
  powerSyncPrivateJwk = await exportJWK(powerSync.privateKey);
  powerSyncPublicKey = powerSync.publicKey;
});

function request(token: string): APIGatewayProxyEventV2 {
  return {
    headers: { authorization: `Bearer ${token}` },
    isBase64Encoded: false,
    rawPath: '/v1/powersync/credentials',
    rawQueryString: '',
    requestContext: {
      accountId: 'anonymous',
      apiId: 'test',
      domainName: 'test',
      domainPrefix: 'test',
      http: {
        method: 'POST',
        path: '/v1/powersync/credentials',
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'vitest',
      },
      requestId: 'request-id',
      routeKey: '$default',
      stage: '$default',
      time: '27/Sep/2026:00:00:00 +0000',
      timeEpoch: Date.now(),
    },
    routeKey: '$default',
    version: '2.0',
  };
}

async function cognitoToken(tokenUse: 'access' | 'id'): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    client_id: 'android-client',
    token_use: tokenUse,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'cognito-test' })
    .setIssuer(cognitoIssuer)
    .setSubject(subject)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(cognitoPrivateKey);
}

function handler() {
  const credentialIssuer = createPowerSyncCredentialIssuer({
    audience: powerSyncEndpoint,
    endpoint: powerSyncEndpoint,
    issuer: powerSyncIssuer,
    keyId: 'powersync-test',
    privateJwk: powerSyncPrivateJwk,
  });
  return createHandler({
    accessTokens: createCognitoAccessTokenVerifier(
      { clientIds: ['android-client'], issuer: cognitoIssuer },
      cognitoPublicKey,
    ),
    credentials: createPowerSyncCredentialService(
      { read: () => Promise.resolve('active') },
      credentialIssuer,
    ),
  });
}

describe('Cognito to PowerSync credential exchange', () => {
  it('turns a real access-token signature into a separately signed five-minute credential', async () => {
    const before = Math.floor(Date.now() / 1000);
    const response = await handler()(
      request(await cognitoToken('access')),
      {} as Context,
    );

    expect(response.statusCode).toBe(200);
    const credentials = JSON.parse(response.body ?? '') as {
      endpoint: string;
      token: string;
    };
    expect(credentials.endpoint).toBe(powerSyncEndpoint);
    const verified = await jwtVerify(credentials.token, powerSyncPublicKey, {
      algorithms: ['RS256'],
      audience: powerSyncEndpoint,
      issuer: powerSyncIssuer,
    });
    expect(verified.payload.sub).toBe(subject);
    expect((verified.payload.exp ?? 0) - (verified.payload.iat ?? 0)).toBe(300);
    expect(verified.payload.iat).toBeGreaterThanOrEqual(before);
  });

  it('does not exchange a correctly signed Cognito ID token', async () => {
    const response = await handler()(
      request(await cognitoToken('id')),
      {} as Context,
    );

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body ?? '')).toEqual({
      code: 'invalid_access_token',
    });
  });
});
