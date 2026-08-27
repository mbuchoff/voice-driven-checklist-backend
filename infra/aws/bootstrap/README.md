# AWS bootstrap

This manual-only root creates the GitHub OIDC provider, read-only plan role,
environment deployment roles, a deployment permissions boundary, and
environment-scoped runtime boundaries. No GitHub workflow is authorized to
apply its state or modify these roles.

The trust policies include GitHub's immutable owner and repository IDs in each
OIDC subject. Repository names and IDs default in `variables.tf`; override both
explicitly and review the trust-policy plan if ownership changes. A repository
rename alone does not change the IDs.

The state bucket is a pre-existing dependency. Verify it before bootstrap:

```bash
aws s3api get-bucket-versioning \
  --bucket voice-checklist-tofu-state-use1-198771014193
aws s3api get-bucket-encryption \
  --bucket voice-checklist-tofu-state-use1-198771014193
aws s3api get-public-access-block \
  --bucket voice-checklist-tofu-state-use1-198771014193
```

Plan only after those checks succeed:

```bash
tofu init -reconfigure -input=false \
  -backend-config=environments/bootstrap.s3.tfbackend
tofu plan -input=false \
  -var='state_bucket=voice-checklist-tofu-state-use1-198771014193' \
  -out=/tmp/bootstrap.tfplan
```

Review every action and obtain explicit approval before applying. The expected
steady-state plan is no-op.

The deployment boundary allows only permissions granted by a role and
independently denies persistent-data deletion plus mutation of GitHub roles and
the boundary itself. Runtime boundaries permit only the exact services each
environment's Lambda code needs. Development branch credentials cannot manage
production resources, Cognito, or deployment credentials. Production Cognito
deletion is denied both by its inline role policy and the deployment boundary.
