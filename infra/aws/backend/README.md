# Backend infrastructure

This root owns environment-scoped backend HTTP API, compute, execution roles,
and logs. Development publishes the active Lambda alias behind three explicit
HTTP API routes: health, public JWKS, and the authenticated PowerSync credential
exchange. Production uses an independent state key and still creates no runtime.

Artifact and provenance values are deployment inputs rather than committed
variables:

- `artifact_path`: exact zip selected for this plan;
- `artifact_digest`: base64 SHA-256 used by Lambda `CodeSha256`;
- `artifact_sha256`: hexadecimal SHA-256 recorded on the alias;
- `commit_sha`: full selected Git commit;
- `deployment_url`: immutable GitHub Actions run associated with the commit;
- `permissions_boundary_arn`: bootstrap-owned, environment-scoped boundary for execution roles.

Selected-ref deployment may apply only the development state for this root. It
may create a new backend service. Persistent addresses remain undeletable;
reconstructable deletion or replacement needs explicit workflow authorization.

The Development Lambda receives only public runtime settings plus the name and
reviewed numeric version of `/voice-checklist/development/runtime`. That SSM
SecureString is seeded outside OpenTofu; the execution role can read only that
exact parameter and the runtime requests only the pinned version. See
[`docs/powersync-authentication.md`](../../../docs/powersync-authentication.md).
