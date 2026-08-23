# Voice-Driven Checklist Backend

Serverless backend infrastructure and application code for
[Voice-Driven Checklist](https://github.com/mbuchoff/voice-driven-checklist).

This repository exclusively owns the AWS authentication and backend state. The
current runtime is a harmless development-only Lambda placeholder. Issue
[#29](https://github.com/mbuchoff/voice-driven-checklist/issues/29) will define
the first sync API, data model, and `/v1` contract; this foundation deliberately
publishes no API routes or event types.

## Local development

Use Node.js 24 and OpenTofu 1.12.5.

```bash
npm ci
npm audit
npm run lint
npm run typecheck
npm test
npm run build
npm run package:artifact
tofu fmt -check -recursive infra
```

`npm run build` bundles `src/handler.ts` and generates valid empty OpenAPI and
event-catalog documents under the ignored `dist/` directory. Runtime
TypeScript schemas in `src/contracts/` are the contract source of truth; the
first route and event schemas belong to #29.

Each OpenTofu root also has offline provider-mocked tests:

```bash
for stack in auth backend bootstrap; do
  tofu -chdir="infra/aws/$stack" init -backend=false -input=false
  tofu -chdir="infra/aws/$stack" validate
  tofu -chdir="infra/aws/$stack" test
done
```

## Infrastructure ownership

| Root | State key | Purpose |
| --- | --- | --- |
| `infra/aws/bootstrap` | `voice-checklist/bootstrap.tfstate` | Manual-only GitHub OIDC, roles, and permissions boundary |
| `infra/aws/auth` development | `voice-checklist/auth/development.tfstate` | Existing development Cognito and Google credential metadata |
| `infra/aws/auth` production | `voice-checklist/auth/production.tfstate` | Existing production Cognito and Google credential metadata |
| `infra/aws/backend` development | `voice-checklist/backend/development.tfstate` | Development compute, roles, and logs |
| `infra/aws/backend` production | `voice-checklist/backend/production.tfstate` | Independent production configuration; no Lambda baseline yet |

All keys use the pre-existing private, versioned, encrypted bucket
`voice-checklist-tofu-state-use1-198771014193` with native S3 lock files. The
bucket is a documented dependency and is not managed by any root. See
[state ownership](docs/state-ownership.md) before changing infrastructure.

## Delivery

- Pull requests run Node and OpenTofu tests. Same-repository pull requests also
  assume a read-only OIDC role and generate real remote-state plans with
  `-lock=false`; forks receive no AWS credentials.
- `main` automatically replaces development with its exact artifact.
- A main-owned manual workflow accepts any trusted branch, tag, or full commit
  and applies only `infra/aws/backend` to the shared development state.
- Protected addresses must be present and have only no-op or in-place update
  actions. Persistent resources also require `lifecycle { destroy = false }`.
- Reconstructable deletes or replacements require the workflow's explicit
  destructive override. Creates do not, so a trusted branch can test a new
  backend service.
- Production has a protected GitHub environment and a scoped role, but this
  issue intentionally adds no production Lambda workflow.

Raw plans remain ephemeral and are never committed or uploaded. See
[deployment and rollback](docs/deployment.md) for artifact provenance and
verification details.

## Secrets

GitHub stores no AWS or third-party credentials. Actions use short-lived GitHub
OIDC sessions. Each independently authorized credential gets an
environment/purpose-scoped AWS Secrets Manager resource; unrelated credentials
are not bundled together.

The auth stack owns only metadata for these values:

- `voice-checklist/development/deployment/google-oauth`
- `voice-checklist/production/deployment/google-oauth`

Their values are seeded and rotated outside OpenTofu. The stack reads the
selected value during deployment because Cognito requires the Google secret in
its provider configuration. Future runtime secrets are passed to Lambda by ARN
or name and read by the execution role at runtime.

## License

This repository is available under the [MIT License](LICENSE).
