# Shared Redis cache final local acceptance

28 October 2026 (Asia/Karachi). **LOCAL FAIL: the 150 ms shared-cache reliability gate fails; live write/consistency acceptance is blocked by Upstash quota exhaustion.** No application fix or configuration change was justified within this scope.

Source/current branch: `task/integrations`, confirmed by the user; initial working tree/index clean. PR target: not applicable. No branch switch, commit, push, deployment or migration. Reviewed `AGENTS.md`, the solution architecture charter, Redis/cache/governance code, and the latest Final Integrations, Functional, Real Provider and retained production-finalization evidence.

## Configuration and implementation

| Area               | Finding                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Client             | Installed `redis` 4.7.1. `REDIS_URL` absent; existing Upstash token/host configuration selects `rediss://` TLS. Credentials were neither printed nor changed.                                                                                                                                                                                                                                    |
| Connection reuse   | One process singleton and shared initialization promise; repeat initialization returned the same client. One TLS connection served all 36 measured commands. Installed SDK defaults: TCP no-delay enabled, keepalive 5 seconds.                                                                                                                                                                  |
| Bounds             | Connect timeout 3,000 ms; up to two SDK reconnect retries, then application retry after 15 seconds. Offline queue disabled; outstanding command queue capped at 2,000. Default command wrapper 150 ms; existing per-call overrides permit 150–1,500 ms.                                                                                                                                          |
| Governance         | Integrations controls explicitly use 500 ms and fail closed with 503. No process-local quota fallback. These settings remain unchanged.                                                                                                                                                                                                                                                          |
| Cache              | Memory first, maximum 2,000 entries; ordinary default TTL one hour. Writes fill memory before a fire-and-forget Redis write. Read failures become misses; failed writes/invalidation log and continue. A wrapper timeout does not cancel an already sent command; late writes can succeed.                                                                                                       |
| Revision ownership | Interview payloads use global/topic revisions, maximum 30-second memory TTL and atomic value/PTTL reads. Ordinary ready/recovery rotates the global revision; probes deliberately skip that write. Integrations downstream identity derives from current Mongo snapshots/revisions; local invalidation alone is not cross-worker correctness. Sprint also has its own 120 ms shared-read budget. |

## Bounded latency measurement

Sanitized samples, connection timings, failed setup diagnostics and process checks: [retained evidence](shared-redis-cache-final-measurement.json). The sandbox connection failed; a network-enabled probe reached the configured service. Initial attempted GET/SET workload stopped at its setup SET rejection. The completed workload used **24 sequential and 12 concurrency-three GETs of one unique missing key**, awaiting underlying replies between sequential calls/batches. No workload retries, full suites, builds or extended load. Missing-key reads isolate small-command latency; successful payload-hit/write latency is unverified.

Milliseconds, nearest-rank quantiles of actual SDK completion, including replies arriving after the unchanged application deadline:

| Workload      |   n |    p50 |    p95 |    p99 | 150 ms timeouts | SDK errors |
| ------------- | --: | -----: | -----: | -----: | --------------: | ---------: |
| Sequential    |  24 | 178.63 | 181.92 | 184.39 |    24/24 (100%) |          0 |
| Concurrency 3 |  12 | 179.79 | 180.60 | 180.60 |    12/12 (100%) |          0 |
| Combined      |  36 | 179.36 | 181.92 | 184.39 |    36/36 (100%) |          0 |

Application timeout observation p50/p95/p99: **157.28/165.28/165.46 ms**. Event-loop monitor p50/p95/p99/max: **15.80/16.26/20.46/21.82 ms**, sampled at 10 ms; this includes the sampling interval, not just excess stall. Sample size is descriptive, not a production tail estimate.

**Root cause:** warm transport/remote-response latency dominated this measurement. Command invocation to first TLS write was at most 0.254 ms sequential / 0.069 ms concurrent; limited concurrency introduced no meaningful queue growth. Cold initialization was 892.63 ms (cumulative DNS 335.19, TCP 456.36, TLS 584.97 ms), entirely outside command timing. Event-loop scheduling delayed deadline delivery but does not explain the dominant response time. Exact packet RTT versus Redis server execution was not separately observable; no claim of measured server CPU time is made. Later diagnostic PING/GET completed in 63.52/67.58 ms, demonstrating time-varying conditions rather than a fixed geographic latency floor. The measured 150 ms timeouts unnecessarily discarded successful replies, but their impact on real payload hits cannot be quantified while writes are blocked.

**Independent operational blocker:** SET and DEL returned `ERR max requests limit exceeded. Limit: 500000, Usage: 500002`. PING/GET still worked. A successful PING therefore does not certify a writable shared cache. No quota reset, limit change or further live probing followed this diagnosis. No global timeout increase can fix this rejection. Reducing transport latency or selecting a feature-specific budget requires healthy-service evidence and an explicit latency tradeoff; no speculative source change was made, so no post-fix comparison applies.

## Focused correctness, fallback and recovery

| Check                    | Result and scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused tests            | **7 PASS, 0 FAIL, 0 skipped**: read-only initialization/default deadline; Integrations admission at 180 ms and fail-closed failure; Interview remaining TTL, cross-worker topic revision/late-fill fencing, bounded memory and recovery namespace. Fixtures/mock Redis, not live Upstash certification. Exact command retained in evidence.                                                                                                                                                       |
| Local hits/misses        | Actual service in independent processes: seeded memory returned a hit; disconnected missing key returned a miss. Live GETs returned null; rejected SETs mean these are not shared-hit evidence.                                                                                                                                                                                                                                                                                                   |
| Outage safety            | Closed only worker A's Redis connection; memory remained usable. Actual Integrations governance returned 503 with **zero outbound operations**. No server outage or production setting was induced.                                                                                                                                                                                                                                                                                               |
| Recovery/restart         | Worker A reconnected and a fresh worker B initialized. Shared payload recovery/persistence remains **BLOCKED**, because every fixture SET was rejected. Probe-only startup deliberately does not certify the ordinary startup revision write.                                                                                                                                                                                                                                                     |
| Cross-worker consistency | Current focused revision fixtures PASS. Retained `PRODUCTION-FINALIZATION-REPORT.md` and `final-local-acceptance/final-checks.json` establish earlier disposable two-worker/Mongo revision correctness; `functional-downstream-2026-10-27.json` retains accepted downstream adoption. Live Upstash shared hits/revision invalidation/restart remain **BLOCKED**. Unversioned keys can retain another worker's local value after deletion; callers must use their established revision identities. |

All attempted remote keys were UUID-scoped, with requested TTLs of 60 or 120 seconds. No SET succeeded; cleanup DEL was quota-rejected, so no successful deletion is claimed. No existing data, application revisions, shared counters, encryption keys, scoring, integrations or credentials were modified. Child processes were stopped. No FLUSHDB, scans, counter resets or production fault injection occurred.

## Finalization and remaining gates

Task plan completed: inspect/preflight → bounded measurement → focused correctness/process checks → evidence/report → explicit-path formatting and cleanup/whitespace validation. No source files changed, so frontend build/typecheck and unrelated suites were unnecessary. Seven tests ran once; documentation-only consolidation did not warrant repeating them.

Added and retained:

- `backend/verification/integrations/SHARED-REDIS-CACHE-FINAL-ACCEPTANCE.md`
- `backend/verification/integrations/shared-redis-cache-final-measurement.json`

Three task-created intermediate receipts were consolidated losslessly into the retained JSON and then deleted after exact-path/ownership verification:

- `backend/verification/integrations/shared-redis-cache-command-diagnostic.json`
- `backend/verification/integrations/shared-redis-cache-write-diagnostic.json`
- `backend/verification/integrations/shared-redis-cache-behavior.json`

No files moved, reusable scripts or temporary logs left behind. Explicit-path installed Prettier write/check with `--single-quote --print-width 100 --trailing-comma none`, JSON parse/reference checks, and unstaged/staged `git diff --check`: **PASS**. Final Git status contains only the two task evidence files.

**Production-only gates:** operator resolution of Redis quota/capacity without resetting application counters; deployed-worker TLS/network and writable-service checks; bounded real payload GET/SET/revision latency within each feature's own budget; cross-worker invalidation, outage recovery and ordinary restart under deployment topology. Preserve fail-closed governance throughout. Existing OAuth, durable keyring, callback and Mongo topology/index gates from prior acceptance remain open. This local result authorizes no production action.
