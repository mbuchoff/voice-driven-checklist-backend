import { describe, expect, it } from 'vitest';

import {
  parseRuntimeConfiguration,
  parseRuntimeSecretLocator,
} from '../src/runtime/configuration.js';

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
    RUNTIME_SECRET_VERSION: '42',
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
  it('pins the runtime secret to one positive numeric parameter version', () => {
    expect(parseRuntimeSecretLocator(environment())).toEqual({
      parameterName: '/voice-checklist/development/runtime',
      version: 42,
    });
  });

  it('derives the exact Cognito issuer and normalizes the client allowlist', () => {
    const configuration = parseRuntimeConfiguration(environment(), runtimeSecret);

    expect(configuration.cognito).toEqual({
      clientIds: ['android-client', 'web-client'],
      issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_06KAQuIlH',
    });
    expect(configuration.powersync.endpoint).toBe(
      'https://development.powersync.example',
    );
  });

  it('preserves opaque database credentials byte-for-byte', () => {
    const configuration = parseRuntimeConfiguration(environment(), {
      ...runtimeSecret,
      mongodb: {
        password: ' leading-and-trailing-password ',
        username: ' application-user ',
      },
    });

    expect(configuration.mongodb).toMatchObject({
      password: ' leading-and-trailing-password ',
      username: ' application-user ',
    });
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
    ['an unpinned runtime parameter', { RUNTIME_SECRET_VERSION: '' }],
    ['a non-numeric runtime parameter version', { RUNTIME_SECRET_VERSION: 'latest' }],
  ])('rejects %s', (_label, override) => {
    const candidate = environment(override);
    expect(() => {
      parseRuntimeSecretLocator(candidate);
      parseRuntimeConfiguration(candidate, runtimeSecret);
    }).toThrow();
  });

  it.each([
    {},
    { mongodb: { password: '', username: 'application-user' }, powersync: runtimeSecret.powersync },
    { mongodb: runtimeSecret.mongodb, powersync: { privateJwk: 'not-an-object' } },
  ])('rejects a missing or malformed runtime secret: %j', (secret) => {
    expect(() => parseRuntimeConfiguration(environment(), secret)).toThrow();
  });
});
