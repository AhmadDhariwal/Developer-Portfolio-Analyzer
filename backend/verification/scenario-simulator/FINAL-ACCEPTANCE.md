# Scenario Simulator — final local P3 reliability acceptance

**FINAL LOCAL P3 ACCEPTANCE: FAILED / MODULE NOT LOCKED.** The extended protocol completed; its failures remain retained. A proven Redis backlog defect was fixed and passed focused real-network verification, but that fix does not establish that the failed load/soak gates now pass.

Date: 25 October 2026 (Asia/Karachi). Source/current branch: `task/simulator`; source commit and application SHA-256 hashes are retained in `p3-source-manifest.json`. Target branch: not applicable to this local verification task. Existing staged `AGENTS.md` and Scenario frontend work is preserved. No branch, commit, push, merge, production configuration change or deployment is authorized or performed.

## Scope and evidence

This acceptance follows `AGENTS.md`, the solution architecture charter, the performance/reliability targets in `SCENARIO-SIMULATOR-ARCHITECTURE-REVIEW.md`, the retained Scenario implementation report, and the Scenario template verification report. Historical reports remain unchanged. This report supersedes only the local P3 findings it explicitly measures, not deployment or Career Sprint release decisions.

The only application change is a finite 2,000-command Redis SDK backlog bound in `backend/src/services/redisCacheService.js`. It addresses the measured retained-waiter defect described below. Quota counts, the 150 ms deadline, public APIs, schemas, scoring, historical records and locked scoring modules are unchanged. All 21 monitored application files matched their baseline hashes throughout the full run; the backlog fix was applied afterward. Added files are verification infrastructure and evidence only:

- `backend/src/scripts/verifyScenarioP3.js`
- `backend/src/scripts/scenarioAcceptanceWorker.js`
- `backend/verification/scenario-simulator/FINAL-ACCEPTANCE.md`
- `backend/verification/scenario-simulator/p3-source-manifest.json`
- `backend/verification/scenario-simulator/p3-acceptance.json`
- `backend/verification/scenario-simulator/p3-ack-recovery.json`
- `backend/verification/scenario-simulator/p3-ack-recovery-before-queue-bound.json`
- `backend/verification/scenario-simulator/p3-smoke.json`
- `backend/verification/scenario-simulator/p3-smoke-startup-failure.json`
- `backend/verification/scenario-simulator/p3-smoke-proxy-failure.json`
- `backend/verification/scenario-simulator/p3-smoke-burst-failure.json`

The full-run machine-readable evidence is [p3-acceptance.json](p3-acceptance.json). Smoke runs explicitly identify themselves as short harness checks and do not establish extended acceptance. Startup readiness, plain-object fixture handling and cancellation-sensitive pool instrumentation were corrected in the verifier. Earlier TCP-forwarded capacity measurements and their failures remain retained. Normal capacity traffic uses direct shared Redis; interception is confined to explicit Redis fault tests. Mongo wire forwarding uses a fast pass-through path outside injected delays. No application threshold or scoring rule was changed to hide those findings.

## Isolated development infrastructure

- A newly spawned MongoDB on an ephemeral loopback port, using a newly created `devinsight-p3-*` temporary directory and the `scenario_acceptance` database. WiredTiger cache is capped at 0.25 GB. No application database URI is read.
- Redis 7.2.11 built from the official HTTPS release archive under a task-owned WSL `/tmp` directory. A new loopback-only Redis process uses an ephemeral port, 64 MB `maxmemory`, `noeviction`, and no persistence. No system package, existing Redis service, cloud endpoint or Redis database was reconfigured or flushed.
- Two separate Node processes run the real JWT middleware, Scenario routes, controllers, services, versioned engine, shared Redis Lua limiter and Mongo driver. Workers run with `NODE_ENV=production`; automatic Scenario index creation is disabled, and production index-readiness checks remain enabled.
- Fixtures contain 140 new synthetic accounts, including 100 workload accounts, owned immutable evaluations, current pinned-calendar Sprints, portfolio plans and integration evidence. Workload accounts each replay one real evaluated snapshot. A separate heavy account has 1,000 minimal index-only documents. These index fixtures do not certify serialization/HTTP cost for 100 full snapshots per typical account or 1,000 full snapshots for a heavy account. Missing GitHub/Resume evidence remains missing; no external reanalysis or AI provider is invoked.
- Runtime versions, host CPU/RAM, actual indexes, driver/pool measurements, Redis memory and Mongo server memory/connections are recorded in the JSON. This Windows/WSL laptop is not an enforced two-instance 2-vCPU/1-GB deployment topology or a production replica set.

The verifier appends read-only context counters to its private module cache; no application source file or production endpoint exposes them. Mongo command/pool events and native pool state are observed without replacing database results. Periodic samples include heap before and after explicit GC; Post-GC sampled growth is distinguished from raw heap and RSS. The original full-run observer retained up to 200,000 pool-wait samples and sorted a copy after GC; its allocations confound a pure application retained-heap interpretation. The current observer uses a fixed-size histogram instead. The original resource failure is preserved and has not been converted into a pass. Sampling and proxy overhead remain part of the local test environment.

## Exact commands and acceptance criteria

From the repository root:

```powershell
node backend/src/scripts/verifyScenarioP3.js --smoke
node backend/src/scripts/verifyScenarioP3.js
node backend/src/scripts/verifyScenarioP3.js --ack-only
node --test backend/src/tests/scenarioSimulatorService.test.js backend/src/tests/scenarioSimulatorReliability.test.js backend/src/tests/scenarioSimulatorCharacterization.test.js backend/src/tests/scenarioLegacyParity.test.js backend/src/tests/scenarioPlanningScore.test.js backend/src/tests/scenarioSimulatorContext.test.js
```

Exact final post-cleanup regression command:

```powershell
node --test backend/src/tests/redisConnectionProbe.test.js backend/src/tests/interviewPrepCache.test.js backend/src/tests/scenarioSimulatorService.test.js backend/src/tests/scenarioSimulatorReliability.test.js backend/src/tests/scenarioSimulatorCharacterization.test.js backend/src/tests/scenarioLegacyParity.test.js backend/src/tests/scenarioPlanningScore.test.js backend/src/tests/scenarioSimulatorContext.test.js
```

The installed native MongoDB executable and the task-owned WSL Redis build are required. The local Redis binary used is `/tmp/devinsight-scenario-redis-p3-20261025/redis-7.2.11/src/redis-server` in the Ubuntu WSL distribution; source archive: `https://download.redis.io/releases/redis-7.2.11.tar.gz`, built with `make -j2 MALLOC=libc BUILD_TLS=no redis-server`. This is isolated test infrastructure, not a production-version recommendation. Neither command loads `.env`. Native execution was needed for isolated processes/networking. The initial regression command passed **27/27 tests**, with no failures or skips; it covers legacy characterization/parity, deterministic V2 invariants, source fan-out/deadlines, ownership projection and quota/index failure policy. Unrelated module suites and frontend builds are not repeatedly rerun for verification-only backend additions.

Full protocol (the `--smoke` mode deliberately shortens these periods and cannot pass extended acceptance):

| Phase                       |   Duration | Offered load | Planned requests |
| --------------------------- | ---------: | -----------: | ---------------: |
| Warm-up                     | 60 seconds |       20 RPS |            1,200 |
| Steady                      | 15 minutes |       20 RPS |           18,000 |
| Burst                       | 60 seconds |      100 RPS |            6,000 |
| One source stalled          | 60 seconds |       20 RPS |            1,200 |
| Mongo wire latency          | 60 seconds |       20 RPS |            1,200 |
| Application rolling restart | 60 seconds |       20 RPS |            1,200 |
| Soak                        | 60 minutes |       20 RPS |           72,000 |

Mix: 40% context, 35% evaluation, 15% history, 8% save and 2% export. Offered requests, successful throughput, HTTP statuses, quota rejection and dependency failure are reported separately. Latency histograms include successful responses only; throttled responses cannot improve the success-latency result. The generator caps in-flight work at 256 and uses bounded latency histograms and bounded diagnostic samples.

Targets remain: pure engine p95 <=5 ms / p99 <=15 ms at 100 evaluations/second/instance; HTTP p95 evaluation <=200 ms, history <=150 ms, save/export/healthy context <=500 ms; context p99 <=1 second. Intentionally degraded context must finish within 2.2 seconds with healthy sources retained. Resources: source fan-out <=4, active pipelines <=32, joiners <=256, steady CPU <70%, heap <256 MB and post-warm-up retained-heap growth <10% across soak; pending work must drain. The published reliability target is <0.5% unexpected 5xx under accepted steady load; dependency failures and admission responses must be separately counted. The local verifier additionally records every unexpected network/5xx response and applies a stricter zero-error diagnostic. That supplemental diagnostic and the published target must be reported separately; neither may be hidden or substituted for the other.

## Local reliability checks

The full-run preflight passed all 24 initial checks before starting warm-up. Final results and any subsequent failures are authoritative in the JSON:

- Actual full unique `{userId, scenarioHash}` and `{userId, createdAt, _id}` cursor indexes exist in the disposable MongoDB. Explain plans are measured against the 1,000-record account, including examined/returned rows and blocking-sort detection.
- Across two processes, 100 simultaneous same-plan saves produce one snapshot; 50 simultaneous exports produce one receipt/item set. Foreign JWT source/target access is rejected. Application restart does not reset shared quota state or durable Sprint receipts.
- The real shared Redis limiter is checked for evaluation 60/minute, context 30/minute, refresh 6/minute, history 60/minute, save 20/minute, export 10/minute and delete 20/minute. Actual accepted/rejected counts and `Retry-After` are retained. TTLs are bounded; account identities are not exposed in quota keys.
- A real TCP Redis blackhole makes both workers fail closed with bounded 503 responses; disconnect/reconnect restores service without enabling local fallback. This tests live Redis protocol behavior, not a mocked counter.
- A collection-specific Mongo wire stall causes the portfolio source to time out while integration evidence remains available. Subsequent reads recover after abort. Distinct-account and hot-account floods exercise real driver cancellation, the 32-pipeline/256-joiner bounds and pending-map drainage.
- A 160-query pressure test reaches the real pool limit and queue, then verifies completion and drained native pool state. Production defaults are recorded, not silently replaced with shorter test timeouts.
- Full workload checks immutable snapshot preservation, duplicate absence, owned primary history, one export receipt/task, and zero fabricated completion/XP.

## Performance and resource results

Full run: `2026-10-25T13:08:22.514Z` to `2026-10-25T14:29:28.885Z` (UTC), **100,800 scheduled/completed requests**, **100,451 successful responses**, **349 HTTP 503s**, no quota 429s in the distributed workload, and no transport failures. All 503s were explicitly classified as shared quota service unavailable. Expected quota-exceeding preflight traffic is separate. Full-run verifier result: **36/44 checks passed; 8 diagnostic/acceptance checks failed; exit 1**.

Numbers below are successful-response latency in milliseconds. Rejected/failed requests do not improve these percentiles.

| Phase                             | Successful / offered | 503 | 503 rate | Context p95 / p99 | Evaluate p95 | History p95 | Save p95 | Export p95 |
| --------------------------------- | -------------------: | --: | -------: | ----------------: | -----------: | ----------: | -------: | ---------: |
| warmup (60 s)                     |        1,200 / 1,200 |   0 |  0.0000% |          53 / 249 |           24 |          25 |       49 |        450 |
| steady-15min (900 s)              |      17,998 / 18,000 |   2 |  0.0111% |          72 / 304 |           37 |          43 |       59 |         65 |
| burst-60sec (60 s)                |        5,942 / 6,000 |  58 |  0.9667% |         504 / 599 |          336 |         245 |      194 |        264 |
| source-timeout-under-load (60 s)  |        1,200 / 1,200 |   0 |  0.0000% |         825 / 842 |           42 |          48 |       64 |         68 |
| mongo-latency-under-load (60 s)   |        1,200 / 1,200 |   0 |  0.0000% |         251 / 348 |           98 |         146 |      172 |        214 |
| rolling-restart-under-load (60 s) |        1,198 / 1,200 |   2 |  0.1667% |        426 / 1468 |           47 |          50 |       73 |         66 |
| soak-60min (3600 s)               |      71,713 / 72,000 | 287 |  0.3986% |        246 / 1012 |           93 |          95 |      145 |        150 |

Interpretation:

- Steady and soak observed 5xx rates were below the published 0.5% steady-load ceiling, but failed the supplemental zero-error diagnostic. Neither is reported as an error-free run.
- Burst failed the healthy-context/evaluation/history p95 targets: **504 >500 ms, 336 >200 ms and 245 >150 ms**. Its 0.9667% 503 rate also exceeded 0.5%. This is a real local capacity/availability failure, not missing infrastructure mislabeled as success.
- Rolling restart failed context p99 (**1,468 >1,000 ms**). The soak also failed context p99 (**1,012 >1,000 ms**). The verifier routes away from a draining worker; these results do not certify actual load-balancer readiness.
- The source-stall and Mongo-latency variants passed their unchanged latency/degraded-context criteria. The source-stall context p95/p99 was **825/842 ms**, with healthy evidence retained.
- Pure engine, 1,000 paced evaluations at 100/second on each instance: p95 **0.4272/0.4585 ms**, p99 **0.8526/0.7972 ms**; deterministic serialized outputs matched. No scoring optimization was justified.

| Worker slot | Soak baseline heap (MiB) | Final sampled heap (MiB) | Growth | Peak sampled raw heap (MiB) | Average soak CPU (% one core) | Final active / joiners / pending | Native pool checked out / waiting |
| ----------- | -----------------------: | -----------------------: | -----: | --------------------------: | ----------------------------: | -------------------------------- | --------------------------------- |
| 0           |                    34.90 |                    36.96 |  5.89% |                       89.38 |                        12.14% | 0 / 0 / 0                        | 0 / 0                             |
| 1           |                    35.29 |                    39.61 | 12.24% |                       91.77 |                        12.16% | 0 / 0 / 0                        | 0 / 0                             |

Absolute heap stayed below 256 MiB and queues drained. Worker-slot 1 failed the raw <10% growth guard (**12.24%**). The observer's growing wait array and post-GC sorted copy contributed allocations, so this is **not proof of an application memory leak**; clean retained-growth acceptance remains **NOT VERIFIED** with corrected fixed-space instrumentation. Steady/soak CPU windows of at least one second peaked at **24.19% of one core**. Pool wait p95 in the full-run final samples was 1 ms; the pre-fix observer retained only its first 200,000 checkout durations. Native final queue measurements are authoritative.

At burst, sampled worker CPU was about **82.14% / 80.74% of one core**, while the generator used about **46.24%**. Sampled cumulative event-loop p99 was about 58 ms and native pool wait p95 was 1 ms. These observations identify quota-deadline/scheduling/transport as a profiling boundary; they do not prove a scoring or database-index defect. No speculative cache, formula, concurrency or deadline redesign was applied.

Real index explain: history returned/examined **20/20** documents at the 1,000-record fixture; unique lookup **1/1**. Both used indexed plans without blocking sort. The isolated context composition measured **8 driver commands** across its user lookup and eight source adapters; missing sources remain disclosed. Full workload source/pool/Redis/Mongo measurements are retained in the JSON.

### Proven root-cause fix and post-fix verification

The 150 ms Promise-race wrapper bounded caller wait, but did not remove already-sent SDK reply waiters when a connected Redis socket stopped returning replies. Two batches of 4,000 timed-out real commands left **0 ->4,000 ->8,000** pending waiters and growing heap. `disableOfflineQueue` alone did not bound an already-connected client. The failed proof is retained in [p3-ack-recovery-before-queue-bound.json](p3-ack-recovery-before-queue-bound.json).

The minimal application fix sets the existing SDK `commandsQueueMaxLength` to **2,000**. The same real-network probe then measured **0 ->2,000 ->2,000**, with zero pending commands after socket recovery; actual Scenario admission remained 503/Retry-After while unavailable. All **13/13** acknowledgement/ownership/concurrency/backlog checks passed. Lost save/export replies were discarded only after Mongo had committed; cross-instance retries preserved the original snapshot and one receipt/item set, with zero completion/XP.

The latest probe also exercises the corrected fixed-size wait histogram. Final focused cache/Scenario regression: **34/34 passed, zero skips**, including the original 27 Scenario checks and 7 cache/probe contract cases. The complete eight-suite command adds `backend/src/tests/redisConnectionProbe.test.js` and `backend/src/tests/interviewPrepCache.test.js` to the initial command above. No environment-loading shared-database consumer suite was run.

**Limits:** The completed 80-minute protocol predates the backlog/sampler corrections. The focused fixes have passed their targeted tests; no clean post-fix extended pass is claimed, and the availability/latency failures remain unresolved. Fixing a finite backlog does not fix the measured burst capacity or prove an unmeasured memory-growth result.

## Remaining locally executable acceptance gates

1. Isolate the cause of the healthy-traffic quota deadline misses and failed 100 RPS latency. Profile/measure Redis RTT, worker scheduling and driver/request cost on a controlled host; apply only an evidence-backed correction, then rerun the failed burst. Do not raise the deadline or relax thresholds merely to obtain a pass.
2. Resolve/revalidate rolling-restart context p99 and the soak context-p99 miss, including actual readiness behavior. Normal 5xx and admission rates must remain separately visible.
3. Revalidate resource growth with the corrected fixed-space observer and final backlog-bound implementation. The raw growth failure and earlier full result remain historical evidence, not a clean current implementation certificate.
4. Before claiming the architecture review's full reference capacity, expand the local corpus to representative healthy-source projections and full 100/1,000-snapshot histories; the present minimal index corpus and replay-heavy history workload do not establish that cost.

These are local gates, not requirements that can honestly be deferred solely as production-only. The condition for a final Scenario freeze and moving on has therefore **not** been met. Preserve verified functionality while resolving these narrowly scoped reliability gates; do not modify/retest unrelated modules.

## Career Sprint integration and release dependencies

Scenario-to-Sprint contracts are verified within this run's stated scope. The independently retained [Career Sprint lock report](../career-sprint/lock-verification/REPORT.md) remains **BLOCKED** and is not overridden by Scenario acceptance. Its open items include:

1. A clean complete backend release run: the retained full run had Sprint/Learning Hub/Recommendations performance failures and a Windows Node/libuv process abort. An isolated Recommendations rerun still missed its unchanged memory-p95 target. These unrelated modules are not modified or repeatedly retested here.
2. Configured external-provider readiness: the retained Groq live request returned 404. Scenario itself is deterministic and makes no AI request; Sprint fallback safeguards do not certify provider availability.
3. Access to the actual protected legacy source for fresh preservation verification: the last lock audit found none of the expected 15 records in that laptop database. No actual-source preservation proof is invented by synthetic tests.
4. Explicit approval and execution of any production legacy exception/reservation migration. The [legacy unblocking report](../career-sprint/legacy-unblocking/REPORT.md) permits read-only legacy exceptions without inventing original IANA provenance; it does not authorize a production apply. Unresolved historical calendars remain read-only and existing overlapping records remain preserved.

## Deployment checklist and outstanding risks

These are separate from locally executable fixture tests and require deployment owners/evidence:

1. Record and approve the deployed application/package versions and actual instance topology; rerun the full protocol on enforced 2-vCPU/1-GB instances with representative healthy-source cardinalities and deployment traffic. Local fixture latency is not a capacity commitment for 10,000 registered accounts or a monthly SLO. Fault-load variants here are 60-second checks, not full repeated hour-long fault soaks.
2. Audit production duplicates and indexes read-only, then separately approve any necessary index creation/repair. Confirm full uniqueness, the cursor index, query plans, replica topology, primary-read/write-concern behavior and pool sizing. Do not use `syncIndexes`, destructive index migration or automatic index removal as verification.
3. Verify deployed shared Redis TLS/ACLs, time synchronization, end-to-end RTT within the existing 150 ms command deadline, capacity/eviction policy, HA/failover and quota-counter retention through Redis service replacement. The isolated no-persistence Redis process does not establish production Redis durability or failover behavior.
4. Verify real gateway/global authenticated-account and anonymous-IP protection, trusted-proxy configuration, request deadlines, load-balancer readiness, graceful drain and failover. The verifier's routing away from its draining worker is not evidence of the deployed load balancer.
5. Bound production pool waits and whole-request failure latency. The existing shared database configuration has 30-second selection and 45-second socket timeouts with the driver default unlimited wait timeout; source-specific deadlines do not independently bound every global JWT/database failure path. Validate actual outage behavior and enforce operational bounds at the approved shared infrastructure boundary.
6. Demonstrate deployed source/operation/error/admission metrics, alerts, capacity and recovery runbooks; distinguish source absence, stale evidence, dependency failures and quota admission. No observed fixture result establishes a monthly availability objective.
7. Obtain Career Sprint owner sign-off on its separately blocked release/performance/provider and actual legacy-data verification gates above, including any separately approved production migration.
8. Obtain explicit user/operator approval for deployment and any protected-branch integration. This verification authorizes neither.

## Rollback and data safety

No production rollback operation was needed or performed. Keep existing legacy/V2 readers, original evaluated results, immutable snapshot identities and Sprint receipt/provenance fields. To roll back exposure, disable new V2 writes/UI through a separately approved release while retaining compatible readers and retry protection. Do not deploy an older writer that drops receipts, overwrites snapshots or reinterprets legacy calendars. Do not rewrite historical scores, evict lifetime receipts, drop indexes, reset shared quota namespaces or infer missing timezones. Retain the finite SDK backlog guard when rolling back exposure; reverting to the unbounded client configuration reintroduces the demonstrated outage-resource defect. Any production data/index change requires its own reviewed plan and approval.

The harness stops only its own processes and deletes only individually verified task-created temporary files. It does not recursively delete directories, run Git cleanup/reset, remove historical evidence or flush shared Redis. Temporary-file cleanup and service exit results are retained in the full JSON. WSL build sources/binary remain task-owned local infrastructure; no system installation was performed.

## Finalization and decision

Modified application file: `backend/src/services/redisCacheService.js` (one finite-backlog constant, its explanation and one existing SDK option). Added source files: the two verification scripts listed above. No existing source file was moved or deleted. The 11 added verification/report/evidence paths are listed under Scope. Task-generated smoke outputs were retained under their explicit failure filenames. Per-run JSON contains exact individually removed temporary Mongo file paths; task-created Redis configs use `p3-redis-<runId>.conf` and were removed only after shutdown. No recursive deletion, Git cleanup/reset, production write or unrelated user-work deletion occurred.

All full/supplemental workers and test-owned Mongo/Redis processes stopped successfully. The WSL build remains isolated under its task-owned `/tmp` path for reproducibility. Existing staged frontend/AGENTS work was not edited by this task. No production endpoints or `.env` databases were used.

**Final checks passed:** explicit-path Prettier write/check for all three changed/new JavaScript files and all retained report/JSON evidence; `node --check` on all three JavaScript files; staged and unstaged `git diff --check`; final post-cleanup focused regression **34/34 passed, no skips**; latest real-network supplemental verification **13/13 passed**. Source-manifest comparison confirms that the only application-file change after the full run is the documented Redis queue bound. Formatting is explicit-path write then matching check; the Redis file retains single quotes, no trailing commas and width 100, while the new scripts use single quotes and width 100. No repository-wide formatting was run. Frontend source/build work is outside this task; its retained feature report is not a claim that unrelated staged edits were revalidated here.

- **LOCAL MODULE LOCK: NO**
- **MULTI-INSTANCE RELIABILITY: FAIL** � shared quota consistency, ownership, concurrency and retry integrity passed; full-load availability/latency acceptance did not.
- **PRODUCTION READINESS: NO**
- **REMAINING DEPLOYMENT GATES:** the exact eight-item deployment checklist above, in addition to the four explicitly local gates.
- **SAFE TO MOVE TO NEXT MODULE: NO**

Do not repeatedly redesign verified functionality or retest unrelated modules. Keep the failed evidence and track the local and external release gates centrally. Recommend freezing Scenario only after its local gates pass; at that point, deployment-only/Sprint-owner gates can remain centrally tracked without reopening the verified implementation for unrelated changes.
