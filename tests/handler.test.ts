import type { Context } from 'aws-lambda';
import { describe, expect, it } from 'vitest';

import { handler } from '../src/handler.js';

describe('placeholder Lambda', () => {
  it('returns a harmless health response without exposing runtime input', async () => {
    const sensitiveInput = { authorization: 'must-not-be-returned' };

    const response = await handler(sensitiveInput, {} as Context);

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: 'ok' });
    expect(response.body).not.toContain(sensitiveInput.authorization);
  });
});
