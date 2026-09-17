# Deployment and rollback

## Pull-request plans

`infrastructure-plan.yml` publishes the required `plan` check for every pull
request. Its credential-bearing `plan-infrastructure` job runs only when the pull
request head belongs to this repository and the repository owner approves its
`infrastructure-plan` environment. The AWS role independently restricts assumption to that immutable
owner ID. The workflow checks out the candidate separately from the current
`main` branch's trusted policy implementation and manifests. PR #1 alone falls
back to its candidate policy because the minimal `main` branch predates the
policy; every later pull request fails closed when `main` lacks the policy.
Candidate build and plan commands finish before the trusted checkout occurs.

The plan role can read only the four environment state objects, the two Google
deployment secrets, and provider metadata needed for refresh. Plans use
`-lock=false`, emit no state mutation, upload no plan file, and print only the
accepted stack/environment or protected-address violation.

The final `plan` job runs even when infrastructure validation fails, is cancelled,
or is skipped; only a successful validation passes. It has no checkout, environment
or token permissions. Fork PRs therefore cannot satisfy the required check by
skipping AWS work. Review a fork contribution and bring it onto a trusted branch
before running infrastructure validation; do not give forks OIDC access or switch
this workflow to `pull_request_target`.

### Main protection

The reviewed REST payload is [main.ruleset.json](../infra/github/main.ruleset.json).
It requires a PR and current, up-to-date `test` and `plan` checks from the GitHub
Actions integration (app ID 15368), blocks force pushes/deletion, and has no bypass
actors. No human PR approval is required. The existing owner approval for the
AWS-bearing `infrastructure-plan` environment is a separate credential-release
gate, not a PR review requirement; the owner can approve their own run. Never add
a review gate that the repository's sole owner cannot satisfy.

The payload is not applied by a workflow. After explicit ruleset authorization:

1. Re-read current rulesets and main protection. On 2026-09-08 there were no
   rulesets; stop and reconcile if another policy now exists rather than adding
   duplicates or overwriting it.
2. Ensure the fail-closed `plan` wrapper is present in the candidate and main, and
   check actual PR check names and GitHub App IDs. A skipped or neutral required
   check is accepted by GitHub, so the old skipped job is not sufficient.
3. Apply the reviewed payload to `repos/mbuchoff/voice-driven-checklist-backend/rulesets`
   (POST for first creation; PUT to the reviewed rule ID for an update), then
   read back the rule and effective main rules.
4. Verify with an authorized disposable PR: red `test` or `plan` blocks merge,
   skipped infrastructure work produces a failed `plan`, success on an up-to-date
   candidate satisfies checks, and no bypass actor is configured. Observe merge
   eligibility; do not merge, force-push, or delete main as a test.

Applying the ruleset before its workflow is available leaves the old skipped-check
gap; uploading this JSON alone does not enforce anything. Post-merge `deploy` must
not be a required PR check. Ruleset changes never authorize a merge.

References: [GitHub required checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging)
and [ruleset API](https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset).

### Deployment-role refresh permissions

Development run [33067430555](https://github.com/mbuchoff/voice-driven-checklist-backend/actions/runs/33067430555)
failed because the AWS provider calls `iam:ListAttachedRolePolicies` when refreshing
the runtime role, including a role with no managed-policy attachments. The manual
bootstrap root supplies that read action only on each environment's runtime-role
ARN pattern. Its shared action list covers both development and production deploy
roles. No runtime permission, trust-policy, boundary, or resource scope is widened.

The PR plan role already permits `iam:Get*`/`iam:List*`, whereas deployment roles
use an explicit action list. A green PR plan therefore does not prove deployment
permissions. The regression test evaluates the actual bootstrap-generated policies;
it does not simulate effective AWS permissions or replace a deployed verification.

Review a fresh manual bootstrap plan and obtain approval for its exact changes
before apply, including the production deploy-role policy update. Do not run a
bootstrap apply from GitHub or bypass review with an ad-hoc IAM patch. After apply,
verify the intended role policies and run the approved development workflow from
main and a selected immutable ref, retaining its existing artifact/alias/live
invocation evidence. If another permission fails, investigate that exact failure;
do not infer a broad grant from this fix. Until those runs pass, GH-28 foundation
repair and the GH-29 runtime gate remain incomplete.

## Development deployment

`deploy-development.yml` runs automatically for `main` and manually for a
selected trusted ref. Always dispatch the manual workflow from `main`; choose
the deployed branch, tag, or commit with the `ref` input. The workflow
definition and policy come from `main`; the application artifact and backend
configuration come from the selected commit. A selected ref is trusted
executable infrastructure code. Its saved plan is checked only after the
main-owned policy checkout, while the AWS boundary independently denies
persistent-resource deletion. The development environment has no reviewer gate
so automatic `main` deployment is not blocked. The workflow:

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
