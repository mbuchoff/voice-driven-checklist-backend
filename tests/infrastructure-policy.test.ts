import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { findInfrastructurePolicyViolations } from '../src/deployment/infrastructure-policy.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('infrastructure policy gate', () => {
  it('combines protected, reconstructable, and lifecycle violations', async () => {
    const configurationDirectory = await mkdtemp(
      join(tmpdir(), 'voice-checklist-policy-'),
    );
    temporaryDirectories.push(configurationDirectory);
    await writeFile(
      join(configurationDirectory, 'main.tf'),
      'resource "aws_s3_bucket" "records" {}',
    );

    const violations = await findInfrastructurePolicyViolations(
      {
        resource_changes: [
          {
            address: 'aws_s3_bucket.records',
            change: { actions: ['delete'] },
            mode: 'managed',
          },
          {
            address: 'aws_lambda_function.worker',
            change: { actions: ['delete', 'create'] },
            mode: 'managed',
          },
        ],
      },
      {
        environment: 'production',
        lifecycleBlocks: ['aws_s3_bucket.records'],
        planAddresses: ['aws_s3_bucket.records'],
        stack: 'backend',
      },
      configurationDirectory,
      false,
    );

    expect(violations).toEqual([
      expect.stringContaining('aws_s3_bucket.records'),
      expect.stringContaining('aws_lambda_function.worker'),
      expect.stringContaining('aws_s3_bucket.records'),
    ]);
  });
});
