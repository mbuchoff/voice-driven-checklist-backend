# Backend infrastructure

This root owns environment-scoped backend compute, execution roles, and logs.
Development currently publishes a harmless direct-invocation Lambda. Production
uses an independent state key but creates no Lambda until the first `/v1`
baseline.

Artifact and provenance values are deployment inputs rather than committed
variables:

- `artifact_path`: exact zip selected for this plan;
- `artifact_digest`: base64 SHA-256 used by Lambda `CodeSha256`;
- `artifact_sha256`: hexadecimal SHA-256 recorded on the alias;
- `commit_sha`: full selected Git commit;
- `deployment_url`: GitHub Deployment associated with the commit;
- `permissions_boundary_arn`: bootstrap-owned boundary for execution roles.

Selected-ref deployment may apply only the development state for this root. It
may create a new backend service. Persistent addresses remain undeletable;
reconstructable deletion or replacement needs explicit workflow authorization.
