import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from 'aws-lambda';
import { MongoClient } from 'mongodb';
import { ZodError } from 'zod';

import { createMongoAccountLifecycleReader } from './accounts/account-lifecycle.js';
import {
  InvalidAccessTokenError,
  createCognitoAccessTokenVerifier,
  type AccessTokenVerifier,
} from './auth/cognito-access-token-verifier.js';
import {
  AccountUnavailableError,
  createPowerSyncCredentialAuthority,
  createPowerSyncCredentialService,
  type PowerSyncCredentialIssuer,
} from './auth/powersync-credential-service.js';
import {
  parseRuntimeConfiguration,
  parseRuntimeSecretParameterName,
} from './runtime/configuration.js';
import { createSsmRuntimeSecretReader } from './runtime/runtime-secret.js';

interface HandlerDependencies {
  readonly accessTokens: AccessTokenVerifier;
  readonly credentials: PowerSyncCredentialIssuer;
  readonly jwks: { readonly keys: readonly unknown[] };
}

type BackendHandler = (
  event: APIGatewayProxyEventV2,
  context: Context,
) => Promise<APIGatewayProxyStructuredResultV2>;

function json(
  statusCode: number,
  body: unknown,
  cacheControl = 'no-store',
): APIGatewayProxyStructuredResultV2 {
  return {
    body: JSON.stringify(body),
    headers: {
      'cache-control': cacheControl,
      'content-type': 'application/json',
    },
    statusCode,
  };
}

function isHttpEvent(event: unknown): event is APIGatewayProxyEventV2 {
  if (typeof event !== 'object' || event === null) {
    return false;
  }
  const candidate = event as {
    readonly rawPath?: unknown;
    readonly requestContext?: unknown;
  };
  const requestContext = candidate.requestContext;
  return (
    typeof candidate.rawPath === 'string' &&
    typeof requestContext === 'object' &&
    requestContext !== null &&
    typeof (requestContext as { readonly http?: unknown }).http === 'object'
  );
}

function authorizationHeader(event: APIGatewayProxyEventV2): string | undefined {
  return Object.entries(event.headers).find(
    ([name]) => name.toLowerCase() === 'authorization',
  )?.[1];
}

function bearerToken(event: APIGatewayProxyEventV2): string | undefined {
  const match = /^Bearer ([^\s]+)$/i.exec(authorizationHeader(event) ?? '');
  return match?.[1];
}

export function createHandler(dependencies: HandlerDependencies): BackendHandler {
  return async (event, context) => {
    void context;

    const method = event.requestContext.http.method.toUpperCase();
    if (method === 'GET' && event.rawPath === '/.well-known/jwks.json') {
      return json(200, dependencies.jwks, 'public, max-age=300');
    }
    if (method !== 'POST' || event.rawPath !== '/v1/powersync/credentials') {
      return json(404, { code: 'not_found' });
    }

    const token = bearerToken(event);
    if (token === undefined) {
      return json(401, { code: 'invalid_access_token' });
    }

    try {
      const verified = await dependencies.accessTokens.verify(token);
      return json(200, await dependencies.credentials.issue(verified.subject));
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) {
        return json(401, { code: 'invalid_access_token' });
      }
      if (error instanceof AccountUnavailableError) {
        return json(403, { code: 'account_unavailable' });
      }
      return json(503, { code: 'temporarily_unavailable' });
    }
  };
}

async function createRuntimeHandler(
  environment: NodeJS.ProcessEnv,
): Promise<BackendHandler> {
  const parameterName = parseRuntimeSecretParameterName(environment);
  const runtimeSecret = await createSsmRuntimeSecretReader().read(parameterName);
  const configuration = parseRuntimeConfiguration(environment, runtimeSecret);
  const mongo = new MongoClient(configuration.mongodb.uri, {
    appName: 'voice-checklist-backend',
    auth: {
      password: configuration.mongodb.password,
      username: configuration.mongodb.username,
    },
    maxIdleTimeMS: 60_000,
    maxPoolSize: 10,
    connectTimeoutMS: 1_500,
    serverSelectionTimeoutMS: 1_500,
  });
  const database = mongo.db(configuration.mongodb.database);
  const lifecycle = createMongoAccountLifecycleReader(
    {
      deletionLedger: database.collection('account_deletion_ledger'),
      lifecycle: database.collection('account_lifecycle'),
    },
  );
  const authority = createPowerSyncCredentialAuthority(
    configuration.powersync,
  );

  return createHandler({
    accessTokens: createCognitoAccessTokenVerifier(configuration.cognito),
    credentials: createPowerSyncCredentialService(lifecycle, authority.credentials),
    jwks: authority.jwks,
  });
}

function initializationFailure(error: unknown): {
  readonly errorName: string;
  readonly event: 'runtime_initialization_failed';
  readonly issuePaths?: readonly string[];
} {
  if (error instanceof Error) {
    const issuePaths = error instanceof ZodError
      ? error.issues.map((issue) => issue.path.map(String).join('.'))
      : undefined;
    return {
      errorName: error.name,
      event: 'runtime_initialization_failed',
      ...(issuePaths === undefined ? {} : { issuePaths }),
    };
  }
  return { errorName: 'UnknownError', event: 'runtime_initialization_failed' };
}

let runtimeHandler: Promise<BackendHandler> | undefined;

export async function handler(
  event: unknown,
  context: Context,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (
    !isHttpEvent(event) ||
    (event.requestContext.http.method.toUpperCase() === 'GET' &&
      event.rawPath === '/health')
  ) {
    return json(200, { status: 'ok' });
  }
  try {
    runtimeHandler ??= createRuntimeHandler(process.env);
    return await (await runtimeHandler)(event, context);
  } catch (error) {
    runtimeHandler = undefined;
    console.error(initializationFailure(error));
    return json(503, { code: 'temporarily_unavailable' });
  }
}
