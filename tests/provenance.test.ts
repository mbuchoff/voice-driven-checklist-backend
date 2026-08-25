import { describe, expect, it } from 'vitest';

import {
  descriptionValue,
  validateDeploymentProvenance,
} from '../src/deployment/provenance.js';

const commit = '0123456789abcdef0123456789abcdef01234567';
const artifactDigest =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const codeDigest = 'ASNFZ4mrze8BI0VniavN7wJEn06J1JtAAAS01jL84Vg=';
const deploymentUrl =
  'https://github.com/mbuchoff/voice-driven-checklist-backend/actions/runs/1';

const selected = { artifactDigest, codeDigest, commit, deploymentUrl };
const actual = {
  aliasFunctionVersion: '1',
  artifactDigest,
  codeDigest,
  commit,
  configurationVersion: '1',
  versionCommit: commit,
  versionDeploymentUrl: deploymentUrl,
};

describe('deployment provenance', () => {
  it('extracts a named value from a Lambda description', () => {
    expect(descriptionValue(`commit ${commit}; deployment run-url`, 'deployment')).toBe(
      'run-url',
    );
  });

  it('returns an empty value when a Lambda description omits the key', () => {
    expect(descriptionValue(`commit ${commit}`, 'artifact')).toBe('');
  });

  it('accepts the selected commit and exact artifact digest', () => {
    expect(validateDeploymentProvenance(actual, selected)).toEqual([]);
  });

  it.each([
    [
      'selected commit differs',
      { artifactDigest, commit: 'abcdef0123456789abcdef0123456789abcdef01' },
    ],
    [
      'artifact digest differs',
      {
        artifactDigest:
          'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
        commit,
      },
    ],
    ['commit is not a full SHA', { artifactDigest, commit: '0123456' }],
    ['artifact digest is malformed', { artifactDigest: 'sha256:bad', commit }],
  ])('rejects deployment when %s', (_name, alias) => {
    expect(
      validateDeploymentProvenance({ ...actual, ...alias }, selected),
    ).not.toEqual([]);
  });

  it.each([
    ['Lambda code differs', { codeDigest: 'different' }],
    ['version commit differs', { versionCommit: 'different' }],
    ['version deployment differs', { versionDeploymentUrl: 'different' }],
    ['alias selects latest', { aliasFunctionVersion: '$LATEST' }],
    ['configuration does not match alias', { configurationVersion: '2' }],
  ])('rejects deployment when %s', (_name, difference) => {
    expect(
      validateDeploymentProvenance(
        { ...actual, ...difference },
        selected,
      ),
    ).not.toEqual([]);
  });
});
