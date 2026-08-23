export interface OpenTofuResourceChange {
  readonly address: string;
  readonly change: {
    readonly actions: readonly string[];
  };
  readonly mode: string;
}

export interface OpenTofuPlan {
  readonly resource_changes?: readonly OpenTofuResourceChange[];
}

const allowedActionSets = new Set(['no-op', 'update']);

export function findProtectedChangeViolations(
  plan: OpenTofuPlan,
  protectedAddresses: readonly string[],
): string[] {
  const changesByAddress = new Map(
    (plan.resource_changes ?? [])
      .filter((change) => change.mode === 'managed')
      .map((change) => [change.address, change.change.actions] as const),
  );

  return protectedAddresses.flatMap((address) => {
    const actions = changesByAddress.get(address);
    if (actions === undefined) {
      return [`${address}: protected address is missing from the plan`];
    }

    const actionSet = actions.join(',');
    return allowedActionSets.has(actionSet)
      ? []
      : [`${address}: protected address has forbidden actions [${actionSet}]`];
  });
}
