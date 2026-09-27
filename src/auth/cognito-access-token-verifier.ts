import {
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JWTVerifyGetKey,
  type KeyInput,
} from 'jose';
import { z } from 'zod';

export class InvalidAccessTokenError extends Error {
  constructor() {
    super('The Cognito access token is invalid.');
    this.name = 'InvalidAccessTokenError';
  }
}

export class IdentityProviderUnavailableError extends Error {
  constructor() {
    super('The Cognito signing-key service is unavailable.');
    this.name = 'IdentityProviderUnavailableError';
  }
}

export interface VerifiedAccessToken {
  readonly subject: string;
}

export interface AccessTokenVerifier {
  verify(token: string): Promise<VerifiedAccessToken>;
}

interface CognitoAccessTokenConfiguration {
  readonly clientIds: readonly string[];
  readonly issuer: string;
}

const keyProviderErrorCodes = new Set([
  'ERR_JOSE_GENERIC',
  'ERR_JWK_INVALID',
  'ERR_JWKS_INVALID',
  'ERR_JWKS_MULTIPLE_MATCHING_KEYS',
  'ERR_JWKS_TIMEOUT',
]);

function isKeyProviderError(error: unknown): boolean {
  return error instanceof errors.JOSEError && keyProviderErrorCodes.has(error.code);
}

export function createCognitoAccessTokenVerifier(
  configuration: CognitoAccessTokenConfiguration,
  key: KeyInput | JWTVerifyGetKey = createRemoteJWKSet(
    new URL(`${configuration.issuer}/.well-known/jwks.json`),
    { timeoutDuration: 1_500 },
  ),
): AccessTokenVerifier {
  const allowedClients = new Set(configuration.clientIds);
  const claims = z.object({
    client_id: z.string().refine((clientId) => allowedClients.has(clientId)),
    sub: z.string().min(1),
    token_use: z.literal('access'),
  });

  return {
    async verify(token) {
      try {
        const verified = await jwtVerify(token, key, {
          algorithms: ['RS256'],
          clockTolerance: 30,
          issuer: configuration.issuer,
          requiredClaims: ['exp', 'sub', 'token_use', 'client_id'],
        });
        const payload = claims.parse(verified.payload);
        return { subject: payload.sub };
      } catch (error) {
        if (isKeyProviderError(error) || !(error instanceof errors.JOSEError || error instanceof z.ZodError)) {
          throw new IdentityProviderUnavailableError();
        }
        throw new InvalidAccessTokenError();
      }
    },
  };
}
