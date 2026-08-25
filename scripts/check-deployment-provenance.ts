import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

import {
  descriptionValue,
  validateDeploymentProvenance,
} from '../src/deployment/provenance.js';

const aliasSchema = z.object({
  Description: z.string(),
  FunctionVersion: z.string().min(1),
});

const configurationSchema = z.object({
  CodeSha256: z.string(),
  Description: z.string(),
});

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
      aliasFunctionVersion: alias.FunctionVersion,
      artifactSha256: descriptionValue(alias.Description, 'artifact'),
      codeSha256: configuration.CodeSha256,
      commit: descriptionValue(alias.Description, 'commit'),
      versionCommit: descriptionValue(configuration.Description, 'commit'),
      versionDeploymentUrl: descriptionValue(
        configuration.Description,
        'deployment',
      ),
    },
    { artifactSha256: sha256, codeSha256: digest, commit, deploymentUrl },
  );

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
