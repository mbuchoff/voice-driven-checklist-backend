# MongoDB + PowerSync local integration proof

This is an isolated GH-29 feasibility test, not the checklist API implementation
and not a deployable authentication service. The existing Lambda, Cognito
configuration and app databases are unchanged.

The companion Expo client lives in
`voice-driven-checklist/spikes/powersync` in the same ticket workspace.

## What runs

- MongoDB 8.0.13, a single-node local replica set on loopback port 27018.
- PowerSync Service 1.26.0 on port 8011, using its real MongoDB connector and
  `post_images: read_only`. Startup explicitly enables post-images on the source
  collection. Missing post-images must fail; do not turn them off to pass a test.
- A local-only upload API on port 8012. A checklist is one MongoDB document;
  its nested content is projected into SQLite as JSON text.
- Synthetic Alice/Bob identities with short-lived, locally signed JWTs. The
  fixture issuer deliberately permits choosing either identity, so this does
  **not** prove Cognito sign-in or authorize use with real accounts. Production
  remains Cognito-access-token-only.

MongoDB binds only to container loopback. The API and PowerSync share the
devcontainer network namespace so the existing host-loopback port mappings can
be used without mounting Mac-incompatible container paths. No cloud services or
paid subscriptions are created.

## Run inside the devcontainer

Use Node.js 24 and run these commands in this directory. First inspect the live
devcontainer mappings and listeners; 8011, 8012 and frontend 4014 must be
published and unused. If they are occupied, reconcile all port references
before starting; do not replace another task's service.

```bash
docker inspect "$(hostname)" --format '{{json .NetworkSettings.Ports}}'
ss -ltnp
export SPIKE_NETWORK_CONTAINER="$(hostname)"
npm ci
docker compose up -d mongo
docker compose exec -T mongo mongosh --quiet --port 27018 --eval \
  'try { rs.status() } catch(e) { if(e.code === 94) rs.initiate({_id:"gh29",members:[{_id:0,host:"127.0.0.1:27018"}]}); else throw e; }'
SPIKE_LOCAL_ONLY=1 npm start
```

Once the API reports that it is listening, use another terminal in this
directory:

```bash
export SPIKE_NETWORK_CONTAINER="$(hostname)"
docker compose up -d --build powersync
npm test
npm run typecheck
```

The eleven API integration tests use the real HTTP server and a randomly named
scratch MongoDB database. Six additional source-capability probes use the real
MongoDB driver and a separate randomly named scratch database. Each suite removes
only its own fixtures afterwards. Neither resets the interactive proof's
`checklist_proof` database. Eleven target-selection checks ensure ordinary runs
stay local and hosted runs require an explicit matching Atlas hostname.

### Source capability preflight

With only the local MongoDB replica set running, execute `npm run test:source`.
No fixture API, PowerSync service or browser is needed for this **source-only**
probe. It exercises:

- Owner-scoped compound uniqueness, including the same checklist UUID for two
  owners and rejection of a duplicate within one owner.
- Cross-collection transactions: document and counter invisible before commit,
  both visible afterwards, and neither retained after abort.
- Database-level change streams with `fullDocument: required`: insert, replacement,
  successive partial updates, deletion, and resume after a saved event. Events are
  consumed after deletion to distinguish exact historical post-images from a
  lookup of the document's current state. The fixture includes stable item IDs,
  order, empty arrays and Unicode; it does not include checklist-run progress.
- Failure when a collection lacks required post-images, without a fallback mode.
- Checkpoint-record create/update/read/delete operations.

The default target is the local replica set, even when MongoDB credentials are
present. A hosted run needs separate target, credential, mutation/cleanup and tier
approval first. After obtaining it, use Node 24 from this directory:

```bash
GH29_SOURCE_PROBE_TARGET=atlas \
GH29_SOURCE_PROBE_EXPECTED_HOST='<approved-host>.mongodb.net' \
node --env-file=../../../atlas-credentials.env node_modules/vitest/vitest.mjs \
  run tests/source-capabilities.test.ts --reporter=verbose --silent=false
```

The credential file must contain `MONGODB_URI`, `MONGODB_USERNAME` and
`MONGODB_PASSWORD`. Keep it outside Git with owner-only permissions; do not paste
credential values into shell commands or logs. The probe extracts only the
approved SRV hostname from the URI, uses separate credentials and TLS, and ignores
the URI's database and other options. It creates a new `gh29_source_probe_` database
with an 80-bit random suffix fitting Atlas Free's 38-byte name limit. Cleanup
drops only collections successfully created by that run and verifies none remain.
Verbose output records the non-secret target/version/region and fixture cleanup.

Passing locally does **not** establish Atlas Free compatibility. Passing on Atlas
with an administrator credential does **not** establish restricted connector-role
permissions, PowerSync replication, canonicalization, quota correctness or
lifecycle fencing. These are prerequisites to test through the actual hosted
connector/client path, not a replacement for that path. No production contract
is defined by the fixture. Existing fixture API tests still target only local
MongoDB; this command runs the source probes, not a hosted API or client E2E suite.

### Atlas application-user access

`tests/atlas-app-access.test.ts` is skipped unless `GH29_ATLAS_APP_ACCESS=1`.
It targets only the approved `VoiceChecklist` cluster and `voice_checklist_dev`
database using the dedicated `voice_checklist_app_dev` credential. Obtain explicit
approval for its temporary writes/cleanup before running it:

```bash
GH29_ATLAS_APP_ACCESS=1 \
GH29_SOURCE_PROBE_TARGET=atlas \
GH29_SOURCE_PROBE_EXPECTED_HOST=voicechecklist.0hbva2h.mongodb.net \
node --env-file=../../../atlas-app-dev.env node_modules/vitest/vitest.mjs \
  run tests/atlas-app-access.test.ts --reporter=verbose --silent=false
```

The owner-only credential file is outside both Git repositories. It includes
`MONGODB_DATABASE=voice_checklist_dev` in addition to the three connection fields
above. Never use the original admin credential for this suite. Do not run the
admin-only source-capability suite with this database-scoped user.

Five live checks cover the effective database role, document CRUD and compound
uniqueness, transaction commit/abort, rejected reads of another database, and
rejected `collMod` collection administration. Atlas reports these authorization
denials as `AtlasError` / 8000; the tests require the denied-action message too,
so an unrelated Atlas error cannot satisfy the security assertions. Only the
two randomly named collections successfully created by the suite are dropped.
Cleanup uses an unfiltered collection listing because Atlas Free rejected the
`$in` name filter. No permanent schema, app deployment or PowerSync user is created
by these tests. Built-in `readWrite` is database-scoped, not collection-level or
CRUD-only; finer runtime privileges remain a production-schema decision.

`tests/atlas-sync-access.test.ts` separately verifies the dedicated source user.
It is skipped unless explicitly enabled and uses the owner-only
`../../../atlas-sync-dev.env` credential. Run only with approval for its temporary
Atlas writes and cleanup:

```bash
GH29_ATLAS_SYNC_ACCESS=1 \
GH29_SOURCE_PROBE_TARGET=atlas \
GH29_SOURCE_PROBE_EXPECTED_HOST=voicechecklist.0hbva2h.mongodb.net \
node --env-file=../../../atlas-sync-dev.env node_modules/vitest/vitest.mjs \
  run tests/atlas-sync-access.test.ts --reporter=verbose --silent=false
```

The suite creates a random source collection with post-images enabled by the
separate admin credential, then proves the sync user can read exact insert/update
events through a database change stream. It also exercises its own checkpoint
collection and rejects source writes and unrelated-database reads. It drops only
its two generated collections. This checks the connector credential's MongoDB
primitives; it does not prove a hosted PowerSync connection or client sync.

`GET /health` reports the local fixture mode. `GET /dev/session?account=alice`
or `bob` returns a fixture token; never log token responses. `GET /jwks`
provides only the public verification key. Authenticated `PUT /checklists/{uuid}`
accepts `{ "content": "<JSON checklist>" }`, commits before acknowledging, and
derives ownership exclusively from the verified token.

## Rebuild derived sync state without deleting the source

Stop only this proof's PowerSync container. Keep MongoDB and the API running,
pause one client and make a local edit. Restart PowerSync with a **new unused**
storage database name (the source URI remains unchanged):

```bash
docker compose stop powersync
PS_PROOF_STORAGE_URI='mongodb://127.0.0.1:27018/powersync_proof_rebuild_example?replicaSet=gh29' \
  docker compose up -d --build powersync
```

Resume the client and verify the second client receives the queued edit, the
checklist UUID is unchanged, and Bob still receives no Alice data. Both the old
derived storage and source documents are retained. This is a local test of
reprocessing, **not evidence of PowerSync Cloud reactivation or Atlas Free
compatibility**.

## Stop

Stop the fixture API with Ctrl-C in its terminal, then:

```bash
docker compose stop
```

The named MongoDB volume is retained. Do not use `down --volumes` unless you
intend to delete this proof's stored synthetic data.

## Deliberately outside this proof

No production retry high-water marks, tombstones/restoration generations,
account deletion, quotas, generated public API contract, Cognito integration,
database-restore reconciliation, or app-data migration are implemented. In
particular a very old retried write can still overwrite newer content; this
fixture's latest-arrival replacement is not the final mutation protocol.

Official references:
[MongoDB source and post-images](https://docs.powersync.com/configuration/source-db/setup#post-images),
[PowerSync self-host examples](https://github.com/powersync-ja/self-host-demo),
[Cloud inactivity/reactivation](https://docs.powersync.com/resources/usage-and-billing#inactive-instances).
