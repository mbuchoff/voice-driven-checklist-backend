# Authentication infrastructure

This root exclusively owns the existing development and production Cognito
resources. Both environments share the configuration and provider lock but use
different variables, remote-state keys, Secrets Manager credentials, pools,
clients, domains, and login branding.

No sync API, storage, or production Lambda belongs in this root.

## Plan an environment

Use the committed non-secret environment variables and backend configuration:

```bash
environment=development
tofu init -reconfigure -input=false \
  -backend-config="environments/$environment.s3.tfbackend"
tofu plan -lock=false -input=false \
  -var-file="environments/$environment.tfvars" \
  -out="/tmp/auth-$environment.tfplan"
tofu show -json "/tmp/auth-$environment.tfplan" \
  | jq '{resource_changes: [(.resource_changes // [])[] | {address, mode, change: {actions: .change.actions}}]}' \
  > "/tmp/auth-$environment.json"
```

Run the repository policy checker from the repository root before any apply:

```bash
npm exec -- tsx scripts/check-infrastructure-policy.ts \
  "/tmp/auth-$environment.json" \
  "infra/policy/auth-$environment.json" \
  infra/aws/auth
```

## Read public app configuration

After initializing the selected environment, retrieve the public Cognito
values consumed by Expo with:

```bash
tofu output -json
```

The output names and app mapping are defined in [`outputs.tf`](outputs.tf).
They contain endpoints and IDs, never the Google OAuth secret.

The projection above writes only resource addresses, modes, and planned
actions; never write or publish raw plan JSON because it can contain sensitive
values. Never put the Google OAuth value in a variable file. The root reads the
environment-specific secret directly from AWS Secrets Manager. OpenTofu owns
the secret's name, tags, recovery behavior, and deletion lifecycle; an operator
or rotation process owns its value.

Do not apply an auth plan merely because the policy accepts it. Production
requires explicit review, and any pool/client create, delete, replace, forget,
or missing action is prohibited.
