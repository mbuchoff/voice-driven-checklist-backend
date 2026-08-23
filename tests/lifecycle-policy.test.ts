import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { findLifecycleGuardViolations } from '../src/deployment/lifecycle-policy.js';

const temporaryDirectories: string[] = [];

async function configurationWith(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'voice-checklist-lifecycle-'));
  temporaryDirectories.push(directory);
  await writeFile(join(directory, 'main.tf'), contents);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('OpenTofu lifecycle policy', () => {
  it('accepts an explicitly guarded protected resource', async () => {
    const directory = await configurationWith(`
      resource "aws_cognito_user_pool" "auth" {
        lifecycle {
          destroy = false
        }
      }
    `);

    await expect(
      findLifecycleGuardViolations(directory, ['aws_cognito_user_pool.auth']),
    ).resolves.toEqual([]);
  });

  it.each([
    ['resource block is missing', ''],
    [
      'lifecycle block is missing',
      'resource "aws_cognito_user_pool" "auth" {}',
    ],
    [
      'destroy protection is disabled',
      `resource "aws_cognito_user_pool" "auth" {
        lifecycle { destroy = true }
      }`,
    ],
  ])('fails closed when the %s', async (_name, contents) => {
    const directory = await configurationWith(contents);

    await expect(
      findLifecycleGuardViolations(directory, ['aws_cognito_user_pool.auth']),
    ).resolves.toEqual([
      expect.stringContaining('aws_cognito_user_pool.auth'),
    ]);
  });
});
