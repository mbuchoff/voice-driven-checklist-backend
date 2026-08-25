export interface DeploymentProvenance {
  readonly aliasFunctionVersion: string;
  readonly artifactDigest: string;
  readonly codeDigest: string;
  readonly commit: string;
  readonly configurationVersion: string;
  readonly versionCommit: string;
  readonly versionDeploymentUrl: string;
}

export interface DeploymentSelection {
  readonly artifactDigest: string;
  readonly codeDigest: string;
  readonly commit: string;
  readonly deploymentUrl: string;
}

const fullCommitPattern = /^[0-9a-f]{40}$/;
const publishedVersionPattern = /^[1-9]\d*$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

export function descriptionValue(description: string, key: string): string {
  const entry = description
    .split('; ')
    .find((part) => part.startsWith(`${key} `));
  return entry?.slice(key.length + 1) ?? '';
}

export function validateDeploymentProvenance(
  actual: DeploymentProvenance,
  selected: DeploymentSelection,
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
  if (actual.codeDigest !== selected.codeDigest) {
    violations.push('deployed Lambda code differs from the selected artifact');
  }
  if (actual.versionCommit !== selected.commit) {
    violations.push('published Lambda version differs from the selected commit');
  }
  if (actual.versionDeploymentUrl !== selected.deploymentUrl) {
    violations.push('published Lambda version differs from the GitHub Deployment');
  }
  if (!publishedVersionPattern.test(actual.aliasFunctionVersion)) {
    violations.push('active alias must select an immutable Lambda version');
  }
  if (actual.configurationVersion !== actual.aliasFunctionVersion) {
    violations.push('deployed Lambda configuration differs from the active alias');
  }

  return violations;
}
