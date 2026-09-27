import {
  GetParameterCommand,
  SSMClient,
  type GetParameterCommandOutput,
} from '@aws-sdk/client-ssm';

interface ParameterStoreClient {
  send(
    command: GetParameterCommand,
    options?: { readonly abortSignal?: AbortSignal },
  ): Promise<GetParameterCommandOutput>;
}

export interface RuntimeSecretReader {
  read(parameterName: string, version: number): Promise<unknown>;
}

export function createSsmRuntimeSecretReader(
  client: ParameterStoreClient = new SSMClient({ maxAttempts: 2 }),
  options: { readonly timeoutMs: number } = { timeoutMs: 1_500 },
): RuntimeSecretReader {
  return {
    async read(parameterName, version) {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, options.timeoutMs);
      let response: GetParameterCommandOutput;
      try {
        response = await client.send(new GetParameterCommand({
          Name: `${parameterName}:${String(version)}`,
          WithDecryption: true,
        }), { abortSignal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      const value = response.Parameter?.Value;
      if (value === undefined) {
        throw new Error('The runtime secret parameter has no value.');
      }
      try {
        return JSON.parse(value) as unknown;
      } catch {
        throw new Error('The runtime secret parameter is not valid JSON.');
      }
    },
  };
}
