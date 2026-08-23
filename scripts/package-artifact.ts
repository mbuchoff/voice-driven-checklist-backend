import { resolve } from 'node:path';

import { createLambdaArtifact } from '../src/deployment/artifact.js';

const [input = 'dist/handler/index.js', output = 'dist/artifact/lambda.zip', ...unexpected] =
  process.argv.slice(2);

if (unexpected.length > 0) {
  throw new Error('Usage: package-artifact [input-path] [output-path]');
}

await createLambdaArtifact(resolve(input), resolve(output));
