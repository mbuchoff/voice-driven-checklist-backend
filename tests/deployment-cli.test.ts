import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

interface ScriptResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function runScript(
  script: string,
  arguments_: readonly string[],
  input = '',
): Promise<ScriptResult> {
  return await new Promise((resolveResult, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', resolve(script), ...arguments_],
      {
        cwd: process.cwd(),
        env: { ...process.env, NO_COLOR: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let stderr = '';
    let stdout = '';

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolveResult({ exitCode: exitCode ?? -1, stderr, stdout });
    });
    child.stdin.end(input);
  });
}

describe('infrastructure policy command', () => {
  const arguments_ = [
    '-',
    'infra/policy/backend-development.json',
    'infra/aws/backend',
  ];
  const destructivePlan = JSON.stringify({
    resource_changes: [
      {
        address: 'aws_cloudwatch_log_group.placeholder[0]',
        change: { actions: ['no-op'] },
        mode: 'managed',
      },
      {
        address: 'aws_lambda_function.placeholder[0]',
        change: { actions: ['delete', 'create'] },
        mode: 'managed',
      },
    ],
  });

  it('rejects a destructive plan from standard input by default', async () => {
    const result = await runScript(
      'scripts/check-infrastructure-policy.ts',
      arguments_,
      destructivePlan,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('requires explicit authorization');
    expect(result.stdout).toBe('');
  });

  it('accepts the same plan only with the explicit reconstructable override', async () => {
    const result = await runScript(
      'scripts/check-infrastructure-policy.ts',
      [...arguments_, '--allow-reconstructable-destroy'],
      destructivePlan,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(
      'Infrastructure policy accepted backend/development.',
    );
  });

  it('rejects incomplete command arguments before reading a plan', async () => {
    const result = await runScript('scripts/check-infrastructure-policy.ts', []);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Usage: check-infrastructure-policy');
    expect(result.stdout).toBe('');
  });
});

describe('deployment provenance command', () => {
  const commit = '0123456789abcdef0123456789abcdef01234567';
  const artifactSha256 =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const codeSha256 = 'ASNFZ4mrze8BI0VniavN7wJEn06J1JtAAAS01jL84Vg=';
  const deploymentUrl =
    'https://github.com/mbuchoff/voice-driven-checklist-backend/actions/runs/1';

  async function provenancePaths(
    aliasFunctionVersion = '1',
  ): Promise<readonly [string, string]> {
    const directory = await mkdtemp(
      join(tmpdir(), 'voice-checklist-provenance-'),
    );
    temporaryDirectories.push(directory);
    const configurationPath = join(directory, 'configuration.json');
    const aliasPath = join(directory, 'alias.json');
    await Promise.all([
      writeFile(
        configurationPath,
        JSON.stringify({
          CodeSha256: codeSha256,
          Description: `commit ${commit}; deployment ${deploymentUrl}`,
        }),
      ),
      writeFile(
        aliasPath,
        JSON.stringify({
          Description: `commit ${commit}; artifact ${artifactSha256}`,
          FunctionVersion: aliasFunctionVersion,
        }),
      ),
    ]);
    return [configurationPath, aliasPath];
  }

  it('accepts matching immutable Lambda provenance', async () => {
    const paths = await provenancePaths();
    const result = await runScript('scripts/check-deployment-provenance.ts', [
      ...paths,
      commit,
      codeSha256,
      artifactSha256,
      deploymentUrl,
    ]);

    expect(result).toEqual({ exitCode: 0, stderr: '', stdout: '' });
  });

  it('rejects an alias that selects the mutable latest version', async () => {
    const paths = await provenancePaths('$LATEST');
    const result = await runScript('scripts/check-deployment-provenance.ts', [
      ...paths,
      commit,
      codeSha256,
      artifactSha256,
      deploymentUrl,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      'active alias must select an immutable Lambda version',
    );
    expect(result.stdout).toBe('');
  });
});
