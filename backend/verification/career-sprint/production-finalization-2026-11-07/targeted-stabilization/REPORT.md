# Career Sprint targeted stabilization — 2026-11-07

**Local assertion reconciliation: PASS. Release: BLOCKED.** The two obsolete Learning Hub expectations are corrected. Host-dependent delays outside cache work were measured; the historical memory p95 breach and real Redis/staging gates remain open. No production code, API, schema, dependency, scoring, XP or streak policy changed.

## Preflight and bounded execution

Source/current branch: `fix/career-sprint`, ref verified. PR/integration target: not applicable. Existing staged changes and historical untracked screenshots/logs were preserved. `baseline.json` records the index fingerprint and source snapshots; `invariants.json` verifies that the existing index is unchanged. Git blob comparisons normalize existing CRLF/LF differences for comparison only; no protected source/configuration file was rewritten.

Plan: inspect the three failures; instrument the existing performance test and reproduce the original Learning Hub assertions once; reconcile only proven fixture/contract drift; format/clean task files; run one confirmation; finalize syntax/format/Git checks and this report. Both cycles are complete. No full suite, additional performance sweep, synthetic CPU load, browser run or build ran. No TypeScript files changed, so TypeScript/build checks were not applicable.

## Memory latency finding

The existing test includes freshly read current/previous Mongo snapshots in its memory-path measurement. It is not a memory-only CPU benchmark. Both reads retain the existing 25ms mocked delay and execute concurrently. Wrappers now record each mocked query's elapsed wall time, its union/critical interval, scheduling overrun, time before cache entry, synchronous hash/LRU/clone work and continuation time. The exact original `<50ms` p95 assertion and 20-sample measurement remain in force; instrumentation overhead is included, never subtracted from the gate.

| Measurement                                             | Diagnostic | Confirmation |
| ------------------------------------------------------- | ---------: | -----------: |
| End-to-end gate p50                                     |    31.75ms |      31.84ms |
| End-to-end gate p95                                     |    32.22ms |      40.17ms |
| Mongo critical interval p95                             |    31.47ms |      39.45ms |
| Mongo time above requested 25ms, p95                    |     6.47ms |      14.45ms |
| Synchronous cache work p95                              |     0.64ms |       0.51ms |
| Longest observed request before measurement bookkeeping |    32.51ms |      86.02ms |

The 86.02ms confirmation outlier had two overlapping mock-query spans of 70.05ms/70.07ms (critical interval 70.13ms), 15.19ms before cache entry, 0.41ms in the cache, and 0.06ms after it. The mock-I/O/continuation interval accounts for the spike; it is not slow cache hashing, LRU handling or cloning. Query spans include fixture construction after the timer; this instrumentation does not distinguish OS scheduling, VM pauses or GC within that interval. Twenty memory hits, forty Mongo reads and zero optional-signal calls in the measured samples still pass. Lifetime counters in the raw diagnostic include the initial cold warm-up, as before.

The initial diagnostic mislabeled both query roles because its `previous` lookup carries an undefined `$ne` value; confirmation checks property presence and asserts exactly one current/one previous role per sample. This label correction does not affect elapsed spans or the gate. CPU readings are quantized on this Windows host and are not interpreted as proof of zero CPU use; the conclusions use wall-time decomposition.

**Reproducible cause observed:** scheduling/continuation delay outside the actual cache can produce individual requests above 50ms even with sub-millisecond cache work. **Limit:** the historical 61.24ms _p95_ itself was not reproduced in the two allowed cycles. Confirmation has one large outlier, while its 95th percentile remains below 50ms. These results do not prove that the historical failure was caused exclusively by host scheduling, nor that a future run is stable. No production cache defect was demonstrated, so no speculative runtime optimization was introduced. The existing performance release gate remains **BLOCKED**, pending a stable-host/staging investigation. No threshold, sleep, assertion, percentile definition or Mongo-authority check was weakened.

Raw samples, p95s and the worst sample are retained in `measurements.json` and the two Sprint TAP logs.

## Learning Hub root causes and correction

### Pagination assertion at former line 326

The current default view is For You. Its v9 fixture classifies SQL as CLAIMED_ONLY, Docker as PARTIAL, React as NOT_EVIDENCED but outside Backend categories, Testing as UNKNOWN, and Node.js as DEMONSTRATED. Only SQL and Docker are eligible learning targets. Current catalog/level filtering yields exactly:

- `fb_c2`: IBM Full-Stack JavaScript certificate, Docker target, Beginner.
- `fb_c5`: Meta Back-End certificate, SQL target, Beginner.
- `fb_c12`: Introduction to Containers, Docker target, publisher level unavailable (permitted by the current contract).

The old assertion assumed that two pages of size two must contain four unique courses. Diagnostic evidence reproduced a two-item first page and a one-item second page with total=3; there was no missing pagination result. The corrected assertions require the exact ID set, disjoint pages, total=3, page sizes 2/1, two pages with correct `hasMore`, and page 99 clamped to the final page. They also require permitted target annotations and the existing Intern level restriction.

Negative cases explicitly request DEMONSTRATED Node.js, UNKNOWN Testing and out-of-stack React: each must return empty For You results with `skill-not-recommended`. Positive cases retain the SQL deep link, forced refresh and input/no-provider checks. Discover must still expose the React-only `fb_c4` course, proving that exclusion is eligibility, not catalog loss. The newer historical v8 snapshot remains in the fixture; current v9 compatibility and all evidence policy/taxonomy/matrix requirements remain unchanged.

### Evidence-unavailable assertion at former line 374

The production controller explicitly returns 503 with code `COURSE_EVIDENCE_UNAVAILABLE` when current evidence cannot be checked. It does so before reusing a personalized result pool. A career-context-only 200 with catalog courses was an obsolete expectation for For You.

The corrected test first verifies valid personalized results despite Redis read failure. It then retains a warm personalized pool and fails only the v9 evidence query; the pool and catalog stores remain available. For You must return 503 without a `courses` field. A real synthetic loopback HTTP handler verifies 503, `Retry-After: 5`, `Cache-Control: private, no-store` and the error code. Under the same evidence failure, Discover must return 200 catalog results with `catalog-discover-v1` and no requested personal skills. Restoring evidence must recover the three eligible personalized courses. The persisted skill classifications must remain unchanged, and AI must never be called.

These selected tests exercise real Mongo and controller/HTTP semantics. They do not rerun or claim the unrelated JWT/progress/handoff subtests; the six unrelated child tests were explicitly excluded. Production authentication and admission code are unchanged.

## Exact commands and results

Run from `backend`:

```text
node src/scripts/verifyCareerSprintTargetedStabilization.js diagnostic
node src/scripts/verifyCareerSprintTargetedStabilization.js confirmation
```

Each phase runs precisely:

```text
node --test --test-concurrency=1 --test-reporter=tap --test-name-pattern="^database-validated memory serialization stays under 50ms p95 and skips optional signals$" src/tests/careerSprintPerformance.test.js
node --test --test-concurrency=1 --test-reporter=tap --test-name-pattern="^Learning Hub real Mongo/JWT:" --test-skip-pattern="^(current version and|memory, Redis and|legacy, temporary,|selected unanalyzed resume,|progress CRUD is|JWT HTTP endpoints)" src/tests/coursesMongo.integration.test.js
```

The driver disables external providers and Redis, supplies a disposable loopback Mongo replica-set URI, and enforces one invocation per phase. It runs the Sprint test before starting Mongo so infrastructure startup does not overlap the latency sample window.

| Cycle        | Sprint                | Learning Hub                                                                                       |
| ------------ | --------------------- | -------------------------------------------------------------------------------------------------- |
| Diagnostic   | PASS 1/1, p95 32.22ms | FAIL: two original child assertions and their parent, 0/3 passed; reproduced 3 vs 4 and 503 vs 200 |
| Confirmation | PASS 1/1, p95 40.17ms | PASS 3/3 (two selected children plus parent), with expanded positive/negative coverage             |

Each command reported zero skipped tests; excluded cases were not executed or counted by Node's filtering. No further diagnostic/confirmation cycle was run. Logs are `diagnostic-sprint.tap`, `diagnostic-courses.tap`, `confirmation-sprint.tap`, `confirmation-courses.tap`; each phase JSON retains exit codes and cleanup results. The diagnostic failures remain retained, not overwritten by confirmation.

## Unchanged contracts

`invariants.json` verifies ten production/configuration files against the existing index: Sprint service/Mongo authority, overview cache, AI admission, AI planner, Sprint controller/invalidation, Learning Hub personalization/controller, v9 scope contract, Weekly Reports and `.env.example`. All are unchanged.

All six existing settings are still referenced/documented with the same defaults: `CAREER_SPRINT_PLANNING_CACHE_MAX_SIZE` (300), `CAREER_SPRINT_PLAN_RESULT_CACHE_TTL_MS` (120000), `CAREER_SPRINT_PLAN_REDIS_BUDGET_MS` (120), `CAREER_SPRINT_PLAN_REDIS_TTL_SECONDS` (120), `CAREER_SPRINT_AI_TIMEOUT_MS` (4500, clamped 2000–5000), `CAREER_SPRINT_STAGE_TIMINGS` (0 in example; existing nonproduction behavior preserved). No environment variable or secret changed. Shared AI limits remain 5 attempts/owner/hour, 1 active/owner, 8 globally. Cache revision identity, TTLs, invalidation, cross-module handoff and scoring behavior remain unchanged. This is source-invariant verification plus the directly affected tests, not another cross-module audit.

## Exact file inventory, formatting and cleanup

Changed existing files in this task only:

1. `backend/src/tests/careerSprintPerformance.test.js` — retained observational instrumentation and additional authority/trace checks; original gate unchanged.
2. `backend/src/tests/coursesMongo.integration.test.js` — only the two affected cases, corrected assertions, explicit failure injection and positive/negative coverage.
3. `backend/verification/career-sprint/production-finalization-2026-11-07/REPORT.md` — latest targeted status/link; preceding broad results preserved as history.

Added reusable script:

- `backend/src/scripts/verifyCareerSprintTargetedStabilization.js`.

Added retained evidence under `backend/verification/career-sprint/production-finalization-2026-11-07/targeted-stabilization/`:

- `REPORT.md`, `baseline.json`, `invariants.json`, `measurements.json`.
- `diagnostic.json`, `confirmation.json`.
- `diagnostic-sprint.tap`, `diagnostic-courses.tap`.
- `confirmation-sprint.tap`, `confirmation-courses.tap`.

Both disposable Mongo processes were stopped. Their 201/207 task-owned files were deleted by exact verified paths and empty-directory removal using the existing fixture; no recursive directory removal was used. Each phase JSON lists all exact pre-teardown paths and the matching deletion count. No source files, existing screenshots, prior logs, historical records or user work were moved/deleted. No task-owned runtime directory remains.

Prettier write/check uses the installed `frontend/node_modules/prettier/bin/prettier.cjs` and explicit paths only. The performance test/verifier retain single quotes, trailingComma=none, printWidth=120, endOfLine=lf; the Learning Hub test retains its existing trailingComma=all, printWidth=100 style. Final checks: **PASS** for source syntax, changed-file formatting, staged/unstaged Git whitespace, unchanged index and production invariants. No unused imports, abandoned diagnostic code or obsolete current-task temporary files remain; the instrumentation/driver are retained reusable verification evidence. No TypeScript files or frontend implementation changed; no build was run. No file was moved, and the removed task-owned database files have no application references.

## Remaining release gates

- **BLOCKED:** explain/reproduce the historical 61.24ms memory p95 on a stable host/staging setup. The local timer/continuation outlier is measured evidence, not a reason to remove or relax the 50ms gate.
- **BLOCKED:** real Redis cross-process consistency/outage/recovery and staging admission/failover checks. No real Redis or paid-provider success is claimed by these targeted mocked-provider tests.
- **CLOSED locally:** the two Learning Hub obsolete assertions, with exact fixture/pagination and evidence-unavailable semantics verified. No production functionality was changed to make the tests pass.
