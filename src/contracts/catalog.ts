import { z } from 'zod';

export interface ApiContract {
  readonly method: 'delete' | 'get' | 'patch' | 'post' | 'put';
  readonly path: `/${string}`;
  readonly request?: z.ZodType;
  readonly responses: Readonly<Record<string, {
    readonly description: string;
    readonly schema?: z.ZodType;
  }>>;
  readonly security?: 'cognitoAccessToken';
}

const powerSyncCredentials = z.strictObject({
  endpoint: z.url(),
  expiresAt: z.iso.datetime(),
  token: z.string().min(1),
});

const publicJwks = z.strictObject({
  keys: z.array(z.strictObject({
    alg: z.literal('RS256'),
    e: z.string().min(1),
    kid: z.string().min(1),
    kty: z.literal('RSA'),
    n: z.string().min(1),
    use: z.literal('sig'),
  })).min(1),
});

const health = z.strictObject({ status: z.literal('ok') });

function credentialError(
  code: 'account_unavailable' | 'invalid_access_token' | 'temporarily_unavailable',
) {
  return z.strictObject({ code: z.literal(code) });
}

export const apiContracts: readonly ApiContract[] = [
  {
    method: 'get',
    path: '/.well-known/jwks.json',
    responses: {
      '200': { description: 'PowerSync credential verification keys.', schema: publicJwks },
      '503': {
        description: 'Runtime configuration is temporarily unavailable.',
        schema: credentialError('temporarily_unavailable'),
      },
    },
  },
  {
    method: 'get',
    path: '/health',
    responses: {
      '200': { description: 'Backend health.', schema: health },
    },
  },
  {
    method: 'post',
    path: '/v1/powersync/credentials',
    responses: {
      '200': {
        description: 'Five-minute account-scoped PowerSync credentials.',
        schema: powerSyncCredentials,
      },
      '401': {
        description: 'Missing or invalid Cognito access token.',
        schema: credentialError('invalid_access_token'),
      },
      '403': {
        description: 'The account lifecycle fence prevents cloud access.',
        schema: credentialError('account_unavailable'),
      },
      '503': {
        description: 'An authentication or lifecycle dependency is unavailable.',
        schema: credentialError('temporarily_unavailable'),
      },
    },
    security: 'cognitoAccessToken',
  },
];

interface OpenApiDocument {
  readonly components: {
    readonly schemas: Record<string, unknown>;
    readonly securitySchemes: Record<string, unknown>;
  };
  readonly info: { readonly title: string; readonly version: string };
  readonly openapi: '3.1.0';
  readonly paths: Record<string, unknown>;
}

function jsonContent(schema: z.ZodType): Record<string, unknown> {
  return {
    'application/json': {
      schema: z.toJSONSchema(schema, { target: 'draft-2020-12' }),
    },
  };
}

export function buildOpenApiDocument(
  catalog: readonly ApiContract[] = apiContracts,
): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const contract of catalog) {
    const declaredResponses = Object.entries(contract.responses);
    if (declaredResponses.length === 0) {
      throw new Error(`${contract.method.toUpperCase()} ${contract.path} needs at least one response.`);
    }
    const responses = Object.fromEntries(
      declaredResponses.map(([status, response]) => [
        status,
        {
          ...(response.schema === undefined ? {} : { content: jsonContent(response.schema) }),
          description: response.description,
        },
      ]),
    );
    paths[contract.path] = {
      ...paths[contract.path],
      [contract.method]: {
        ...(contract.request === undefined
          ? {}
          : {
              requestBody: {
                content: jsonContent(contract.request),
                required: true,
              },
            }),
        responses,
        ...(contract.security === 'cognitoAccessToken'
          ? { security: [{ cognitoAccessToken: [] }] }
          : {}),
      },
    };
  }

  return {
    components: {
      schemas: {},
      securitySchemes: {
        cognitoAccessToken: {
          bearerFormat: 'Cognito access token',
          scheme: 'bearer',
          type: 'http',
        },
      },
    },
    info: {
      title: 'Voice-Driven Checklist Backend',
      version: '0.1.0',
    },
    openapi: '3.1.0',
    paths,
  };
}
