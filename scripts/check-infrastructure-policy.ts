import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { findInfrastructurePolicyViolations } from '../src/deployment/infrastructure-policy.js';
import {
  parseOpenTofuPlan,
  parsePolicyManifest,
} from '../src/deployment/plan-policy.js';

async function readJson(path: string): Promise<unknown> {
  let source: string;
  if (path === '-') {
    process.stdin.setEncoding('utf8');
    source = '';
    for await (const chunk of process.stdin as AsyncIterable<unknown>) {
      if (typeof chunk !== 'string') {
        throw new Error('Infrastructure plan input must be UTF-8 text.');
      }
      source += chunk;
    }
  } else {
    source = await readFile(resolve(path), 'utf8');
  }

  return JSON.parse(source) as unknown;
}

async function main(): Promise<void> {
  const [
    planPath,
    manifestPath,
    configurationDirectory,
    destructiveOverride,
    ...unexpected
  ] = process.argv.slice(2);

  if (
    planPath === undefined ||
    manifestPath === undefined ||
    configurationDirectory === undefined ||
    unexpected.length > 0 ||
    (destructiveOverride !== undefined &&
      destructiveOverride !== '--allow-reconstructable-destroy')
  ) {
    throw new Error(
      'Usage: check-infrastructure-policy <plan.json|-> <manifest.json> <configuration-directory> [--allow-reconstructable-destroy]',
    );
  }

  const manifest = parsePolicyManifest(await readJson(resolve(manifestPath)));
  const plan = parseOpenTofuPlan(await readJson(planPath));
  const violations = await findInfrastructurePolicyViolations(
    plan,
    manifest,
    resolve(configurationDirectory),
    destructiveOverride === '--allow-reconstructable-destroy',
  );

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
