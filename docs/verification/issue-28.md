# Issue 28 verification

Verification date: 2026-08-23 UTC.

## Completed live checks

- The pre-existing state bucket has versioning, AES-256 server-side encryption,
  public-access blocking, and native lock-file configuration.
- Bootstrap plan: eight expected creates, no updates/replacements/deletes.
- Bootstrap apply: eight added, zero changed, zero destroyed.
- Bootstrap steady-state plan: no changes.
- Original app-location auth plan, development: no changes.
- Original app-location auth plan, production: no changes.
- Google OAuth values copied directly from encrypted state to environment-scoped
  Secrets Manager resources without printing or writing the values.
- New auth root imported only `aws_secretsmanager_secret.google_oauth` in each
  existing state. The only migration apply action in each environment was an
  in-place update of that new secret's metadata.
- New auth-location plan, development: no changes.
- New auth-location plan, production: no changes.
- Live development pool remains `us-east-1_06KAQuIlH` with clients
  `voice-checklist-development-android_debug` and
  `voice-checklist-development-web_localhost`; deletion protection remains
  inactive by design.
- Live production pool remains `us-east-1_YGvmEPUtl` with client
  `voice-checklist-production-android_play`; deletion protection is active.
- Both live Google IdP credentials exactly match their new Secrets Manager
  values. Existing callback URLs, code flow, Google-only provider selection,
  and public-client behavior remain intact.

No Cognito address was created, deleted, replaced, moved, or modified during
the transfer.

## Merge-gated checks

The repository owner requested that both pull requests stop before merge.
Consequently these validations can run only after the backend workflow exists
on the default branch:

- automatic harmless development deployment from `main`;
- protected manual replacement from a selected non-`main` ref;
- GitHub Actions artifact retention and GitHub Deployment provenance from those
  two paths.

They remain required before issue #28 can be closed.
