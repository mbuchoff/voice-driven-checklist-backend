export interface DeploymentProvenance {
  readonly artifactDigest: string;
  readonly commit: string;
}

const fullCommitPattern = /^[0-9a-f]{40}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

export function descriptionValue(description: string, key: string): string {
  const entry = description
    .split('; ')
    .find((part) => part.startsWith(`${key} `));
  return entry?.slice(key.length + 1) ?? '';
}

export function validateDeploymentProvenance(
  actual: DeploymentProvenance,
  selected: DeploymentProvenance,
): string[] {
  const violations: string[] = [];

  if (!fullCommitPattern.test(actual.commit)) {
    violations.push('deployed commit must be a full lowercase Git SHA');
  }
  if (!sha256Pattern.test(actual.artifactDigest)) {
    violations.push('deployed artifact digest must be a lowercase SHA-256');
  }
  if (actual.commit !== selected.commit) {
    violations.push('deployed commit differs from the selected commit');
  }
  if (actual.artifactDigest !== selected.artifactDigest) {
    violations.push('deployed artifact differs from the selected artifact');
  }

  return violations;
}
