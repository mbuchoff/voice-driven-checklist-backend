import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);
const opaqueNonEmpty = z.string().min(1);
const httpsUrl = z.url().refine((value) => new URL(value).protocol === 'https:');
const mongoUrl = z.url().refine((value) => {
  const parsed = new URL(value);
  return (
    (parsed.protocol === 'mongodb:' || parsed.protocol === 'mongodb+srv:') &&
    parsed.username === '' &&
    parsed.password === ''
  );
}, 'MONGODB_URI must use MongoDB and must not contain credentials');

const runtimeSecretLocatorSchema = z.object({
  RUNTIME_SECRET_PARAMETER_NAME: nonEmpty.regex(/^\/voice-checklist\/(development|production)\/runtime$/),
  RUNTIME_SECRET_VERSION: z.coerce.number().int().positive(),
});

const environmentSchema = z.object({
  COGNITO_CLIENT_IDS: nonEmpty,
  COGNITO_USER_POOL_ID: nonEmpty.regex(/^[a-z]{2}-[a-z]+-\d+_[A-Za-z0-9]+$/),
  MONGODB_DATABASE: nonEmpty,
  MONGODB_URI: mongoUrl,
  POWERSYNC_ENDPOINT: httpsUrl,
  POWERSYNC_JWT_ISSUER: httpsUrl,
  POWERSYNC_JWT_KID: nonEmpty,
});

const runtimeSecretSchema = z.strictObject({
  mongodb: z.strictObject({
    password: opaqueNonEmpty,
    username: opaqueNonEmpty,
  }),
  powersync: z.strictObject({
    additionalPublicJwks: z.array(z.record(z.string(), z.unknown())).optional(),
    privateJwk: z.record(z.string(), z.unknown()),
  }),
});

export interface RuntimeConfiguration {
  readonly cognito: {
    readonly clientIds: readonly string[];
    readonly issuer: string;
  };
  readonly mongodb: {
    readonly database: string;
    readonly password: string;
    readonly uri: string;
    readonly username: string;
  };
  readonly powersync: {
    readonly additionalPublicJwks: readonly Record<string, unknown>[];
    readonly endpoint: string;
    readonly issuer: string;
    readonly keyId: string;
    readonly privateJwk: Record<string, unknown>;
  };
}

export function parseRuntimeConfiguration(
  environment: NodeJS.ProcessEnv,
  runtimeSecret: unknown,
): RuntimeConfiguration {
  const values = environmentSchema.parse(environment);
  const secret = runtimeSecretSchema.parse(runtimeSecret);
  const clientIds = [...new Set(
    values.COGNITO_CLIENT_IDS.split(',').map((value) => value.trim()).filter(Boolean),
  )];
  if (clientIds.length === 0) {
    throw new Error('COGNITO_CLIENT_IDS must contain at least one client ID.');
  }

  const region = values.COGNITO_USER_POOL_ID.slice(
    0,
    values.COGNITO_USER_POOL_ID.indexOf('_'),
  );

  return {
    cognito: {
      clientIds,
      issuer: `https://cognito-idp.${region}.amazonaws.com/${values.COGNITO_USER_POOL_ID}`,
    },
    mongodb: {
      database: values.MONGODB_DATABASE,
      password: secret.mongodb.password,
      uri: values.MONGODB_URI,
      username: secret.mongodb.username,
    },
    powersync: {
      additionalPublicJwks: secret.powersync.additionalPublicJwks ?? [],
      endpoint: values.POWERSYNC_ENDPOINT,
      issuer: values.POWERSYNC_JWT_ISSUER,
      keyId: values.POWERSYNC_JWT_KID,
      privateJwk: secret.powersync.privateJwk,
    },
  };
}

export function parseRuntimeSecretLocator(
  environment: NodeJS.ProcessEnv,
): { readonly parameterName: string; readonly version: number } {
  const locator = runtimeSecretLocatorSchema.parse(environment);
  return {
    parameterName: locator.RUNTIME_SECRET_PARAMETER_NAME,
    version: locator.RUNTIME_SECRET_VERSION,
  };
}
