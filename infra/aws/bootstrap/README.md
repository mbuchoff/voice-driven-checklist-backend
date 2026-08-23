# AWS bootstrap

This manual-only root creates the GitHub OIDC provider, read-only plan role,
environment deployment roles, and shared permissions boundary. No GitHub
workflow is authorized to apply its state or modify these roles.

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

The boundary allows only permissions granted by a role and independently denies
persistent-data deletion plus mutation of GitHub roles and the boundary itself.
Development branch credentials cannot manage Cognito or read deployment
credentials. Production Cognito deletion is denied both by its inline role
policy and the boundary.
