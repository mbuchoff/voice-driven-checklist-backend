import { findLifecycleGuardViolations } from './lifecycle-policy.js';
import {
  findProtectedChangeViolations,
  findReconstructableDestructiveViolations,
  type OpenTofuPlan,
  type PolicyManifest,
} from './plan-policy.js';

export async function findInfrastructurePolicyViolations(
  plan: OpenTofuPlan,
  manifest: PolicyManifest,
  configurationDirectory: string,
  allowReconstructableDestroy: boolean,
): Promise<string[]> {
  return [
    ...findProtectedChangeViolations(plan, manifest.planAddresses),
    ...findReconstructableDestructiveViolations(
      plan,
      manifest.planAddresses,
      allowReconstructableDestroy,
    ),
    ...(await findLifecycleGuardViolations(
      configurationDirectory,
      manifest.lifecycleBlocks,
    )),
  ];
}
