import { convertFiles } from '@cdktf/hcl2json';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import {
  apiContracts,
  buildOpenApiDocument,
} from '../src/contracts/catalog.js';

describe('contract generation', () => {
  it('emits a valid API document for an empty catalog', () => {
    const openapi = buildOpenApiDocument([]);

    expect(openapi.openapi).toBe('3.1.0');
    expect(openapi.paths).toEqual({});
    expect(openapi.components.schemas).toEqual({});
  });

  it('publishes the authenticated PowerSync credential exchange and its stable failures', () => {
    const openapi = buildOpenApiDocument();

    expect(openapi.paths['/health']).toHaveProperty('get');
    expect(openapi.paths['/.well-known/jwks.json']).toHaveProperty('get');
    expect(openapi.paths['/v1/powersync/credentials']).toHaveProperty('post');
    const jwksContract = JSON.stringify(
      openapi.paths['/.well-known/jwks.json'],
    );
    expect(jwksContract).toContain('"200"');
    expect(jwksContract).toContain('"503"');
    expect(jwksContract).toContain('"temporarily_unavailable"');
    const credentialContract = JSON.stringify(
      openapi.paths['/v1/powersync/credentials'],
    );
    expect(credentialContract).toContain('"200"');
    expect(credentialContract).toContain('"401"');
    expect(credentialContract).toContain('"403"');
    expect(credentialContract).toContain('"503"');
    expect(credentialContract).toContain('"cognitoAccessToken":[]');
  });

  it('generates code-first requests and explicit status responses', () => {
    const openapi = buildOpenApiDocument([{
      method: 'post',
      path: '/test',
      request: z.object({ name: z.string() }),
      responses: {
        '201': { description: 'Created.', schema: z.object({ id: z.string() }) },
      },
    }]);

    expect(openapi.paths['/test']).toHaveProperty('post');
    expect(JSON.stringify(openapi.paths['/test'])).toContain('"201"');
  });

  it('preserves every HTTP method when contracts share a path', () => {
    const openapi = buildOpenApiDocument([
        {
          method: 'get',
          path: '/test',
          responses: {
            '200': { description: 'Found.', schema: z.object({ id: z.string() }) },
          },
        },
        {
          method: 'post',
          path: '/test',
          request: z.object({ name: z.string() }),
          responses: {
            '200': { description: 'Updated.', schema: z.object({ id: z.string() }) },
          },
        },
      ]);

    expect(openapi.paths['/test']).toHaveProperty('get');
    expect(openapi.paths['/test']).toHaveProperty('post');
  });

  it('rejects a contract with no response outcomes', () => {
    expect(() => buildOpenApiDocument([{
      method: 'get',
      path: '/test',
      responses: {},
    }])).toThrow('at least one response');
  });

  it('keeps the deployed API Gateway routes aligned with generated contracts', async () => {
    const configuration = await convertFiles('infra/aws/backend') as {
      resource: {
        aws_apigatewayv2_route: {
          backend: Array<{ for_each: string }>;
        };
      };
    };
    const routeExpression = configuration.resource.aws_apigatewayv2_route.backend[0]?.for_each;
    const deployedRoutes = [...(routeExpression ?? '').matchAll(/"([A-Z]+ \/[^"\n]+)"/g)]
      .map((match) => match[1]);
    const contractRoutes = apiContracts.map(
      (contract) => `${contract.method.toUpperCase()} ${contract.path}`,
    );

    expect(deployedRoutes.sort()).toEqual(contractRoutes.sort());
  });
});
