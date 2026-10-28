# MongoDB integration governance acceptance

28 October 2026, Asia/Karachi. **REDIS-INDEPENDENT CONNECT/SYNC PASS; RATE LIMITS PASS; CONCURRENCY PASS; SECURITY PASS** in the disposable local acceptance environment. Production activation remains a separate operator action.

## Scope and selection

Source `task/integrations` was confirmed in this conversation. Implemented on `fix/integration-mongo-governance`; PR target not applicable. Initial status contained only the preceding shared-Redis report and its JSON evidence; both were preserved. Read `AGENTS.md`, the architecture charter, existing cache/governance, Connect/OAuth controllers, adapters, transactional persistence, sync/polling and recent acceptance evidence.

The demonstrated 503 was an Upstash write rejection at request limit 500,000 / usage 500,002, not the 150 ms cache deadline. Added **explicit** `INTEGRATION_GOVERNANCE_STORE=mongo` as the requested alternative. The default remains `redis` for compatibility. Selection is fixed when the module loads; invalid selections fail closed. There is no automatic fallback and no simultaneous Redis/Mongo admission in this mode. Redis cache implementation and its deadlines are unchanged.

To activate, configure `INTEGRATION_GOVERNANCE_STORE=mongo` identically on every application/polling worker, using the existing transaction-capable MongoDB connection. Drain all old workers first. Wait for outstanding 60-second request windows and leases (maximum job lease 130 seconds) to expire; longer provider cooldowns must also expire or be preserved under a separately reviewed handover. Do not alternate stores to obtain another quota window. This task did **not** edit `backend/.env`, restart the user's application, or change production configuration. An application still selecting Redis will continue to depend on writable Redis admission.

## Implementation and ownership

- Existing `run`, `request`, `reserve`, `finish`, `withJob` and `actionLimit` APIs remain compatible. Connect, OAuth exchange/identity/refresh/revocation, manual Sync and background polling already enter these boundaries; their callers did not need changes.
- Mongo snapshot transactions with majority writes atomically check global/provider active leases, provider/user minute budgets and cooldowns, then commit all counters/leases before outbound work. Aborted/denied admissions spend no partial request budget. Global and provider documents serialize concurrent workers. Job and outbound-request concurrency retain their existing separate policy semantics.
- Opaque lease tokens prevent a stale release from removing a replacement lease. Each lease retains its own deadline; the document expiry is the latest active lease. Expiry is checked on reads, independently of the eventual TTL sweep. Provider failures, 401/403/429, Retry-After, successful-response backoff and exhausted provider quotas preserve the established cooldown behavior.
- Uses only the current Mongoose connection. Transactions have a 2,000 ms retry/operation budget and 1,000 ms commit bound; concurrent initial `_id` insertion races retry the entire transaction at most three times. Missing connectivity, unsupported transactions, index conflict and store-operation failure become the existing sanitized 503. No provider call occurs inside a transaction.
- New `integrationgovernancestates` collection has its built-in unique `_id` index and one required `governance_expiry` TTL index (`expiresAt: 1`, `expireAfterSeconds: 0`). Initialization inspects existing indexes, adds the absent TTL index and refuses incompatible expiry indexes; it never replaces an index. Index inspection/creation was exercised only on the disposable database. Existing connection/insight/log indexes, schemas and historical records were not changed.
- Mongo remains authoritative for owned connection claims, OAuth state consumption, mutation fencing and integration insights. Existing encryption/AAD, scoring, duplicate-sync prevention and downstream revision identities are unchanged. Redis remains optional ordinary caching; misses use existing authoritative paths.

## Focused verification

Command from `backend`:

```text
node --test src/tests/integrationMongoGovernance.test.js src/tests/integrationsGovernance.test.js src/tests/integrationsLifecycle.test.js
```

**20 PASS, 0 FAIL, 0 skipped.** [Sanitized evidence](mongodb-governance-acceptance.json). The new acceptance comprises one parent and eleven subtests; existing Redis governance/lifecycle regressions provide eight checks.

| Gate                     | Evidence                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Redis-disabled lifecycle | Actual authenticated Express routes: Connect → Sync → Disconnect persisted captured lee215 observations through actual adapters, normalization and transactions. Redis client access throws in the fixture; **zero governance Redis calls** occurred. Four HTTP-boundary fixture replays; **zero real provider HTTP requests**.                                                            |
| OAuth/security           | Fixture token exchange and identity calls passed real admission. Foreign-owner state consumption and replay rejected before additional provider work. Credentials persisted encrypted; changing the owner failed authenticated decryption. JWT protection and private response regression checks passed. This is not live OAuth consent acceptance.                                        |
| Rate limits              | Provider/user request budgets rejected with 429; denied requests left the provider budget unchanged. The eleventh action rejected at the configured ten-action cap. Tests use deliberately small process-local fixture limits; application defaults were not changed.                                                                                                                      |
| Two-worker concurrency   | Two independent Node processes racing for one provider slot produced exactly one admitted reservation and one 429. Two global slots rejected a third provider; job admission rejected overlapping work. Release restored capacity. No process-local counter established correctness.                                                                                                       |
| Expiry/restart/recovery  | A worker exited with an outstanding lease; another worker remained blocked. Fixture-owned timestamps were advanced to represent expiry without waiting or relying on TTL deletion; admission recovered and an old token could not release the new lease. Expired request windows reset logically. Mongo disconnect rejected admission with 503/zero outbound work and reconnect recovered. |
| Store outage             | Injected failure specifically in authoritative admission returned HTTP 503 before the adapter ran, while authentication's Mongo reads remained available. The disconnected-store test also returned 503. Changing the environment variable after module load did not change the selected store.                                                                                            |
| Cooldowns/polling/cache  | Header/payload backoff, 401/403/429 and three independent failures blocked new admission. Actual polling persisted a self-reported certification fixture through Mongo job admission. A warmed second-worker Sprint cache changed identity after the first worker disconnected an integration.                                                                                             |

The initial sandbox Mongo process could not start; the network/process-enabled disposable run succeeded. That first enabled run exposed two harness errors: a nonexistent disconnect route and a repeated-failure test that exhausted its fixture user budget before its third failure. Corrected both expectations; the final focused run above passed. No application correction was needed for those harness failures. No broad suite, frontend build, provider retry experiment or stress test ran.

## Bounded performance comparison

| Measurement                       |   n |       p50 |       p95 |       p99 | Interpretation                                                |
| --------------------------------- | --: | --------: | --------: | --------: | ------------------------------------------------------------- |
| Local Mongo admission transaction |  12 |  15.79 ms |  31.82 ms |  31.82 ms | Sequential complete admissions; release excluded from timing. |
| Retained warm Upstash GET         |  36 | 179.36 ms | 181.92 ms | 184.39 ms | Earlier cache probe; 36/36 exceeded its 150 ms wrapper.       |

These are different workloads/topologies, not an equal-workload speedup claim. Upstash governance writes were quota-rejected, so no successful live Redis-admission baseline exists. Existing 500 ms Redis governance behavior still passed its focused regression. The small Mongo sample is descriptive; production transaction latency/contention remains a deployment gate. No additional live Upstash commands were needed for this implementation.

## Finalization and exact inventory

Modified:

- `DEVINSIGHT_AI_SOLUTION_ARCHITECTURE_CHARTER.md` — records the authorized integration-only alternative.
- `backend/.env.example` — documents explicit store selection and coordinated handover.
- `backend/src/services/integrationGovernanceService.js` — routes unchanged governance boundaries to the selected authority.

Added:

- `backend/src/models/integrationGovernanceState.js`
- `backend/src/services/integrationMongoGovernanceService.js`
- `backend/src/tests/integrationMongoGovernance.test.js`
- `backend/src/tests/fixtures/integrationMongoGovernanceWorker.js`
- `backend/verification/integrations/mongodb-governance-acceptance.json`
- `backend/verification/integrations/MONGODB-GOVERNANCE-ACCEPTANCE.md`

No repository files moved or deleted. Disposable Mongo stopped and 115 verified task-owned database files were removed by the existing guarded helper; both child workers stopped. No abandoned scripts, logs, screenshots or traces. The two earlier shared-Redis evidence files remain untouched. Explicit-path installed Prettier write/check passed for changed JavaScript, Markdown and JSON (single quotes, width 100, no trailing commas); `.env.example` retains its existing plain environment-file conventions. All five changed/added JavaScript syntax checks and unstaged/staged Git whitespace checks passed. No dependencies, credentials, encryption keys, scoring rules, shared Redis counters or existing user work changed. No commit, push, merge, deployment or production configuration change.

## Remaining blockers

No remaining blocker for the implemented **selected-Mongo local fixture scope**. Activation requires the coordinated store selection described above, transaction-capable MongoDB, and permissions to inspect/create the new collection/TTL index. All workers must use the same authority and synchronized clocks, as the existing policies use worker timestamps. Verify bounded admission latency/contention and Mongo outage/recovery under the deployed topology before production release. Existing live OAuth consent, durable secret-manager/key retention and deployment callback/topology gates remain open. Ordinary cache latency and unrelated Redis-dependent modules remain outside this integration-only alternative.
