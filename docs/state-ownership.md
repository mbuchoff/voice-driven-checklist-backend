# State ownership

The backend repository is the only configuration allowed to apply the Voice
Checklist AWS authentication and backend states. The app repository consumes
public Cognito outputs but does not own or apply AWS infrastructure.

## State layout

All state is in AWS account `198771014193`, Region `us-east-1`, bucket
`voice-checklist-tofu-state-use1-198771014193`.

| State key | Root | Mutation path |
| --- | --- | --- |
| `voice-checklist/bootstrap.tfstate` | `infra/aws/bootstrap` | Local, manual, explicitly reviewed only |
| `voice-checklist/auth/development.tfstate` | `infra/aws/auth` | Local migration/operator path; PR plans are read-only |
| `voice-checklist/auth/production.tfstate` | `infra/aws/auth` | Protected production operator path; PR plans are read-only |
| `voice-checklist/backend/development.tfstate` | `infra/aws/backend` | Automatic `main` or protected selected-ref workflow |
| `voice-checklist/backend/production.tfstate` | `infra/aws/backend` | Reserved; no production runtime workflow |

The bucket has versioning, server-side encryption, public-access blocking, and
native `.tflock` locking. It predates this repository and must not be imported
into a root. Bootstrap and application roles cannot delete the state objects.

## Cognito transfer invariant

The auth root deliberately keeps these resource addresses unchanged:

- `aws_cognito_user_pool.auth`
- `aws_cognito_identity_provider.google`
- `aws_cognito_user_pool_domain.auth`
- `aws_cognito_user_pool_client.app["android_debug"]`
- `aws_cognito_user_pool_client.app["web_localhost"]`
- `aws_cognito_user_pool_client.app["android_play"]`
- matching `aws_cognito_managed_login_branding.app` instances

The separate development and production state lineages remain in their
original keys. No state copy or `moved` block is necessary because only the
repository location changed.

The pool, app-client block, and Google credential metadata declare OpenTofu
`destroy = false`. Production also uses Cognito user-pool deletion protection.
The manifests under `infra/policy/` independently fail when a protected plan
address is missing, created, deleted, replaced, forgotten, or loses its
lifecycle guard.

## Adding a persistent resource

1. Introduce and review it without placing its address in the protected plan
   manifest; otherwise its first create correctly fails closed.
2. Create it through the guarded environment role.
3. Add its instance address and resource-block address to the environment
   manifest immediately after the reviewed creation.
4. Confirm the next plan is no-op or update-only for that address.

Do not use this sequence to replace an already protected address. The manifest
from `main`, not a selected branch, is the deployment authority.
