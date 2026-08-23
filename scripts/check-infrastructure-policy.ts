import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { findLifecycleGuardViolations } from '../src/deployment/lifecycle-policy.js';
import {
  findProtectedChangeViolations,
  parseOpenTofuPlan,
  parsePolicyManifest,
} from '../src/deployment/plan-policy.js';

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

async function main(): Promise<void> {
  const [planPath, manifestPath, configurationDirectory, ...unexpected] =
    process.argv.slice(2);

  if (
    planPath === undefined ||
    manifestPath === undefined ||
    configurationDirectory === undefined ||
    unexpected.length > 0
  ) {
    throw new Error(
      'Usage: check-infrastructure-policy <plan.json> <manifest.json> <configuration-directory>',
    );
  }

  const manifest = parsePolicyManifest(await readJson(resolve(manifestPath)));
  const plan = parseOpenTofuPlan(await readJson(resolve(planPath)));
  const violations = [
    ...findProtectedChangeViolations(plan, manifest.planAddresses),
    ...(await findLifecycleGuardViolations(
      resolve(configurationDirectory),
      manifest.lifecycleBlocks,
    )),
  ];

  if (violations.length > 0) {
    throw new Error(`Infrastructure policy rejected the plan:\n${violations.join('\n')}`);
  }

  console.log(
    `Infrastructure policy accepted ${manifest.stack}/${manifest.environment}.`,
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Infrastructure policy failed.');
  process.exitCode = 1;
}
