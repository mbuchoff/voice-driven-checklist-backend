import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { buildContractDocuments } from '../src/contracts/catalog.js';

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, undefined, 2)}\n`);
}

const outputDirectory = resolve('dist/contracts');
const documents = buildContractDocuments();

await Promise.all([
  writeJson(resolve(outputDirectory, 'events.json'), documents.events),
  writeJson(resolve(outputDirectory, 'openapi.json'), documents.openapi),
]);
