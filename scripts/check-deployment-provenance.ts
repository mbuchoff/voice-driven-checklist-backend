import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

import { validateDeploymentProvenance } from '../src/deployment/provenance.js';

const aliasSchema = z.object({
  Description: z.string(),
  FunctionVersion: z.string().min(1),
});

const configurationSchema = z.object({
  CodeSha256: z.string(),
  Description: z.string(),
  Version: z.string(),
});

function descriptionValue(description: string, key: string): string {
  const entry = description
    .split('; ')
    .find((part) => part.startsWith(`${key} `));
  return entry?.slice(key.length + 1) ?? '';
}

async function main(): Promise<void> {
  const [
    configurationPath,
    aliasPath,
    commit,
    digest,
    sha256,
    deploymentUrl,
    ...unexpected
  ] = process.argv.slice(2);
  if (
    configurationPath === undefined ||
    aliasPath === undefined ||
    commit === undefined ||
    digest === undefined ||
    sha256 === undefined ||
    deploymentUrl === undefined ||
    unexpected.length > 0
  ) {
    throw new Error(
      'Usage: check-deployment-provenance <configuration.json> <alias.json> <commit> <base64-digest> <hex-sha256> <deployment-url>',
    );
  }

  const configuration = configurationSchema.parse(
    JSON.parse(await readFile(resolve(configurationPath), 'utf8')),
  );
  const alias = aliasSchema.parse(
    JSON.parse(await readFile(resolve(aliasPath), 'utf8')),
  );
  const violations = validateDeploymentProvenance(
    {
      artifactDigest: descriptionValue(alias.Description, 'artifact'),
      commit: descriptionValue(alias.Description, 'commit'),
    },
    { artifactDigest: sha256, commit },
  );

  if (configuration.CodeSha256 !== digest) {
    violations.push('deployed Lambda code differs from the selected artifact');
  }
  if (descriptionValue(configuration.Description, 'commit') !== commit) {
    violations.push('published Lambda version differs from the selected commit');
  }
  if (descriptionValue(configuration.Description, 'deployment') !== deploymentUrl) {
    violations.push('published Lambda version differs from the GitHub Deployment');
  }
  if (configuration.Version === '$LATEST') {
    violations.push('active alias must select an immutable Lambda version');
  }

  if (violations.length > 0) {
    throw new Error(
      `Deployment provenance verification failed:\n${violations.join('\n')}`,
    );
  }
}

try {
  await main();
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : 'Deployment provenance verification failed.',
  );
  process.exitCode = 1;
}
