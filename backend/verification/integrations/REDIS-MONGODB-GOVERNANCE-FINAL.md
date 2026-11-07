# Final Redis/MongoDB integration governance architecture

28 October 2026, Asia/Karachi. **REDIS-INDEPENDENT CONNECT/SYNC PASS | RATE LIMITS PASS | CONCURRENCY PASS | AUTHORIZATION PASS | FAILURE RECOVERY PASS | DATA PRESERVATION PASS | LOCAL READINESS PASS** for the current working tree and disposable acceptance scope. Production activation/topology acceptance remains separate.

## Audit and demonstrated issues

Continued on the user-confirmed `fix/integration-mongo-governance` branch; original source `task/integrations`, HEAD `9e08dcb6`; PR target not applicable. Read `AGENTS.md`, the architecture charter, cache/governance, Mongo persistence/indexes, Connect/OAuth routes, adapters, polling and the preceding acceptance reports. Preserved all earlier uncommitted source/evidence. Concurrent staging appeared during this run; no staging, unstaging, reset, commit or branch integration was performed.

The original integration 503 came from Redis-dependent action/provider/job admission, not ordinary caching. Retained [shared-cache evidence](SHARED-REDIS-CACHE-FINAL-ACCEPTANCE.md) established Upstash write rejection at limit 500,000 / usage 500,002. Its 150 ms cache deadline also discarded successful warm replies, but integration governance already used 500 ms; increasing that timeout could not repair quota rejection.

The [previous Mongo acceptance](MONGODB-GOVERNANCE-ACCEPTANCE.md) verified a working transaction-backed alternative, but still defaulted to Redis and retained two selectable counter implementations. That architecture is superseded here: **MongoDB always owns integration admission**, even if the obsolete `INTEGRATION_GOVERNANCE_STORE` variable says `redis`. No cache health event or environment selector can change that authority.

The new failure matrix also demonstrated a cache teardown defect: a socket closing during `QUIT` could trigger another asynchronous `disconnect()` rejection that was not awaited. The targeted fix awaits disconnect failures and skips an already-closed client. The unchanged 150 ms command deadline, queue cap, cache TTLs and reconnect policies remain intact.

## Responsibilities and preserved behavior

| Responsibility           | Authority / behavior                                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider requests        | Existing Node/Express adapters and bounded transport; no HTTP inside Mongo transactions.                                                                                     |
| Authentication/ownership | Existing JWT/User checks, owner-scoped persistence, OAuth state consumption and mutation fences. No authorization bypass.                                                    |
| Integration admission    | Existing Mongo adapter only: atomic provider/user minute budgets, action limits, global/provider request concurrency, separate job concurrency and provider cooldowns.       |
| Connection truth         | Existing Mongo transactions, unique user/provider index, duplicate-sync claim and fenced commit; conflicts remain 409.                                                       |
| Tokens/history/scoring   | Existing encrypted credentials, immutable historical data and scoring remain unchanged.                                                                                      |
| Optional caches          | Redis/memory caches may miss or reject writes; existing Mongo-backed source reads and revision identities remain authoritative. Redis has no integration admission counters. |

Policy defaults remain 8 global / 2 provider concurrency, 60 provider requests / 20 account-provider requests per minute and 10 mutation actions per minute; all existing configured overrides and operation/request bounds remain unchanged. Fixture-only settings deliberately use smaller limits for bounded verification.

The reused `IntegrationGovernanceState` model/adapter needs no further schema or index changes. Snapshot transactions with majority writes serialize shared global/provider documents before outbound work. Existing `_id` uniqueness and bounded whole-transaction retries handle first-insert races. Counter windows and individual leases are checked against their dates; TTL deletion is storage cleanup, not correctness. A stale token cannot release a replacement lease. The only governance indexes remain `_id_` and `governance_expiry` (`expiresAt: 1`, expiry zero); incompatible existing expiry indexes fail closed rather than being replaced.

OAuth exchange/identity/refresh/revocation enter `governance.request` through existing adapters. Manual ingestion enters `run`; Sync and polling also use `withJob`; action middleware covers protected mutation routes and public callback/webhook admission. Existing transactional webhook replay receipts and connection claims remain untouched. Mongo admission failure produces sanitized 503 before provider work; quota/concurrency saturation produces 429.

## Redis configuration and rollout boundary

The existing explicit configuration supports local development with `REDIS_URL=redis://127.0.0.1:6379`, and deployment with a TLS `rediss://` URL or the existing Upstash fields. `REDIS_URL` has precedence. `.env.example` now documents these roles and removes the obsolete admission selector. No real environment file, secret, encryption key, production service or deployment was changed; local Redis installation/service provisioning was not part of this task.

All application and polling workers must run this Mongo-only implementation together. Before replacing legacy Redis-governed workers, drain them and preserve outstanding 60-second budgets, leases (maximum job lease 130 seconds) and any longer provider cooldowns. No counters were copied, cleared or reset. Never overlap old Redis-authoritative workers with new Mongo-authoritative workers to obtain independent quota windows.

## Focused verification and failure recovery

[Sanitized final evidence](redis-mongodb-governance-final.json). **25 affected checks PASS** across the final successful Mongo invocation (13 checks) and the other affected checks (12) in the preceding invocation. Exact commands and unsuccessful-attempt diagnostics are retained in the JSON. No live provider/Upstash requests, OAuth consent, full suites, stress tests or production builds ran.

| Check                                 | Result                                                                                                                                                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cache state matrix                    | Healthy, unavailable, quota-exhausted, timed-out and restarted/recovered cache: each actual authenticated Connect → captured Fetch → Normalize → Mongo → Sync → downstream read → Disconnect returned 200.                                                                            |
| Durable budgets through Redis changes | Shared provider count advanced **2 → 4 → 6 → 8 → 10 → 12**, exactly two admitted fixture requests per lifecycle. Cache restart never reset or bypassed Mongo counters.                                                                                                                |
| Genuine limits                        | Provider/user budgets and action saturation return 429; HTTP action-limit rejection made no provider call. Denied admissions did not partially spend another budget.                                                                                                                  |
| Cross-worker concurrency              | Two independent Node processes racing for one provider slot yielded one admission and one 429. Global cap and separate job cap rejected excess reservations.                                                                                                                          |
| Expiry/restart                        | A worker exited holding a reservation. Another worker remained blocked until fixture-owned timestamps represented expiry; stale release did not remove the new lease. Correctness did not depend on waiting for a TTL sweep.                                                          |
| Cooldowns                             | Header/payload backoff, quota exhaustion, 401/403/429 and repeated failures blocked subsequent admission. Existing Retry-After handling retained.                                                                                                                                     |
| Mongo admission outage                | Injected authoritative-store failure returned HTTP 503 behind successful authentication with zero provider work. Disconnected-store direct admission also failed 503; reconnect recovered without Redis.                                                                              |
| Authorization/data                    | JWT protection, foreign-owner reads/mutations, OAuth state ownership/replay, encrypted token persistence and owner-bound decryption passed. Original fixture insight snapshot remained byte-identical during other users' lifecycles; existing connection indexes remained identical. |
| Downstream/polling                    | Warmed second-worker Sprint cache changed revision after another worker disconnected the integration. Existing polling persisted a certification fixture through Mongo job admission. Earlier accepted non-OAuth workflows/scoring evidence is reused.                                |
| Cache recovery fix                    | Dedicated QUIT/socket-close and failed-disconnect regressions passed; the real cache client completed recovery without unhandled rejection.                                                                                                                                           |

The cache matrix uses the **real node-redis client and cache service against an isolated RESP transport fixture**, including explicit write rejection and withheld replies. It is not a full Redis server or live Upstash certification. Probe-only initialization avoids unrelated Interview revision writes. Fourteen HTTP-boundary fixture replays occurred; actual provider HTTP calls were zero. Both worker processes and cache sockets stopped; the existing guarded helper stopped disposable Mongo and removed 115 verified task-owned database files.

The first matrix run exposed the cache teardown defect above. A subsequent combined invocation hit the existing six-second worker-startup deadline before its Mongo subtests; the other 12 checks passed. Running only the affected Mongo acceptance file then passed all 13 checks. No timeout was raised and no unaffected checks were repeated afterward.

## Bounded latency and operation overhead

Twelve sequential successful Mongo admissions, excluding release time: **p50 30.64 ms; p95/p99 45.67 ms**. Instrumented adapter calls: **60 reads + 48 replacements**, or five reads/four replacements per admission, plus transaction commit. These are adapter operation counts, not packet counts or Mongo profiler measurements. Release separately reads/replaces two lease documents. Shared-document contention and majority commits are the principal scaling considerations; retries are bounded by the existing 2,000 ms transaction budget / 1,000 ms commit bound.

The earlier 12-admission sample measured 15.79/31.82/31.82 ms. The adapter algorithm is unchanged, and these small local samples under different host conditions/instrumentation do not establish a statistically meaningful regression or a production SLO. The retained Upstash GET sample (179.36/181.92/184.39 ms) is a different workload, not an equal-workload speed comparison. No extra live Redis benchmark was run.

## Other Redis-dependent paths: audited, unchanged

| Path                      | Existing dependency / remaining implication                                                                                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jobs Hub                  | `jobGovernanceService` uses Redis for source daily/monthly budgets, intervals, leases and scheduler locks; unavailable controls deny admission. Strict Jobs mutations can still return 503.                                         |
| News Hub                  | `newsGovernanceService` retains Redis source budgets/cooldowns/leases/discovery locks. Cached browsing has local limiter fallback; fresh ingestion still requires its own controls.                                                 |
| Scenario Simulator        | Shared Redis limits remain required in production unless its explicit single-instance mode is selected. Failure can still return 503.                                                                                               |
| Public Portfolio          | Strict contact/upload controls remain Redis-dependent; some other limits use bounded local fallback. Public cache reads still authorize current Mongo visibility/account state.                                                     |
| GitHub analyzer           | Separate from Integrations OAuth: save locking can fall back to Mongo, while refresh/SWR coordination still depends on Redis health/process behavior. No claim of Redis-independent analyzer governance.                            |
| Support / Recommendations | Support retains Mongo dedupe/quota enforcement behind Redis acceleration. Optional recommendation enrichment uses a Redis lock and may proceed when it is unavailable; cross-worker enrichment deduplication is not certified here. |

These are separate feature policies, not reasons to bypass integration admission. Generic cache locks and unrelated scheduled workers were not rewritten.

## Exact final-pass inventory and finalization

Modified during this final pass:

- `DEVINSIGHT_AI_SOLUTION_ARCHITECTURE_CHARTER.md`
- `backend/.env.example`
- `backend/src/services/integrationGovernanceService.js`
- `backend/src/services/redisCacheService.js`
- `backend/src/tests/integrationsGovernance.test.js`
- `backend/src/tests/integrationMongoGovernance.test.js`
- `backend/src/tests/redisConnectionProbe.test.js`
- `backend/src/tests/fixtures/integrationMongoGovernanceWorker.js`

Added:

- `backend/src/tests/fixtures/integrationRedisCacheFixture.js`
- `backend/verification/integrations/redis-mongodb-governance-final.json`
- `backend/verification/integrations/REDIS-MONGODB-GOVERNANCE-FINAL.md`

Reused unchanged from the preceding implementation: `backend/src/models/integrationGovernanceState.js`, `backend/src/services/integrationMongoGovernanceService.js`, and all preceding reports/receipts. No repository files moved or deleted. No abandoned task-owned logs, scripts, traces or screenshots. Explicit-path installed Prettier write/check, JavaScript syntax, JSON/reference/secret checks, and unstaged/staged Git whitespace validation passed. `.env.example` preserves its plain environment-file conventions. Concurrent staged work remains staged; final unstaged/new files remain reviewable. Acceptance applies to the tested working tree, not an independently certified staged snapshot.

## Remaining production gates and limits

Verify transaction-capable deployed Mongo, majority-write latency/contention, permissions for the existing new governance collection/TTL index, consistent worker clocks, coordinated replacement of legacy workers, deployed secrets/callbacks and previously blocked live OAuth consent acceptance. No runtime configuration or deployment was changed by this task.

Admission-store 503 is verified behind working authentication. The shared JWT middleware still maps its own User lookup errors to 401; full-database failure therefore fails closed but may be classified before admission. That pre-existing shared authentication error classification is outside this integration-only change. The fixture does not certify production Redis/Upstash transport, every unrelated Redis-dependent feature, or exactly-once external provider execution after an ambiguous worker/network failure. Existing admission budgets consume each attempt and connection leases continue to fence commits.
