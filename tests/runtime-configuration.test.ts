import { describe, expect, it } from 'vitest';

import { parseRuntimeConfiguration } from '../src/runtime/configuration.js';

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    COGNITO_CLIENT_IDS: 'android-client, web-client,android-client',
    COGNITO_USER_POOL_ID: 'us-east-1_06KAQuIlH',
    MONGODB_DATABASE: 'voice_checklist_dev',
    MONGODB_URI: 'mongodb+srv://example.mongodb.net/',
    POWERSYNC_ENDPOINT: 'https://development.powersync.example',
    POWERSYNC_JWT_ISSUER: 'https://api.example.test',
    POWERSYNC_JWT_KID: 'development-1',
    RUNTIME_SECRET_PARAMETER_NAME: '/voice-checklist/development/runtime',
    ...overrides,
  };
}

const runtimeSecret = {
  mongodb: {
    password: 'secret-for-test-only',
    username: 'application-user',
  },
  powersync: {
    privateJwk: { kty: 'RSA' },
  },
};

describe('runtime configuration', () => {
  it('derives the exact Cognito issuer and normalizes the client allowlist', () => {
    const configuration = parseRuntimeConfiguration(environment(), runtimeSecret);

    expect(configuration.cognito).toEqual({
      clientIds: ['android-client', 'web-client'],
      issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_06KAQuIlH',
    });
    expect(configuration.powersync.audience).toBe(
      'https://development.powersync.example',
    );
  });

  it.each([
    ['a MongoDB URI containing credentials', {
      MONGODB_URI: 'mongodb+srv://username:password@example.mongodb.net/',
    }],
    ['an insecure PowerSync endpoint', {
      POWERSYNC_ENDPOINT: 'http://development.powersync.example',
    }],
    ['an invalid user-pool ID', {
      COGNITO_USER_POOL_ID: 'not-a-pool',
    }],
    ['a runtime parameter outside the application path', {
      RUNTIME_SECRET_PARAMETER_NAME: '/another-application/development/runtime',
    }],
  ])('rejects %s', (_label, override) => {
    expect(() => parseRuntimeConfiguration(environment(override), runtimeSecret)).toThrow();
  });

  it.each([
    {},
    { mongodb: { password: '', username: 'application-user' }, powersync: runtimeSecret.powersync },
    { mongodb: runtimeSecret.mongodb, powersync: { privateJwk: 'not-an-object' } },
  ])('rejects a missing or malformed runtime secret: %j', (secret) => {
    expect(() => parseRuntimeConfiguration(environment(), secret)).toThrow();
  });
});
