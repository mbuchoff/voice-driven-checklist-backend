import { z } from 'zod';

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

const policyManifestSchema = z
  .object({
    environment: z.enum(['development', 'production']),
    lifecycleBlocks: z.array(z.string().min(1)),
    planAddresses: z.array(z.string().min(1)),
    stack: z.enum(['auth', 'backend']),
  })
  .strict();

const openTofuPlanSchema = z
  .object({
    resource_changes: z
      .array(
        z
          .object({
            address: z.string().min(1),
            change: z
              .object({
                actions: z.array(z.string().min(1)),
              })
              .loose(),
            mode: z.string().min(1),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();

export type PolicyManifest = z.infer<typeof policyManifestSchema>;

export function parsePolicyManifest(value: unknown): PolicyManifest {
  const result = policyManifestSchema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid protected-resource manifest: ${details}`);
  }

  return result.data;
}

export function parseOpenTofuPlan(value: unknown): OpenTofuPlan {
  const result = openTofuPlanSchema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid OpenTofu plan JSON: ${details}`);
  }

  return result.data;
}

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

export function findReconstructableDestructiveViolations(
  plan: OpenTofuPlan,
  protectedAddresses: readonly string[],
  allowDestructiveChanges: boolean,
): string[] {
  if (allowDestructiveChanges) {
    return [];
  }

  const protectedAddressSet = new Set(protectedAddresses);
  return (plan.resource_changes ?? []).flatMap((change) => {
    const isReconstructableManagedResource =
      change.mode === 'managed' && !protectedAddressSet.has(change.address);
    const isDestructive = change.change.actions.some((action) =>
      ['delete', 'forget'].includes(action),
    );

    return isReconstructableManagedResource && isDestructive
      ? [
          `${change.address}: reconstructable deletion or replacement requires explicit authorization`,
        ]
      : [];
  });
}
