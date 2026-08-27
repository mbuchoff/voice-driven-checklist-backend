# Repository guidance

- Use Node.js 24, npm, TypeScript, Vitest, and OpenTofu 1.12.5.
- Follow test-driven development for behavior and infrastructure policy changes.
- Never commit or print secret values, raw OpenTofu state, or saved plans.
- This repository exclusively owns the existing auth states at `voice-checklist/auth/development.tfstate` and `voice-checklist/auth/production.tfstate`.
- Preserve the existing Cognito resource addresses in `infra/aws/auth`; pool and app-client replacements require an explicit issue-specific decision.
- The S3 state bucket `voice-checklist-tofu-state-use1-198771014193` is a pre-existing dependency, not a managed resource.
- `infra/aws/bootstrap` is manual-only. Selected branch deployment may apply only `infra/aws/backend` development state.
- Persistent resources must be added to the relevant `infra/policy/*.json` manifest after their initial reviewed creation and must declare `lifecycle { destroy = false }`.
- Persistent means identity or data that cannot be reconstructed safely, including pools and app client IDs, databases, queues, buckets and their contents, secrets, subscriber registries, and log groups.
- Production has no Lambda baseline or deployment workflow until the first `/v1` contract exists.
- Never merge a pull request without the user's explicit instruction.
