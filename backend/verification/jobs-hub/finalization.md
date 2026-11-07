# Jobs Hub backend finalization

STATUS: VERIFIED

READY FOR JOBS HUB FRONTEND: YES

The real MongoDB check from the preceding unblocking pass and the real Upstash Redis checks below have passed. The backend is ready for frontend development. This approval covers the backend contracts and focused integration evidence; deployment and live paid-provider verification remain outside this task.

## Existing Upstash verification — 19 October 2026

### Configured application connection

The backend `.env` contains configured `UPSTASH_REDIS_HOST`, `UPSTASH_REDIS_PORT`, and `UPSTASH_REDIS_TOKEN`; its `REDIS_URL` override is empty. The existing client builds a `rediss://` connection with the installed `redis`/node-redis package. It uses Redis TCP over TLS, **not** the Upstash REST API. No credentials, application key values or connection URLs containing credentials were printed or included in this report.

Using the actual application client with read-only probe initialization:

- TLS connection/authentication succeeded; `PING` returned `PONG`.
- `EVAL` running only `return redis.call('PING')` returned `PONG`, without writing keys.
- Three further PING measurements completed in 76, 76 and 75 milliseconds, inside the unchanged 150 ms command timeout. These are observations, not a load-test or latency guarantee.
- `COMMAND INFO` metadata discovery failed on the configured endpoint. This did not prevent PING or Lua execution. Commands required by Jobs Hub were subsequently exercised directly on a separate disposable Upstash database, rather than inferred from metadata support.

The earlier skips did **not** establish an Upstash connectivity failure. `jobsHubLocal.integration.test.js` deliberately does not load application `.env`, requires `JOBS_TEST_REDIS_URL`, and rejects remote hosts. Those protections prevented running destructive integration fixtures against application infrastructure. They remain intact. The new hosted integration suite supports explicitly acknowledged, separate Upstash test databases with additional target checks.

### Confirmed defects and minimal fixes

1. `initRedisCache` initialized `interview:revision:global` on every ready event, including connection checks. Added the opt-in `probeOnly` flag so diagnostic connections suppress that write. Ordinary application startup and recovery retain their existing behavior; the focused Interview cache regression passed.
2. `checkRedisConnection.js` loaded `.env` relative to the caller's working directory. Invoked from the repository root, it reported `Redis: unavailable` despite the configured backend `.env`. It now resolves `backend/.env` explicitly and requests probe-only initialization. The same root invocation then returned `Redis: PONG`.

No Jobs Hub architecture, provider adapter, scoring, cache TTL, production credential, rate limit or performance budget was changed. No Redis/REST SDK, Redis server, Docker, Memurai or other software was installed.

### Disposable database safety

Provisioned a new free, unclaimed Upstash scratch database through its documented `start-redis` API, using a Codex User-Agent. It is separate from the application's endpoint and credentials and automatically expires after 72 hours unless claimed. No application secrets, customer data, or real job records were copied into it. See [Upstash's disposable database documentation](https://upstash.com/docs/agent-resources/cli).

The service supplied REST credentials, which also authenticated successfully with Redis TCP/TLS. Write-based verification used that TLS transport through the existing installed node-redis library. The disposable database's observed raw PING latency was approximately 219–221 ms, above the application's 150 ms proxy deadline. Integration tests therefore use the native test client, as the pre-existing local integration fixture does, to verify Redis semantics. They do not widen or bypass the application's operational deadline or claim that this temporary database meets that deadline. The configured application database's own bounded-client connectivity was verified separately above.

Before any writes, the hosted fixture requires `JOBS_TEST_REDIS_DISPOSABLE=true`, TLS, an Upstash hostname, a known application endpoint, a different test hostname, and different test credentials. Safety checks reject the application database even if the disposable flag is set. Every key is wrapped in a random `jobs-test:<UUID>:` namespace. Cleanup deletes only the exact keys tracked by that fixture; no `FLUSHDB`, `FLUSHALL`, wildcard deletion, application key reads, or production test mutations are used.

Two separate native clients exercised distributed behavior. Two actual child processes competed for the same namespaced lease after a start barrier: exactly one executed the protected synthetic upstream callback and the other skipped. No provider HTTP request was made.

### Real Redis results

`jobsHubUpstash.integration.test.js`: **7 passed, 0 failed, 0 skipped** (parent plus six focused subtests).

- Thirty concurrent admissions across two clients produced exactly one admitted request. Distributed active-slot limits, daily/monthly budgets, UTC quota TTLs, interval TTLs, and slot TTLs were verified without changing production policies.
- `429` cooldowns persisted across clients and fresh module instances. Both seconds and HTTP-date `Retry-After` values worked; shorter subsequent values did not shorten cooldown. Exhausted quota response headers also preserved cooldown.
- Three failed-attempt records opened the actual shared five-minute circuit.
- Token ownership protected replacement leases, and competing processes executed the protected callback once.
- Actual Lua counters enforced the unchanged ceilings: 120 reads/minute, two refreshes/15 minutes, and 30 mutations/minute. The next request in each category returned 429 with Retry-After.
- Public pool publication was shared. An older fill could not replace a newer Redis pool. A warm worker observed a refreshed pool after the unchanged 15-second Memory lifetime. Absolute cache expiry was not extended by promotion.
- Short-lived real Redis keys expired, the pool reloaded via its fallback loader, and closing a real test connection caused fallback and fail-closed quota admission. The fallback loader uses synthetic values in this Redis-focused check; real Mongo persistence was established by the prior Mongo integration run.
- Required commands were exercised directly or inside actual Lua: PING, EVAL, GET, SET with NX/EX/PX, DEL, MGET, EXISTS, INCR, PTTL, PEXPIRE, PEXPIREAT, ZADD, ZCARD, ZREMRANGEBYSCORE and ZREM.
- Cleanup verified **32 isolated test keys removed, zero tracked keys remaining**. No application keys were touched. The empty scratch database is left to its automatic expiry; its temporary local credential file is removed during finalization.

Focused client/probe regressions: **7 passed, 0 failed, 0 skipped**, covering probe side effects, ordinary startup behavior, remote-target guards, working-directory-independent configuration, and existing Interview cache expiry/invalidation/recovery.

Total for this pass: **14 passed, 0 failed, 0 skipped**. The Mongo check was already verified in the preceding pass and was not rerun; the original local-only Redis fixture was not pointed at production or relaxed to permit it. No full repository regression, frontend test, paid provider call, deployment or production database operation was run.

### Exact changes and finalization for this pass

Modified:

- `backend/src/services/redisCacheService.js` — added opt-in probe initialization without namespace mutation; default startup behavior retained.
- `backend/src/scripts/checkRedisConnection.js` — resolves backend `.env` explicitly and uses probe initialization.
- `backend/verification/jobs-hub/finalization.md` — current results and frontend readiness; earlier records below are retained as history.

Added:

- `backend/src/tests/redisConnectionProbe.test.js` — focused diagnostic and target-safety regression checks.
- `backend/src/tests/fixtures/jobsHubRedisFixture.js` — remote target validation, actual TLS clients, isolated namespace adapter and exact-key cleanup.
- `backend/src/tests/fixtures/jobsHubRedisWorker.js` — actual child process for lease coordination verification.
- `backend/src/tests/jobsHubUpstash.integration.test.js` — real hosted Redis verification.

Pre-existing implementation changes were preserved. All six changed JavaScript files and this report passed explicit-path Prettier write/check with the existing backend options. Syntax and working/staged Git whitespace checks passed. No repository source file was moved or deleted. Task-owned temporary scratch credentials are removed; no credentials or raw provider responses are retained as evidence.

### Remaining staging/provider requirements

**READY FOR JOBS HUB FRONTEND: YES.** Staging must still validate actual worker deployment, representative Mongo query plans/index deployment, Redis durability/eviction policy, region-specific latency against the existing 150 ms deadline, provider configuration/access rights, and budget ceilings below real remaining purchased quotas. Metered provider budgets remain opt-in and no paid credits were consumed to establish this approval.

## Historical local-infrastructure unblocking — 19 October 2026 (superseded above)

Only the two pending integration tests were selected for the final verification run. Result: **one passed, zero failed, one skipped**. The unchanged initial hardening/context suites were not rerun. No frontend work, deployment, paid provider requests, production data access, dependency installation, or system-wide software installation was performed.

### Real MongoDB evidence

- Found the installed MongoDB executable at `C:/Program Files/MongoDB/Server/8.2/bin/mongod.exe`, version **8.2.6**. An existing MongoDB Windows service was running on port 27017 and was left untouched.
- Started a separate hidden process bound only to `127.0.0.1:63130`, with its own task-created data directory. Used `directConnection=true` and random `jobs_hub_test_*` databases. The test never loaded application `.env` settings or used the application's database.
- The originally skipped Mongo test passed before any changes. Strengthened that same test with assertions required by this verification request; the final run passed against the real server as well. No production implementation fix was needed.
- Verified the actual cache indexes: unique `jobId_1`, TTL `expiresAt_1` with `expireAfterSeconds=0`, and deterministic `lastSynced_-1_updatedAt_-1__id_1_expiresAt_1`. Verified the owner/job unique action index and that action-history indexes have no TTL.
- Fifteen concurrent same-owner action upserts produced exactly one record. Verified foreign-owner isolation, Saved/Applied/Hidden persistence, canonical external-ID alias resolution, and rejection of owner injection and Mongo update operators.
- Verified fresh versus retained-stale reads, provider-expired and retention-expired exclusion, rejection of new actions on expired jobs, and continued mutation of existing action history after job expiry. The test checks TTL index configuration and immediate application expiry filtering; it does not claim to have waited for MongoDB's asynchronous TTL monitor to delete a row.
- Both test databases were dropped by the test's ownership-checked cleanup. Before shutdown, checked server options against the owned data directory, loopback binding, port and process ID, and confirmed zero `jobs_hub_test_*` databases remained.

Final test command, run outside the sandbox to permit loopback connections:

```powershell
$env:JOBS_TEST_MONGODB_URI = 'mongodb://127.0.0.1:63130/?directConnection=true'
Remove-Item Env:JOBS_TEST_REDIS_URL -ErrorAction SilentlyContinue
node --test backend/src/tests/jobsHubLocal.integration.test.js
```

### Exact remaining infrastructure blocker

Sandboxed connection probes returned `EACCES`; host-level checks distinguished that restriction from actual service availability. Outside the sandbox, MongoDB port 27017 was listening and Redis port 6379 returned `ECONNREFUSED`.

- No `redis-server`, Memurai, Docker or Podman executable was found on PATH or in the checked installed-runtime locations. Windows service and installed-package inventories identified MongoDB but no Redis-compatible service or container runtime.
- `wsl --list --quiet` explicitly reported that Windows Subsystem for Linux is not installed.
- No Redis/Memurai installation was present in the checked standard installation directories or matching WinGet package directories. No existing Redis installation/custom port was supplied by the user.
- The repository has no Docker/Compose setup or approved disposable Redis startup script, and no installed `redis-memory-server`, `testcontainers`, or equivalent local Redis runtime was available. Its Redis check script targets configured infrastructure and was not run against application secrets or production services.
- Therefore there is no existing approved mechanism on this machine to start a real temporary Redis service. Installing a new runtime or system-wide virtualization software was outside the permitted scope. Further connection retries were stopped.

Real Redis Lua admission, quota TTLs, public-pool publication/invalidation, cooldown persistence across clients, token-owned worker leases, cross-worker duplicate suppression, distributed route limits and Redis outage/recovery behavior remain **unverified against real Redis**. The initial focused tests and code are retained, but their mocked evidence does not close these gates. No rate limit, budget, security assertion or performance bound was weakened.

### Changes and finalization for this unblocking pass

Modified only:

- `backend/src/tests/jobsHubLocal.integration.test.js` — added real Mongo index, persistence, canonical-ID, isolation and expiry assertions; added diagnostic index names and concurrent-upsert count.
- `backend/verification/jobs-hub/finalization.md` — recorded current infrastructure findings, real test results and remaining gates. The initial implementation record below is retained as history.

All pre-existing implementation changes were preserved. No application source files were changed, moved or deleted in this pass. Prettier write/check used the same explicit two paths and existing backend formatting options; JavaScript syntax and working/staged Git whitespace checks passed.

Cleanup verified ownership before gracefully shutting down the disposable process and recursively removing only `backend/verification/jobs-hub/runtime-20261019-unblock/`, including its `ownership.json`, `mongod.log`, and Mongo-generated `data/` subtree. No test process or generated database directory was retained. Relevant results are preserved above. The existing MongoDB Windows service was confirmed still running.

### Approval and staging requirements

**READY FOR JOBS HUB FRONTEND: NO.** Supply an approved local Redis-compatible runtime or isolated loopback Redis endpoint, then run the retained real Redis test and required TTL/cache/route-limit/multi-worker checks. MongoDB no longer blocks approval. Continue to require staging verification of deployed indexes/query plans, durable non-evicting quota state, worker startup, configured provider credentials, actual remaining paid-provider budget ceilings and provider access/licensing. These configuration requirements must not be validated by spending paid API credits during this backend check.

## Initial implementation: scope and architecture

Read the root AGENTS.md, docs/features/jobs.md, the general architecture guide, Jobs Hub routes/controllers/services/models, canonical developer context, existing evidence compatibility checks, shared Redis service, and existing rate limiting. No separate Jobs Hub architecture artifact was supplied beyond the repository guide. The initial Git working tree was clean.

Backend only. Existing GET routes, filters, pagination shape, normalized IDs for existing provider records, job details, and six provider adapters remain. Recruiter modules, frontend, shared Redis internals, historical data, dependencies, production databases, and integration credentials were not changed. No provider API requests were made during verification.

## Actual cache and delivery flow

1. Read a single versioned public pool from process Memory, then shared Redis, then MongoDB. Memory retains at most one pool of 1,000 jobs, with a 15-second promotion lifetime. Redis uses jobs:v2:public:pool with a five-minute absolute envelope expiry. Promotion never extends that expiry.
2. Mongo reads at most 1,000 retained listings, sorted deterministically by lastSynced, updatedAt, and \_id, with a server-side 1.5-second query limit. Existing 24–48 hour freshness settings and seven-day default retention are retained. Freshness, provider validThrough, and cache retention are distinct.
3. Filter invalid, globally hidden, explicitly expired, and duplicate listings. Retained stale listings remain usable, with stale fallback metadata; listings are never asserted to still be available at the employer.
4. Rank per request using current compatible evidence. Personalized results are deliberately not cached or shared. HTTP responses use private, no-store. Owner action reads remove hidden listings before pagination. Only the returned page receives course/sprint enrichment.
5. Cold, stale, or explicit refresh requests schedule refresh outside response delivery. A cold, empty database can therefore return an empty feed until prewarming completes. Existing refresh query aliases remain, but refresh now schedules work rather than waiting for provider calls.
6. Concurrent process fills share one promise. Atomic Redis publication compares observation times to avoid older fills overwriting newer publications. Successful ingestion replaces only the Jobs Hub public key; other workers observe it within 15 seconds. Actions need no public invalidation because owner state is read on every request.
7. Redis failures fall back to Mongo. During a Mongo pool-read failure, the last process pool can be reused for up to one hour beyond its envelope expiry, subject to per-job retention and provider expiry. Authentication, evidence and owner visibility still require their persistence infrastructure; this is not a promise that personalized HTTP feeds work through a complete Mongo outage.

## Quotas, provider reliability and workers

- Reuses the existing Redis client and its bounded command timeouts. Lua atomically enforces per-provider active slots, daily UTC counters, monthly UTC counters, minimum request intervals, and cooldowns. Redis hash tags keep each provider's admission keys in the same cluster slot.
- Missing or unavailable quota state fails closed for external HTTP requests. Uncertain reservations and failed requests are never refunded because a provider may have charged for them. Redis state must persist across worker restarts; flushing or evicting quota keys can erase budget history. Operators must provision durable Redis and an eviction policy suitable for quota counters.
- JSearch, Jooble and Adzuna require explicit JOB*<PROVIDER>\_DAILY_BUDGET and JOB*<PROVIDER>\_MONTHLY_BUDGET values; both default to zero. These are application ceilings, not assertions about purchased provider allowances. Set them below the actual remaining subscription quotas, including any usage by other applications.
- Free defaults: Arbeitnow and RemoteOK each permit at most 24/day and 1,000/month, with one-hour spacing. Remotive permits at most four/day and 1,000/month, with at least six-hour spacing. All providers default to one distributed active request. JOB*<PROVIDER>\_CONCURRENCY and JOB*<PROVIDER>\_MIN_INTERVAL_MS configure additional bounds; zero budgets or concurrency disable requests.
- Remotive requires JOB_REMOTIVE_ENABLED=true. Its public API documentation recommends at most four requests daily and restricts displaying listings to collect signups/email addresses. This authenticated product needs suitable authorization before enabling the adapter. See [Remotive API documentation](https://github.com/remotive-com/remote-jobs-api/blob/main/README.md).
- Free feeds run before metered fallback. Metered providers are considered only when free feeds deliver fewer than 80 usable listings or an explicit provider is requested. Public whole-board feeds are fetched once and filtered locally, rather than queried once per developer's skills.
- Every HTTP attempt is admitted separately. JSearch is limited to one page per ingestion. There are no immediate HTTP retries: later bounded worker/request refresh ticks are the retry mechanism. Retry-After seconds/dates, exhausted quota headers, authentication failures, and three transport failures open shared cooldowns. Retry-After durations beyond one day are preserved. Existing persisted Mongo quota circuits remain respected.
- Dedicated transport bounds request timeout to six seconds, adds a seven-second abort signal, disables redirects, limits request size and response size, checks provider response shapes, and removes provider credentials/bodies from errors. Malformed individual rows are isolated.
- Background startup prewarms and scheduled ticks rotate one profile per tick. A token-owned Redis lease, a one-minute shared refresh gate, process single-flight, and per-provider intervals protect against multiplied worker traffic. No global Axios behavior was changed.
- Source health includes safe configuration/availability summaries and quota usage/store availability; historical request details, error bodies, and credentials are withheld.

## Ranking, quality and security

- Reuses canonical active developer context and the existing current Skill Gap evidence compatibility gate. Recommended technologies are no longer merged into known skills, and mismatched historical analyses are not borrowed.
- Rank weights and formula remain unchanged. One intentional correctness fix removes skill gaps from the ranker's known-skill union. Scores can consequently fall where a previously missing skill incorrectly counted as demonstrated overlap; missing-skill explanations now retain that distinction.
- Missing titles/companies and unsafe apply links are rejected. Unknown salary, currency, location, posting date, experience and employment type are not invented. Numeric salary bounds and explicitly supplied currency/period survive cache persistence without conversions. Provider provenance and validThrough are retained.
- Deduplication recognizes tracking URL variants and identical title/company/location records across sources, while retaining distinct locations. Such heuristic dedupe can collapse separate identical-role openings from the same employer/location; source records remain in Mongo.
- URL parsing rejects credentials, unsupported protocols, private/loopback addresses, local hostnames and custom ports. Provider redirects are never followed. Text normalization strips encoded HTML tags and bounds descriptions/lists.
- Mongo bulk writes no longer scan every recently synced listing. They upsert at most 1,200 input rows, deduplicated by existing job ID. Cache reads and health scans are capped at 1,000 records. Health metrics expose sampled=true when the cap is reached; totals at that cap describe the sample.
- Added a deterministic cache-order index and owner/action indexes in schemas. No index migration or production database operation was run. Build/verify these indexes through the normal deployment process and inspect representative query plans before release.
- Jobs Hub reads are limited to 120 authenticated requests/minute. Explicit refresh is limited to two/15 minutes. Mutations are limited to 30/minute. Redis enforces shared counters; reads retain a bounded process-local limiter during Redis outages, while refresh/mutations return 503. Read outage limits are per process, not distributed.
- Query arrays/objects, oversized values, malformed IDs, body-supplied owners, Mongo operators, arbitrary fields and nonboolean action flags are rejected. No cross-user response cache is used. Owner visibility fails closed when its Mongo read cannot complete.

## API compatibility and action contract

Existing GET /api/jobs, /api/jobs/:id, /api/jobs/source-health and /api/jobs/cache-health remain authenticated. Refresh/forceRefresh query aliases remain supported, with asynchronous refresh semantics described above. Jobs expose additive salaryMetadata, expiry/provenance metadata and actions fields. Personalization and refreshScheduled diagnostics are additive.

New endpoints, all under /api/jobs:

| Method        | Path                                 | Contract                                                                                                                          |
| ------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| GET           | /actions?state=saved&page=1&limit=20 | Owner's actions; state optionally saved/applied/hidden; limit capped at 50, page capped at 1,000; returns actions, page, hasMore. |
| PUT           | /:id/actions                         | Body contains one or more boolean saved/applied/hidden fields; returns action.                                                    |
| POST / DELETE | /:id/save                            | Set saved true / false.                                                                                                           |
| POST / DELETE | /:id/apply                           | Record applied true / false; does not submit an employer application.                                                             |
| POST / DELETE | /:id/hide                            | Set hidden true / false.                                                                                                          |

Actions use deterministic owner/job primary keys plus an owner/job unique index. Repeated sets are idempotent, concurrent duplicate upserts retry the owner-qualified update, and external ID aliases resolve to canonical IDs. Existing actions can still be edited after source-cache expiry. New actions require an available retained job. Action history has no TTL and is not deleted when source jobs expire. Hidden details return 404 to their owner until unhidden through the action endpoint.

## Initial implementation: verification and finalization

Focused command:

```powershell
node --test backend/src/tests/jobsHubHardening.test.js backend/src/tests/jobsHubLocal.integration.test.js backend/src/tests/developerContextService.test.js
```

Initial focused suite: 38 passed, zero failed, two integration checks skipped. This comprises 24 Jobs Hub checks and 14 canonical context checks. The two real-service integration checks require explicitly supplied local test URLs. Tests cover cache concurrency/copy isolation/freshness/publication races, owner writes, validation, authenticated Express routing, hidden pagination, all six adapters, free-first fallback, source failures, transport bounds, quota admission parameters, cooldowns, rate limiting, worker leases and representative deterministic ranking.

The initial socket-based route fixture encountered a Windows EACCES error on a dynamic loopback port. The retained fixture dispatches through the actual Express router in process, removing dependency on Windows port exclusions. It verifies route ordering/authentication wiring with stub controllers; controller behavior and rate limits have separate focused checks. It is not a live deployment HTTP test.

Local integration prerequisites, without application .env loading:

```powershell
$env:JOBS_TEST_REDIS_URL = 'redis://127.0.0.1:6379'
$env:JOBS_TEST_MONGODB_URI = 'mongodb://127.0.0.1:27017'
node --test backend/src/tests/jobsHubLocal.integration.test.js
```

The Mongo test creates a random `jobs_hub_test_*` database, verifies ownership before dropping only that database, and does not use the application's database. The Redis test prefixes every touched key with a unique test namespace and deletes only those exact keys. Remote URLs are rejected. The initial implementation did not obtain real-service evidence; its sandboxed probes did not establish host-level service availability. The unblocking findings above supersede that initial infrastructure assessment.

All 15 changed JavaScript files were passed explicitly to the installed Prettier executable in write mode, using singleQuote=true, trailingComma=none, printWidth=100 and CRLF; the same paths/options were checked afterward. An initial transient Windows file-write failure affected two files; retrying write mode succeeded. Syntax checks cover those same 15 files. Git working/staged whitespace checks are included after finalization.

An informational local ranking smoke check processed 1,000 representative jobs in 136 ms. This is a single CPU-path sample, not a load test or end-to-end latency guarantee. No frontend tests, exhaustive E2E, full repository regression suite, paid API calls, database migrations, or dependency installation were performed.

No files were moved or deleted. No temporary logs, screenshots, traces, generated assets or throwaway scripts were created. The retained additions are source modules, focused tests, and this verification report. Existing unrelated files and historical evidence remain intact.

## Exact file inventory

Modified:

- backend/src/controllers/jobController.js
- backend/src/models/jobCache.js
- backend/src/routes/jobRoutes.js
- backend/src/services/jobService.js
- backend/src/services/jobSourceSyncService.js
- backend/src/utils/jobRanker.js

Added:

- backend/src/controllers/jobActionController.js
- backend/src/middleware/jobsRateLimit.js
- backend/src/models/userJobAction.js
- backend/src/services/jobActionService.js
- backend/src/services/jobGovernanceService.js
- backend/src/services/jobPoolCacheService.js
- backend/src/services/jobProviderTransport.js
- backend/src/tests/jobsHubHardening.test.js
- backend/src/tests/jobsHubLocal.integration.test.js
- backend/verification/jobs-hub/finalization.md

## Remaining release gates

Real Mongo integration and separate real Upstash Redis verification are now complete. Frontend development can proceed. Verify deployment index creation/query plans, durable Redis behavior, region-specific latency, real provider credential configuration, purchased quota ceilings, source licensing, and worker startup in staging before release. Approval does not assert paid-provider availability or a completed production deployment.
