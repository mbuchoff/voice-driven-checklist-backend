import { exportJWK, generateKeyPair, jwtVerify } from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { AccountLifecycleReader } from '../src/accounts/account-lifecycle.js';
import {
  AccountUnavailableError,
  createPowerSyncCredentialAuthority,
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
  return createPowerSyncCredentialAuthority({
    endpoint,
    issuer,
    keyId: 'powersync-development-1',
    privateJwk,
    now,
  });
}

describe('PowerSync credential issuer', () => {
  it('issues only a five-minute, subject-scoped token and a public JWKS', async () => {
    const authority = issuerUnderTest();

    const credentials = await authority.credentials.issue(subject);
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
    expect(authority.jwks).toEqual({
      keys: [expect.objectContaining({
        alg: 'RS256',
        kid: 'powersync-development-1',
        kty: 'RSA',
        use: 'sig',
      })],
    });
    expect(authority.jwks.keys[0]).not.toHaveProperty('d');
  });

  it('publishes retiring public keys during a signing-key rotation', async () => {
    const retiring = await generateKeyPair('RS256', {
      extractable: true,
      modulusLength: 2048,
    });
    const retiringJwk = {
      ...await exportJWK(retiring.publicKey),
      alg: 'RS256',
      kid: 'powersync-retiring',
      use: 'sig',
    };

    const authority = createPowerSyncCredentialAuthority({
      additionalPublicJwks: [retiringJwk],
      endpoint,
      issuer,
      keyId: 'powersync-development-1',
      privateJwk,
    });

    expect(authority.jwks.keys.map((key) => key.kid)).toEqual([
      'powersync-development-1',
      'powersync-retiring',
    ]);
    expect(authority.jwks.keys.every((key) => !('d' in key))).toBe(true);
  });

  it('rejects an incomplete private signing key before it can become a runtime promise', () => {
    expect(() => createPowerSyncCredentialAuthority({
      endpoint,
      issuer,
      keyId: 'powersync-development-1',
      privateJwk: { d: 'd', e: 'AQAB', kty: 'RSA', n: 'n' },
    })).toThrow();
  });

  it('rejects duplicate signing and verification key IDs', async () => {
    const activePublic = {
      ...await exportJWK(publicKey),
      alg: 'RS256',
      kid: 'powersync-development-1',
      use: 'sig',
    };

    expect(() => createPowerSyncCredentialAuthority({
      additionalPublicJwks: [activePublic],
      endpoint,
      issuer,
      keyId: 'powersync-development-1',
      privateJwk,
    })).toThrow();
  });

  it('rejects a private member in an additional verification key', async () => {
    const verification = {
      ...await exportJWK(publicKey),
      alg: 'RS256',
      d: 'must-not-be-published',
      kid: 'powersync-retiring',
      use: 'sig',
    };

    expect(() => createPowerSyncCredentialAuthority({
      additionalPublicJwks: [verification],
      endpoint,
      issuer,
      keyId: 'powersync-development-1',
      privateJwk,
    })).toThrow();
  });
});

describe('PowerSync credential service', () => {
  it('checks the account lifecycle before issuing credentials', async () => {
    const read = vi.fn().mockResolvedValue('active');
    const lifecycle: AccountLifecycleReader = {
      read,
    };
    const authority = issuerUnderTest();
    const service = createPowerSyncCredentialService(lifecycle, authority.credentials);

    await expect(service.issue(subject)).resolves.toMatchObject({ endpoint });
    expect(read).toHaveBeenCalledWith(subject);
  });

  it.each(['deleting', 'deleted'] as const)(
    'rejects an account that is %s',
    async (state) => {
      const lifecycle: AccountLifecycleReader = {
        read: vi.fn().mockResolvedValue(state),
      };
      const authority = issuerUnderTest();
      const issue = vi.spyOn(authority.credentials, 'issue');
      const service = createPowerSyncCredentialService(lifecycle, authority.credentials);

      await expect(service.issue(subject)).rejects.toBeInstanceOf(AccountUnavailableError);
      expect(issue).not.toHaveBeenCalled();
    },
  );
});
