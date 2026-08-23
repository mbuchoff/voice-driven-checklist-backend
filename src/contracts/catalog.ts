import type { z } from 'zod';

export interface ApiContract {
  readonly method: 'delete' | 'get' | 'patch' | 'post' | 'put';
  readonly path: `/${string}`;
  readonly request?: z.ZodType;
  readonly response: z.ZodType;
}

export interface EventContract {
  readonly schema: z.ZodType;
}

// Issue #29 will add the first runtime schemas and /v1 operations.
export const apiContracts: readonly ApiContract[] = [];
export const eventContracts: Readonly<Record<string, EventContract>> = {};

interface OpenApiDocument {
  readonly components: { readonly schemas: Record<string, unknown> };
  readonly info: { readonly title: string; readonly version: string };
  readonly openapi: '3.1.0';
  readonly paths: Record<string, unknown>;
}

interface EventDocument {
  readonly events: Record<string, unknown>;
  readonly schemaVersion: '1.0.0';
}

export function buildContractDocuments(): {
  readonly events: EventDocument;
  readonly openapi: OpenApiDocument;
} {
  return {
    events: {
      events: {},
      schemaVersion: '1.0.0',
    },
    openapi: {
      components: { schemas: {} },
      info: {
        title: 'Voice-Driven Checklist Backend',
        version: '0.0.0',
      },
      openapi: '3.1.0',
      paths: {},
    },
  };
}
