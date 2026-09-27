# PowerSync authentication

The app continues to authenticate with Cognito authorization code + PKCE. When
the PowerSync SDK requests credentials, it sends the Cognito **access token** to
`POST /v1/powersync/credentials`. The backend:

1. verifies the Cognito RS256 signature, exact user-pool issuer and expiry;
2. requires `token_use=access` and one of the configured public app-client IDs;
3. derives the cloud account only from the verified `sub`;
4. checks `account_lifecycle`, then the retained `account_deletion_ledger` when
   ordinary lifecycle state is absent; and
5. returns the PowerSync endpoint and a subject-scoped RS256 JWT whose lifetime
   is exactly five minutes.

The public key is available at `GET /.well-known/jwks.json`. The private key is
never returned or logged. API mutations continue to use the Cognito access
token; the PowerSync credential is only for PowerSync download/reconnect.

## Lifecycle semantics

An unseen Cognito subject is a new active cloud account. Account deletion must
write `deleting` before destructive work begins. Once deletion completes, its
time-bounded deletion-ledger entry remains authoritative after ordinary account
state is removed. This prevents an unexpired Cognito token from recreating
cloud access after cleanup.

The mutation API and new PowerSync credential issuance stop at the lifecycle
fence. A PowerSync credential already accepted before that boundary can retain
cloud access until it expires, for at most five minutes. No server can remotely
erase a client's offline SQLite cache.

## Runtime secret

Development reads `/voice-checklist/development/runtime` as one SSM
`SecureString`. It is seeded outside OpenTofu and contains this JSON shape:

```json
{
  "mongodb": {
    "username": "<application database user>",
    "password": "<application database password>"
  },
  "powersync": {
    "privateJwk": {
      "kty": "RSA",
      "n": "<base64url modulus>",
      "e": "AQAB",
      "d": "<private exponent>",
      "p": "<first prime factor>",
      "q": "<second prime factor>",
      "dp": "<first CRT exponent>",
      "dq": "<second CRT exponent>",
      "qi": "<first CRT coefficient>"
    }
  }
}
```

The Lambda environment contains only public identifiers, a credential-free
MongoDB URI, and the SSM parameter name. The runtime role can read only that
exact parameter. The deployment workflow verifies that the parameter exists
by exercising the new Lambda version's public JWKS route; the deployment role
cannot read the parameter itself.

### Signing-key rotation

The optional `powersync.additionalPublicJwks` array contains retiring or staged
public RS256 keys. Every entry must have a unique `kid`, and private members are
rejected. The active public key is always derived from `privateJwk` and
`POWERSYNC_JWT_KID`; if the private JWK already has a `kid`, it must match.

Rotate without invalidating five-minute credentials:

1. Add the next key's public JWK to `additionalPublicJwks`, deploy a new Lambda
   version pinned to that SSM parameter version, and verify both key IDs appear
   in public JWKS.
2. Replace `privateJwk` with the next private JWK, change
   `POWERSYNC_JWT_KID`, and replace `additionalPublicJwks` with the outgoing
   key's public JWK (remove the newly promoted key from that array). Deploy again
   with the new SSM parameter version.
3. After the old credential lifetime plus the five-minute JWKS cache has elapsed,
   remove the old public JWK and deploy once more with the final parameter version.

Each rotation change records the numeric `runtime_secret_version` beside
`POWERSYNC_JWT_KID` in the reviewed Development tfvars. The deployment role has
no permission to read the secret; the Lambda runtime requests only that exact
version. Cold starts therefore cannot mix an old key ID with the latest secret.
For a verified rollback, dispatch the original version-pinned commit, which
carries its original version; the deployment workflow rejects pre-pinning
commits before apply. Retain those SSM revisions for the rollback window. Never
reuse a `kid` for different key material.

## Atlas Free networking

Atlas Free does not support private endpoints or VPC peering. A Lambda without
a stable NAT egress address therefore requires the Atlas project access list to
allow `0.0.0.0/0`; Atlas still requires TLS and the restricted database user's
credentials. This network exception must be an explicit Development deployment
decision. A paid dedicated Atlas cluster plus private networking, or paid AWS
fixed egress, removes it.
