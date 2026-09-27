import {
  SignJWT,
  importJWK,
  type JWK_RSA_Private,
  type JWK_RSA_Public,
} from 'jose';
import { z } from 'zod';

import type { AccountLifecycleReader } from '../accounts/account-lifecycle.js';

const fiveMinutesInSeconds = 5 * 60;

const privateRsaJwk = z.looseObject({
  alg: z.literal('RS256').optional(),
  d: z.string().min(1),
  dp: z.string().min(1),
  dq: z.string().min(1),
  e: z.string().min(1),
  kid: z.string().min(1).optional(),
  kty: z.literal('RSA'),
  n: z.string().min(1),
  p: z.string().min(1),
  q: z.string().min(1),
  qi: z.string().min(1),
  use: z.literal('sig').optional(),
});

const publicRsaJwk = z.strictObject({
  alg: z.literal('RS256'),
  e: z.string().min(1),
  kid: z.string().min(1),
  kty: z.literal('RSA'),
  n: z.string().min(1),
  use: z.literal('sig'),
});

export interface PowerSyncCredentials {
  readonly endpoint: string;
  readonly expiresAt: string;
  readonly token: string;
}

export interface PowerSyncCredentialIssuer {
  issue(subject: string): Promise<PowerSyncCredentials>;
}

export interface PowerSyncCredentialAuthority {
  readonly credentials: PowerSyncCredentialIssuer;
  readonly jwks: { readonly keys: readonly JWK_RSA_Public[] };
}

interface PowerSyncCredentialConfiguration {
  readonly additionalPublicJwks?: readonly Record<string, unknown>[];
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

export function createPowerSyncCredentialAuthority(
  configuration: PowerSyncCredentialConfiguration,
): PowerSyncCredentialAuthority {
  const privateKey: JWK_RSA_Private = privateRsaJwk.parse(configuration.privateJwk);
  if (privateKey.kid !== undefined && privateKey.kid !== configuration.keyId) {
    throw new Error('The private signing key ID does not match POWERSYNC_JWT_KID.');
  }
  const now = configuration.now ?? (() => new Date());
  const activePublicKey: JWK_RSA_Public = {
    alg: 'RS256',
    e: privateKey.e,
    kid: configuration.keyId,
    kty: 'RSA',
    n: privateKey.n,
    use: 'sig',
  };
  const additionalPublicKeys: JWK_RSA_Public[] = (configuration.additionalPublicJwks ?? [])
    .map((key) => publicRsaJwk.parse(key));
  const publicKeys = [activePublicKey, ...additionalPublicKeys];
  if (new Set(publicKeys.map((key) => key.kid)).size !== publicKeys.length) {
    throw new Error('PowerSync verification key IDs must be unique.');
  }

  let signingKey: ReturnType<typeof importJWK> | undefined;
  function loadSigningKey(): ReturnType<typeof importJWK> {
    if (signingKey !== undefined) {
      return signingKey;
    }
    const pending = importJWK(privateKey, 'RS256');
    signingKey = pending.catch((error: unknown) => {
      signingKey = undefined;
      throw error;
    });
    return signingKey;
  }

  return {
    credentials: {
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
          .setAudience(configuration.endpoint)
          .setSubject(subject)
          .setIssuedAt(issuedAt)
          .setExpirationTime(expiresAt)
          .sign(await loadSigningKey());

        return {
          endpoint: configuration.endpoint,
          expiresAt: new Date(expiresAt * 1000).toISOString(),
          token,
        };
      },
    },
    jwks: { keys: publicKeys },
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
  };
}
