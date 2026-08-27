import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { zipSync } from 'fflate';

const zipTimestamp = new Date(1980, 0, 1, 0, 0, 0);

export async function createLambdaArtifact(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  const source = await readFile(inputPath);
  const archive = zipSync(
    {
      'index.js': [
        source,
        {
          attrs: 0o644 << 16,
          level: 9,
          mtime: zipTimestamp,
          os: 3,
        },
      ],
    },
    { level: 9 },
  );

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, archive);
}
