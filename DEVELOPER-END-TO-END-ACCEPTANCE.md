# Developer end-to-end acceptance

Continuation of commit 9c066ce8 on fix/bug-02. Working tree and index were clean on entry. The previously authorized branch remains checked out. PR target is not applicable.

**Acceptance is incomplete.** The changes address specific sources of inconsistent data. The full browser, provider, Redis, scheduler and cross-module test matrix is still outstanding.

## Changes and why

- GitHub has one MongoDB save lock per account using the existing GitHubSaveLock model. It renews while the provider is active and writes the lease fence in the same transaction as the accepted result. A loser cannot commit or release a successor's lock. Owned Analyze revalidates the saved result instead of trusting a completed frontend cache entry.
- The existing GitHub analysis service separates owned results from shared preview data. Legacy records can use an exact matching preview revision. If that revision is gone, legacy records with sufficient stored evidence return their recorded fields as stale, with missing narrative left absent.
- Skill Gap, Recommendations and Portfolio resolve GitHub evidence by account. Profile Recommendation enrichment uses the accepted revision. Portfolio cache reuse includes Skill Gap data alongside GitHub, resume, career context and the existing integration revision. It only reads Skill Gap coverage when the recorded GitHub and selected resume timestamps match.
- The resume library ignores out-of-order list responses. A saved result or error from the previous context cannot replace a newer upload. The existing View Analysis optimization remains.
- Course progress no longer clears the catalog cache. Browser revision events distinguish Dashboard-only updates from broad source changes. Dashboard queues profile and source events through the same path and continues to use read-only summary requests.
- A Recommendations read that keeps previous cards after failure labels them stale. Selection of already incompatible AI results across all modules remains an open acceptance item.

## Verified results

| Verification                                                          | Result                                                                                                                                                                                                     |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Angular full test suite                                               | 712 passed across 120 files. An earlier run exposed a broken View Analysis cache optimization, which was restored and covered by the final run.                                                            |
| Angular production build                                              | Passed. Existing size budgets still warn on the initial bundle and Jobs and public portfolio styles.                                                                                                       |
| TypeScript                                                            | Passed.                                                                                                                                                                                                    |
| Focused backend GitHub, Portfolio scope and Recommendations hardening | 48 passed.                                                                                                                                                                                                 |
| GitHub HTTP and disposable MongoDB                                    | Passed. 31-second provider hold, renewable lease, simulated takeover, same-handle cached Analyze, failed-provider preservation, profile change and owner checks. The provider was a deterministic fixture. |
| Recommendations and performance suites                                | 11 passed on disposable MongoDB or controlled fixtures. Changing a shared preview alone did not change owned recommendations.                                                                              |
| Skill Gap hardening and Redis cache contract                          | 28 passed, 1 skipped. The skipped test needs a real disposable Redis engine.                                                                                                                               |
| Broad backend                                                         | Failed (exit 1). Observed failures include missing Resume PDF fixtures and Course catalog worker, quota, and recovery checks. The tool truncated the final aggregate totals.                               |
| Playwright/browser workflow                                           | Pending. Angular test-harness results do not establish real F5, hard-reload or multi-tab behavior.                                                                                                         |
| Scoped propagation, all relationships                                 | Not fully verified. See the per-event table and the open items below.                                                                                                                                      |

The first broad backend invocation was stopped when inspection found tests that load application connection settings from backend/.env. The local configured database can be selected by early Career Sprint tests in that invocation. The configured MongoDB and Redis URLs were confirmed to be loopback addresses. The replacement run used an ephemeral replica set, isolated Career Sprint test database and an unavailable loopback Redis endpoint, with the application environment values overridden. No production or remote provider behavior was used to establish acceptance.

## Measurements and limits

The GitHub HTTP fixture verified repeated saved reads with zero provider calls from those reads. The synthetic Recommendations concurrency case measured zero GitHub calls, one AI call, one signal computation and two persistence operations for a five-request batch during explicit generation. Those controlled counts do not measure production traffic. Complete page-entry HTTP budgets, database operation budgets, Redis hit/miss rates, scheduler retries and cross-module propagation latency have not been measured this continuation.

## Open acceptance items

- Real disposable Redis, recovery and multi-instance invalidation, and a real browser run for F5, hard reload, navigation, account and organization switches, and two tabs.
- An end-to-end GitHub/Resume/Profile → Skill Gap, Portfolio, Recommendations and Dashboard run asserting both displayed values and recorded freshness.
- Full module implementation remains incomplete. Integration/sprint/interview/report/notification/background signal lifecycles still need the complete consumer matrix and multi-instance scheduling acceptance. Historical reports and saved plans still follow their existing explicit policies.
- Skill Gap and Portfolio compatibility for every legacy shape and current input revision, remaining five-state UI coverage and comprehensive latency instrumentation.
- Resolve broad backend failures and re-run acceptance before declaring the workspace stable.

For dependency, behavior and verification detail see [Developer dependency map](DEVELOPER-CROSS-MODULE-DEPENDENCY-MAP.md), [Refresh behavior](DEVELOPER-REFRESH-BEHAVIOR-MATRIX.md), and [Cache invalidation verification](DEVELOPER-CACHE-INVALIDATION-VERIFICATION.md).

## Exact change and evidence inventory

Source files, tests and documentation added or changed:

- `DEVELOPER-CACHE-INVALIDATION-VERIFICATION.md`
- `DEVELOPER-CROSS-MODULE-DEPENDENCY-MAP.md`
- `DEVELOPER-END-TO-END-ACCEPTANCE.md`
- `DEVELOPER-REFRESH-BEHAVIOR-MATRIX.md`
- `backend/src/modules/github/githubcontroller.js`
- `backend/src/modules/github/services/githubservice.js`
- `backend/src/modules/recommendations/services/recommendationService.js`
- `backend/src/modules/skill-gap/skillgapcontroller.js`
- `backend/src/modules/workflows/analysiscontroller.js`
- `backend/src/tests/dashboard/dashboardPortfolioScope.test.js`
- `backend/src/tests/github/githubAnalyzerHardening.test.js`
- `backend/src/tests/github/githubAnalyzerPerformance.test.js`
- `backend/src/tests/github/githubFreshnessMongo.integration.test.js`
- `backend/src/tests/recommendations/recommendationsHardening.test.js`
- `backend/src/tests/recommendations/recommendationsMongo.integration.test.js`
- `backend/src/tests/recommendations/recommendationsPerformance.test.js`
- `frontend/src/app/features/developer/pages/dashboard/dashboard.component.ts`
- `frontend/src/app/features/developer/pages/recommendations/recommendations.component.ts`
- `frontend/src/app/features/developer/pages/resume-analyzer/resume-analyzer.component.spec.ts`
- `frontend/src/app/features/developer/pages/resume-analyzer/resume-analyzer.component.ts`
- `frontend/src/app/shared/services/course.service.ts`
- `frontend/src/app/shared/services/frontend-cache-invalidation.service.spec.ts`
- `frontend/src/app/shared/services/frontend-cache-invalidation.service.ts`
- `frontend/src/app/shared/services/github.service.ts`

No source files were moved or deleted. The full test harness rewrote 13 tracked verification artifacts. They were restored to their verified clean baseline after saving the new evidence. The manifest gives both exact paths for every file. [Evidence manifest](backend/verification/data-freshness/continuation-2026-11-18/evidence-manifest.json)

Prettier write and check, TypeScript, production build, backend syntax checks and Git whitespace validation passed. Commits, pushes, branch changes, deployments, dependency installations and schema migrations were outside this task.
