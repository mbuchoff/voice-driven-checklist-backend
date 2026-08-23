import { describe, expect, it } from 'vitest';

import { validateDeploymentProvenance } from '../src/deployment/provenance.js';

const commit = '0123456789abcdef0123456789abcdef01234567';
const artifactDigest =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('deployment provenance', () => {
  it('accepts the selected commit and exact artifact digest', () => {
    expect(
      validateDeploymentProvenance(
        { artifactDigest, commit },
        { artifactDigest, commit },
      ),
    ).toEqual([]);
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
  ])('rejects deployment when %s', (_name, actual) => {
    expect(
      validateDeploymentProvenance(actual, { artifactDigest, commit }),
    ).not.toEqual([]);
  });
});
