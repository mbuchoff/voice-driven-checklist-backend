import type { Context } from 'aws-lambda';
import { describe, expect, it } from 'vitest';

import { handler } from '../src/handler.js';

describe('placeholder Lambda', () => {
  it('returns a harmless health response without exposing runtime input', () => {
    const sensitiveInput = { authorization: 'must-not-be-returned' };

    const response = handler(sensitiveInput, {} as Context);
    const body = response.body ?? '';

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(body)).toEqual({ status: 'ok' });
    expect(body).not.toContain(sensitiveInput.authorization);
  });
});
