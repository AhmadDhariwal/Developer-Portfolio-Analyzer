# Final Integrations scalability acceptance

28 October 2026, Asia/Karachi. **PUBLIC PROFILE REUSE PASS | REDIS OPTIONALITY PASS | MONGO GOVERNANCE PASS | CROSS-WORKER SAFETY PASS | SYNC RELIABILITY PASS | SECURITY PASS | SCALABILITY PASS | LOCAL READINESS PASS** for the tested working tree and bounded synthetic scope. This is not deployment certification or a promise that 1,000 simultaneous requests all succeed under unchanged quotas.

## Audit, scope and actual changes

Continued on the user-confirmed `fix/integration-mongo-governance` branch, HEAD `9e08dcb6`; PR target not applicable. Read `AGENTS.md`, the architecture charter, current Connect/Sync/polling, governance, provider adapters, Mongo persistence, cache/invalidation and the latest [Mongo/Redis acceptance](REDIS-MONGODB-GOVERNANCE-FINAL.md). Preserved the pre-existing staged implementation, evidence, secrets and index state; no staging, unstaging, commit, merge or deployment.

Before this change, every eligible Connect/Sync fetched a public profile again, including the same identity requested by another account. Admission used five sequential reads and four replacements inside a transaction; release added two reads/two replacements. The global coordination document was therefore held in longer, conflicting transactions. Polling's bounded due query had no matching index. Public adapters also swallowed typed admission errors: the controlled cohort exposed **441 genuine quota denials incorrectly reported as 502**.

Implemented only the following changes:

- Added short-lived, reusable public observations and bounded Mongo-backed cross-worker single-flight. Connect and Sync use the same helper; polling already enters Sync. Redis is not consulted by this new path, avoiding the previously measured Upstash latency/command cost.
- Retained per-account request quotas for reused observations. Provider budgets/concurrency are consumed only by actual outbound attempts, through the unchanged admission boundary. Real source request cost, including successful query fallback attempts, is recorded and charged to subsequent accounts. Scores, ownership, connection state and persistence remain per account.
- Batched governance reads and ordered replacements **inside the same snapshot/majority transaction**. Admission now uses one find/one bulk command for the same five reads/four state documents; release uses one find/one bulk command for its same two documents. This reduces round trips without dropping any check or weakening atomicity. Policy values, retry/commit bounds and the Mongo authority remain unchanged.
- Added the non-unique `integration_due_poll` index `{status: 1, nextSyncAt: 1}` after a disposable explain experiment reduced documents examined **1,000 → 10**, with the same ten returned rows. Existing unique indexes were retained.
- Preserved typed 429/503/cancellation through public-adapter catches, and mapped provider HTTP 429 to the existing 429/Retry-After envelope. Added a freshness predicate to lease acquisition: a reader paused before claiming an expired entry cannot claim it after another worker refreshes it.

No dependency, scoring formula, OAuth credential handling, permanent-data migration or unrelated feature changed. Normalization and owner-fenced Connect/Sync/Disconnect still run independently for each account; a public snapshot never replaces an account's persistence/history.

## Public reuse boundaries and resource bounds

| Area                  | Rule                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eligible observations | Credential-free LeetCode handles, **numeric** Stack Overflow identities, and explicit `devto@handle`. All original integrations remain supported through their existing paths.                                                                                                                                                                                   |
| Identity/key          | SHA-256 of provider + canonical public identity + public visibility + `public-unverified-v1`. Trimmed handles retain case to avoid speculative alias merging; numeric IDs normalize leading zeroes. Ambiguous display-name resolution is not shared.                                                                                                             |
| Private exclusions    | OAuth/private providers, any access/refresh credential, arbitrary Portfolio URLs, Certifications, Kaggle credential/resource ingestion and unsupported identities bypass shared reuse.                                                                                                                                                                           |
| Payload               | Strict provider-specific field projection; no raw response, token, application-user ID, ownership flag, account aggregate score or confidence. Existing public provider metrics are retained; account scores are recomputed by the unchanged normalizer. Each caller receives a detached copy. Maximum serialized observation: **32 KiB**.                       |
| Freshness             | **Five minutes**, fresh-only; no stale-on-error reads. Source failure preserves the account's earlier successful records through existing failure handling. Generation invalidation fences late publishers; schema-version changes produce a different namespace. User disconnect does not invalidate another account's public observation.                      |
| Coordination          | Mongo lease token + generation + lease deadline. A caller cannot publish after losing its lease or invalidation generation. Logical date checks govern expiry; delayed TTL cleanup cannot authorize an expired result or reservation.                                                                                                                            |
| Backpressure          | Per worker: at most **32 active identity flights / 128 pending callers**. Cross-worker followers have a **two-second polling budget**, with capped delays, then receive 429/Retry-After; individual Mongo operations have separate two-second deadlines. No unbounded queue, retry loop or new infrastructure. Existing Sync job caps still apply even on reuse. |
| Retention             | New `integrationpublicsnapshots` has `_id_` and `public_snapshot_expiry` (`expiresAt:1`, expiry zero). Successful observations expire after five minutes; failed-fetch metadata expires after ten seconds; pending records expire with their bounded lease. TTL bounds retention, not a fixed global disk-byte cap; monitor cleanup lag and volume.              |

Mongo initializes the new TTL index only after inspecting existing indexes and refuses incompatible expiry indexes. No production index was created during this task. Local Redis and deployed Upstash remain explicitly configured optional caches for existing paths; actual environment files were untouched. Other modules' Redis-dependent governance remains as described in the preceding architecture report.

## Focused acceptance and measured comparison

Evidence: [before transaction batching](scalability-before-batching.json), [final simulation](final-scalability-acceptance.json), [affected governance/lifecycle acceptance](scalability-governance-regression.json). **36 distinct focused checks PASS**: twenty post-batching checks plus sixteen already-passing affected wiring/lifecycle/recorded-data regressions. The latter were reused rather than repeated after a store-internal optimization. Commands and scope are retained in the final JSON. No frontend source changed, so no build was needed.

The controlled simulation used disposable local MongoDB, two real Node workers, **1,000 virtual users at concurrency eight**, 500 requesting one public identity and 500 distinct identities. It exercises the public-fetch/governance boundary, not 1,000 open HTTP sockets or full per-user authentication/persistence throughput. Provider traffic is mocked using the existing recorded response; no provider HTTP, OAuth consent, Upstash command or production database access occurred.

| Measurement                             |                  Before batching |                 After batching |
| --------------------------------------- | -------------------------------: | -----------------------------: |
| Shared-profile group                    |      500 served / 1 source fetch |    500 served / 1 source fetch |
| Entire cohort                           |   559 success / 441 expected 429 | 559 success / 441 expected 429 |
| Provider calls                          |                               60 |                             60 |
| Reused successful observations          | 499 (89.27% successful hit rate) |                   499 (89.27%) |
| Fetch-boundary p50 / p95 / p99          |       40.85 / 195.77 / 281.28 ms | **31.16 / 123.77 / 226.91 ms** |
| Mongo command p50 / p95 / p99           |                   4 / 16 / 19 ms |                 6 / 18 / 20 ms |
| Mongo commands                          |                            8,934 |       **5,126 (42.62% fewer)** |
| Observed WriteConflict failures retried |                              358 |         **229 (36.03% fewer)** |
| Redis commands on tested fetch path     |                                0 |                              0 |
| Decision throughput, including 429      |                          98.12/s |                       126.56/s |
| Cohort duration                         |                          10.19 s |                         7.90 s |

The unchanged **60 requests/minute provider cap** explains the 441 rejections; no 502/503 or oversubscription was observed in the accepted cohort. This is bounded backpressure, not evidence that provider quotas should be raised. The measured unshared baseline used five identical-profile reads and made five provider calls; sharing served 500 such reads with one call. The 499 reused responses would otherwise require additional fetch attempts or rate-limit rejection; they are not 499 extra calls actually made by the throttled baseline.

Mongo durations are driver-command timings, not server CPU/profile measurements. Command counts include transaction retries, initialization and fixture instrumentation; changed command mix explains why individual-command medians can rise while whole-call latency falls. A separate twelve-admission sample confirmed **12 read commands + 12 bulk commands replacing 48 documents**, versus the previous 60 reads/48 replacement commands. Admission p50/p95/p99 was **15.62 / 19.39 / 19.39 ms**. A single before/after sample is not a production SLO or statistical capacity estimate.

### Correctness and failure checks

- All 500 shared-profile callers reused one fetch across both workers. Warm observations survived process restart with zero new source calls. A controlled paused-reader race verified that a freshly published entry cannot be reclaimed by an old reader. Generation invalidation fenced a late source result with 409, and an expired abandoned lease recovered without waiting for TTL deletion.
- Actual authenticated Connect → fixture Fetch → Normalize → Mongo → Sync → downstream → Disconnect passed with Redis healthy, absent, quota-rejecting, timing out and recovered. Those state checks reused the already fresh public observation, kept provider count at one, and independently asserted **two account-budget charges** per lifecycle. Cache hits do not bypass account quotas; exhausted account quota returned 429, and unavailable Mongo admission returned 503 before provider work.
- Provider/user/global limits, two-worker request/job concurrency, duplicate Sync claims, cooldowns, OAuth state ownership/replay, encrypted token storage, cross-worker downstream revisions and historical-fixture preservation passed. Captured LeetCode, Stack Overflow, Dev.to, Portfolio, Kaggle and Certification contracts retained their accepted normalization/provenance.
- Initial test diagnostics were corrected rather than hidden: a cohort boundary included four distinct identities in the shared-only checkpoint; the next completed sample exposed the adapter 502 masking defect. Both are recorded in the final evidence. One successful pre-batching comparison and one necessary post-batching comparison were retained; there were no extended load runs or live-provider retries.

## Resource costs and remaining deployment gates

Two worker end-of-cohort RSS samples were approximately **152 / 149 MiB**, with used JS heaps **34 / 42 MiB**; these are endpoint measurements, not peak-memory guarantees. Snapshot collection logical BSON was **94,048 bytes for 502 documents**, plus 8,192 index bytes, including short-lived rejected-fetch metadata. Physical allocation/compression and TTL lag are not represented by those logical bytes. The benchmark used an eight-connection pool per worker; the production pool configuration was inspected and left unchanged.

Fresh reads still require account admission and independent owner persistence: sharing is not O(1) work for N accounts. A warm identity flight needs one snapshot lookup and each account needs its own quota transaction; real Connect/Sync also writes its own connection/insight/history. At the three eligible providers' default budgets, five-minute positive-snapshot volume is about 900 single-request refreshes, or up to 1,080 across quota-window boundaries before TTL lag; failed-key metadata also depends on authenticated ingress and account count. At the 32 KiB payload ceiling that latter positive-payload envelope is about 34 MiB, while this measured fixture was much smaller. These are planning estimates, not cloud billing or fixed disk-cap guarantees. New fetches incur zero Redis commands; no dollar-price or production cost claim is made.

Before deployment, verify provider-specific retention/reuse terms and identity rules; confirm Mongo topology, majority-write latency, pool/connection capacity, index permissions/build plan, TTL/storage monitoring and consistent clocks. Preserve outstanding budgets/cooldowns while draining legacy workers; do not run conflicting governance versions or reset counters. Verify actual authenticated throughput and tail latency under the deployment topology, and retain the existing OAuth consent/secret-manager/callback gates. Many simultaneous full Syncs may correctly return 429/409 under current caps. No claim of exactly-once external execution after ambiguous network failures is added. These local results do not certify unrelated Redis-dependent modules.

## Exact inventory and finalization

Modified in this task:

- `DEVINSIGHT_AI_SOLUTION_ARCHITECTURE_CHARTER.md`
- `backend/.env.example`
- `backend/src/controllers/integrationscontroller.js`
- `backend/src/models/integrationConnection.js`
- `backend/src/services/integrationGovernanceService.js`
- `backend/src/services/integrationMongoGovernanceService.js`
- `backend/src/services/integrationSyncService.js`
- `backend/src/services/integrations/leetcodeAdapter.js`
- `backend/src/services/integrations/stackoverflowAdapter.js`
- `backend/src/services/integrations/devBlogsAdapter.js`
- `backend/src/tests/integrationMongoGovernance.test.js`
- `backend/src/tests/integrationsGovernance.test.js`
- `backend/src/tests/integrationsLifecycle.test.js`

Added:

- `backend/src/models/integrationPublicSnapshot.js`
- `backend/src/services/integrationPublicSnapshotService.js`
- `backend/src/tests/integrationPublicSnapshot.test.js`
- `backend/src/tests/fixtures/integrationScalabilityWorker.js`
- `backend/verification/integrations/final-scalability-acceptance.json`
- `backend/verification/integrations/scalability-before-batching.json`
- `backend/verification/integrations/scalability-governance-regression.json`
- `backend/verification/integrations/FINAL-SCALABILITY-ACCEPTANCE.md`

No repository files moved or deleted. Previous acceptance reports/receipts and staged work were preserved. Disposable workers/Mongo processes stopped; existing guarded cleanup removed only verified task-owned database files (82 in the final scalability run, 115 in its final governance regression). No abandoned scripts, logs, screenshots or traces remain. Explicit-path installed Prettier write/check, changed JavaScript syntax, JSON/reference/secret checks, and unstaged/staged Git whitespace validation passed; `.env.example` retains its plain environment-file conventions. No full suite, frontend build, deployment, migration, credential/key change, provider quota reset, commit, push or merge occurred. Acceptance applies to the working tree, not a separately certified staged snapshot.
