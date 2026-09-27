import { exportJWK, generateKeyPair, jwtVerify } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { AccountLifecycleReader } from '../src/accounts/account-lifecycle.js';
import {
  AccountUnavailableError,
  createPowerSyncCredentialIssuer,
  createPowerSyncCredentialService,
} from '../src/auth/powersync-credential-service.js';

const endpoint = 'https://example.powersync.journeyapps.com';
const issuer = 'https://api.example.test';
const subject = 'd9ed16f8-78d1-4a61-8f4d-18bdbf31bb16';
let privateJwk: Record<string, unknown>;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', {
    extractable: true,
    modulusLength: 2048,
  });
  privateJwk = await exportJWK(pair.privateKey);
  publicKey = pair.publicKey;
});

function issuerUnderTest(now = () => new Date('2026-09-27T12:00:00.000Z')) {
  return createPowerSyncCredentialIssuer({
    audience: endpoint,
    endpoint,
    issuer,
    keyId: 'powersync-development-1',
    privateJwk,
    now,
  });
}

describe('PowerSync credential issuer', () => {
  it('issues only a five-minute, subject-scoped token and a public JWKS', async () => {
    const credentialIssuer = issuerUnderTest();

    const credentials = await credentialIssuer.issue(subject);
    const verified = await jwtVerify(credentials.token, publicKey, {
      algorithms: ['RS256'],
      audience: endpoint,
      currentDate: new Date('2026-09-27T12:00:00.000Z'),
      issuer,
    });

    expect(credentials).toMatchObject({
      endpoint,
      expiresAt: '2026-09-27T12:05:00.000Z',
    });
    expect(verified.payload).toMatchObject({
      aud: endpoint,
      iss: issuer,
      sub: subject,
    });
    expect((verified.payload.exp ?? 0) - (verified.payload.iat ?? 0)).toBe(300);
    expect(verified.payload).not.toHaveProperty('email');
    expect(credentialIssuer.jwks()).toEqual({
      keys: [expect.objectContaining({
        alg: 'RS256',
        kid: 'powersync-development-1',
        kty: 'RSA',
        use: 'sig',
      })],
    });
    expect(credentialIssuer.jwks().keys[0]).not.toHaveProperty('d');
  });
});

describe('PowerSync credential service', () => {
  it('checks the account lifecycle before issuing credentials', async () => {
    const read = vi.fn().mockResolvedValue('active');
    const lifecycle: AccountLifecycleReader = {
      read,
    };
    const credentialIssuer = issuerUnderTest();
    const service = createPowerSyncCredentialService(lifecycle, credentialIssuer);

    await expect(service.issue(subject)).resolves.toMatchObject({ endpoint });
    expect(read).toHaveBeenCalledWith(subject);
  });

  it.each(['deleting', 'deleted'] as const)(
    'rejects an account that is %s',
    async (state) => {
      const lifecycle: AccountLifecycleReader = {
        read: vi.fn().mockResolvedValue(state),
      };
      const credentialIssuer = issuerUnderTest();
      const issue = vi.spyOn(credentialIssuer, 'issue');
      const service = createPowerSyncCredentialService(lifecycle, credentialIssuer);

      await expect(service.issue(subject)).rejects.toBeInstanceOf(AccountUnavailableError);
      expect(issue).not.toHaveBeenCalled();
    },
  );
});
