import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { buildContractDocuments } from '../src/contracts/catalog.js';

describe('contract generation', () => {
  it('emits valid empty API and event documents for an empty catalog', () => {
    const documents = buildContractDocuments({ apiContracts: [], eventContracts: {} });

    expect(documents.openapi.openapi).toBe('3.1.0');
    expect(documents.openapi.paths).toEqual({});
    expect(documents.openapi.components.schemas).toEqual({});
    expect(documents.events.events).toEqual({});
  });

  it('publishes the authenticated PowerSync credential exchange and its stable failures', () => {
    const { openapi } = buildContractDocuments();

    expect(openapi.paths['/.well-known/jwks.json']).toHaveProperty('get');
    expect(openapi.paths['/v1/powersync/credentials']).toHaveProperty('post');
    const credentialContract = JSON.stringify(
      openapi.paths['/v1/powersync/credentials'],
    );
    expect(credentialContract).toContain('"200"');
    expect(credentialContract).toContain('"401"');
    expect(credentialContract).toContain('"403"');
    expect(credentialContract).toContain('"503"');
    expect(credentialContract).toContain('"cognitoAccessToken":[]');
  });

  it('generates API and event documents from code-first contracts', () => {
    const documents = buildContractDocuments({
      apiContracts: [
        {
          method: 'post',
          path: '/test',
          request: z.object({ name: z.string() }),
          response: z.object({ id: z.string() }),
        },
      ],
      eventContracts: {
        TestCreated: { schema: z.object({ id: z.string() }) },
      },
    });

    expect(documents.openapi.paths['/test']).toHaveProperty('post');
    expect(documents.events.events).toHaveProperty('TestCreated');
  });

  it('preserves every HTTP method when contracts share a path', () => {
    const { openapi } = buildContractDocuments({
      apiContracts: [
        {
          method: 'get',
          path: '/test',
          response: z.object({ id: z.string() }),
        },
        {
          method: 'post',
          path: '/test',
          request: z.object({ name: z.string() }),
          response: z.object({ id: z.string() }),
        },
      ],
      eventContracts: {},
    });

    expect(openapi.paths['/test']).toHaveProperty('get');
    expect(openapi.paths['/test']).toHaveProperty('post');
  });
});
