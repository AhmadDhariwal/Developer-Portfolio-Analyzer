# Developer data freshness finalization — 2026-11-17

Acceptance: **INCOMPLETE**. Core corrections are implemented and tested. The full request is not accepted: real Redis/provider/browser gates and several regression failures remain. No guarantee of zero fluctuation is asserted.

## Scope and Git preflight

Authorized source/current branch: `fix/bug-02`. PR target: not applicable. Working tree and index were clean before implementation. No branch changes, commits, pushes, merges, deployments, dependency installations, schema declarations, production connections or destructive data operations were performed. Existing API routes/methods and scoring formulas remain.

## Implemented changes

1. GitHub page initialization/navigation and Refresh Data use `POST /api/github/analyze-save` with `savedOnly:true`. The existing authenticated handler validates the configured username and reads the latest owned Analysis. It never invokes GitHub/AI or persistence on that path. Missing accepted data returns a clear 404 asking for explicit sync.
2. Full accepted payloads are stored inside the existing Mixed `githubSignals.acceptedResult` field, without a schema migration. Legacy reads only use a shared payload if its analyzedAt exactly matches the owned accepted revision. Failed source calls retain the accepted result. Older timestamps cannot replace newer owned accepted results. Cached saves do not append history or replay mutation invalidation.
3. Identical observed GitHub evidence retains its assessment and history and skips optional narrative enrichment. The Redis/Mongo cache freshness window can be renewed after an explicit successful source verification.
4. Repository changes now participate in the existing acceptance/notification transaction. The callback rechecks profile identity, and a new Analysis insert remains an insert if Mongo retries the transaction. A changed profile during sync is rejected with 409.
5. GitHub invalidation targets `v9-skill-evidence-governance`, with owner scope for foreground saves and actual `skill_gap:result:<userId>:` prefix invalidation. Existing content/source hashes remain in use.
6. Every shared Redis payload read uses an atomic GET/PTTL snapshot. Memory promotion cannot extend the remaining source TTL. Missing, expired and no-expiry entries are misses. Lock release is an atomic token comparison/delete. No configured TTL was changed.
7. Profile page entry revalidates persisted profile data. Account cache clearing also cancels organization requests/cached shareReplay state. Organization creation invalidates after success.
8. Course progress and interview completion invalidate Dashboard/report caches after persistence. Interview maintenance uses the existing shared Mongo interview-bank lease; cron remains `30 */4 * * *`.
9. Ordinary profile Skill Gap reads cannot queue GitHub SWR or consume optional narrative AI admission. Explicit refresh and temporary user-invoked workflows retain their controls.
10. Recommendations can display an eligible browser snapshot while revalidating, but completed browser/service payload caches cannot suppress server revision validation. Backend deterministic/AI admission policy is retained.
11. Weekly Reports page entry requests latest/history saved data even when its 10/15-minute browser snapshots exist. It does not regenerate reports.
12. Portfolio cache reuse compares a GitHub/resume/career input fingerprint as well as the existing integration revision. Historical provenance is not upgraded on reads.
13. Scoped storage revision events invalidate matching account/tenant caches in another tab. Dashboard coalesces same-tab/cross-tab events and re-reads saved evidence using its existing cancellation and stale-cycle checks. There is no added polling interval.

## Verification results

| Check                             | Result                                                             | Evidence                                                                    |
| --------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Frontend full suite               | PASS: 710 tests, 120 files                                         | backend/verification/data-freshness/frontend-tests.txt                      |
| Focused backend regressions       | PASS: 65 passed; 1 real-Redis test skipped                         | backend/verification/data-freshness/focused-backend-tests.txt               |
| GitHub real HTTP/JWT/Mongo        | PASS: 1 integration test with provider stubs; no Redis             | backend/verification/data-freshness/github-mongo-tests.txt                  |
| Skill Gap real Mongo, two workers | PASS: 9 tests; provider stubs; isolated rerun                      | backend/verification/data-freshness/skillgap-mongo-tests.txt                |
| Broad backend suite               | FAIL: 1027 passed, 26 failed, 1 cancelled, 27 skipped (1081 total) | backend/verification/data-freshness/backend-tests.txt                       |
| TypeScript noEmit                 | PASS                                                               | backend/verification/data-freshness/typescript.txt                          |
| Angular production build          | PASS with bundle/stylesheet budget warnings                        | backend/verification/data-freshness/frontend-build.txt                      |
| Changed-source formatter          | Prettier write then check, explicit paths: PASS                    | repository configured frontend formatter; matching backend per-file options |
| Changed backend syntax            | node --check: PASS                                                 | each changed/new backend JavaScript file                                    |
| Git whitespace                    | git diff --check and cached --check: PASS                          | finalization command                                                        |
| Real Redis engine                 | BLOCKED; optional integration test added, not passed               | DPA_TEST_REDIS_URL unset; no installed supported Redis server found         |
| Real browser/Playwright           | NOT TESTED                                                         | F5/hard reload/two tabs/visuals still require execution                     |

The broad backend run preceded the final focused corrections and is retained unmodified. Two Skill Gap assertions expected an automatic AI call, and a recommendation source assertion expected the removed browser payload cache. They were updated to the requested behavior and covered by passing targeted reruns. A concurrent-load frontend rerun also had one 5000ms Career Sprint test timeout (709 passed); no timeout was increased. The final frontend run is retained in frontend-tests.txt, with the intermediate failure described in frontend-concurrent-load-note.md. Other broad failures remain unresolved; the broad suite has not subsequently passed. Do not subtract these corrected assertions and present a fabricated passing broad result.

Broad failures include missing resume PDF fixtures (`backend/src/tests/fixtures/resume/standard.pdf`, `empty.pdf`), missing explicit isolated Career Sprint connection variables, stale Sprint planner test paths (path corrected in this change), course catalog/admission assertions, integration connection/governance failures, news environment catalog assertions, and worker startup/timing failures. Some harnesses are sensitive to concurrent process load: the final standalone Skill Gap two-worker run passes after a loaded rerun returned admission 503s. This does not prove those failures can all be dismissed as environmental.

## Counts and performance

The real GitHub HTTP/Mongo test performs repeated saved reads with **zero provider invocations from those reads**, tests 401/404 owner/missing states, cached-save deduplication, failed sync preservation, changed accepted revisions, and a profile switch during synchronization. Its GitHub provider is a stub: no real remote commit or paid AI invocation was tested. The diagnostic records counts before the final profile-switch case; see test assertions for full request sequence.

The retained focused GitHub timing benchmarks measure synthetic in-process provider/cache fixtures. Their p50/p95 values are in focused-backend-tests.txt; they are not production latency or a performance improvement claim. Real capacity/load improvements were not established.

## Remaining implementation/acceptance work

- Execute the full module matrix with real Redis, browser workflows, remote-provider fixtures and two backend instances, including source-to-Dashboard chains. All modules remain BLOCKED for full acceptance in the module matrix.
- Finish auditing all consumers against the owned accepted revision. Source fingerprints alone do not prove every legacy/global preview cache is compatible with an owned assessment.
- Exercise long GitHub syncs past the existing 30-second save lease and mixed Redis outage/recovery. The existing lease architecture was retained; complete renewal/fencing guarantees are not established.
- Accept or implement a legacy saved-result reconstruction/migration for records whose matching shared payload was replaced. The new reader deliberately reports unavailable instead of mixing another revision.
- Complete per-selected-resume response ordering, cross-account/tab/organization acceptance and the complete five-state freshness presentation. These have not been fully finalized across all modules.
- Audit and test renewal/recovery for all twelve worker loops. Only the missing interview maintenance lease was changed here.
- Resolve the remaining broad backend failures, restore legitimate missing PDF fixtures through the repository workflow, and rerun full acceptance. Tests were not weakened or skipped to conceal failures.

## Isolated infrastructure setup

MongoDB Memory Server is not installed as a project dependency. An existing MongoDB 8.2 binary is available at `C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe`; the repository replica-set fixture can run without new software. Run outside a sandbox that blocks loopback/process access:

```powershell
$env:INTEGRATION_TEST_MONGOD = 'C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe'
node --test backend/src/tests/github/githubFreshnessMongo.integration.test.js
node --test backend/src/tests/skill-gap/skillGapProduction.test.js
```

For real Redis, once an approved Docker installation or equivalent disposable server is available (Docker was not installed in this task), start a loopback-only instance. No shared Upstash/application URL should be used:

```powershell
docker run --rm --name dpa-freshness-redis -p 127.0.0.1:16379:6379 redis:7-alpine redis-server --save "" --appendonly no
# In another shell:
$env:DPA_TEST_REDIS_URL = 'redis://127.0.0.1:16379/15'
$env:DPA_TEST_REDIS_DISPOSABLE = 'true'
node --test backend/src/tests/core/cacheFreshness.test.js
```

The Redis test requires the disposable acknowledgment, permits loopback URLs only, uses random task-owned keys, and deletes only its exact keys. WSL discovery returned E*ACCESSDENIED. No system software, package, credential or machine-wide configuration was installed/changed. Other existing integration suites have their own opt-in variables, including `CAREER_SPRINT_ISOLATED_MONGO_URI` (strict loopback `/career_sprint_legacy_test*<suffix>`database),`JOBS_TEST_REDIS_URL`, and `NEWS_TEST_REDIS_URL`/`NEWS_TEST_MONGODB_URI`; consult each fixture's safety validation instead of pointing it at shared application data.

## Finalization and exact inventory

No source files were moved or deleted. Existing test harnesses rewrote historical verification artifacts; their current results were copied into `backend/verification/data-freshness/regression-evidence/`, and original historical bytes were recovered from the initially clean Git baseline. Exact paths are in `backend/verification/data-freshness/historical-evidence-restoration.json`.

The following redundant, task-owned logs were deleted after retaining equivalent final evidence: `backend/verification/data-freshness/github-tests.txt`, `cache-score-tests.txt`, `cache-contract-tests.txt`, and `github-final-tests.txt`. No directories, user files, source fixtures, assets, licenses or historical records were deleted. Failure logs and essential current results are retained.

Changed/new source, tests and documentation:

- `CROSS-MODULE-CONSISTENCY-VERIFICATION.md`
- `DATA-FRESHNESS-DEPENDENCY-MAP.md`
- `DEVELOPER-DATA-FRESHNESS-FINAL.md`
- `DEVELOPER-MODULE-REFRESH-TEST-MATRIX.md`
- `MODULE-CACHE-REFRESH-MATRIX.md`
- `PROJECT-DATA-FLOW-ARCHITECTURE.md`
- `REDIS-AND-CACHE-INVENTORY.md`
- `REFRESH-PERFORMANCE-AND-RISKS.md`
- `SCHEDULERS-AND-BACKGROUND-JOBS.md`
- `backend/src/core/cache/redisCacheService.js`
- `backend/src/modules/github/githubcontroller.js`
- `backend/src/modules/github/services/githubservice.js`
- `backend/src/modules/interview-prep/services/interviewQuestionMaintenanceService.js`
- `backend/src/modules/skill-gap/skillgapcontroller.js`
- `backend/src/modules/workflows/analysiscontroller.js`
- `backend/src/tests/career-sprint/careerSprintHardening.test.js`
- `backend/src/tests/core/cacheFreshness.test.js`
- `backend/src/tests/dashboard/dashboardPortfolioScope.test.js`
- `backend/src/tests/github/githubAnalyzerHardening.test.js`
- `backend/src/tests/github/githubAnalyzerPerformance.test.js`
- `backend/src/tests/github/githubFreshnessMongo.integration.test.js`
- `backend/src/tests/recommendations/recommendationsHardening.test.js`
- `backend/src/tests/skill-gap/skillGapProduction.test.js`
- `frontend/src/app/features/developer/pages/dashboard/dashboard.component.ts`
- `frontend/src/app/features/developer/pages/github-analyzer/github-analyzer.component.html`
- `frontend/src/app/features/developer/pages/github-analyzer/github-analyzer.component.spec.ts`
- `frontend/src/app/features/developer/pages/github-analyzer/github-analyzer.component.ts`
- `frontend/src/app/features/developer/pages/profile/profile.component.ts`
- `frontend/src/app/features/developer/pages/recommendations/recommendations.component.ts`
- `frontend/src/app/features/developer/pages/weekly-reports/weekly-reports.component.ts`
- `frontend/src/app/shared/services/api.service.ts`
- `frontend/src/app/shared/services/course.service.ts`
- `frontend/src/app/shared/services/frontend-cache-invalidation.service.spec.ts`
- `frontend/src/app/shared/services/frontend-cache-invalidation.service.ts`
- `frontend/src/app/shared/services/github.service.spec.ts`
- `frontend/src/app/shared/services/github.service.ts`
- `frontend/src/app/shared/services/interview-prep.service.ts`
- `frontend/src/app/shared/services/recommendations.service.ts`

Retained task evidence paths:

- `backend/verification/data-freshness/backend-tests.txt`
- `backend/verification/data-freshness/changed-contract-tests.txt`
- `backend/verification/data-freshness/focused-backend-tests.txt`
- `backend/verification/data-freshness/frontend-build.txt`
- `backend/verification/data-freshness/frontend-tests.txt`
- `backend/verification/data-freshness/github-mongo-tests.txt`
- `backend/verification/data-freshness/historical-evidence-restoration.json`
- `backend/verification/data-freshness/regression-evidence/architecture/request-flow-governance-results.json`
- `backend/verification/data-freshness/regression-evidence/courses/acquisition-2026-11-06/coverage.json`
- `backend/verification/data-freshness/regression-evidence/courses/defects-2026-11-05/mongo-network.json`
- `backend/verification/data-freshness/regression-evidence/courses/defects-2026-11-05/shared-catalog.json`
- `backend/verification/data-freshness/regression-evidence/courses/relevance-2026-11-06/after.json`
- `backend/verification/data-freshness/regression-evidence/integrations/final-scalability-acceptance.json`
- `backend/verification/data-freshness/regression-evidence/integrations/query-plans.json`
- `backend/verification/data-freshness/regression-evidence/integrations/repeated-requests-cache-audit.json`
- `backend/verification/data-freshness/regression-evidence/integrations/scalability-governance-regression.json`
- `backend/verification/data-freshness/regression-evidence/notifications/integration-results.json`
- `backend/verification/data-freshness/regression-evidence/skillgap/production-results.json`
- `backend/verification/data-freshness/regression-evidence/weekly-reports/refinement-2026-11-11/pagination.pdf`
- `backend/verification/data-freshness/regression-evidence/weekly-reports/refinement-2026-11-11/snapshot.pdf`
- `backend/verification/data-freshness/skillgap-mongo-tests.txt`
- `backend/verification/data-freshness/typescript.txt`
