import { describe, expect, it } from 'vitest';
import { sourceProbeTarget } from '../src/source-target.js';

const atlas = {
  GH29_SOURCE_PROBE_TARGET: 'atlas',
  GH29_SOURCE_PROBE_EXPECTED_HOST: 'fixture.mongodb.net',
  MONGODB_URI: 'mongodb+srv://old-user:old-password@fixture.mongodb.net/existing_data?tls=false&appName=ignored',
  MONGODB_USERNAME: 'fixture-user',
  MONGODB_PASSWORD: 'fixture-password-with-@:/characters',
};

describe('source probe target selection', () => {
  it('keeps ordinary test runs local even when MongoDB credentials are present', () => {
    const target = sourceProbeTarget({ ...atlas, GH29_SOURCE_PROBE_TARGET: undefined });
    expect(target.label).toBe('local');
    expect(target.uri).toBe('mongodb://127.0.0.1:27018/?replicaSet=gh29');
    expect(target.options.auth).toBeUndefined();
  });

  it('uses the explicitly selected Atlas host and separate credentials, ignoring URI database and overrides', () => {
    const target = sourceProbeTarget(atlas);
    expect(target.label).toBe('atlas');
    expect(target.uri).toBe('mongodb+srv://fixture.mongodb.net/');
    expect(target.options).toMatchObject({
      auth: { username: atlas.MONGODB_USERNAME, password: atlas.MONGODB_PASSWORD },
      authSource: 'admin', tls: true, writeConcern: { w: 'majority' },
    });
  });

  it.each([
    { GH29_SOURCE_PROBE_TARGET: 'unknown' },
    { GH29_SOURCE_PROBE_EXPECTED_HOST: '' },
    { GH29_SOURCE_PROBE_EXPECTED_HOST: 'another.mongodb.net' },
    { MONGODB_URI: 'mongodb://fixture.mongodb.net/' },
    { MONGODB_URI: 'mongodb+srv://fixture.mongodb.net.attacker.example/' },
    { MONGODB_URI: 'mongodb+srv://fixture.mongodb.net:27017/' },
    { MONGODB_USERNAME: '' },
    { MONGODB_PASSWORD: '' },
  ])('refuses an incomplete, mismatched or unexpected target: %j', override => {
    expect(() => sourceProbeTarget({ ...atlas, ...override })).toThrow();
  });

  it('does not echo a malformed credential-bearing URI in errors', () => {
    const invalid = 'invalid URI containing fixture-secret';
    let error: unknown;
    try { sourceProbeTarget({ ...atlas, MONGODB_URI: invalid }); }
    catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('fixture-secret');
    expect(error).not.toHaveProperty('cause');
  });
});
