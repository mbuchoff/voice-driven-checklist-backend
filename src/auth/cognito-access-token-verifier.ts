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

const validationErrorCodes = new Set([
  'ERR_JOSE_ALG_NOT_ALLOWED',
  'ERR_JWS_INVALID',
  'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JWKS_NO_MATCHING_KEY',
  'ERR_JWT_CLAIM_VALIDATION_FAILED',
  'ERR_JWT_EXPIRED',
  'ERR_JWT_INVALID',
]);

function isCallerValidationError(error: unknown): boolean {
  return error instanceof errors.JOSEError && validationErrorCodes.has(error.code);
}

export function createCognitoAccessTokenVerifier(
  configuration: CognitoAccessTokenConfiguration,
  key: KeyInput | JWTVerifyGetKey = createRemoteJWKSet(
    new URL(`${configuration.issuer}/.well-known/jwks.json`),
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
          maxTokenAge: 65 * 60,
          requiredClaims: ['exp', 'sub', 'token_use', 'client_id'],
        });
        const payload = claims.parse(verified.payload);
        return { subject: payload.sub };
      } catch (error) {
        if (error instanceof z.ZodError || isCallerValidationError(error)) {
          throw new InvalidAccessTokenError();
        }
        throw new IdentityProviderUnavailableError();
      }
    },
  };
}
