import type {
  GetParameterCommand,
  GetParameterCommandOutput,
} from '@aws-sdk/client-ssm';
import { describe, expect, it, vi } from 'vitest';

import { createSsmRuntimeSecretReader } from '../src/runtime/runtime-secret.js';

describe('SSM runtime secret reader', () => {
  it('requests one named SecureString with decryption and parses its JSON', async () => {
    const send = vi.fn<
      (command: GetParameterCommand) => Promise<GetParameterCommandOutput>
    >().mockResolvedValue({
      $metadata: {},
      Parameter: { Value: '{"mongodb":{"username":"app"}}' },
    } satisfies GetParameterCommandOutput);
    const reader = createSsmRuntimeSecretReader({ send });

    await expect(reader.read('/voice-checklist/development/runtime', 42)).resolves.toEqual({
      mongodb: { username: 'app' },
    });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0].input).toEqual({
      Name: '/voice-checklist/development/runtime:42',
      WithDecryption: true,
    });
  });

  it.each([
    [{ $metadata: {} } satisfies GetParameterCommandOutput],
    [{ $metadata: {}, Parameter: { Value: 'not-json' } } satisfies GetParameterCommandOutput],
  ])('fails closed for a missing or malformed parameter: %j', async (response) => {
    const reader = createSsmRuntimeSecretReader({
      send: vi.fn().mockResolvedValue(response),
    });

    await expect(reader.read('/voice-checklist/development/runtime', 42)).rejects.toThrow();
  });

  it('aborts a parameter read before it can consume the API request budget', async () => {
    const send = vi.fn((
      _command: GetParameterCommand,
      options?: { abortSignal?: AbortSignal },
    ) => new Promise<GetParameterCommandOutput>((_resolve, reject) => {
      options?.abortSignal?.addEventListener('abort', () => {
        reject(new Error('aborted'));
      });
    }));
    const reader = createSsmRuntimeSecretReader({ send }, { timeoutMs: 10 });

    await expect(reader.read('/voice-checklist/development/runtime', 42)).rejects.toThrow(
      'aborted',
    );
  });
});
