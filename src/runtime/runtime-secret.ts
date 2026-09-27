import {
  GetParameterCommand,
  SSMClient,
  type GetParameterCommandOutput,
} from '@aws-sdk/client-ssm';

interface ParameterStoreClient {
  send(command: GetParameterCommand): Promise<GetParameterCommandOutput>;
}

export interface RuntimeSecretReader {
  read(parameterName: string): Promise<unknown>;
}

export function createSsmRuntimeSecretReader(
  client: ParameterStoreClient = new SSMClient({}),
): RuntimeSecretReader {
  return {
    async read(parameterName) {
      const response = await client.send(new GetParameterCommand({
        Name: parameterName,
        WithDecryption: true,
      }));
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
