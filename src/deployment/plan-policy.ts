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
              }),
            mode: z.string().min(1),
          }),
      )
      .optional(),
  });

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

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function findRuntimeSecretVersionPinViolations(value: unknown): string[] {
  const plan = record(value);
  const plannedValues = record(plan?.planned_values);
  const outputs = record(plannedValues?.outputs);
  const versionOutput = record(outputs?.runtime_secret_version);
  const version = versionOutput?.value;

  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    return ['runtime_secret_version: planned output must be a positive integer'];
  }

  const rootModule = record(plannedValues?.root_module);
  const resources = rootModule?.resources;
  const pinnedVersions = Array.isArray(resources)
    ? resources.flatMap((resource) => {
        const candidate = record(resource);
        if (candidate?.address !== 'aws_lambda_function.placeholder[0]') {
          return [];
        }

        const values = record(candidate.values);
        const environment = values?.environment;
        if (!Array.isArray(environment) || environment.length !== 1) {
          return [];
        }

        const variables = record(record(environment[0])?.variables);
        const pinnedVersion = variables?.RUNTIME_SECRET_VERSION;
        return typeof pinnedVersion === 'string' ? [pinnedVersion] : [];
      })
    : [];

  return pinnedVersions.length === 1 && pinnedVersions[0] === String(version)
    ? []
    : [
        'aws_lambda_function.placeholder[0]: RUNTIME_SECRET_VERSION must match the planned runtime_secret_version output',
      ];
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
