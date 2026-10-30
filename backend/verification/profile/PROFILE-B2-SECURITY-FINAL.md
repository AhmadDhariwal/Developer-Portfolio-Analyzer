# Profile & B2 — security hardening final

29 October 2026, Asia/Karachi. Branch: `task/profile`; integration/PR target: not applicable. HEAD: `96179a7f4372887f06952723e3302c9b566d652e`. Read repository `AGENTS.md`, the solution architecture charter and `PROFILE-B2-FINAL-ACCEPTANCE.md`. Pre-existing staged acceptance scripts/evidence were preserved. No index reset/restaging, commit, merge, deployment, production provisioning, bucket policy change, secret rotation or migration occurred.

**Verdict: focused hardening PASS; production readiness BLOCKED; module freeze WITHHELD.** Redis admission remains fail-closed. Minimum-privilege key replacement, production activation/provisioning and deployment verification require the operator actions below. This task completes the safe local implementation/preparation; it does not certify unverified infrastructure.

## Verified fixes

1. **Bound and isolate maintenance runs.** The standalone account worker previously scanned every receipt and aborted on its first failure. Both existing command names now invoke one shared runner: at most 50 storage receipts followed by at most 50 due account receipts. Accounts use `deferObjects:true`, so the account loop cannot multiply the provider batch per account. Storage or individual account failures do not stop other eligible accounts while Mongo remains available. A database outage still terminates safely with receipts retained.
2. **Durable account retry backoff.** Add backward-compatible `retryAfter` and `cleanupAttempts` to account-deletion receipts, plus `(retryAfter,createdAt,_id)` selection index. Failed worker attempts back off for one minute. Legacy receipts without retry fields remain eligible. No TTL, history rewrite or destructive index synchronization was introduced.
3. **Safe worker startup.** Worker connections have bounded connection/selection/socket settings and four pooled connections. They disable automatic collection/index creation and verify both collections, declared indexes and absence of TTLs before cleanup. Missing provisioning fails closed with a sanitized error, before provider/file cleanup.
4. **Explicit additive provisioner.** `provisionStorageCollections.js` requires dedicated maintenance URI/database, defaults to inspect, requires transaction-capable topology and permits apply only for generated disposable loopback databases or explicitly acknowledged authorized staging targets. It creates only the two storage/cleanup collections and declared additive indexes. Index conflicts fail without dropping or rewriting data. It never loads `.env` or falls back to the application connection.
5. **Earlier sanitized environment validation.** Startup now checks B2 configuration before route loading/environment success logging. Partial/invalid configuration fails early. Removed the startup JWT secret prefix/suffix disclosure; the log says only `JWT_SECRET=configured`. No secret value or signing policy changed.
6. **Read-only audit and operational preparation.** Added a credential-safe B2 auditor, an exact operator runbook, a one-designated-worker systemd service/timer template and a same-origin nginx proxy snippet. These are prepared artifacts; nothing was installed or enabled.

The receipt metadata addition is internal and additive. Profile/Settings UI, scoring formulas, historic analyses, owner/public API contracts and Redis policies remain unchanged.

## B2 audit and minimum privileges

Fresh evidence: `profile-b2-security/b2-audit.json`. Four bounded read-only Native API calls were made: authorize each key and retrieve only its scoped bucket metadata. **No B2 PUT, DELETE, existing-object enumeration or download was performed in this task.** No Redis command was sent.

| Gate                                                                  | Result                                                                                                                                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Both credentials authenticate                                         | PASS; secrets and bucket identities omitted from all evidence                                                                                                                                     |
| One intended bucket per key, distinct credentials, regional endpoints | PASS                                                                                                                                                                                              |
| Both buckets private                                                  | PASS                                                                                                                                                                                              |
| Both defaults SSE-B2/AES256                                           | PASS                                                                                                                                                                                              |
| Required file capabilities                                            | PASS                                                                                                                                                                                              |
| Least privilege                                                       | OPERATOR REQUIRED: both keys retain unnecessary `shareFiles`, bucket metadata and bucket-management capabilities, including lifecycle/encryption/logging/replication/notification/settings writes |
| Lifecycle                                                             | PASS for observed configuration: zero lifecycle rules on both buckets; no expiration policy was added                                                                                             |
| Versioning                                                            | Reused PASS: prior live acceptance created distinct versions and performed version-pinned reads/exact-version deletion; no new live traffic needed                                                |
| Retention/Object Lock                                                 | OPERATOR REQUIRED: current keys cannot view retention metadata. Prior disposable versions were deletable; this does not certify all retention/hold settings                                       |

Runtime minimum is exactly **`readFiles`, `writeFiles`, `listFiles`, `deleteFiles`**. Keep one non-master key per bucket. Images need common prefix `v1/` for generated avatar/portfolio subdirectories; résumé key may use `v1/resumes/`. Adapter kind/bucket/owner/key checks remain independent. Runtime does not require bucket writes, key administration, public sharing, account-wide bucket listing or governance bypass. Bucket metadata/retention audits should use the separately authorized operator console/read-only audit credentials.

`backend/deployment/storage/STORAGE-OPERATIONS.md` contains exact Native API v4 key payload templates, capability mapping, private bucket/encryption/retention checks, secret-manager slot names, all-worker rollout, bounded verification, rollback and old-key revocation order. No live secret was printed, replaced, revoked or changed. Prefix restrictions must be checked against existing ledger keys before application.

The older live acceptance script requires metadata privileges at preflight. Do not add those to runtime keys to satisfy a verifier; perform operator metadata audit separately and use an approved split preflight for runtime fixture operations.

Provider basis: [S3 app-key capabilities](https://www.backblaze.com/docs/cloud-storage-s3-compatible-app-keys), [v4 key payload](https://www.backblaze.com/apidocs/b2-create-key), [bucket encryption/retention metadata](https://www.backblaze.com/apidocs/b2-list-buckets).

## Storage configuration and activation

- PASS: existing `.env` is structurally valid with both isolated buckets. An **in-memory** `STORAGE_DRIVER=b2` validation succeeds, without modifying configuration.
- OPERATOR REQUIRED: configured write driver remains `filesystem`; normal writes have not been activated on B2. No production setting was changed.
- PASS: adapter rejects partial settings, shared credentials/buckets, unsafe endpoints and region mismatch. Missing B2 configuration fails early when driver is `b2`. No B2 outage fallback is introduced.
- PASS/reused: filesystem development writes and legacy reads, version-pinned managed reads during filesystem rollback, strict image/PDF validation, ownership and safe replacement. Historical filesystem files are not removed by activation.
- OPERATOR REQUIRED: preserve original persistent image/resume roots and B2 reader settings across workers/rollback. Validate backups and deployment restart behavior. The prior copy/hash/compare-and-set migration plan remains separate; no migration is run.

Configuration checklist: `STORAGE_DRIVER`; all five `B2_IMAGES_*` fields and all five `B2_RESUMES_*` fields; original `PUBLIC_IMAGE_STORAGE_ROOT`/résumé mounts; production JWT secret/issuer/audience, `NODE_ENV=production`, existing strict-secret gate, exact public origins and healthy shared Redis. Every API/cleanup worker must receive the same approved generation of these settings.

## MongoDB, cleanup and multi-worker safety

**Local provisioning PASS.** Actual disposable transaction-capable Mongo on `127.0.0.1:27141` was used. The provisioner created missing `storedassets` and `accountdeletioncleanups` with their declared indexes, then reapplied idempotently. Sentinel records and legacy receipt fields survived. Unique storage references reject duplicates. No cleanup TTL exists. Tests remove only their explicitly generated fixture databases.

**Configured production/staging gate remains open.** Previous read-only configured-database evidence showed the storage ledger indexes present and account cleanup collection absent. No new query or mutation was made against that configured database in this task. No staging target was supplied; only local provisioning was authorized and exercised. Production provisioning requires its separately approved change. The staging acknowledgement is an operator assertion of prior authorization, not proof a URI is staging; never relabel a production target.

Cleanup verification:

- 52 due disposable account receipts process as **50, then 2**, with a separate future retry remaining deferred.
- A failed account receives durable retry metadata while another account completes. Legacy no-retry-field receipts remain eligible. The next immediate pass does not retry deferred work.
- Actual worker CLI refuses missing collections/indexes. Both operational aliases succeed against an explicitly provisioned empty fixture database, with zero provider/object attempts.
- Existing atomic owner fences, reference activation, account deletion and generated-key exact-version removal are unchanged. Prior B2 evidence covers provider failure, uncertain uploads, durable receipts, restart, concurrent deletion and protection of neighboring keys.
- Repeated or concurrent exact-version cleanup is safe to retry; provider race errors may retain a receipt for the next pass. This task does not introduce a distributed scheduler lease or claim duplicate requests are impossible.

One designated oneshot maintenance worker is prepared, not installed. Schedule **one** command, not both aliases. The template runs once per minute after the prior invocation ends; timeout interruption leaves receipts for recovery. Its filesystem protections/secret file/legacy root paths require operator review on the target host. The account batch is bounded in receipts; a single large account can still require substantial streaming legacy-file work. No expensive large-account benchmark was run.

Sanitized summaries record duration, processed accounts, object batch result/limit, failures and oldest selected-account age. Nonzero exit/summary failures, increasing retries, sustained full batches, stale uploads and aged/uncertain receipts must alert. The runbook gives initial alert/recovery thresholds. No alert destination, supervisor, schedule or dashboard was installed. Windows acceptance cannot certify Linux systemd/nginx deployment syntax/environment; validate those templates on the chosen host before enabling them.

## Production security audit

| Area                         | Verified result / remaining boundary                                                                                                                                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JWT/session revisions        | Focused PASS and reused prior Mongo/HTTP password rotation/revision checks. Secret fragments no longer logged. Full-fleet rollout remains operator-required                                                                                               |
| Media cookies                | Source audit/reused PASS: purpose-bound audience, HttpOnly, SameSite=Lax, `/uploads`, 20 minutes, Secure in production; current persisted session/account checks                                                                                          |
| Private downloads            | Focused/reused PASS: owner/publication/visible-CTA checks, bounded bytes/hash verification, no public static PDFs, sanitized provider errors                                                                                                              |
| Cache/privacy revocation     | Focused PASS: authorization/current publication before warmed cache, private/no-store and Cookie variation for managed media; unpublish/hidden sections revoke protected access                                                                           |
| Upload validation            | Reused PASS: image bytes/signature and size, real PDF parser/quality bounds, generated keys, strict admission before B2 operations                                                                                                                        |
| Owner/cross-user consistency | Focused/reused PASS: Mongo authority, transaction owner fences, foreign references rejected, no cross-user replacement/deletion                                                                                                                           |
| HTTPS/proxy                  | OPERATOR REQUIRED: no deployed origin/certificate topology was supplied. Use same-origin HTTPS, private Node port, preserve Set-Cookie/no-store, proxy `/uploads` through application authorization                                                       |
| Client IP/trust proxy        | OPERATOR REQUIRED: app uses direct peer IP; an unconfigured proxy can collapse quotas to the edge IP. Actual hop/CIDR must be verified before a scoped trust-proxy change. No blanket trust or spoofable forwarding was introduced                        |
| CORS                         | Audited: existing wildcard **noncredentialed** CORS with bearer API ownership checks remains compatible. Same-origin deployment needs no credentialed CORS. Cross-origin cookie delivery is not accepted; requires exact allowlist/client work separately |
| Logout                       | Existing limitation remains: local-only logout does not immediately revoke already issued bearer/media credentials. Revision/account checks and expiry still apply. Immediate server logout needs an approved requirement/implementation                  |
| Legacy media                 | Existing static images remain public by URL; managed portfolio media has current publication checks. Downloaded copies and historical public legacy assets cannot be retroactively revoked. No historical file deletion/migration performed               |

No demonstrated endpoint defect justified unrelated frontend/global CORS/auth/scoring changes. HTTPS, edge headers, cookie delivery, legacy mounts and all-worker identity are deployment checks, not inferred passes from local tests.

## Verification and reuse

Initial focused run: **28 passed, 0 failed, 0 skipped** (`focused-tests.tap`), covering storage security changes, Profile account security and public-portfolio authorization/privacy/validation/fail-closed behavior. After strengthening batch/CLI tests and worker startup guards, reran only the affected file: **4 passed, 0 failed, 0 skipped** (`affected-tests.tap`). Counts are separate runs, not 32 distinct tests.

```powershell
$env:STORAGE_SECURITY_MONGO='mongodb://127.0.0.1:27141/?replicaSet=profileB2Security'
node --test backend/src/tests/storageSecurityFinal.test.js backend/src/tests/profileAccountSecurity.test.js backend/src/tests/publicPortfolioHardening.test.js
# After final affected changes:
node --test backend/src/tests/storageSecurityFinal.test.js
```

Additional CLI inspect/apply/reapply and both alias smoke evidence: `cli-provisioning.json`; final CLI startup refusal/success is also asserted in the final affected test. B2 fresh audit is read-only. No Redis retry, quota change or HTTP upload was attempted. No frontend build/browser rerun was needed because no frontend source changed.

Reuse `PROFILE-B2-FINAL-ACCEPTANCE.md` and its retained evidence: 87 backend/19 frontend passing tests, production build and desktop/mobile checks, real B2 six-object/seven-version acceptance with all fixture versions removed, version-specific cleanup/restart and cross-module propagation. These are prior evidence, not newly repeated live operations. No expensive suite, AI/mail/provider traffic or load test was run.

## Redis BLOCKED and operator actions

Strict upload/contact middleware remains unchanged and fail-closed; no in-memory/Mongo quota authority or relaxed limit was added. Previous configured Redis Lua quota failure remains an explicit blocker. No real HTTP upload/contact admission is claimed.

The runbook gives exact recovery verification: wait for the existing quota window/service owner recovery without this task increasing quota; PING is insufficient; then run bounded shared limiter checks with two random identities/three fresh processes, exact fixture-counter cleanup, authenticated disposable staging HTTP avatar/portfolio/PDF/contact checks, and the outage fixture before enabling B2. Do not disable Redis or contact real recipients to test failure.

Remaining ordered gates:

1. Authorized operator replaces the overprivileged bucket-scoped runtime keys using the supplied four-capability payloads; independently reviews retention/Object Lock and validates the replacement keys across all workers.
2. Apply explicit additive provisioning/index checks to the authorized staging target, then separately approved production target. No configured production collection was created here.
3. Approve/install one cleanup service/timer, secret injection, original-volume permissions and actual monitoring/alerts; verify bounded retries/restart in staging.
4. Wait for healthy Redis admission and retain real shared-admission/authenticated HTTP evidence. Preserve 503 during outage; do not bypass.
5. Validate actual HTTPS/proxy/no-store/cookies, exact trusted proxy topology, JWT generation consistency and legacy backups/restore. Resolve retained logout/legacy-retention policy decisions as applicable.
6. Activate `STORAGE_DRIVER=b2` only in the approved deployment after those gates. Preserve filesystem assets and reader rollback configuration. No production-ready or freeze designation before acceptance passes.

## Exact changed files and finalization

Source/operational changes:

- `backend/src/config/env.js`
- `backend/src/models/accountDeletionCleanup.js`
- `backend/src/services/storageCleanupWorkerService.js`
- `backend/src/scripts/retryStorageCleanup.js`
- `backend/src/scripts/retryAccountDeletionCleanup.js`
- `backend/src/scripts/provisionStorageCollections.js`
- `backend/src/scripts/auditB2Security.js`
- `backend/src/tests/storageSecurityFinal.test.js`
- `backend/deployment/storage/STORAGE-OPERATIONS.md`
- `backend/deployment/storage/storage-cleanup.service.example`
- `backend/deployment/storage/storage-cleanup.timer.example`
- `backend/deployment/storage/nginx-storage.conf.example`
- `backend/verification/profile/PROFILE-B2-SECURITY-FINAL.md`
- `backend/verification/profile/profile-b2-security/b2-audit.json`
- `backend/verification/profile/profile-b2-security/focused-tests.tap`
- `backend/verification/profile/profile-b2-security/affected-tests.tap`
- `backend/verification/profile/profile-b2-security/cli-provisioning.json`
- `backend/verification/profile/profile-b2-security/validation.json`
- `backend/verification/profile/profile-b2-security/formatting.txt`

Explicit-path Prettier write/check, changed JavaScript syntax and Git working-tree/index whitespace checks are recorded in finalization evidence. Config templates remain reviewable text and require target-host validation. No existing source/evidence was moved/deleted. Task-owned fixture databases are dropped and its local Mongo process stopped after acceptance; no production cleanup worker is invoked. Prior staged/concurrent work is retained, with no commit/stage mutation.

**B2 SECURITY: PRIVATE/ENCRYPTED/ISOLATED PASS; LEAST PRIVILEGE/RETENTION OPERATOR REQUIRED | STORAGE CONFIGURATION: ACTIVATION VALIDATION PASS, LIVE DRIVER CHANGE OPERATOR REQUIRED | MONGODB: LOCAL ADDITIVE PROVISIONING PASS, CONFIGURED TARGET GATE OPEN | CLEANUP: BOUNDED/RETRY/CLI PASS, SCHEDULER/MONITORING OPERATOR REQUIRED | PRIVACY: FOCUSED PASS, DEPLOYMENT/POLICY GATES OPEN | MULTI-WORKER SAFETY: TRANSACTION/RETRY CONTRACTS PASS, FLEET/PROXY GATES OPEN | REDIS: BLOCKED, FAIL-CLOSED PRESERVED | PRODUCTION GATES: OPEN | MODULE: NOT FROZEN.**
