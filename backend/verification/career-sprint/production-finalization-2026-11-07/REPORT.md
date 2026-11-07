# Career Sprint production finalization — 2026-11-07

**Release status: BLOCKED.** The targeted Learning Hub assertion blockers are resolved. The historical Sprint p95 failure remains blocked pending stable-host/staging verification; real Redis gates remain open. This is not production sign-off. No production records, migrations, deployments, commits, pushes or branch switches were performed.

## Latest targeted stabilization

See [targeted results and exact file inventory](targeted-stabilization/REPORT.md). Exactly one controlled diagnostic cycle and one confirmation cycle ran; no full suite, browser matrix, load test, TypeScript run or build was repeated.

- Sprint: the original end-to-end `<50ms` p95 assertion, 20 samples and 25ms mocked Mongo delay remain unchanged. Diagnostic p95 **32.22ms**; confirmation p95 **40.17ms**. Cache work p95 **0.64ms / 0.51ms**. Confirmation reproduced an **86.02ms** request outlier: **70.13ms** in mocked Mongo timer spans, **15.19ms** before cache entry and **0.41ms** in synchronous cache work. This observed spike is outside cache hash/LRU/clone work. The historical **61.24ms p95** was not reproduced in the bounded cycles; it is not silently cleared by their passing p95 results. No runtime performance defect was demonstrated, and no runtime code or threshold changed.
- Learning Hub: the fixture has only SQL/CLAIMED_ONLY and Docker/PARTIAL as eligible Backend targets, yielding exactly **3**, not 4, Coursera entries (`fb_c2`, `fb_c5`, `fb_c12`). Tests now verify exact disjoint pages, clamping, excluded topics and Discover availability. Evidence storage failure correctly returns **503 / COURSE_EVIDENCE_UNAVAILABLE**, `Retry-After: 5`, and no personalized courses even with a warm pool. Redis-only failure, recovery and Discover remain positive paths. The two corrected tests and their parent passed **3/3**; the Sprint test passed **1/1**. The current v9 contract and production Learning Hub implementation were preserved.
- Ten production/configuration files were verified unchanged against the pre-existing index, including all six Sprint variables, Mongo authority, shared AI limits and invalidation. The existing staged index is unchanged. Only two test files, one bounded verifier and these release documents/evidence changed in this task.

## Earlier production-finalization evidence (retained)

The failure counts and inventories below describe the preceding broad finalization, before the targeted reconciliation above. They are retained as historical evidence, not presented as the latest test result.

## Scope and baseline

Developer/User Career Sprint only. Source and working branch: `fix/career-sprint`, explicitly confirmed by the user. PR/integration target: not applicable. Initial index: empty. Initial working-tree change: `backend/.env.example` (11 existing added lines). Those lines are preserved; this task appends a separate Career Sprint configuration section. No user work was reset, removed or staged.

Audit followed the implementation, feature contract, historical verification reports, backend CommonJS services/models/routes/controllers, Angular components/services/presentation helpers, tests, provider/cache abstractions and the Scenario, Learning Hub, Skill Gap, Dashboard, News and Weekly Reports consumers. Historical reports describe earlier states and are not fresh verification. No separate architecture overview was supplied with the request.

## Necessary changes

1. Overview cache hits now refresh LRU recency without extending the original 60-second TTL. Previously the nominal 500-entry LRU behaved as insertion-order eviction. The new eviction regression failed before the fix and passed afterward.
2. Optional AI sequencing passes the existing provider abstraction `requestPolicy: {maxAttempts: 1}` and a cancellation signal at the configured deadline. Previously retries=0 still allowed multiple models/providers and the outer deadline did not cancel underlying work. No provider API, dependency or model schema changed.
3. Draft-only save/import/delete and streak recovery no longer invalidate News personalization. They still invalidate Sprint/Dashboard/Scenario consumers. Task changes and draft ingestion retain News invalidation because task topics and completion affect personalization. Matching frontend behavior is tested.
4. Completion/reopening changes the pending task checkbox optimistically. XP, level, timestamps and analytics remain server-owned. Failure restores the previous snapshot; duplicate clicks remain blocked; success replaces the view with the server response. Rollback does not overwrite a replacement snapshot.
5. Documented the six existing Sprint tuning variables and the Mongo replica-set prerequisite. Updated the feature guide and linked this review from the historical report.
6. Implemented the approved shared AI admission policy in the existing Mongo governance store: five uncached planning attempts per owner per fixed hour, one active attempt per owner, eight globally. Quota and both leases commit atomically using the existing transaction helper. Cache hits and coalesced callers bypass admission. Denial/store failure uses deterministic fallback. Failed admitted attempts consume quota; lease release never refunds it. Ten-second token-scoped leases bound crash recovery and old cleanup cannot release replacement work. The global limit also bounds any individual provider to at most eight admitted Sprint calls.
7. Added the approved `meta.sprint.tasksOverdue` count to newly generated Weekly Reports and the corresponding stored snapshot field. Historical reports retain absence of this metric; there is no default/backfill or score change. Tests cover alias precedence, exclusive overdue boundaries, completed exclusions and schema retention. The real browser/API verifier now checks the persisted count against Sprint analytics before/after completion.

## Mathematics and calendar contract

No scoring engine or historical record was rewritten.

| Contract             | Verified behavior                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Windows              | Default Monday–Sunday, seven inclusive pinned calendar days; custom windows 1–366 days, including DST boundaries                |
| Task defaults        | Learning 3, practice 4, project 5; existing explicit manual point range 1–10 remains supported                                  |
| Limits               | 500 tasks, 8 saved drafts; bounded per-request imports and text                                                                 |
| XP                   | High 15 / medium 10 / low 5, plus task points; once per false→true transition; reversal subtracts; replay adds nothing          |
| Level                | `max(1, floor(XP / 100) + 1)`                                                                                                   |
| Progress             | Rounded/clamped completed points divided by total points × 100; empty Sprint adapter returns 0                                  |
| Productivity         | Rounded/clamped `4 * completedPoints + 5 * completedTaskCount - 6 * overdueTaskCount`                                           |
| Overdue              | Incomplete task whose first available endDate/deadline/dueDate is strictly before now; date-only deadlines end at local day end |
| Overview consistency | Rounded/clamped `0.62 * progress + 23 * min(streak,14)/14 + 1.5 * min(completedTasksInLast7CalendarDays,10)`                    |
| History consistency  | Rounded/clamped `0.65 * progress + 3.5 * min(streak,10)`                                                                        |

The overview/history formulas are explicitly distinct in current code and the earlier report. The shared developer signal also retains its separate `0.72 * progress + 28 * min(streak,14)/14` summary. Weekly Reports consumes that existing signal. Unifying these would change scoring and was not done. Unknown legacy calendar provenance remains unavailable/read-only rather than inventing a timezone or recent consistency score.

Authoritative new-window policy is `sprint-calendar-48h-v1`, established by `docs/features/career-sprint.md`, `sprintCalendar.js`, `sprintStreakPolicy.js` and release-policy tests. The break occurs at the second local midnight after real activity; recovery expires exactly 48 elapsed hours later, exclusively. UTC, Asia/Karachi and America/New_York spring/fall DST boundaries are covered. Recovery records a separate bridge once per broken interval and creates no completion, XP or progress. Legacy missed-calendar-day behavior remains versioned; unknown legacy calendars cannot be mutated. No migration ran.

Independent real HTTP/Mongo arithmetic groups passed XP 25 / 100 / 43, level 1 / 2 / 1, progress 63% / 80% / 100%, including concurrent completion replay, reversal, recompletion and persisted reads. See `integrated-results.json`.

## API, persistence, cache and AI findings

JWT protects all Sprint routes. Owned queries and foreign task/draft/Scenario rejection are exercised by real JWT/Mongo integration. Optimistic document versioning and up to five fresh-document retries preserve completion/import idempotency. Existing atomic Learning Hub/Recommendations handoffs increment `__v`. Unique creation/day indexes and owner reservation documents protect windows; overlap returns 409. Conservative reservations survive ambiguous failure and require operator review, not automatic deletion. Legacy migration remains an explicitly authorized operator action.

Mongo is authoritative before overview cache reuse. Snapshot/revision identity includes current/previous data, pinned day, overdue state and draft context. Old Redis writes use their old immutable revision key. The 500-entry memory LRU has a fixed 60-second TTL; overview Redis uses `career_sprint:overview-v4` with 120 seconds. Redis reads have a 120ms Sprint budget and shared Redis command/backlog bounds. New tests cover LRU, non-sliding TTL, independent clones, in-flight deduplication, late revision writes, rejection and stalled Redis. Two real processes verified fresh Mongo revisions, restart, concurrent windows and database failure/fallback. **Actual Redis was unavailable**, so those results do not prove live cross-process Redis behavior.

AI output is accepted only as the exact permutation of permitted deterministic target IDs: exact length, unique known IDs and no extra fields. Task content, dates, points, XP and completion remain backend-controlled. Provider errors, malformed/duplicate/unknown IDs, polluted facts and timeout use deterministic fallback. Five identical refreshes share one request. Current profile/evidence/source/task history is checked before plan cache reuse. Completed/imported tasks remain excluded without promoting recorded activity to proficiency.

**Admission gap resolved locally after approval:** quotas and concurrency now share Mongo authority across processes. Eight real-Mongo assertions/groups cover exhaustion, hourly rollover, concurrent owner denial without quota leakage, global capacity, expired leases, old-token cleanup, process isolation and unavailable storage. Provider-path tests separately verify that denied admission makes no provider call and failures release the reservation. The approved limit applies to uncached plan attempts, conservatively including attempts that later hit the provider abstraction's own cache; it is not a billing ledger. Production still needs staging load/failover verification, synchronized worker clocks and real configured provider checks. No new environment variables, HTTP error shapes or database migration were introduced by admission.

## Cross-module compatibility

- Skill Gap/evidence: imports and completion remain recorded activity; no automatic demonstrated proficiency or credentials. Existing evidence classes remain unchanged.
- Scenario: immutable receipts/provenance survive 50 concurrent replay attempts, task edits/deletion and draft ingestion; no duplicated XP or simulated achievements.
- Learning Hub: atomic owned handoff and replay after task editing passed. Existing broader suite has two failed child assertions, below.
- Dashboard/Weekly Reports: backend invalidation and frontend cache refresh remain; real browser verification checks freshness after mutation. New reports add the approved overdue count; existing task-count completion and consistency scoring remain distinct from point-weighted Sprint progress. Persisted historical weekly reports remain historical.
- Tech News: task-based contexts still invalidate; draft-only operations and restoration preserve personalization. News provenance tests retain existing ranking and reject claimed/inferred proof.

## Environment audit

This is a code/example audit, not disclosure or validation of configured secrets. Runtime configuration is read at startup; restart after changes. No `.env` was edited.

| Variable                                                                | Classification / actual behavior                                                                                                                    | Example coverage                                                           |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `MONGODB_URI`                                                           | Required application database; startup reads this name; replica set or mongos required by existing completion/restoration notification transactions | Present                                                                    |
| `MONGO_URI`                                                             | Compatibility alias in test/operator scripts; does not replace application startup's `MONGODB_URI`                                                  | Not required in example                                                    |
| `JWT_SECRET`                                                            | Required secure authentication secret                                                                                                               | Present placeholder                                                        |
| `JWT_ISSUER`, `JWT_AUDIENCE`                                            | Optional/defaulted `devinsight-api`, `devinsight-web`                                                                                               | Present                                                                    |
| `REDIS_URL`                                                             | Optional; takes precedence, native Redis TCP/TLS URL                                                                                                | Present                                                                    |
| `UPSTASH_REDIS_HOST`, `UPSTASH_REDIS_PORT`, `UPSTASH_REDIS_TOKEN`       | Optional alternate Redis configuration; port defaults 6379; token enables alternate URL construction                                                | Present                                                                    |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_MODELS`, `GEMINI_COOLDOWN_MS` | Optional sequencing provider; models default through provider manager, cooldown 180000ms; deterministic planning needs no key                       | Key/single model/cooldown present; plural list is optional and omitted     |
| `AI_PROVIDER_PRIORITY`                                                  | Optional shared provider order, also influenced by platform settings; Sprint does not hardcode Gemini-only execution                                | Present                                                                    |
| `GROQ_*`, `OPENAI_*`, `ANTHROPIC_*`, `OPENROUTER_*`                     | Optional shared alternatives: API key, model, models and cooldown fields; not Sprint-specific requirements                                          | Groq/OpenAI single-model keys present; other optional alternatives omitted |
| `AI_REQUEST_TIMEOUT_MS`                                                 | Shared optional default 30000ms; Sprint explicitly overrides it                                                                                     | Not needed for Sprint example                                              |
| `AI_RESPONSE_CACHE_TTL_SECONDS`, `AI_DETERMINISTIC_CACHE_TTL_SECONDS`   | Shared optional defaults 86400 / 600 seconds; separate from Sprint overview/plan TTLs                                                               | Optional omitted                                                           |
| `CAREER_SPRINT_PLANNING_CACHE_MAX_SIZE`                                 | Optional/defaulted 300, minimum 10                                                                                                                  | Added existing knob                                                        |
| `CAREER_SPRINT_PLAN_RESULT_CACHE_TTL_MS`                                | Optional/defaulted 120000, minimum 1000ms                                                                                                           | Added existing knob                                                        |
| `CAREER_SPRINT_PLAN_REDIS_BUDGET_MS`                                    | Optional/defaulted 120, minimum 20ms                                                                                                                | Added existing knob                                                        |
| `CAREER_SPRINT_PLAN_REDIS_TTL_SECONDS`                                  | Optional/defaulted 120, minimum 30s                                                                                                                 | Added existing knob                                                        |
| `CAREER_SPRINT_AI_TIMEOUT_MS`                                           | Optional/defaulted 4500, clamped 2000–5000ms                                                                                                        | Added existing knob                                                        |
| `CAREER_SPRINT_STAGE_TIMINGS`                                           | Optional: `1` enables production timing metadata; nonproduction overview timing remains enabled                                                     | Added existing knob, 0                                                     |
| `NODE_ENV`                                                              | Shared environment selector; production disables default stage timings                                                                              | Present                                                                    |
| `RATE_LIMIT_GLOBAL_MAX`, `RATE_LIMIT_GLOBAL_MAX_DEV`                    | Shared optional HTTP limits, production default 500 / 15min; development default at least 5000; platform security settings can override             | Optional omitted; not AI quota controls                                    |

No obsolete `CAREER_SPRINT_*` runtime variables were found. Test/verifier-only variables are not deployment configuration: `CAREER_SPRINT_ISOLATED_MONGO_URI`, `CAREER_SPRINT_TEST_OWNER`, `CAREER_SPRINT_FINAL_E2E_URI`, `CAREER_SPRINT_FINAL_E2E_PORT`, `CAREER_SPRINT_AI_VERIFY_URI`, `SPRINT_E2E_OUTPUT`, `SPRINT_E2E_SESSION`, `SPRINT_LIVE_OUTPUT`, `SPRINT_UI_OUTPUT`, `SPRINT_CHROMIUM_PATH`, `PLAYWRIGHT_MODULE`, and the existing `RELEASE_*` operator script inputs.

Production requirements: supported Node/ICU timezone data and synchronized clocks across workers; Mongo replica set, reviewed existing unique/reservation/governance indexes and notification persistence; explicit legacy provenance and migration authorization; Redis TLS/connectivity if using shared caching; authenticated user ownership; staging verification of the approved shared AI admission before paid-provider enablement. Local tests use disposable loopback Mongo and provider mocks. Staging must validate actual Redis outage/recovery, distributed admission under load/failover, supported browsers and real configured provider behavior without touching production history.

## Exact verification commands and results

Commands below run from `backend` unless marked otherwise. All providers are controlled in tests; no paid/live provider request was made.

```text
node --test --test-concurrency=1 src/tests/careerSprintService.test.js src/tests/careerSprintFinalization.test.js src/tests/careerSprintHardening.test.js src/tests/careerSprintLegacyPolicy.test.js src/tests/careerSprintPlanningFinalization.test.js src/tests/careerSprintReleasePolicies.test.js src/tests/careerSprintPerformance.test.js src/tests/sprintOverviewCache.test.js src/tests/sprintInvalidation.test.js src/tests/weeklyReportSprint.test.js src/tests/weeklyReportScheduler.test.js
```

Pre-admission focused PASS: 54/54, zero skipped/cancelled. Initial parallel baseline was 45/46 (memory p95 59.47ms vs unchanged <50ms); the failed test passed alone, and an intermediate serial focused run passed all thresholds. **Final expanded post-cleanup result: FAIL, 61/62, zero skipped/cancelled, memory p95 61.24ms against <50ms.** All other cases passed. Retained full output: `backend-final.txt`. An independent 40-sample host probe of the test's 25ms timer measured p50 31.60ms / p95 32.23ms / max 33.42ms (`timer-diagnostic.json`). Host timer granularity and scheduling affect measurements, but this probe does not prove the complete cause of the application's failed p95. The intermittent failure remains unresolved; no threshold, sleep, assertion or scoring rule was weakened. No repeated passing run is used to hide the final failed gate.

```text
node --test --test-concurrency=1 src/tests/careerSprintMongo.integration.test.js src/tests/careerSprintLegacy.integration.test.js src/tests/careerSprintWorkers.integration.test.js src/tests/sprintAiAdmission.integration.test.js
```

Final combined PASS: 11/11, zero skips/cancellations, including real JWT/Mongo, legacy preservation, two processes and shared AI admission (parent plus seven boundary/concurrency groups). Initial sandbox attempts could not connect (EACCES) or had no listener. Standalone Mongo then failed notification transactions. A disposable replica set resolved that prerequisite. Redis-unavailable two-process fallback is verified; live Redis remains BLOCKED. Fixtures were torn down before exact-path runtime cleanup.

```text
node --test --test-concurrency=1 src/tests/sprintInvalidation.test.js src/tests/scenarioSprintExport.test.js src/tests/coursesMongo.integration.test.js src/tests/newsContract.test.js src/tests/scoringFoundation.test.js src/tests/weeklyReportScheduler.test.js
```

FAIL: 36 passed / 39 counted (two Learning Hub child failures plus their failed parent). Atomic Sprint handoff and ownership passed. Failures: `coursesMongo.integration.test.js:326` expects 4 paginated Coursera entries but gets 3; `:374` expects career-context fallback 200 but gets 503. Current `courseRecommendationService.js` intentionally filters For You by eligible evidence targets and explicitly returns 503 for evidence-unavailable. These pre-existing tests need reconciliation with the newer Learning Hub contract; no Learning Hub source/assertion changes were made. The relevant source and failures were inspected; the complete backend suite was not repeatedly run.

```text
# frontend
npm test -- --watch=false --include='src/app/pages/career-sprint/**/*.spec.ts' --include='src/app/shared/services/career-sprint.service.spec.ts'
# repository root
node frontend/node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.app.json
# frontend
npm run build
```

Angular PASS: 30/30 in 5 files, zero skips. The initial sandbox invocation failed all 5 suites before running tests due to EPERM on temporary-file rename; the permitted rerun passed. TypeScript PASS. Production build PASS, bundle `main-IF3PLBTM.js`, 120.688 seconds; the existing Landing Page SCSS warning remains (56.67 kB against 48 kB). Budgets were not changed. Post-cleanup results are recorded below.

```text
# backend, isolated CAREER_SPRINT_FINAL_E2E_URI
node src/scripts/verifyCareerSprintFinalE2E.js --serve
# frontend, explicit bundled Playwright and task-owned output/session paths
node scripts/verify-career-sprint-live.cjs
node scripts/verify-career-sprint-ui.cjs
```

Real API verifier PASS: 5/5 groups. `integrated-results.json` retains arithmetic and handoff results. Real browser/API PASS: 5/5 groups, including the approved persisted overdue count matching Sprint analytics and decreasing by one on completion. UI matrix PASS: 24/24 layouts, 3/3 interaction flows and 8/8 additional states; no recorded overflow or contrast failures. The bundled Chromium executable was missing; retries used the already-installed Chrome binary via `SPRINT_CHROMIUM_PATH`, with fresh synthetic owners. No browser installation was performed. Light desktop planner and Dark mobile dashboard screenshots were directly inspected. Browser results are retained under `frontend/verification/career-sprint/production-finalization-2026-11-07/{live,ui}`. This is focused accessibility verification, not a comprehensive certification. The isolated API shell's unrelated 404 endpoints are retained in the browser JSON.

## Exact task file inventory

Changed existing files:

- `backend/.env.example` — preserve initial user hunk; append existing Sprint knobs only.
- `backend/src/controllers/careerSprintController.js`
- `backend/src/services/aiTaskService.js`
- `backend/src/services/sprintOverviewCacheService.js`
- `backend/src/services/weeklyReportService.js`
- `backend/src/models/weeklyReport.js` — approved optional overdue metric; no historical default or migration.
- `backend/src/tests/careerSprintPerformance.test.js` — mock the newly isolated admission boundary; thresholds unchanged.
- `backend/src/tests/careerSprintPlanningFinalization.test.js`
- `frontend/src/app/pages/career-sprint/career-sprint.component.ts`
- `frontend/src/app/pages/career-sprint/career-sprint.component.spec.ts`
- `frontend/src/app/shared/services/career-sprint.service.ts`
- `frontend/src/app/shared/services/career-sprint.service.spec.ts`
- `frontend/scripts/verify-career-sprint-live.cjs`
- `docs/features/career-sprint.md`
- `backend/verification/career-sprint/REPORT.md` — historical report retained; latest-review link only.

Added service/tests:

- `backend/src/tests/sprintOverviewCache.test.js`
- `backend/src/tests/sprintInvalidation.test.js`
- `backend/src/services/sprintAiAdmissionService.js`
- `backend/src/tests/sprintAiAdmission.integration.test.js`
- `backend/src/tests/weeklyReportSprint.test.js`

Retained verification artifacts are listed with exact paths in `file-inventory.json`. No source file was moved or deleted. Task-owned runtime/session deletion is recorded in `cleanup.json`; no unrelated/untracked user files or historical screenshots/reports were deleted.

## Final verification and remaining gates

Final cleanup and post-cleanup checks are recorded in `cleanup.json` and `finalization.json`. The task-owned API verifier was stopped, Mongo shut down with exit code 0, and 770 verified task-owned database/log/PID/session files were removed individually by exact path. No recursive directory deletion was used. Exact retained source/evidence paths are in `file-inventory.json`. Production status remains BLOCKED by the intermittent Sprint memory latency failure, live Redis/staging verification and reconciliation of the two pre-existing Learning Hub assertions above. Paid-provider quality and preservation of inaccessible production historical records are not claimed from synthetic local data. No protected historical records were loaded or modified.

Post-cleanup Angular **PASS 30/30**, TypeScript **PASS**, production build **PASS** (80.243s; unchanged browser-verified `main-IF3PLBTM.js`). Logs are `frontend/verification/career-sprint/production-finalization-2026-11-07/frontend-final.txt` and `build-final.txt`. The Landing Page warning remains unchanged. Backend **61/62** retains its failed latency gate; all functional, AI-boundary, calendar and new report tests passed. Final Mongo integration was **11/11** before fixture teardown. Source syntax checks passed for all 13 backend/verifier JavaScript files. Prettier write/check passed for all 17 changed JavaScript/TypeScript sources using explicit paths: backend singleQuote=true, trailingComma=none, printWidth=120, endOfLine=lf; existing Weekly Reports service retains trailingComma=all, printWidth=100; frontend uses `frontend/.prettierrc`. The feature guide is in the repository's configured formatter ignore; its focused readable edits and the historical report's link were retained without reformatting unrelated documentation. No unused imports/debug code or obsolete task-owned temporary files remain in scope. Both `git diff --check` and `git diff --cached --check` passed; Git's existing LF-to-CRLF notices are warnings, and nothing was staged. No application source was moved/deleted, so no application references required relocation.
