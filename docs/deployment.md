# Deployment and rollback

## Pull-request plans

`infrastructure-plan.yml` runs only when the pull request head belongs to this
repository and the repository owner approves its `infrastructure-plan`
environment. The AWS role independently restricts assumption to that immutable
owner ID. The workflow checks out the candidate separately from the current
base branch's trusted policy implementation and manifests. The first
repository-bootstrap PR falls back to its candidate policy because the minimal
base predates the policy; after that merge, selected code cannot weaken the
main-owned guard.

The plan role can read only the four environment state objects, the two Google
deployment secrets, and provider metadata needed for refresh. Plans use
`-lock=false`, emit no state mutation, upload no plan file, and print only the
accepted stack/environment or protected-address violation.

## Development deployment

`deploy-development.yml` runs automatically for `main` and manually for a
selected trusted ref. The workflow definition and policy come from `main`; the
application artifact and backend configuration come from the selected commit.
The workflow:

1. resolves the ref to a full 40-character commit;
2. runs the complete Node test/build suite;
3. creates one Lambda zip and records its hexadecimal and base64 SHA-256;
4. uploads that exact zip as a GitHub Actions artifact for 90 days;
5. creates a GitHub Deployment tied to the selected commit and artifact ID;
6. generates one saved plan under `/tmp`, applies the exact saved plan, and
   discards it with the runner;
7. verifies Lambda `CodeSha256`, the published version description, the active
   alias commit/artifact description, and a live invocation;
8. marks the GitHub Deployment successful or failed.

The Lambda function carries stable `Application`, `Environment`, `ManagedBy`,
and `Repository` tags. Published versions inherit a description containing the
selected commit and GitHub Deployment URL. The `active` alias description
contains the commit and Lambda zip digest.

## Destructive changes

Persistent resource delete, replace, forget, missing, and first-create actions
always fail once an address is in the main manifest. The deployment permissions
boundary also denies deletion of Cognito, tables, queues, Secrets Manager
secrets, log groups, KMS keys, databases, and environment-prefixed S3 data.

Reconstructable compute or configuration can be deleted or replaced only when
a manual selected-ref run explicitly enables `allow_reconstructable_destroy`.

## Rollback

Before the first production `/v1` release, rollback evidence is limited to
development Lambda versions because this issue creates no production Lambda.
To roll back development, select a previously verified Git commit and rebuild
its artifact deterministically through the main-owned workflow. Never move the
alias to an unverified version by hand.

GitHub Actions artifacts expire after 90 days. An expired artifact is not a
promotion candidate: rebuild from the selected commit, deploy it to development,
and repeat digest and live-invocation verification before any later promotion.

Issue #29 establishes the first production runtime baseline. Issue #32 owns
post-baseline breaking-contract and previous-client compatibility enforcement.
