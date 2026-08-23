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
- One-time development backend bootstrap plan: five expected creates, no
  updates/replacements/deletes. The normal policy correctly rejected the log
  group's protected first-create before the explicitly authorized bootstrap.
- Non-main bootstrap artifact commit:
  `6c4c3c8fa7d359adab8a364d935785a5cac43c03`.
- Lambda zip SHA-256:
  `15b8390af3c74beafbaa7f97d0e21a738565358302aa12c7c193d60e0c950470`.
- Live development Lambda version 1 matches the commit and digest; the active
  alias matches both, direct invocation returns the health response, stable
  tags match, log retention is 30 days, and the execution-role boundary is
  attached.
- Development backend steady-state plan: policy accepted, no changes.

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
