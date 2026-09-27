import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';

import {
  IdentityProviderUnavailableError,
  InvalidAccessTokenError,
} from '../src/auth/cognito-access-token-verifier.js';
import { AccountUnavailableError } from '../src/auth/powersync-credential-service.js';
import { createHandler, handler as runtimeHandler } from '../src/handler.js';

function event(method: string, path: string, authorization?: string): APIGatewayProxyEventV2 {
  return {
    headers: authorization === undefined ? {} : { authorization },
    isBase64Encoded: false,
    rawPath: path,
    rawQueryString: '',
    requestContext: {
      accountId: 'anonymous',
      apiId: 'test',
      domainName: 'test',
      domainPrefix: 'test',
      http: {
        method,
        path,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'vitest',
      },
      requestId: 'request-id',
      routeKey: '$default',
      stage: '$default',
      time: '27/Sep/2026:00:00:00 +0000',
      timeEpoch: 1_798_416_000_000,
    },
    routeKey: '$default',
    version: '2.0',
  };
}

function dependencies() {
  return {
    accessTokens: { verify: vi.fn().mockResolvedValue({ subject: 'account-1' }) },
    credentials: {
      issue: vi.fn().mockResolvedValue({
        endpoint: 'https://example.powersync.test',
        expiresAt: '2026-09-27T12:05:00.000Z',
        token: 'signed-token',
      }),
      jwks: vi.fn().mockReturnValue({ keys: [{ kty: 'RSA' }] }),
    },
  };
}

describe('backend HTTP handler', () => {
  it('keeps direct health invocation independent of secret runtime configuration', async () => {
    await expect(runtimeHandler({}, {} as Context)).resolves.toMatchObject({
      body: JSON.stringify({ status: 'ok' }),
      statusCode: 200,
    });
  });

  it('fails closed when runtime secret configuration is unavailable', async () => {
    const response = await runtimeHandler(
      event('POST', '/v1/powersync/credentials', 'Bearer token'),
      {} as Context,
    );

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body ?? '')).toEqual({
      code: 'temporarily_unavailable',
    });
  });

  it('retains the harmless health response without exposing runtime input', async () => {
    const handler = createHandler(dependencies());
    const sensitiveInput = 'must-not-be-returned';

    const response = await handler(event('GET', '/health', sensitiveInput), {} as Context);
    const body = response.body ?? '';

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(body)).toEqual({ status: 'ok' });
    expect(body).not.toContain(sensitiveInput);
  });

  it('publishes only the PowerSync public signing key', async () => {
    const deps = dependencies();
    const handler = createHandler(deps);

    const response = await handler(event('GET', '/.well-known/jwks.json'), {} as Context);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? '')).toEqual({ keys: [{ kty: 'RSA' }] });
    expect(deps.accessTokens.verify).not.toHaveBeenCalled();
  });

  it('exchanges a strictly formatted bearer token for account-scoped credentials', async () => {
    const deps = dependencies();
    const handler = createHandler(deps);

    const response = await handler(
      event('POST', '/v1/powersync/credentials', 'Bearer cognito-access-token'),
      {} as Context,
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({ 'cache-control': 'no-store' });
    expect(JSON.parse(response.body ?? '')).toEqual({
      endpoint: 'https://example.powersync.test',
      expiresAt: '2026-09-27T12:05:00.000Z',
      token: 'signed-token',
    });
    expect(deps.accessTokens.verify).toHaveBeenCalledWith('cognito-access-token');
    expect(deps.credentials.issue).toHaveBeenCalledWith('account-1');
  });

  it.each([undefined, 'cognito-access-token', 'Bearer one two', 'Basic token'])(
    'rejects a missing or malformed authorization header: %s',
    async (authorization) => {
      const deps = dependencies();
      const handler = createHandler(deps);

      const response = await handler(
        event('POST', '/v1/powersync/credentials', authorization),
        {} as Context,
      );

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body ?? '')).toEqual({ code: 'invalid_access_token' });
      expect(deps.accessTokens.verify).not.toHaveBeenCalled();
    },
  );

  it.each([
    [new InvalidAccessTokenError(), 401, 'invalid_access_token'],
    [new AccountUnavailableError(), 403, 'account_unavailable'],
    [new IdentityProviderUnavailableError(), 503, 'temporarily_unavailable'],
    [new Error('MongoDB unavailable'), 503, 'temporarily_unavailable'],
  ] as const)('maps a boundary failure without leaking it: %#', async (failure, status, code) => {
    const deps = dependencies();
    deps.accessTokens.verify.mockRejectedValue(failure);
    const handler = createHandler(deps);

    const response = await handler(
      event('POST', '/v1/powersync/credentials', 'Bearer token'),
      {} as Context,
    );

    expect(response.statusCode).toBe(status);
    expect(JSON.parse(response.body ?? '')).toEqual({ code });
    expect(response.body).not.toContain(failure.message);
  });

  it('returns a stable not-found response for every other route', async () => {
    const response = await createHandler(dependencies())(
      event('GET', '/not-a-route'),
      {} as Context,
    );

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body ?? '')).toEqual({ code: 'not_found' });
  });
});
