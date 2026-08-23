import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findLifecycleGuardViolations } from '../src/deployment/lifecycle-policy.js';
import { parsePolicyManifest } from '../src/deployment/plan-policy.js';

const cases = [
  ['auth', 'development'],
  ['auth', 'production'],
  ['backend', 'development'],
  ['backend', 'production'],
] as const;

describe('protected-resource manifests', () => {
  it.each(cases)('%s/%s matches guarded OpenTofu resource blocks', async (stack, environment) => {
    const manifestPath = resolve(
      `infra/policy/${stack}-${environment}.json`,
    );
    const manifest = parsePolicyManifest(
      JSON.parse(await readFile(manifestPath, 'utf8')),
    );

    expect(manifest.stack).toBe(stack);
    expect(manifest.environment).toBe(environment);
    await expect(
      findLifecycleGuardViolations(
        resolve(`infra/aws/${stack}`),
        manifest.lifecycleBlocks,
      ),
    ).resolves.toEqual([]);
  });

  it('protects every existing Cognito pool and client plan address', async () => {
    const development = parsePolicyManifest(
      JSON.parse(
        await readFile(
          resolve('infra/policy/auth-development.json'),
          'utf8',
        ),
      ),
    );
    const production = parsePolicyManifest(
      JSON.parse(
        await readFile(resolve('infra/policy/auth-production.json'), 'utf8'),
      ),
    );

    expect(development.planAddresses).toEqual(
      expect.arrayContaining([
        'aws_cognito_user_pool.auth',
        'aws_cognito_user_pool_client.app["android_debug"]',
        'aws_cognito_user_pool_client.app["web_localhost"]',
      ]),
    );
    expect(production.planAddresses).toEqual(
      expect.arrayContaining([
        'aws_cognito_user_pool.auth',
        'aws_cognito_user_pool_client.app["android_play"]',
      ]),
    );
  });
});
