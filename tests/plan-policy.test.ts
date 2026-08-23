import { describe, expect, it } from 'vitest';

import {
  findProtectedChangeViolations,
  type OpenTofuPlan,
} from '../src/deployment/plan-policy.js';

const protectedAddresses = [
  'aws_cognito_user_pool.auth',
  'aws_cognito_user_pool_client.app["android_play"]',
];

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
  it('accepts only no-op and in-place update actions for every protected address', () => {
    const plan = planWith([
      { address: protectedAddresses[0]!, actions: ['no-op'] },
      { address: protectedAddresses[1]!, actions: ['update'] },
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
      { address: protectedAddresses[0]!, actions },
      { address: protectedAddresses[1]!, actions: ['no-op'] },
    ]);

    expect(findProtectedChangeViolations(plan, protectedAddresses)).toEqual([
      expect.stringContaining(protectedAddresses[0]!),
    ]);
  });

  it('fails closed when a protected address is absent from the plan', () => {
    const plan = planWith([
      { address: protectedAddresses[0]!, actions: ['no-op'] },
    ]);

    expect(findProtectedChangeViolations(plan, protectedAddresses)).toEqual([
      expect.stringContaining(protectedAddresses[1]!),
    ]);
  });
});
