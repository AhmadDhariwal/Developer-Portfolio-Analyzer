# Scenario Simulator — production finalization

**Release decision: FAIL / NOT READY FOR PRODUCTION.** Functional fixes and local contract verification are complete; sustained availability/latency remains a measured failure. The requested fully accepted local release candidate has not been achieved. No timeout, offered load, assertion, score or threshold was relaxed to claim acceptance.

Date: 9 November 2026, Asia/Karachi. Authorized/current branch: `release1`, explicitly requested by the user. Starting HEAD: `5c23163f7631848361c7986a24acc52cbf394b80`. Initial working tree and index were clean. PR target: not applicable. The agent did not stage, commit, push, merge, deploy, connect to production, change production indexes or make paid provider calls. Historical reports and failed evidence remain retained.

## Architecture, mathematics and evidence ownership

The existing `scenario-planning-v2` architecture remains: Angular workspace/components → authenticated `/api/simulator` routes → owned context, deterministic calculation, immutable Scenario snapshots and the existing Sprint export adapter. No HTTP API, schema, dependency, scoring table or formula was changed; legacy golden results remain readable.

Skills are canonically sorted by their nominal role × difficulty × demand contribution before the existing diminishing multipliers (1, 0.7, 0.4). Projects are similarly ranked, using existing diminishing multipliers (1, 0.8, 0.6). Skill/project components cap at 22 each, title-based synergy at 10 and improvement at 40; job-match improvement uses the existing 0.72 multiplier and rounding. Predictions saturate in 0–100. Capacity remains `durationWeeks × 0.8` with the existing piecewise overload penalty. These are planning heuristics, not calibrated hiring probabilities.

Existing seeded tests check 1,000 deterministic bounded calculations, uncertainty containment, permutation invariance, invalid types, prototype-safe lookups, frozen rules and zero project points. Added checks exercise diminishing returns, impact sensitivity, role relevance, capacity and a zero-only project retaining the baseline. A zero-impact project contributes zero **direct project points**; in mixed plans it still consumes effort and participates in the existing title-based synergy heuristic. This distinction is documented, rather than inventing a new scoring policy. Byte hashes of unchanged scoring/contract files are retained in the final manifest.

V2 evaluation does not need source availability and never writes hypothetical skills into verified evidence or Readiness Scores. Baselines 55/48 are explicitly unconfirmed user assumptions, not averages of evidence scores. Saving verifies the current evaluation hash; `$setOnInsert` plus the owned unique index preserves the original snapshot under replay. Legacy calculations and historical snapshots retain their versions.

### Eight context sources

| Source           | Actual scope and safeguards                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub Analyzer  | Public cache for the authenticated profile's normalized GitHub username; expiry and seven-day freshness checked; observations stay distinct from demonstrated proficiency.           |
| Resume Analyzer  | Owned selected resume file and its owned analysis; an unanalyzed selected file stays missing, rather than silently substituting another resume. Thirty-day freshness.                |
| Skill Gap v9     | Owned role/experience/username cache, required evidence-rule version, selected-resume/source compatibility; stale/mismatched results excluded. UNKNOWN remains UNKNOWN at its owner. |
| Recommendations  | Owned current role/experience records from the last seven days; planning intent, not evidence of proficiency.                                                                        |
| Career Sprint    | Owned current Sprint window; goal/activity context only, no automatic completion or XP.                                                                                              |
| Public Portfolio | Owned profile; only planned/upcoming project suggestions, completed projects excluded before bounding the projection. Self-claims stay self-claims.                                  |
| Integrations     | Owned merged insight, seven-day freshness; inference remains distinct from observation.                                                                                              |
| Jobs Demand      | Shared fresh, unexpired public catalog; at most 250 jobs and bounded skill counts, market context only.                                                                              |

Fanout is four, source deadline 750 ms, Mongo `maxTimeMS` 650 ms, profile deadline 500 ms and total context deadline two seconds. Timeout/abort paths retain healthy sources. Pending work is bounded to 32 leaders and 256 joiners per worker, keyed by owner/identity revision. Context/history are authoritative reads, not persistent result caches: frontend shares in-flight requests and invalidates on session/profile changes; source modules retain ownership of their cached evidence. No additional Redis cache or competing invalidation layer was introduced.

## Confirmed defects and fixes

1. **Cancelled reads left loading state stuck.** Cache/session invalidation completes reads without a value; the workspace previously cleared loading only on `next`/`error`. Generation-aware `finalize` now clears flags on cancellation too.
2. **Pagination errors were silent; obsolete pages could append after refresh.** History now retains existing rows/cursor, shows a retry explanation, clears loading on cancellation and ignores responses from an older workspace generation.
3. **UNKNOWN suggestions were described as missing skills.** The panel now says “Skills to Explore.” Existing suggestion fields/classifications and downstream contracts are unchanged.
4. **Unsafe legacy migration.** Running it previously loaded default database configuration and deleted duplicates before creating an index. It now defaults to a read-only audit using explicit `SCENARIO_AUDIT_URI`; `--apply` additionally requires explicit `SCENARIO_MIGRATION_URI`. Duplicates block index application for reviewed preservation/reconciliation. It never deletes snapshots or drops existing indexes. It can add the already-declared full owned unique/history indexes only when explicitly applied. The old destructive cleanup/`--verify` workflow must not be used. Tests apply indexes only on newly spawned disposable MongoDB.
5. **Verification cleanup/startup/restart defects.** The Scenario Mongo fixture now removes individually verified owned files and empty directories instead of recursive deletion. The P3 verifier accepts an explicit installed Redis test binary; its short restart sampling now waits for the replacement instead of sending IPC to a retired process. Browser launch failures close the owned HTTP server; explicit installed-browser paths and output directories are supported. None of these changes alter runtime governance.

## Security, persistence and Sprint integrity

All six routes retain JWT protection and request-owner predicates. Real HTTP foreign export/deletion attempts return not-found; request bodies cannot override ownership. Global JSON payload limit remains 100 kB, item counts/string lengths are bounded and snapshot serialization is capped at 65,536 bytes. History uses bounded limit (1–20), deterministic `(createdAt, _id)` cursor pagination and primary reads. No production index was queried or changed.

Redis Lua quotas remain shared per owner and operation: context 30/minute, refresh 6, evaluate/history 60, save/delete 20 and export 10. Production fails closed on shared quota uncertainty, preserving the 150 ms command deadline and existing 2,000-command SDK queue bound. Empty/unset `SCENARIO_LIMIT_MODE` retains this shared policy; the explicit `single-instance` exception must never be used to mask multi-worker failures.

Sprint exports retain atomic optimistic writes, durable mode/version/scenario receipts, stable item identities, owner checks and bounded retries. Real Mongo/two-worker tests cover 100 concurrent saves, 50 concurrent exports, replay after edit/delete/restart, draft ingestion and foreign owners. Added boundary assertions verify 500 tasks, eight drafts and 128 receipts reject without changing the Sprint. Exports stay incomplete manual work and award no XP, verified skill or readiness change. Career Sprint implementation/policies were not modified.

Disposable index verification used 1,020 synthetic minimal records. History returned five rows examining five keys/documents; identity lookup returned one examining one. These are index/query-plan fixtures, not production-size serialization benchmarks. No demonstrated need to add runtime indexes was found. Real production duplicate/index audits and representative high-cardinality context-source plans remain external gates.

## Test evidence and performance

Evidence base: `production-finalization-2026-11-09/`. Every runner `results.json` records exact commands, cwd, exit code and child wall time; adjacent logs retain raw results/stacks. The runner strips application credentials and never loads `.env`. Fixture provider initialization reports disabled providers; no AI generation is part of Scenario verification.

| Verification                                                           | Result                                                               | Exact evidence / child wall time                                                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Focused backend, mathematical, legacy and Skill Gap consumer contracts | PASS: 31/31, zero skipped                                            | `run-2026-11-08T19-11-45-751Z/backend-focused.log`; 11,818 ms                                      |
| Mongo snapshots, two real processes, Sprint exports and migration      | PASS: 4/4, zero skipped                                              | `run-2026-11-08T19-13-37-937Z/mongo-and-workers.log`; 34,911 ms                                    |
| Added Sprint limit/state-preservation checks                           | PASS: 1/1, zero skipped                                              | `sprint-limits.log`, `sprint-limits-results.json`; 13,806 ms                                       |
| Affected Angular components/service                                    | PASS: 20/20, seven files                                             | `run-2026-11-08T19-22-58-340Z/angular-focused.log`; 58,943 ms, Vitest 9.92 s                       |
| TypeScript                                                             | PASS                                                                 | Same run, 8,717 ms                                                                                 |
| Production build                                                       | PASS                                                                 | Same run, 66,046 ms; unchanged Jobs/landing stylesheet warnings retained                           |
| Browser journeys                                                       | PASS: 32 viewport/state captures, no overflow or browser page errors | `browser-verified.log`, `browser-verified-results.json`; 48,931 ms; installed Edge, synthetic APIs |
| Standalone sustained two-worker burst                                  | FAIL                                                                 | `../scenario-simulator/production-final-2026-11-09-focused.json`; runner 97,080 ms                 |
| Short fault/restart protocol after verifier fix                        | 42/44 checks pass; overall FAIL                                      | `production-final-2026-11-09-smoke-recovery.json`; 93,243 ms; burst availability/latency fail      |
| Short CPU profile                                                      | DIAGNOSTIC, not acceptance                                           | `production-final-2026-11-09-profile.json`; 50,563 ms                                              |

Commands from repository root:

```powershell
node backend/src/scripts/verifyScenarioProduction.cjs --backend
node backend/src/scripts/verifyScenarioProduction.cjs --mongo
node backend/src/scripts/verifyScenarioProduction.cjs --load
node backend/src/scripts/verifyScenarioProduction.cjs --load --profile
node backend/src/scripts/verifyScenarioProduction.cjs --smoke
node backend/src/scripts/verifyScenarioProduction.cjs --smoke --recovery
node backend/src/scripts/verifyScenarioProduction.cjs --frontend
node --test --test-reporter=tap backend/src/tests/scenarioSprintExport.test.js
```

Only failing groups or newly added assertions were retried. `--mongo` was added to avoid repeating passing units. For browser verification, process-local `NODE_PATH` points to the existing Codex runtime and `SCENARIO_CHROMIUM_PATH` to installed Edge; final direct-browser commands/results are retained alongside their logs. No browser or app dependency was installed. Full repository regression and the historical hour-long protocol were not run.

### Sustained performance blocker

The standalone direct-transport run offered exactly **6,000 requests at 100 RPS for 60 seconds** after a ten-second warmup. It returned **5,951 successes and 49 fail-closed 503s (0.817%)**. Successful-response p95: context 452 ms (p99 747), evaluation 310 ms, history 180 ms, save 151 ms and export 234 ms. Unchanged targets: context/save/export p95 ≤500 ms, evaluation ≤200 ms, history ≤150 ms, context p99 ≤1,000 ms and no unexpected 5xx. Availability and evaluation/history p95 fail. Errors are counted separately and excluded from successful latency percentiles.

Cold context: 234/255 ms; first export 611/604 ms; first evaluation 63/49 ms across the two workers. Warmup p95: context 91 ms, evaluation 29 ms, history 37 ms, save 47 ms, export 71 ms. The persistent-context cache hit rate is **not applicable**; `cache.hit` remains false. A separate coalescing contract verifies 100 concurrent same-owner callers share one eight-source read, followed by fresh reads after completion. This does not claim distributed result caching across workers.

Worker CPU during the sustained burst was about 64.4%/64.5% of one core; recorded event-loop p99 reached approximately 98/106 ms. The additional 15-second CPU profile made timing worse (97/1,500 503s) and is explicitly diagnostic despite its zero script exit code. Its largest self-time frames include native socket writes, idle time, microtasks and ordinary Mongoose hydration; it did not isolate a specific application callback sufficient to justify a fix. This is not proof that the host is the only cause. Windows application/Mongo processes plus WSL2 Redis are not deployment-equivalent native Linux workers.

The corrected short protocol completed all phases: 42/44 checks passed, including JWT isolation, shared operation quotas, outage/reconnect, source failure recovery, bounded leader/joiner/pool queues, immutable records, durable export replay, zero fabricated completion/XP and short memory drain. Its five-second 100-RPS phase had 497/500 successes with three fail-closed 503s and failed latency. It ran alongside frontend/browser work and is not a standalone capacity benchmark. Phase names such as `steady-15min` and `soak-60min` are legacy labels: in smoke mode they ran **five seconds**, not those named durations.

### Failures and diagnostic limitations preserved

- Initial sandboxed native run: all four integration tests failed during the 15-second Mongo startup window. The original fixture did not include its buffered Mongo diagnostics in that timeout message. The same tests passed with local process/network access; no timeout/assertion was increased.
- First Angular run: 19/20 passed. The new pagination fixture had incorrectly retained initial `isLoadingHistory=true`, so the method correctly refused pagination. The test now explicitly starts after bootstrap and asserts its page request is observed. Final 20/20 passed.
- Initial smoke: 34/35 explicit checks passed; history quota had four timeout 503s. It then stopped at a retired-worker sampling timeout before its final soak/record checks. Raw stacks remain. The sampling race was corrected; recovery completed all 44 checks, retaining the two actual performance failures.
- Initial final-browser launch could not find Playwright's Chromium binary and left the verifier HTTP server open. The owned process was stopped; cleanup now runs even when launch fails. Installed Edge was used thereafter.
- First Edge journey reached error/empty recovery but its fixture looked for visible “Force Refresh” instead of the button's existing accessible name “Refresh simulator data.” The locator was corrected; screenshots/logs from that failed attempt remain.
- The historical extended acceptance/trace failures are unchanged. A successful short test does not supersede them. No additional sustained rerun was used to hunt for a lucky pass.

## Environment, observability and release gates

`environment-audit.json` and `environment-audit-final.json` contain relevant variable **names, occurrence counts and configured booleans only**, including duplicate-name inspection. `.env` and all provider credentials/model settings are unchanged. `.env.example` adds empty `SCENARIO_LIMIT_MODE`, `SCENARIO_AUDIT_URI`, `SCENARIO_MIGRATION_URI` with safe operational guidance. No new runtime credential is required for deterministic calculations; shared Redis, Mongo and JWT infrastructure retain their existing keys/defaults.

Existing bounded Prometheus events/source-duration metrics remain in place. Real metrics scraping, alert routing, Redis TLS/ACL/failover, deployment pool sizes, gateway limits, readiness/draining and production source/index distributions require staging/operator evidence.

| Release gate                                                                                    | Status                                                                |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Deterministic v2 mathematics and preserved legacy behavior                                      | PASS locally                                                          |
| Ownership, selected resume, source isolation and partial-data recovery                          | PASS on stated unit/native fixtures                                   |
| Immutable history, cursor pagination, native concurrency                                        | PASS locally                                                          |
| Sprint draft/active exports, receipts, limits and retry integrity                               | PASS locally                                                          |
| Safe migration behavior and declared indexes on disposable Mongo                                | PASS locally                                                          |
| Angular contracts, TypeScript and production compilation                                        | PASS locally                                                          |
| Desktop/mobile, Light/Dark/System, loading/error/empty/partial/history browser states           | PASS on fixture APIs; not staging acceptance                          |
| Sustained 100-RPS availability and latency                                                      | **FAIL — release blocker**                                            |
| Corrected extended steady/restart/soak acceptance                                               | **BLOCKED** until sustained gate passes; historical failures retained |
| Deployment-equivalent Linux diagnosis, real Redis TLS/ACL/failover, production read-only audits | **BLOCKED — external infrastructure/approval**                        |
| Career Sprint owner sign-off/legacy-data rollout and actual staging account journeys            | **BLOCKED — external acceptance**                                     |

No release/production-ready declaration is justified while these gates remain open.

## Exact changed-file inventory and finalization

Application/UI:

- `frontend/src/app/pages/scenario-simulator/scenario-simulator.component.ts`
- `frontend/src/app/pages/scenario-simulator/scenario-simulator.component.spec.ts`
- `frontend/src/app/pages/scenario-simulator/components/scenario-context/scenario-context.component.html`

Operations/verification:

- `backend/.env.example`
- `backend/src/scripts/migrateScenarioSimulationUniqueIndex.js`
- `backend/src/scripts/verifyScenarioP3.js`
- `backend/src/scripts/verifyScenarioProduction.cjs` (new)
- `backend/src/tests/fixtures/scenarioMongo.js`
- `backend/src/tests/scenarioSprintExport.test.js`
- `backend/src/tests/scenarioProductionContracts.test.js` (new)
- `backend/src/tests/scenarioMigration.integration.test.js` (new)
- `frontend/scripts/scenario-vitest.config.mjs` (new)
- `frontend/scripts/verify-scenario-decomposition-ui.cjs`

Report/evidence:

- This report (new).
- `backend/verification/scenario-simulator/production-final-2026-11-09-{focused,profile,smoke,smoke-recovery}.json` (new retained evidence).
- All exact generated logs/JSON paths under `production-finalization-2026-11-09/`, and screenshots/JSON under `frontend/verification/scenario-simulator/production-finalization-2026-11-09/`, are recorded in the final inventory. These include failed attempts intentionally retained.

No application source file was moved or deleted. Mandatory scoped Prettier write/check, JavaScript syntax, TypeScript and staged/unstaged whitespace results are retained in the finalization evidence. Task-owned temporary artifacts are cleaned only after verifying exact roots/ownership; essential logs and screenshots are retained. Final inventory distinguishes unchanged scoring/model/API contracts from the above edits. No unrelated module implementation was changed.

`production-finalization-2026-11-09/cleanup-results.json` records 20 owned temporary files deleted and four diagnostic logs retained at exact recorded destinations; no recursive deletion was used. No owned Mongo processes remained. The P3 cleanup had left nested Mongo spill-store files after stopping its processes; those exact task-owned files and empty folders were removed during finalization. Passing suites/builds were not repeated after artifact-only cleanup. Post-cleanup syntax, formatting, TypeScript, frozen-contract and Git checks are recorded in `finalization-results.json` and `finalization.log`, with exact files/hashes and generated evidence paths in `file-inventory.json`.

The first whitespace check caught a task-added extra blank line at the end of `.env.example`; it was removed. That failed check/log is preserved in `finalization-initial-results.json` / `finalization-initial.log`; final Git checks were then repeated.

During finalization, three evidence files were staged externally: `production-final-2026-11-09-smoke.json`, `production-final-2026-11-09-smoke-recovery.json` and `production-finalization-2026-11-09/browser-final-results.json`. They were preserved. An initial “index remains empty” assertion therefore became inapplicable; its result is retained in `finalization-concurrent-index-results.json`, not treated as a source defect or undone. The observed staged fingerprint was `ae0192fb4df55ac0f524e6474ced612aa5ba59c1`; HEAD and source branch were unchanged. Final checks cover staged whitespace and record the actual index state.
