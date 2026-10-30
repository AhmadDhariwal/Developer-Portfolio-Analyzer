# Profile/B2 operator runbook

Prepared configuration only. Do not apply to production without the approved deployment/secret change. No Redis admission fallback is allowed.

## Replace application keys through authorized secret management

Runtime requires exactly `readFiles`, `writeFiles`, `listFiles`, `deleteFiles`. GET/HEAD use readFiles; PUT uses writeFiles; ListObjectVersions uses listFiles; concrete-version DELETE uses deleteFiles. Object SSE-B2 does not require bucket-encryption write privileges.

Create **two single-bucket non-master keys** using the Backblaze operator console or Native API v4 `b2_create_key`. Use the operator's separately authorized administrative session, never an application key embedded in a script. These are reviewable payload templates, not executed commands:

```json
{
  "accountId": "<operator account ID>",
  "keyName": "devinsight-images-runtime",
  "bucketIds": ["<existing images bucket ID>"],
  "namePrefix": "v1/",
  "capabilities": ["readFiles", "writeFiles", "listFiles", "deleteFiles"]
}
```

For the second key use `keyName=devinsight-resumes-runtime`, only the existing résumé bucket ID, `namePrefix=v1/resumes/`, and the same four capabilities. Images need the common `v1/` prefix because one application key cannot express both `v1/avatars/` and `v1/portfolio-images/`; the application independently enforces kind/bucket/owner/key syntax. Confirm all ledger keys are within these prefixes before switching. Do not add broad scope to accommodate an unexpected key.

Omit `shareFiles`, `listAllBucketNames`, all key-management capabilities, all bucket writes/deletes, replication/logging/notification/lifecycle writes, retention writes, legal-hold writes and `bypassGovernance`. Runtime does not need bucket metadata/list-buckets capabilities. For a separate operator read-only audit, use scoped `listBuckets`, `readBuckets`, `readBucketEncryption`, `readBucketRetentions` and any documented read-only lifecycle capability needed by the console. Do not add audit privileges to runtime solely to satisfy the optional auditor: it reports metadata unavailable when permissions are absent.

1. Confirm both existing buckets remain private, defaults are SSE-B2/AES256, and endpoint/region match. Record lifecycle/Object Lock/default retention outside the application; retained versions may legitimately prevent deletion. Never grant governance bypass to make cleanup pass.
2. Create the two replacement keys after approval. Store each one-time secret directly in the approved secret manager. Do not paste it into CLI arguments, reports, chat, screenshots, Git or shell history.
3. Update the four backend secret slots `B2_IMAGES_KEY_ID`, `B2_IMAGES_APPLICATION_KEY`, `B2_RESUMES_KEY_ID`, `B2_RESUMES_APPLICATION_KEY` through the approved change. Leave bucket names/endpoints/regions unchanged. Roll all API and cleanup workers together so stale processes do not retain old keys.
4. Validate both authorized scopes via Native authorization. Run bounded staging fixture PUT/GET/HEAD/ListObjectVersions/DELETE and cross-bucket denial only after approval. Profile/Portfolio admission now uses MongoDB and does not require Redis; direct adapter and authenticated HTTP evidence remain separate. Preserve every existing key/object. The prior direct verifier requires metadata privileges during preflight; use the separate operator audit or approved split preflight for minimal runtime keys rather than broadening them.
5. Verify older managed objects remain readable with replacement credentials, including version-pinned reads, using approved non-sensitive fixtures. Keep the old secret rollback version available only to the authorized operator during the rollout window. Revoke old keys only after all processes have changed and verification passes. Revocation/secret changes were not performed by this task.

Provider documentation: [capabilities and S3 operations](https://www.backblaze.com/docs/cloud-storage-s3-compatible-app-keys), [v4 key creation](https://www.backblaze.com/apidocs/b2-create-key), [authorization scopes](https://www.backblaze.com/apidocs/b2-authorize-account), [bucket retention/encryption metadata](https://www.backblaze.com/apidocs/b2-list-buckets).

## B2 activation checklist

- Required configuration: `STORAGE_DRIVER=b2`; separate `B2_IMAGES_BUCKET`, `B2_IMAGES_REGION`, `B2_IMAGES_ENDPOINT`, `B2_IMAGES_KEY_ID`, `B2_IMAGES_APPLICATION_KEY`; matching `B2_RESUMES_*` fields. Endpoint is exactly `https://s3.<region>.backblazeb2.com`, without a trailing slash. No master key, repeated key pair, shared bucket or incomplete configuration.
- `node backend/src/scripts/auditB2Security.js` performs offline configuration validation from local `.env`, including an in-memory b2 activation check; it does not change it. `--live` adds four bounded read-only provider calls and prints only sanitized results. `B2_SECURITY_OUTPUT` optionally retains its JSON. Runtime keys may not have optional metadata privileges; private-policy/retention auditing remains separate operator work.
- Startup validates B2 before loading routes/reporting environment success. Invalid B2 configuration fails startup; unavailable B2 writes do not fall back to disk. Startup logs no JWT secret fragments. Do not enable a storage or infrastructure outage fallback.
- Configure a strong shared `JWT_SECRET`, issuer/audience and `NODE_ENV=production`. Use the existing `SECURITY_STRICT_ENV=true` gate. Synchronize all workers, including cleanup. This task does not rotate the existing JWT secret or change session lifetimes.
- Keep `PUBLIC_IMAGE_STORAGE_ROOT` pointing to the original persistent legacy image root. Mount the original résumé paths on every required worker. Validate ownership, permissions and backups before any path change. No historical file should be moved/deleted as part of activation.
- Keep all B2 reader variables during a write rollback to `filesystem`. Existing B2 references still need the ledger and credentials. Existing filesystem references remain authoritative until a separate copy/hash/CAS migration is verified.
- Do not switch the live driver until Mongo admission/storage indexes are provisioned, all old Redis-authoritative Profile workers are drained, proxy/cookie deployment is verified and cleanup scheduling is approved. Redis remains required by unchanged modules that use it. No production `.env` was changed here.

## Explicit additive Mongo provisioning

The command never loads `.env`, never infers `MONGODB_URI` and never deletes/rebuilds indexes or records. It creates only `storedassets` and `accountdeletioncleanups`, plus declared additive indexes; a conflict fails safely and requires operator review. Both collections must have no TTL. Transactions require replica/sharded topology.

Set maintenance URI and database through protected process environment, not inline secrets. The database must be reviewed independently. Inspect before apply:

```powershell
# STORAGE_MAINTENANCE_MONGO_URI and STORAGE_MAINTENANCE_DATABASE supplied securely.
node backend/src/scripts/provisionStorageCollections.js
# Only after the exact target is authorized as staging:
$env:STORAGE_MAINTENANCE_ENV='staging'
$env:STORAGE_MAINTENANCE_ACK='authorized-staging-target'
node backend/src/scripts/provisionStorageCollections.js --apply
```

The environment/acknowledgement is an operator assertion of prior staging authorization, not permission to label production as staging. This task applied only to generated `profile_b2_security_<24 hex>` databases on loopback port 27141. Production application still uses its existing connection settings. For production provisioning, a separate approved change is required.

Expected declared indexes: `storedassets.reference` unique, `storedassets.ownerId`, `storedassets.(state,retryAfter,expiresAt)`; `accountdeletioncleanups._id` identity and `(retryAfter,createdAt,_id)` retry selection. Older safe indexes remain; no syncIndexes/drop is used. Existing account receipts without retry fields are immediately eligible and backward compatible. New failed account attempts persist a one-minute retryAfter and cleanupAttempts; no TTL discards failed work.

## Cleanup scheduling and monitoring

Both existing commands use the same runner:

```powershell
# Approved worker environment must supply Mongo/B2 and original legacy roots.
node backend/src/scripts/retryStorageCleanup.js
# Backward-compatible operational alias (do not schedule both):
node backend/src/scripts/retryAccountDeletionCleanup.js
```

Each run performs at most 50 provider receipt attempts total, then at most 50 due account receipts. Account processing uses `deferObjects:true`, preventing another provider batch per account. An individual object/account failure retains evidence and does not stop unrelated due accounts; account retry selection/backoff is durable. The worker refuses missing collections, declared indexes or unsafe TTLs before cleanup and disables automatic collection/index creation. The process exits nonzero on partial failure and logs a sanitized JSON batch summary with duration, failed count, selected-account age and processed counts. A null object count means that batch failed; do not interpret it as zero attempted objects.

Cleanup deletes only generated managed keys referenced by durable receipts or files belonging to an existing explicit account-deletion receipt. **Do not run cleanup against production as an acceptance test.** Deploying the worker later executes already authorized account deletion work; operator approval of the deployment/environment is required. The test suite uses fixture adapters and task-owned files only.

Review `backend/deployment/storage/devinsight-storage-cleanup.service.example`, `devinsight-storage-cleanup.timer.example` and `nginx-storage.conf.example` against actual Linux paths, identity, proxy hop, TLS virtual host and protected secrets. Validate with `systemd-analyze verify` and `nginx -t` on the intended staging host; these local templates have not been installed or host-validated. Install only one timer/one designated maintenance worker for the shared ledger; do not schedule the alias separately. A oneshot service cannot overlap itself. A single designated worker avoids simultaneous duplicate provider requests; transactional owner fences and concrete version deletion retain correctness/retryability if processes overlap or die. Do not claim a distributed scheduler lease exists.

The timer runs once per minute after the preceding invocation finishes. Timeout interruption can leave an operation uncertain; its receipt survives for retry. Unknown-version empty listings require operator reconciliation; never discard them just because a key currently lists empty. Exact-version deletion may be blocked by retention/holds; retain the receipt and alert rather than changing policy or bypassing governance.

Alert on every nonzero exit/summary failure, sustained full batches, growing cleanupAttempts, oldest pending account/object receipt age, stale uploading receipts and unknown-version outcomes. Review pending work with bounded indexed queries against the approved ledger; never log filenames/URLs/private owner data in general metrics. For a fresh receipt, alert if it remains pending beyond 15 minutes (initial operational threshold; tune from measured service objectives). Confirm worker logs/alerts, recovery after restart, secret reload and legacy-volume access in staging before production. No supervisor, schedule, dashboard or alert destination was installed by this task.

## Transport, cookies and privacy

Use one HTTPS browser origin for `/api` and `/uploads`. The supplied nginx snippet is a template inside an already approved TLS server; certificates, domain, API port, service identity, body limits, log retention and legacy roots require operator review. Keep the Node port on loopback/private networking; overwrite forwarded headers at the trusted edge. The current app has no Express trust-proxy setting, so req.ip sees its direct peer: behind a proxy this can collapse IP quotas to the proxy address. Use exactly one verified forwarding strategy/hop/CIDR via a separately reviewed deployment change; never set blanket `trust proxy=true` for an Internet-reachable app or trust client-supplied X-Forwarded-For. This task does not change global API/IP behavior without topology evidence.

Secure, HttpOnly, SameSite=Lax `/uploads` media cookies are issued in production, with a separate JWT audience and 20-minute expiry. Current persisted account/session revision is checked on each private managed read. API bearer JWTs cannot substitute for media cookies. Password rotation renews the current credential and invalidates old revisions. Local-only logout retains the previously documented capability-expiry limitation; immediate server logout revocation needs an approved product/security decision.

The existing Express CORS policy allows wildcard noncredentialed API CORS. It does not allow credentialed cross-origin cookie reads; bearer authorization and owner checks still apply. Same-origin deployment avoids changing that API contract. Do not add wildcard credentialed CORS or expose B2 origins/signed URLs. A cross-origin credentialed frontend would require an exact allowlist and explicit client changes; it is not accepted here.

Keep protected managed responses `private,no-store`, `Vary: Cookie`, nosniff and authorization/publication checks before bytes. Proxy `/uploads` through Node; never alias B2 or a disk root publicly to bypass authorization. Disable CDN/proxy caches for protected routes and preserve Set-Cookie. Static legacy images keep their historical public-by-URL semantics; private PDFs are denied on the static route. Revocation cannot retract downloaded copies. Real deployed HTTPS/HSTS/cookie/no-store behavior remains a deployment gate.

## Profile admission rollout and recovery

Profile and Portfolio upload/contact quotas use MongoDB `integrationgovernancestates` as their single authority. Redis is optional for these paths and remains in use only by unchanged modules. Never serve one Profile quota from both old Redis and new Mongo workers: split counters permit extra allowances.

Before enabling the candidate, provision and inspect Mongo indexes using the explicit maintenance target procedure above. Stop and drain every old Profile worker before any Mongo-admission worker accepts traffic. Retain the old build and Redis counters for rollback; deploy all API workers and the cleanup worker with the same Mongo generation. Verify transaction topology, majority writes, 429/Retry-After, and 503 on Mongo admission failure. Do not reset either store. For rollback, drain all Mongo workers before returning traffic to the old Redis build, and account for consumed Mongo quota until the longest affected window expires. Keep traffic on one authority throughout handover.

Mongo/index/capacity failure is fail-closed (503); genuine quota denial remains 429. Redis outage alone must not stop migrated Profile uploads/contact. Unchanged Redis-governed modules retain their own Redis requirements. Use bounded staging requests and generated identities only; do not send contact mail or alter production quotas for testing.

Local evidence confirms Mongo authority under Redis-unavailable fixtures, independent processes, shared quotas, restarts and concurrent boundaries. It does not certify the configured production Mongo target, fleet drain, Atlas durability/capacity/monitoring, IP proxy topology or rollback execution. Those remain operator gates.

Do not retry the exhausted service repeatedly, raise quotas, remove limits or introduce memory/Mongo fallback. Wait for the existing quota window to recover or have the authorized service owner resolve the provider condition through an approved operational change. No such change was performed here.

After health is restored, use a short staging verification window:

1. Run `node backend/src/scripts/checkRedisConnection.js` (read-only PING). PING alone is insufficient: previous PING/GET worked while Lua was rejected.
2. Supply the existing operations verifier a dedicated output folder via `PROFILE_B2_LIVE_OUTPUT`, then run `node backend/src/scripts/verifyProfileB2Operations.js`. It reads configured Mongo metadata and uses only two random limiter identities. Three fresh processes must share ten upload admissions, deny the eleventh with 429/Retry-After, and admit the other owner. It removes or verifies absence of only its generated counters. Inspect explicit result fields rather than treating process exit zero as acceptance.
3. Use disposable authenticated staging accounts to exercise actual upload/contact middleware and existing APIs. Verify two account identities remain isolated and publication revocation is immediate for protected media/PDF responses. Test avatar/portfolio/PDF upload with tiny fixtures and clean only those fixtures using durable receipts.
4. Verify an unavailable-client fixture still returns 503 before file/provider/transaction mutations. Do not disable production Redis or consume contact/mail quotas against real recipients. The focused fixture test already covers upload/contact fail-closed behavior.
5. Record the new Redis and authenticated HTTP evidence, then reassess activation/freeze. Until then: **real HTTP upload/contact acceptance remains BLOCKED**, regardless of direct B2 successes.
