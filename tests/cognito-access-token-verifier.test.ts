import { generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  IdentityProviderUnavailableError,
  InvalidAccessTokenError,
  createCognitoAccessTokenVerifier,
} from '../src/auth/cognito-access-token-verifier.js';

const issuer = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_example';
const subject = 'd9ed16f8-78d1-4a61-8f4d-18bdbf31bb16';
let privateKey: CryptoKey;
let publicKey: CryptoKey;

beforeAll(async () => {
  ({ privateKey, publicKey } = await generateKeyPair('RS256', {
    modulusLength: 2048,
  }));
});

async function accessToken(
  claims: Record<string, unknown> = {},
  overrides: { expiresIn?: number; issuedAt?: number; issuer?: string } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    client_id: 'android-client',
    token_use: 'access',
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'cognito-test' })
    .setIssuer(overrides.issuer ?? issuer)
    .setSubject(subject)
    .setIssuedAt(overrides.issuedAt ?? now)
    .setExpirationTime(now + (overrides.expiresIn ?? 3600))
    .sign(privateKey);
}

describe('Cognito access-token verification', () => {
  it('accepts an intended Cognito app client and returns only its subject', async () => {
    const verifier = createCognitoAccessTokenVerifier(
      {
        clientIds: ['android-client', 'web-client'],
        issuer,
      },
      publicKey,
    );

    await expect(verifier.verify(await accessToken({ email: 'not-forwarded@example.com' })))
      .resolves.toEqual({ subject });
  });

  it.each([
    ['an ID token', { token_use: 'id' }, {}],
    ['an unintended client', { client_id: 'attacker-client' }, {}],
    ['the wrong issuer', {}, { issuer: `${issuer}-other` }],
    ['an expired token', {}, { expiresIn: -60 }],
  ])('rejects %s', async (_label, claims, overrides) => {
    const verifier = createCognitoAccessTokenVerifier(
      { clientIds: ['android-client'], issuer },
      publicKey,
    );

    await expect(verifier.verify(await accessToken(claims, overrides)))
      .rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('distinguishes an unavailable key source from a caller authentication failure', async () => {
    const verifier = createCognitoAccessTokenVerifier(
      { clientIds: ['android-client'], issuer },
      () => Promise.reject(new Error('network unavailable')),
    );

    await expect(verifier.verify(await accessToken()))
      .rejects.toBeInstanceOf(IdentityProviderUnavailableError);
  });

  it('accepts a still-unexpired token without duplicating the pool lifetime policy', async () => {
    const verifier = createCognitoAccessTokenVerifier(
      { clientIds: ['android-client'], issuer },
      publicKey,
    );
    const issuedAt = Math.floor(Date.now() / 1000) - (70 * 60);

    await expect(verifier.verify(await accessToken({}, {
      expiresIn: 10 * 60,
      issuedAt,
    }))).resolves.toEqual({ subject });
  });
});
