import { describe, expect, it } from 'vitest';

import { buildContractDocuments } from '../src/contracts/catalog.js';

describe('contract generation', () => {
  it('emits valid empty API and event documents before the first backend contract', () => {
    const documents = buildContractDocuments();

    expect(documents.openapi.openapi).toBe('3.1.0');
    expect(documents.openapi.paths).toEqual({});
    expect(documents.openapi.components.schemas).toEqual({});
    expect(documents.events.events).toEqual({});
  });

  it('does not invent a /v1 baseline before the API ticket defines one', () => {
    const { openapi } = buildContractDocuments();

    expect(Object.keys(openapi.paths).some((path) => path.startsWith('/v1'))).toBe(false);
  });
});
