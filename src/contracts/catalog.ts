import { z } from 'zod';

export interface ApiContract {
  readonly accessToken?: boolean;
  readonly method: 'delete' | 'get' | 'patch' | 'post' | 'put';
  readonly path: `/${string}`;
  readonly request?: z.ZodType;
  readonly response?: z.ZodType;
  readonly responses?: Readonly<Record<string, {
    readonly description: string;
    readonly schema?: z.ZodType;
  }>>;
}

export interface EventContract {
  readonly schema: z.ZodType;
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

function credentialError(
  code: 'account_unavailable' | 'invalid_access_token' | 'temporarily_unavailable',
) {
  return z.strictObject({ code: z.literal(code) });
}

export const apiContracts: readonly ApiContract[] = [
  {
    method: 'get',
    path: '/.well-known/jwks.json',
    response: publicJwks,
  },
  {
    accessToken: true,
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
  },
];
export const eventContracts: Readonly<Record<string, EventContract>> = {};

interface ContractCatalog {
  readonly apiContracts: readonly ApiContract[];
  readonly eventContracts: Readonly<Record<string, EventContract>>;
}

interface OpenApiDocument {
  readonly components: {
    readonly schemas: Record<string, unknown>;
    readonly securitySchemes: Record<string, unknown>;
  };
  readonly info: { readonly title: string; readonly version: string };
  readonly openapi: '3.1.0';
  readonly paths: Record<string, unknown>;
}

interface EventDocument {
  readonly events: Record<string, unknown>;
  readonly schemaVersion: '1.0.0';
}

export function buildContractDocuments(
  catalog: ContractCatalog = { apiContracts, eventContracts },
): {
  readonly events: EventDocument;
  readonly openapi: OpenApiDocument;
} {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const contract of catalog.apiContracts) {
    const responses = contract.responses === undefined
      ? {
          '200': {
            content: contract.response === undefined
              ? undefined
              : {
                  'application/json': {
                    schema: z.toJSONSchema(contract.response, {
                      target: 'draft-2020-12',
                    }),
                  },
                },
            description: 'Successful response',
          },
        }
      : Object.fromEntries(
          Object.entries(contract.responses).map(([status, response]) => [
            status,
            {
              ...(response.schema === undefined
                ? {}
                : {
                    content: {
                      'application/json': {
                        schema: z.toJSONSchema(response.schema, {
                          target: 'draft-2020-12',
                        }),
                      },
                    },
                  }),
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
                content: {
                  'application/json': {
                    schema: z.toJSONSchema(contract.request, {
                      target: 'draft-2020-12',
                    }),
                  },
                },
                required: true,
              },
            }),
        responses,
        ...(contract.accessToken === true
          ? { security: [{ cognitoAccessToken: [] }] }
          : {}),
      },
    };
  }

  return {
    events: {
      events: Object.fromEntries(
        Object.entries(catalog.eventContracts).map(([name, contract]) => [
          name,
          z.toJSONSchema(contract.schema, { target: 'draft-2020-12' }),
        ]),
      ),
      schemaVersion: '1.0.0',
    },
    openapi: {
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
    },
  };
}
