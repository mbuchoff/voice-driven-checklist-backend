import {
  SignJWT,
  importJWK,
  type JWK,
  type JWK_RSA_Public,
} from 'jose';
import { z } from 'zod';

import type { AccountLifecycleReader } from '../accounts/account-lifecycle.js';

const fiveMinutesInSeconds = 5 * 60;

const privateRsaJwk = z.looseObject({
  alg: z.literal('RS256').optional(),
  d: z.string().min(1),
  e: z.string().min(1),
  kid: z.string().min(1).optional(),
  kty: z.literal('RSA'),
  n: z.string().min(1),
  use: z.literal('sig').optional(),
});

export interface PowerSyncCredentials {
  readonly endpoint: string;
  readonly expiresAt: string;
  readonly token: string;
}

export interface PowerSyncCredentialIssuer {
  issue(subject: string): Promise<PowerSyncCredentials>;
  jwks(): { readonly keys: readonly JWK_RSA_Public[] };
}

interface PowerSyncCredentialConfiguration {
  readonly audience: string;
  readonly endpoint: string;
  readonly issuer: string;
  readonly keyId: string;
  readonly now?: () => Date;
  readonly privateJwk: Record<string, unknown>;
}

export class AccountUnavailableError extends Error {
  constructor() {
    super('The account lifecycle fence prevents cloud access.');
    this.name = 'AccountUnavailableError';
  }
}

export function createPowerSyncCredentialIssuer(
  configuration: PowerSyncCredentialConfiguration,
): PowerSyncCredentialIssuer {
  const privateKey = privateRsaJwk.parse(configuration.privateJwk);
  const signingKey = importJWK(privateKey as JWK, 'RS256');
  const now = configuration.now ?? (() => new Date());
  const publicKey: JWK_RSA_Public = {
    alg: 'RS256',
    e: privateKey.e,
    kid: configuration.keyId,
    kty: 'RSA',
    n: privateKey.n,
    use: 'sig',
  };

  return {
    async issue(subject) {
      const issuedAt = Math.floor(now().getTime() / 1000);
      const expiresAt = issuedAt + fiveMinutesInSeconds;
      const token = await new SignJWT({})
        .setProtectedHeader({
          alg: 'RS256',
          kid: configuration.keyId,
          typ: 'JWT',
        })
        .setIssuer(configuration.issuer)
        .setAudience(configuration.audience)
        .setSubject(subject)
        .setIssuedAt(issuedAt)
        .setExpirationTime(expiresAt)
        .sign(await signingKey);

      return {
        endpoint: configuration.endpoint,
        expiresAt: new Date(expiresAt * 1000).toISOString(),
        token,
      };
    },
    jwks() {
      return { keys: [publicKey] };
    },
  };
}

export function createPowerSyncCredentialService(
  lifecycle: AccountLifecycleReader,
  issuer: PowerSyncCredentialIssuer,
): PowerSyncCredentialIssuer {
  return {
    async issue(subject) {
      if (await lifecycle.read(subject) !== 'active') {
        throw new AccountUnavailableError();
      }
      return issuer.issue(subject);
    },
    jwks: () => issuer.jwks(),
  };
}
