# Scenario Simulator — Root Cause and Final Lock Report

**Decision: do not lock.** The direct 60-second burst fails the unchanged availability limit. The trace proves the immediate failure mechanism is delayed Node worker event-loop/socket processing: Redis quota calls are correctly dispatched to the shared server and reply after the 150 ms deadline, while both independent workers experience synchronized event-loop pauses. It does not isolate whether those pauses originate in application synchronous work or the Windows/WSL1 runtime. There is no evidence-based application patch to make safely, so the corrected full extended acceptance was not run.

Date: 25 October 2026. Reviewed `AGENTS.md`, the architecture charter, `FINAL-ACCEPTANCE.md`, `FOCUSED-RELIABILITY-REPORT.md`, and the previous `FINAL-LOCK-REPORT.md`. Git preflight confirmed source/current branch `task/simulator`, commit `f3883e6efa5e89893cb05711a7544d2245ca6067`; target branch is not applicable to local verification. Existing staged and untracked user work was preserved. No production data or shared quota was accessed or reset.

## Diagnosis

The direct-infrastructure, 60-second trace is retained in [root-cause-trace.json](D:/Developer-Portfolio-Analyzer/backend/verification/scenario-simulator/root-cause-trace.json), run `3603be1f-b0e9-49f1-9fde-510fc50c81cb` (16:26:38–16:28:11 UTC). The source hashes recorded by that run match all 12 recorded files in the current checkout. Both workers used direct connections to the same disposable Redis server; no forwarding proxy or CPU profiler was in the capacity path. Fixed-size trace buffers retained all 6,000 burst requests and 6,000 Redis MONITOR commands within their declared bounds.

The 6,000-request 100-RPS burst returned **5,915 successes and 85 quota 503s (1.42%)**: 44 errors on worker 18732 and 41 on worker 7176. All 85 records identify `Redis command timed out.` The limiter returned fail-closed 503s; it did not admit requests through local fallback. For every failed request, the matching underlying Redis command later completed and its reply reached the worker **after** the HTTP 503. Thus the failure was a delayed command path, not an absent quota call or lost Redis reply.

The trace breaks down that path. The Redis `EVAL` entered the Redis client socket in under **0.32 ms** at p95. The socket's underlying write was dispatched after **66–70 ms median** and **133–159 ms p95**. Redis MONITOR, calibrated against `TIME` with **0.56 ms** uncertainty, saw the counter around **68–80 ms after quota start** at median. The client read the matching reply **195–202 ms after quota start** at median, after the 150 ms command deadline had elapsed. Failed-command client queue samples had **zero commands waiting to be sent**; waiting-for-reply p95 was 18 and 7 commands respectively, far below the retained 2,000-command guard. This is not an overloaded outbound Redis command queue.

Event-loop evidence overlaps every failed request: **44/44** failures overlapped a measured pause on worker 18732, **41/41** on worker 7176, and **84/85** also overlapped a pause on the other worker. Pauses reached **232/246 ms**. The verifier's independent event loop also paused up to **115 ms**, overlapping 31 failures. A separate Redis connection's PING RTT was **0.82 ms median, 7.97 ms p95, 26.70 ms p99, and 302 ms maximum**. That PING includes scheduling in the verifier process, so it is not a pure network measurement; together with the cross-worker pauses it shows this Windows/WSL1 test host has intermittent scheduling/transport stalls.

Redis server measurements do not show a slow Lua bottleneck: the run recorded 6,206 EVAL calls and **70.69 μs average server execution time** across phases; the longest retained Redis SLOWLOG command was **9.032 ms**. These are server-side measurements, distinct from the much longer client-observed interval. GC overlapped 27 of the 85 failures; the longest observed GC event was **25.13 ms**, and most failures did not overlap GC. GC alone cannot explain the synchronized pauses or the 150 ms deadline misses.

The evidence proves event-loop/socket scheduling delay is the immediate cause of the quota timeouts. It does **not** establish which synchronous application callback or host scheduling/network component causes the pauses. The separate direct 60-second run in [final-lock-direct.json](D:/Developer-Portfolio-Analyzer/backend/verification/scenario-simulator/final-lock-direct.json) also failed with 49/6,000 503s, while the earlier 15-second direct burst passed. This shows the trace observer is not needed to reproduce the sustained failure. Its additional bounded observation still makes the 85-error run less representative than an observer-free deployment benchmark.

The available host is Windows with Redis 7.2.11 under WSL1, Node 24.19.0, and eight logical CPUs. Because both app workers and the test controller show overlapping pauses, this environment cannot separate a host/runtime scheduling defect from an application main-thread stall with enough confidence to justify changing application behavior. A native Linux, deployment-equivalent two-worker/Redis run with low-overhead event-loop and socket timing is the precise remaining diagnostic gate.

## Before and current results

| Run                           | Duration and path                             | Availability                 | Successful-response latency                                   |
| ----------------------------- | --------------------------------------------- | ---------------------------- | ------------------------------------------------------------- |
| Historical extended burst     | 60 s, original harness                        | 5,942/6,000; 58 503s (0.97%) | context p95/p99 504/599 ms; evaluation 336 ms; history 245 ms |
| Earlier focused burst         | 15 s, direct Redis                            | 1,500/1,500; zero 503s       | context p95/p99 55/176 ms; evaluation 26 ms; history 27 ms    |
| Prior final-lock direct burst | 60 s, direct Mongo/Redis                      | 5,951/6,000; 49 503s (0.82%) | context p95/p99 191/811 ms; evaluation 129 ms; history 58 ms  |
| Per-request trace burst       | 60 s, direct Mongo/Redis with bounded tracing | 5,915/6,000; 85 503s (1.42%) | context p95/p99 443/911 ms; evaluation 233 ms; history 183 ms |

The per-request trace burst also measured save/export p95 of 181/255 ms. The unchanged limits are healthy-context/save/export p95 ≤500 ms, evaluation p95 ≤200 ms, history p95 ≤150 ms, context p99 ≤1,000 ms, with no unexpected 5xx and published error rate <0.5%. The trace run fails availability, evaluation/history p95 and the stricter zero-error check. Failed requests are counted separately and excluded from successful-response latency percentiles.

## Changes and tests

**Application fix implemented: no.** No application defect was proven at a code location. Changing the quota timeout, adding retries, relaxing the zero-error/latency limits, reducing offered load, or enabling local quotas would hide the measured failure or alter the existing distributed-quota contract. The previously implemented Redis SDK command-queue bound of 2,000 remains in place. APIs, schemas, scoring, authentication, history, snapshots and Sprint contracts were not modified.

The pre-existing opt-in trace harness and trace evidence were present in the working tree at preflight; they were read and preserved. This task changed only this report. The source manifest verifies the trace run's source versions; no source hash differs in the current checkout.

Affected regressions passed:

```powershell
node --test backend/src/tests/scenarioSimulatorReliability.test.js backend/src/tests/scenarioSimulatorContext.test.js backend/src/tests/redisConnectionProbe.test.js
```

Result: **11 passed, 0 failed, 0 skipped**. This unit/contract suite does not override the failed live burst. The direct 60-second burst and per-request trace above are the focused live results; the burst gate is **FAIL**. No memory test was repeated because the preceding isolated three-minute fixed-space memory check passed and this task made no application-memory change.

The corrected full extended acceptance was **not run**. Its precondition—a passing focused direct burst—was not met. The historical 100,800-request / 60-minute run remains failed evidence; it is not being replaced with a new pass claim.

## Infrastructure and remaining gates

Use isolated, deployment-equivalent Linux development infrastructure for the next focused reproduction. Preserve the same real two-worker shared Redis atomic limiter, 150 ms command deadline, exact 100-RPS/60-second mix and acceptance thresholds. Capture per-request command queue/write/reply timestamps, Redis server execution, low-overhead network RTT, and worker event-loop/GC intervals. If synchronized pauses persist with healthy Redis execution, collect a low-overhead CPU/event-loop profile to identify the blocking callback before changing application code. Do not rerun the 60-minute protocol until that direct burst passes.

Once focused burst acceptance passes, run the corrected full extended protocol exactly once. Its steady, restart, source-failure, pool-pressure, memory/soak, Mongo history, concurrency, ownership and Sprint replay gates remain unverified after the latest trace instrumentation. Representative full-history/source evidence and deployment-equivalent topology also remain gates from `FINAL-ACCEPTANCE.md`.

Production still requires a read-only index/duplicate audit and reviewed rollout where needed; real Redis TLS/ACL, capacity, failover and quota retention evidence; deployed request deadlines, gateway protection, readiness and graceful load-balancer failover; bounded Mongo pool/outage latency; production monitoring/runbooks; Career Sprint owner sign-off and actual legacy-data preservation evidence; and explicit deployment/protected-branch approval. No deployment or production operation was performed.

There is no application rollback for this task. Preserve the existing queue bound, snapshots, receipts and historical scores. The trace scripts and JSON are essential evidence and were not moved or deleted. No unrelated modules were changed or retested.

## Finalization

The affected 11-test command passed. All five verifier/trace scripts pass `node --check`. Prettier write/check was run on this report with the repository-installed formatter and explicit path, `--single-quote --print-width 100`; Git staged and unstaged whitespace checks pass. Existing staged work was preserved.

- ROOT CAUSE PROVEN AND FIXED: NO
- ACTUAL APPLICATION FIX IMPLEMENTED: NO
- FOCUSED BURST ACCEPTANCE: FAIL
- EXTENDED ACCEPTANCE: NOT RUN
- READY TO LOCK LOCALLY: NO
- READY FOR PRODUCTION: NO

The direct blocker is unresolved event-loop/socket scheduling latency on the available Windows/WSL1 test topology. The immediate timeout mechanism is established; its underlying application-versus-host scheduling source is not. Do not lock the module until the focused burst passes and the corrected extended acceptance completes.
