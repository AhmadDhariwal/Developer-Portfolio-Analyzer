# Repeated integration requests and optional Redis audit

28 October 2026, Asia/Karachi. **REPEATED CONNECT PASS | SYNC SEMANTICS PASS | LEASE SAFETY PASS | SNAPSHOT REUSE PASS. Decision: retain Mongo-only public snapshots; do not add production Redis read-through.**

Continued on the previously confirmed `fix/integration-mongo-governance` branch; PR target not applicable. Read `AGENTS.md`, the architecture charter and [scalability acceptance](FINAL-SCALABILITY-ACCEPTANCE.md). Initial staged work and prior reports were preserved. No staging, commit, deployment, production configuration or secret changes.

## Findings and targeted fix

Fresh snapshots already prevent repeated provider fetching. The unchanged public-snapshot implementation's retained two-worker evidence served 500 virtual users from one source fetch, including restart/invalidation fencing. This task reused that evidence rather than repeating the 1,000-user simulation. The new authenticated fixture also verified one source fetch across two accounts and no new fetches on repeated Connect or Sync.

Repeated Connect still unnecessarily reset its nonce/lease, normalized again, rewrote the connection/insight and invalidated downstream state. More seriously, `beginManual` cleared an active Sync lease. A Sync claim acquired after manual validation began could also be overwritten at Connect commit.

Added a narrow fresh-Connect no-op: a consistent Mongo read transaction checks the active owned account, identical successful credential-free connection, five-minute owned freshness, fresh shared snapshot and equality with that account's stored observation. The response explicitly says it is already connected to the fresh public profile. No connection timestamp, insight or ownership assertion is changed. Stale, changed, failed, credential-bearing and noneligible inputs retain normal Connect behavior.

Action admission still counts every click. A no-op returns connection status rather than adopting a new observation, so it does not spend another observation-read budget. Real Connect/Sync observation reads retain their existing quotas. Manual Sync still claims a lease, normalizes, updates timestamps/scheduling, appends history and invalidates downstream state; it has not become a no-op. Concurrent cold Connect attempts may still return the existing fenced 409 response; no new idempotency-key/replay API was introduced.

Manual Connect start and attempt-based commit now atomically require an inactive/expired Sync lease. Busy operations return 409 without clearing the active token. Existing unique indexes, attempt fencing, encryption and persistence APIs remain intact; no schema/index changes were needed.

## Measurements

[Sanitized evidence](repeated-requests-cache-audit.json). Disposable Mongo, actual authenticated routes, captured provider fixtures and local Redis-protocol fixture; **zero real provider or Upstash requests**.

Three identical fresh Connect clicks, same already-cached profile. The baseline disables only the new no-op helper in the fixture:

| Metric                    |  Baseline |  Improved |
| ------------------------- | --------: | --------: |
| Provider calls            |         0 |         0 |
| Normalizations            |         3 |         0 |
| Mongo commands            |        48 |        27 |
| Attempted document writes |        21 |         3 |
| Total elapsed             | 352.71 ms | 224.27 ms |

The remaining three writes enforce action limits. Connection and insight documents remained byte-identical. Two explicit Syncs still performed two normalizations, appended two history records and used zero provider calls while the snapshot was fresh. Writes include update/insert/delete and findAndModify operations, not server-profiler modified-document statistics; timings are small local samples.

The **benchmark-only** read-through prototype required a Mongo metadata read before Redis GET, binding key/generation/absolute freshness and a content hash. Its fixture-only hash is not a production schema change. Twelve alternating baseline/candidate reads per payload:

| Public payload | Mongo-only p50 / p95 / p99 | Read-through p50 / p95 / p99 |
| -------------- | -------------------------- | ---------------------------- |
| 615 bytes      | 2.65 / 5.51 / 5.51 ms      | 4.64 / 6.98 / 6.98 ms        |
| 30,103 bytes   | 3.72 / 4.41 / 4.41 ms      | 4.97 / 6.11 / 6.11 ms        |

Each path still needed **one Mongo read per warm lookup**; the candidate added one Redis GET. Candidate latency was higher at both payload sizes. With twelve samples, p95/p99 equal the maximum and do not establish production tail behavior. No Mongo command reduction was measured. Adding integrity metadata, writes and failure handling is not justified by this evidence. This uses real node-redis against a small RESP fixture, not a complete Redis server or deployed TLS benchmark; no universal Redis-performance claim is made.

Generation mismatch rejected cached data and fetched Mongo again. Expired Mongo metadata returned a miss without consulting Redis. Cold quota/recovery cases required two Mongo reads plus GET/SET; timeout fallback took **166.99 ms**. Known-unavailable Redis bypass needed one Mongo read and zero Redis commands. These extra commands and pending replies would be new costs absent from the current Mongo-only path. No production file imports the prototype.

## Focused acceptance and finalization

**10 PASS, 0 FAIL, 0 skipped:** repeated-request acceptance plus existing lifecycle tests. Active-lease checks passed both before manual validation and after a racing Sync claim; stale owned freshness and credentials did not shortcut. Previous public-snapshot TTL/generation, two-worker single-flight, quotas and cross-worker invalidation evidence remains applicable because that service was not changed.

```text
node --test --test-concurrency=1 src/tests/integrationRepeatedRequests.test.js src/tests/integrationsLifecycle.test.js
```

An initial run completed the Connect/lease checks and warm measurements but timed out during prototype teardown: QUIT raced a timed-out SDK reply. The test harness now observes the socket-disconnected state before cleanup; the focused rerun passed. Final review also corrected write-count instrumentation to include findAndModify and reran the small affected checks successfully. Production cache shutdown was not changed or newly certified. Mongo processes/cache sockets stopped; the existing guarded helper removed 118 verified task-owned database files in the final run. No abandoned scripts, logs or traces remain. No full suites, builds, live requests or extended load tests ran.

Modified:

- `DEVINSIGHT_AI_SOLUTION_ARCHITECTURE_CHARTER.md`
- `backend/src/controllers/integrationscontroller.js`
- `backend/src/services/integrationPersistenceService.js`
- `backend/src/tests/integrationsLifecycle.test.js`

Added:

- `backend/src/tests/integrationRepeatedRequests.test.js`
- `backend/src/tests/fixtures/integrationRedisReadThroughCandidate.js`
- `backend/verification/integrations/repeated-requests-cache-audit.json`
- `backend/verification/integrations/REPEATED-REQUESTS-CACHE-AUDIT.md`

No files moved/deleted. Explicit-path Prettier write/check, changed JavaScript syntax, evidence/reference/secret checks and unstaged/staged Git whitespace checks passed. Acceptance covers the working tree; existing staging was preserved. Prior deployment/consent/topology gates remain open. The prototype adds no production cache dependency, admission counter, ownership claim, private observation or account score.
