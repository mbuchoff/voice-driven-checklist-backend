import { describe, expect, it } from 'vitest';

import {
  findProtectedChangeViolations,
  parseOpenTofuPlan,
  parsePolicyManifest,
  type OpenTofuPlan,
} from '../src/deployment/plan-policy.js';

const userPoolAddress = 'aws_cognito_user_pool.auth';
const clientAddress = 'aws_cognito_user_pool_client.app["android_play"]';
const protectedAddresses = [userPoolAddress, clientAddress];

function planWith(
  changes: Array<{ address: string; actions: string[] }>,
): OpenTofuPlan {
  return {
    resource_changes: changes.map(({ address, actions }) => ({
      address,
      change: { actions },
      mode: 'managed',
    })),
  };
}

describe('protected OpenTofu plan policy', () => {
  it('rejects malformed protected-resource manifests', () => {
    expect(() => parsePolicyManifest({ planAddresses: [''] })).toThrow(
      /protected-resource manifest/i,
    );
  });

  it('rejects malformed OpenTofu plan JSON', () => {
    expect(() =>
      parseOpenTofuPlan({ resource_changes: 'not-an-array' }),
    ).toThrow(/OpenTofu plan/i);
  });

  it('parses a valid OpenTofu plan without discarding plan metadata', () => {
    const plan = {
      format_version: '1.2',
      resource_changes: [
        {
          address: userPoolAddress,
          change: { actions: ['no-op'], before: {} },
          mode: 'managed',
        },
      ],
    };

    expect(parseOpenTofuPlan(plan)).toEqual(plan);
  });

  it('fails closed when the plan has no resource changes', () => {
    expect(findProtectedChangeViolations({}, [userPoolAddress])).toEqual([
      expect.stringContaining(userPoolAddress),
    ]);
  });

  it('does not accept a data-source change for a protected managed address', () => {
    const plan: OpenTofuPlan = {
      resource_changes: [
        {
          address: userPoolAddress,
          change: { actions: ['no-op'] },
          mode: 'data',
        },
      ],
    };

    expect(findProtectedChangeViolations(plan, [userPoolAddress])).toEqual([
      expect.stringContaining(userPoolAddress),
    ]);
  });

  it('accepts only no-op and in-place update actions for every protected address', () => {
    const plan = planWith([
      { address: userPoolAddress, actions: ['no-op'] },
      { address: clientAddress, actions: ['update'] },
    ]);

    expect(findProtectedChangeViolations(plan, protectedAddresses)).toEqual([]);
  });

  it.each([
    ['create', ['create']],
    ['delete', ['delete']],
    ['replace', ['delete', 'create']],
    ['forget', ['forget']],
  ])('rejects a protected %s action', (_name, actions) => {
    const plan = planWith([
      { address: userPoolAddress, actions },
      { address: clientAddress, actions: ['no-op'] },
    ]);

    expect(findProtectedChangeViolations(plan, protectedAddresses)).toEqual([
      expect.stringContaining(userPoolAddress),
    ]);
  });

  it('fails closed when a protected address is absent from the plan', () => {
    const plan = planWith([
      { address: userPoolAddress, actions: ['no-op'] },
    ]);

    expect(findProtectedChangeViolations(plan, protectedAddresses)).toEqual([
      expect.stringContaining(clientAddress),
    ]);
  });
});
