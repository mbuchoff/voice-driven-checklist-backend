import { describe, expect, it } from 'vitest';

import {
  findProtectedChangeViolations,
  findReconstructableDestructiveViolations,
  findRuntimeSecretVersionPinViolations,
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

  it('discards plan values outside the infrastructure policy contract', () => {
    const plan = {
      format_version: '1.2',
      resource_changes: [
        {
          address: userPoolAddress,
          change: {
            actions: ['no-op'],
            before: { client_secret: 'must-not-reach-policy-code' },
          },
          mode: 'managed',
        },
      ],
    };

    expect(parseOpenTofuPlan(plan)).toEqual({
      resource_changes: [
        {
          address: userPoolAddress,
          change: { actions: ['no-op'] },
          mode: 'managed',
        },
      ],
    });
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

describe('runtime-secret version plan policy', () => {
  function planWithPin(
    outputVersion: unknown,
    environmentVersion: unknown,
  ): unknown {
    return {
      planned_values: {
        outputs: {
          runtime_secret_version: { value: outputVersion },
        },
        root_module: {
          resources: [{
            address: 'aws_lambda_function.placeholder[0]',
            values: {
              environment: [{
                variables: {
                  RUNTIME_SECRET_VERSION: environmentVersion,
                },
              }],
            },
          }],
        },
      },
    };
  }

  it('accepts a positive planned version pinned into the Lambda environment', () => {
    expect(findRuntimeSecretVersionPinViolations(planWithPin(42, '42')))
      .toEqual([]);
  });

  it('rejects a pre-pinning plan with no version output', () => {
    expect(findRuntimeSecretVersionPinViolations({ planned_values: {} }))
      .toEqual([expect.stringContaining('planned output')]);
  });

  it('rejects a Lambda version that does not pin the planned secret version', () => {
    expect(findRuntimeSecretVersionPinViolations(planWithPin(42, '41')))
      .toEqual([expect.stringContaining('must match')]);
  });
});

describe('reconstructable resource plan policy', () => {
  const functionAddress = 'aws_lambda_function.placeholder[0]';

  it('allows a reconstructable create without a destructive override', () => {
    const plan = planWith([
      { address: functionAddress, actions: ['create'] },
    ]);

    expect(
      findReconstructableDestructiveViolations(
        plan,
        protectedAddresses,
        false,
      ),
    ).toEqual([]);
  });

  it('rejects a reconstructable deletion or replacement by default', () => {
    const plan = planWith([
      { address: functionAddress, actions: ['delete', 'create'] },
    ]);

    expect(
      findReconstructableDestructiveViolations(
        plan,
        protectedAddresses,
        false,
      ),
    ).toEqual([expect.stringContaining(functionAddress)]);
  });

  it('accepts an explicitly authorized reconstructable deletion or replacement', () => {
    const plan = planWith([
      { address: functionAddress, actions: ['delete', 'create'] },
    ]);

    expect(
      findReconstructableDestructiveViolations(
        plan,
        protectedAddresses,
        true,
      ),
    ).toEqual([]);
  });
});
