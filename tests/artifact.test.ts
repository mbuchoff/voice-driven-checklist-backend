import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

import { createLambdaArtifact } from '../src/deployment/artifact.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('Lambda artifact packaging', () => {
  it('creates a deterministic zip containing only index.js', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'voice-checklist-artifact-'));
    temporaryDirectories.push(directory);
    const input = join(directory, 'index.js');
    const firstOutput = join(directory, 'first.zip');
    const secondOutput = join(directory, 'second.zip');
    const source = 'exports.handler = () => ({ statusCode: 200 });\n';
    await writeFile(input, source);

    await createLambdaArtifact(input, firstOutput);
    await createLambdaArtifact(input, secondOutput);

    const first = await readFile(firstOutput);
    const second = await readFile(secondOutput);
    const entries = unzipSync(first);
    expect(first).toEqual(second);
    expect(Object.keys(entries)).toEqual(['index.js']);
    expect(Buffer.from(entries['index.js'] ?? []).toString('utf8')).toBe(source);
  });
});
