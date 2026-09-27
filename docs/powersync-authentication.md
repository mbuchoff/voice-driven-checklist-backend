# PowerSync authentication

The app continues to authenticate with Cognito authorization code + PKCE. When
the PowerSync SDK requests credentials, it sends the Cognito **access token** to
`POST /v1/powersync/credentials`. The backend:

1. verifies the Cognito RS256 signature, exact user-pool issuer, expiry and
   issued-at age;
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
      "d": "<private exponent and remaining private RSA fields>"
    }
  }
}
```

The Lambda environment contains only public identifiers, a credential-free
MongoDB URI, and the SSM parameter name. The runtime role can read only that
exact parameter. The deployment workflow verifies that the parameter exists
without printing its value.

## Atlas Free networking

Atlas Free does not support private endpoints or VPC peering. A Lambda without
a stable NAT egress address therefore requires the Atlas project access list to
allow `0.0.0.0/0`; Atlas still requires TLS and the restricted database user's
credentials. This network exception must be an explicit Development deployment
decision. A paid dedicated Atlas cluster plus private networking, or paid AWS
fixed egress, removes it.
