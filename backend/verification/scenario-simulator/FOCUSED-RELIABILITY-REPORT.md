# Scenario Simulator — focused reliability report

Date: 2026-10-25. Final focused run: 15:34:17–15:35:43 UTC.

**Focused checks pass. Full acceptance remains open.** The demonstrated bottleneck was in the local verification path: forwarding shared Redis traffic through the HTTP generator's fault proxy introduced deadline misses. Removing that artificial hop eliminated the reproduced 503s without changing application behavior. CPU profiling also materially disturbed burst measurements. Neither result proves that every failure in the historical extended run has been explained.

## Scope and safeguards

Read `AGENTS.md`, the solution architecture charter and `FINAL-ACCEPTANCE.md` before implementation. Preflight verified current/source branch `task/simulator`; target branch was not applicable because no branch integration was requested. Existing working-tree/index changes were preserved. No branch creation, commit, push, merge, deployment or production-data operation was performed.

Changes are confined to verification scripts and retained evidence. Application scoring, API routes, schemas, source projections, immutable snapshots, Sprint contracts, quotas, the 150 ms Redis command deadline and acceptance thresholds are unchanged. The previously implemented SDK `commandsQueueMaxLength: 2000` guard is retained; this request did not modify `redisCacheService.js`. No new architecture decision required a charter edit.

Every run created its own loopback MongoDB database/process, Redis process/ephemeral port and synthetic accounts. No `.env`, shared Redis endpoint, shared quota reset or production data was used. Cleanup stopped only owned processes and unlinked individually verified task-owned temporary files; no directory was recursively deleted. All five evidence files record successful worker/Mongo shutdown and Redis exit code 0. Historical reports and failed evidence remain intact.

## Findings and corrections

### Burst and quota deadline misses

The failed unprofiled comparison returned **10 quota 503s out of 1,500 requests** with Mongo and Redis both routed through in-process fault proxies. The underlying Redis commands eventually completed without a Redis command error, but worker-observed Lua round-trip p99 reached **160/155 ms**, beyond the unchanged **150 ms** admission deadline. Worker event-loop p99 was **97/87 ms**, maximum **176/154 ms**. The 503s correctly failed closed; they were not permission to fall back to independent local quotas.

Keeping the Mongo proxy and bypassing **only the Redis proxy** produced **1,500/1,500 successful requests**: Lua p99 **22/20 ms**, event-loop p99 **34/34 ms**, and all original HTTP latency limits passed. A separate direct Mongo/Redis comparison also passed. This isolates the extra Redis forwarding path as a demonstrated contributor in this local harness. The measurements include client scheduling, socket transport and callback delivery; they are not Redis-server-only execution times.

The capacity path now connects both workers directly to the same real Redis instance. Redis blackhole, disconnect and lost-acknowledgement tests retain their fault proxies in their separate phases. The extended verifier switches to direct Redis only after its network-failure checks. Its full protocol was **not rerun**. Mongo fault injection remains available for the existing source-failure phases.

The initial diagnostic CPU-profiled run was unsuitable as acceptance evidence: its Mongo-proxy/Redis-direct burst had 80 quota 503s, and its fully direct burst had 316. Profiling-off direct traffic had zero. Profiles showed substantial socket-writing, microtask, document-construction and profiler costs rather than evidence justifying a scoring or quota change. Profiling is now explicit (`--profile`), ends after a short diagnostic burst, and returns `FOCUSED_DIAGNOSTIC_NOT_ACCEPTANCE`; profiled traffic cannot receive a passing capacity status.

This corrects demonstrated verification interference. It does **not** establish that the artificial hop or profiling explains every historical burst, restart or soak failure. The historical extended run did not use this new CPU profiler.

### Restart and readiness

No application readiness or context defect was established in the focused run, so no speculative application startup/drain change was made. The verifier now explicitly checks a context request started before worker drain, starts a replacement process, and routes ongoing requests away from the draining worker. The existing worker closes its HTTP server before Redis/Mongo shutdown.

The final in-flight context completed with HTTP 200 in **36.21 ms**. During replacement, **200/200 requests succeeded**. Context p95/p99 was **62/161 ms**. The six separately recorded cold context/export/evaluation calls also returned 200; cold context took **183.36/121.65 ms**, and cold exports **389.99/278.96 ms**. No warm-up response is substituted for a measured request.

These are verifier-worker lifecycle results. They do not certify the application's deployed process supervisor, global bootstrap/shutdown, readiness endpoint or load-balancer behavior. The earlier restart p99 failure remains historical failed evidence pending extended acceptance.

### Memory and observer cost

The existing fixed 20,001-bin checkout histogram remains in place. New quota timing uses a fixed 2,001-bin histogram; no per-command timing array grows with traffic. Per worker, these two buffers occupy exactly **80,004 + 8,004 = 88,008 bytes**. Capacity/memory checks run without a CPU profiler. Generator histograms and concurrency are bounded; final burst peak outstanding requests was **19**, below the cap of 128.

Forced GC is now reserved for quiescent retained-heap checkpoints. Periodic extended-run sampling no longer requests GC while traffic is in flight. This removes an intrusive measurement action; it does not retrospectively prove GC caused the historical errors. The prior unbounded SDK waiter defect and its 2,000-command correction remain documented in `FINAL-ACCEPTANCE.md`; this request does not replace that real-network proof with a mock or rerun it unnecessarily.

After restart and a 10-second warm-up, the bounded memory check ran three 10-second windows at 20 RPS, **600 requests**, with quiescent GC checkpoints:

| Worker slot | Baseline retained heap | Final retained heap | Growth |  Final RSS | Peak sampled pre-GC heap |
| ----------- | ---------------------: | ------------------: | -----: | ---------: | -----------------------: |
| 0           |              34.55 MiB |           35.38 MiB | +2.42% | 124.73 MiB |                54.14 MiB |
| 1           |              32.48 MiB |           32.70 MiB | +0.66% | 164.70 MiB |                52.83 MiB |

Both passed the unchanged **<10% retained growth** and **<256 MiB heap** guards. These are sampled peaks, not continuous maxima. Context active/joiner/pending counts, Mongo waiting/checked-out counts and Redis command queues drained to zero. Native pool checkout p95 was 1 ms; no checkout failures occurred. Final native connection counts were 8/13. Short-term heap results distinguish fixed observer storage from retained application allocations but **do not prove long-duration stability or absence of a slow leak**.

## Exact test commands and results

Commands ran from `D:\Developer-Portfolio-Analyzer`. Infrastructure runs required local process/network access for the owned development services.

```powershell
node backend/src/scripts/verifyScenarioP3.js --focused --label=baseline
node backend/src/scripts/verifyScenarioP3.js --focused --label=unprofiled
node backend/src/scripts/verifyScenarioP3.js --focused --label=proxy-diagnostic
node backend/src/scripts/verifyScenarioP3.js --focused --label=mongo-proxy-diagnostic
node backend/src/scripts/verifyScenarioP3.js --focused --label=after --transport=mongo-proxy

node --test backend/src/tests/scenarioSimulatorReliability.test.js backend/src/tests/scenarioSimulatorContext.test.js backend/src/tests/redisConnectionProbe.test.js
```

The first four commands used intermediate diagnostic revisions: `baseline` selected the two profiled comparisons; `unprofiled` selected direct transports plus restart/memory; `proxy-diagnostic` selected both proxies; `mongo-proxy-diagnostic` selected Mongo proxy/direct Redis. Labels are now filenames only. The final script uses explicit `--transport=direct|mongo-proxy|proxy`, `--burst-only` and `--profile` options. Do not expect replaying an early command against the final revision to reconstruct its intermediate configuration.

| Evidence                                                                                                                                           | Result and scope                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [focused-baseline.json](D:/Developer-Portfolio-Analyzer/backend/verification/scenario-simulator/focused-baseline.json)                             | Diagnostic FAIL; profiled comparisons retained, not capacity acceptance                                               |
| [focused-unprofiled.json](D:/Developer-Portfolio-Analyzer/backend/verification/scenario-simulator/focused-unprofiled.json)                         | PASS; fully direct short burst, restart and bounded memory                                                            |
| [focused-proxy-diagnostic.json](D:/Developer-Portfolio-Analyzer/backend/verification/scenario-simulator/focused-proxy-diagnostic.json)             | FAIL; 10/1,500 shared-quota 503s with both forwarding proxies                                                         |
| [focused-mongo-proxy-diagnostic.json](D:/Developer-Portfolio-Analyzer/backend/verification/scenario-simulator/focused-mongo-proxy-diagnostic.json) | PASS; 1,500/1,500 after bypassing only Redis proxy                                                                    |
| [focused-after.json](D:/Developer-Portfolio-Analyzer/backend/verification/scenario-simulator/focused-after.json)                                   | PASS; final implementation, 8/8 assertions, 2,700 scheduled requests plus six cold calls and one in-flight drain call |

The final schedule was 10 seconds warm-up at 20 RPS; 15 seconds burst at 100 RPS; 10 seconds restart at 20 RPS; 10 seconds memory warm-up at 20 RPS; three 10-second memory windows at 20 RPS. All **2,707 HTTP calls succeeded**. Real JWT authentication, shared Lua quotas, V2 `/what-if`, Mongo persistence/history and idempotent Sprint export routes were exercised. Real required unique/history indexes were verified. Workload saves/exports are replay-heavy; this is not a new broad concurrency or representative-history certification.

Affected regressions: **11 tests passed, zero failed/skipped**, covering index fail-closed behavior, atomic shared quotas and owner keys, quota-outage fail-closed behavior, context compatibility/account scope, bounded source recovery and Redis startup/probe safety. No frontend, unrelated module or full repository suite was run. Neither the 100,800-request protocol nor the 60-minute soak was repeated.

### Comparable unprofiled burst results

Each burst offered 100 RPS for 15 seconds, with the same 40/35/15/8/2 context/evaluation/history/save/export mix and 100 workload accounts.

| Metric                    | Before: both proxies | Isolation: Mongo proxy only | Final corrected path |
| ------------------------- | -------------------: | --------------------------: | -------------------: |
| Successful requests       |          1,490/1,500 |                 1,500/1,500 |          1,500/1,500 |
| Shared-quota 503          |                   10 |                           0 |                    0 |
| Context p95 / p99         |         407 / 613 ms |                 77 / 144 ms |          55 / 176 ms |
| Evaluation p95            |               295 ms |                       24 ms |                26 ms |
| History p95               |               256 ms |                       26 ms |                27 ms |
| Save p95                  |               178 ms |                       27 ms |                29 ms |
| Export p95                |               295 ms |                      109 ms |                37 ms |
| Worker Lua p99            |         160 / 155 ms |                  22 / 20 ms |           16 / 22 ms |
| Worker CPU, % of one core |        69.91 / 67.92 |            See raw evidence |        45.70 / 45.28 |

Original p95 targets remain context/save/export ≤500 ms, evaluation ≤200 ms, history ≤150 ms; normal context p99 ≤1,000 ms. Final successful burst throughput was **99.94 RPS**, including response-body parsing; no requests were shed by generator backpressure and no 429s or network failures occurred. Sequential laptop measurements are not an enforced resource-limited deployment benchmark.

Environment: Windows 10.0.26300, Node 24.19.0, eight logical CPU i5-8365U, approximately 16 GiB host RAM; two separate Node workers; MongoDB 8.2.2 with 0.25 GiB WiredTiger cache; Redis 7.2.11 under WSL with 64 MB maximum memory and no persistence; Mongoose 9.2.4 and Redis client 4.7.1. Service memory limits are not total host memory limits. No claim is made about unsampled process peaks or observer-free runtime overhead.

## Changed files and finalization

Changed/added by this focused task:

1. [verifyScenarioP3.js](D:/Developer-Portfolio-Analyzer/backend/src/scripts/verifyScenarioP3.js): early-exit focused mode, explicit diagnostic controls, capacity Redis transport separation, periodic GC exclusion.
2. [scenarioAcceptanceWorker.js](D:/Developer-Portfolio-Analyzer/backend/src/scripts/scenarioAcceptanceWorker.js): fixed-space quota timing, per-phase event-loop/CPU diagnostics, optional short CPU profile, observer byte counts.
3. [scenarioFocusedVerification.js](D:/Developer-Portfolio-Analyzer/backend/src/scripts/scenarioFocusedVerification.js): reusable short burst, drain/restart and bounded-memory protocol.
4. [FOCUSED-RELIABILITY-REPORT.md](D:/Developer-Portfolio-Analyzer/backend/verification/scenario-simulator/FOCUSED-RELIABILITY-REPORT.md): this report.
5. [focused-baseline.json](D:/Developer-Portfolio-Analyzer/backend/verification/scenario-simulator/focused-baseline.json).
6. [focused-unprofiled.json](D:/Developer-Portfolio-Analyzer/backend/verification/scenario-simulator/focused-unprofiled.json).
7. [focused-proxy-diagnostic.json](D:/Developer-Portfolio-Analyzer/backend/verification/scenario-simulator/focused-proxy-diagnostic.json).
8. [focused-mongo-proxy-diagnostic.json](D:/Developer-Portfolio-Analyzer/backend/verification/scenario-simulator/focused-mongo-proxy-diagnostic.json).
9. [focused-after.json](D:/Developer-Portfolio-Analyzer/backend/verification/scenario-simulator/focused-after.json).

No source/evidence files were moved or deleted. Only owned transient infrastructure files were removed by the verifier after results were retained. Existing staged changes, including earlier Redis/AGENTS/frontend changes, were preserved rather than attributed to this request.

Finalization uses the installed Prettier with explicit paths for all nine files, write then check, `--single-quote --print-width 100`; `node --check` for the three scripts; and both `git diff --check` and `git diff --cached --check`. Results: formatting PASS, syntax PASS, whitespace PASS. The 11 affected regressions were rerun after infrastructure cleanup and final source edits. Git emits existing Windows LF/CRLF conversion notices, not whitespace-check failures.

## Remaining risks, rollback and gates

- Full post-correction burst/steady/restart/soak acceptance and representative healthy-source/full-history capacity remain open. The earlier 58-error burst, restart/soak latency misses and raw memory-growth miss are not erased or upgraded to passes. All original failure causes are therefore not claimed fixed.
- Longer-duration retained memory stability remains unverified. A 30-second bounded window cannot establish 60-minute stability, monthly availability or rare-failure behavior.
- New full-protocol transport/periodic-sampling changes were syntax checked and reused by the focused path where applicable; the full protocol itself was not executed. Future extended acceptance must use the corrected instrumentation and retain failures separately.
- Deployment-only gates remain actual topology capacity, gateway/trusted-proxy quotas/deadlines, readiness and graceful failover, deployed Mongo index rollout/ownership audit, Redis transport/security/eviction policy and monitoring/alerts/runbooks. No production index rollout was attempted.
- Career Sprint owner release/performance/provider and actual legacy-data preservation gates remain those in `FINAL-ACCEPTANCE.md`. No unrelated Sprint/Learning Hub/Recommendations retest or modification was performed.

There is no application/data rollback for this task. The verification changes can be reverted independently while retaining their evidence. Do not revert the existing 2,000-command Redis queue guard, reset quotas, rewrite snapshots, drop indexes/receipts or change historical scores as a rollback. Any deployment still requires explicit approval.

Freeze further speculative application changes while these results are reviewed. The module cannot receive a full reliability lock yet; local extended acceptance still remains, so the remaining work cannot honestly be labeled deployment-only. Track those gates centrally without reopening unrelated modules.

- ROOT CAUSES FIXED: NO
- FOCUSED REGRESSION: PASS
- BURST AND RECOVERY: PASS
- MEMORY GROWTH: PASS
- FULL ACCEPTANCE STILL REQUIRED: YES
- SAFE TO LOCK MODULE: NO

Here, NO for root causes means that not all historical extended-run failures have a verified resolution. The measured verification-path interference is corrected. PASS for burst/recovery and memory applies only to the focused durations and topology above.
