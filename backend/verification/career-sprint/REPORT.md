# Career Sprint backend finalization

Date: 2026-10-15 (Asia/Karachi). **STATUS: BLOCKED** pending the release decisions and remaining issues below. Frontend implementation has not started.

## Existing module audit

Reviewed the supplied request, repository `AGENTS.md`, `docs/features/career-sprint.md`, API/cache/dependency documentation, models, routes, controllers, Sprint/planning/streak/scoring services, prompt, existing Sprint tests and release/performance scripts, frontend API/service consumers, Recommendations/Learning Hub atomic handoffs, Simulator imports, Dashboard and Weekly Reports dependencies. No separate architecture briefing was present in the supplied attachment; the implementation and repository feature guide were used.

The initial working tree was clean. Existing functionality included Monday–Sunday automatic sprints, custom date fields, owned history, manual tasks, boolean completion, XP/levels, weighted progress, analytics, day streaks, restoration, explicit deterministic/optional AI previews, eight stored plan slots, Scenario-to-draft imports, a second Simulator-to-task adapter, and memory/Redis overview and planning caches. It had no backend task-edit/delete or draft-delete/selective-ingestion routes. Frontend draft loading was already possible from `aiPlans` on the current/history payloads.

Demonstrated defects fixed:

- Creation previously inserted new records without an overlap/idempotency guard; it did not overwrite an existing record directly. Duplicate current records could make older progress disappear from the selected current view.
- Invalid task points/enums were silently changed; imported `isCompleted` could bypass XP/timestamp accounting. Category defaults were always three points.
- Concurrent document saves could produce unhandled version conflicts. Raw atomic Recommendations/Learning Hub inserts did not participate in document versioning.
- A restored streak immediately broke again on the next read, and subsequent real work reset it. Restoration now records a separate bridge timestamp.
- Saving a ninth uniquely named draft silently evicted the oldest. It now returns 409 and retains all eight.
- Legacy custom windows could be selected via current-week aliases even when their real window was inactive. New/edited custom windows synchronize aliases for existing Weekly Reports consumers.
- A failed in-flight read had an unobserved rejecting `finally` promise. Cache invalidation could also leave the old in-flight request joinable.
- Low aggregate GitHub scores were incorrectly treated as proof of absent READMEs/tests. Legacy AI gap labels and historical weekly labels were treated as current skill weaknesses.
- Provider rejection could escape the optional AI fallback. Explicit force-refresh requests bypassed provider deduplication.
- Planning cache identity did not include freshly checked source/profile/task context.

## Sprint/task lifecycle

Default windows remain inclusive Monday 00:00 through Sunday 23:59:59.999 in the server calendar. A custom start without an end defaults to seven inclusive days. Invalid/reversed dates are rejected; date-only strings retain their calendar day rather than being parsed as UTC and shifted to the previous local day. New windows are bounded to 366 days; each sprint is bounded to 500 tasks in Sprint-managed insertion paths.

New windows have a unique owned `creationKey` and a unique multikey `{ userId, occupiedDays }` reservation index. This prevents simultaneous new windows sharing a calendar day, including differently shaped overlapping windows. Exact-window replay returns the existing record and preserves its tasks/XP. Date updates reserve the new days with the same document save; overlap returns 409. Previous-sprint selection uses the completed window before the current start, rather than an unrelated creation week. Current reads only use week aliases for legacy documents without custom dates.

Task titles are required and limited to 120 characters; descriptions to 1,000. Text must be strings and control/whitespace characters are normalized. Text remains plain text, not HTML. Category defaults are learning=3, project=5, practice=4. Points must be finite numbers in [1,10]; zero, null, strings, NaN and out-of-range values are rejected. Enum values are validated. Optional task dates must be valid and ordered. Incoming IDs, completion timestamps, XP and source provenance cannot be used to claim completed work through ordinary creation.

Completion remains `isCompleted: boolean`; timestamps are set by the server on a transition to true and cleared on reversal. Repeating the same state preserves the original timestamp. Up to five optimistic retries reload the owned document and reapply the action. Identical titles are idempotent additions; differently cased or whitespace-normalized duplicate titles are omitted. A concurrent write that still cannot settle returns 409. There is no new account-level XP ledger or historical recalculation.

Added protected routes:

| Route                                                 | Contract                                                                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUT /api/career-sprints/:id/tasks/:taskId`           | Existing `{isCompleted}` completion action, or a separate edit payload containing title/description/points/priority/category/startDate/endDate |
| `DELETE /api/career-sprints/:id/tasks/:taskId`        | Delete an incomplete owned task; repeated deletion is harmless                                                                                 |
| `DELETE /api/career-sprints/:id/ai-plans/:planId`     | Delete an owned saved draft                                                                                                                    |
| `POST /api/career-sprints/:id/ai-plans/:planId/tasks` | `{taskIndexes: [0, 2]}` adds selected zero-based entries; supply every index for Add All                                                       |

Editing/deleting completed tasks returns 409 until the user explicitly uncompletes them. Mixed completion/edit payloads are rejected. This avoids inventing an implicit XP correction policy. Existing history is not migrated, deleted or automatically rescored.

## Exact XP / level / progress / consistency / productivity formulas

All authoritative calculations are deterministic. Shared scoring engines were not changed.

- Task XP = priority base + points. High=15, medium=10, low=5.
- Completion adds that task XP once per false→true transition. Reversal subtracts it, floored at zero. Recompletion restores the same net XP; replay adds nothing. Existing counters are **sprint-scoped**, not a verified lifetime account total.
- Level = `max(1, floor(xpPoints / 100) + 1)`. Non-finite helper inputs safely fall back to zero rather than producing Infinity/NaN.
- Progress = rounded, clamped `100 * completed task points / total task points`. Empty sprint UI progress=0. The unchanged shared `sprint-progress-v1` engine returns unavailable/null for an empty denominator; the Sprint adapter maps that to zero. Legacy absent/zero task points count as one; duplicate task IDs and negative point entries are handled by that engine's existing rules.
- Overview consistency = rounded/clamped `0.62 * progress + 23 * min(currentStreak,14)/14 + 1.5 * min(completedTasksInLast7CalendarDays,10)`.
- History consistency = rounded/clamped `0.65 * progress + 3.5 * min(currentStreak,10)`. This existing distinct summary formula is preserved, not silently unified.
- Productivity = rounded/clamped `4 * completedPoints + 5 * completedTaskCount - 6 * overdueTaskCount`.
- Overdue = incomplete tasks whose `endDate || deadline || dueDate` is strictly earlier than now. Completed tasks are excluded. A date-only end is normalized to the end of that calendar day.
- Daily activity counts only completed tasks with completion timestamps. Multiple tasks on a day contribute multiple completed-task counts, but only one streak day.
- Comparisons subtract the previous window's progress, completion count, streak and XP. Plan confidence/consistency metadata are advisory stored draft metadata, not authoritative XP or proficiency.

## Streak and restore policy

One calendar day with one or more completions is one activity day. Same-day completion does not increment again; the next day increments; a longer gap restarts at one. Longest streak is retained. Yesterday's activity yields warning; at least one missed day yields broken. Uncompletion does not erase an already recorded activity day under the existing policy.

Existing eligibility is **1–3 missed calendar days**, calculated as `daysBetween(anchor,today)-1`, not elapsed hours. The requested 48-hour rule conflicts with this code and with its former inaccurate “72 h” comment. This release preserves the implemented three-missed-day policy and explicitly documents the conflict instead of choosing a new policy. Eligibility metadata now includes the final permitted day consistently.

`streakRestoredAt` bridges the gap without changing `lastActiveDate` or creating a completion record. Inactivity uses the later of actual activity and the bridge. A replay cannot restore the same gap again or award XP. Real work on the bridge day records actual activity without double-incrementing; work the next day increments normally.

Tests cover UTC, Asia/Karachi and America/New_York server calendars, spring/fall DST, midnight, one-day activity, repeated restoration and the existing final eligible day. There is no configured user-local IANA timezone in the current User/Sprint contract; server-calendar tests do not prove per-user timezone support.

## AI / deterministic planning

Both remain explicit POST previews. Ordinary current/history reads do not invoke task-planning AI. No preview writes tasks, XP, streaks, evidence or existing task state.

Planning reads canonical active profile identity, owned task history (latest 12 sprints), and the existing read-only evidence-compatibility adapter. That adapter verifies owned selected Resume/GitHub references, timestamps, freshness and `skill-evidence-coverage-v1`. UNKNOWN/NOT_EVIDENCED are not converted into an assertion of inability. PARTIAL/CLAIMED_ONLY may supply evidence-review targets with explicit limitations. Missing evidence falls back to career-context templates. Unqualified aggregate GitHub scores no longer manufacture README/test defects. Recommendations terms are constrained to the owned matching stack/experience and recent records; full modern Recommendation action-card adaptation remains a limitation below.

Fresh context checks precede plan-cache lookup. Profile/evidence/recommendation/task context and calendar day participate in the plan fingerprint. Cache versions are overview_v3/plan_v3 so old result schemas are not reused. Existing work is omitted from newly built previews; the retained history horizon is bounded and is not an all-time semantic duplicate detector.

The AI prompt bounds context strings/lists/tasks, labels context as data, and forbids scores, XP, confidence, verified proficiency and fabricated personal data. Output validates task counts, title/description lengths, categories, unsafe text, diversity and lexical grounding. The server assigns dates/points/priorities. Rejection, thrown provider errors and a hard configured timeout produce deterministic previews. Simultaneous explicit refreshes share one provider request. Live paid-provider quality was not independently verified; tests use controlled providers.

## Drafts / Scenario imports

At most eight uniquely named drafts are retained without automatic eviction. Existing same-name replacement semantics remain. Drafts load from current/history payloads; delete and selective/bulk ingestion use owned sprint and plan IDs. Selected indexes are bounded and validated. All selected tasks are saved in one optimistic document mutation and title deduplication applies to repeated/concurrent imports.

Scenario-to-draft loading checks Scenario ownership. Server-generated source IDs/hashes are retained through draft ingestion; arbitrary ordinary task payloads cannot supply trusted provenance. Simulator-to-task creation now uses the same version-retried Sprint merge adapter and invalidates Sprint caches. Simulator work remains proposed action, even where a hypothetical scenario contains skills, projects or hiring-score metadata. No completion or import promotes evidence, issues credentials or changes GitHub/Resume/Skill Gap state.

Changed-career-context draft acknowledgement and historical same-name draft-version behavior still require a defined product contract; stored goals are retained, not silently converted to factual current ability.

## Cross-module handoffs

Recommendations and Learning Hub retain their existing owned atomic insertion and source deduplication contracts. The only changes in their services are `$inc: {__v:1}` alongside the existing atomic push, so concurrent Sprint document saves cannot ignore those inserts. Simulator changes are restricted to its Sprint adapter. No locked source engine, learning-progress engine or shared scoring engine was rewritten.

Dashboard/Sprint/Scenario/News invalidation remains tied to successful mutations. The existing frontend invalidator clears Sprint, Dashboard, Weekly Report, Scenario, News, Recommendation and Job caches after successful Sprint HTTP responses. No frontend source changed. Weekly Reports consumes persisted Sprint task/alias data; new custom aliases are synchronized. Persisted historical weekly reports remain immutable saved reports, not reports regenerated on every Sprint write.

## Security / cache / persistence

Every Sprint route uses JWT `protect`; service mutations query `{_id:sprintId,userId}` and Scenario imports additionally query the Scenario owner. Current/history reads are user-scoped. ID and bounded payload validation happens before writes. Client errors retain bounded safe messages; internal errors use generic responses. Owned database fixtures verify foreign task/draft/Scenario access, replay, concurrent writes and persistence after fresh reads.

Optimistic saves and handoff version increments prevent duplicate completion rewards/lost concurrent document updates. Overview invalidation clears memory and joinable in-flight state; epochs prevent obsolete local requests repopulating the cache. Scheduled Redis writes check the epoch before starting, Redis lookup failures fall back to Mongo, and optional display signals no longer turn a successful mutation into a provider-dependent failure. Existing force-refresh failure fallback preserves the previous valid overview and remains a stale-display policy requiring review for stricter error surfacing.

Read-only database audit: 15 existing records, 15 without day reservations, zero invalid windows, zero owners with multiple active sprints; both new unique indexes exist. No historical records were backfilled or removed. Legacy overlap backfill, cross-worker memory invalidation and Redis races across process restart are not proven by single-process fixture tests.

## Files changed / modular structure

Changed existing source files:

- `backend/src/controllers/careerSprintController.js`
- `backend/src/models/careerSprint.js`
- `backend/src/prompts/careerSprintPrompt.js`
- `backend/src/routes/careerSprint.routes.js`
- `backend/src/scripts/ensureCareerSprintIndexes.js`
- `backend/src/services/aiTaskService.js`
- `backend/src/services/careerSprintService.js`
- `backend/src/services/streakService.js`
- `backend/src/services/courseHandoffService.js` (version increment only)
- `backend/src/services/recommendationHandoffService.js` (version increment only)
- `backend/src/services/scenarioSimulatorService.js` (Sprint adapter plus required file formatting)
- `backend/src/tests/careerSprintPerformance.test.js` (cache-version assertions and formatter-tolerant query-chain assertion; performance thresholds unchanged)

Added source files:

- `backend/src/scripts/auditCareerSprintData.js` (read-only counts/index audit)
- `backend/src/tests/careerSprintFinalization.test.js`
- `backend/src/tests/careerSprintPlanningFinalization.test.js`
- `backend/src/tests/careerSprintMongo.integration.test.js`

Retained evidence files:

- `backend/verification/career-sprint/REPORT.md`
- `backend/verification/career-sprint/data-audit.json`
- `backend/verification/career-sprint/performance.json`
- `backend/verification/career-sprint/full-backend-final.txt`
- `backend/verification/career-sprint/focused.txt`
- `backend/verification/career-sprint/validation.json`

No files were moved. No unrelated user work was present at task start or deleted. The only deleted paths are the task-created preliminary logs `backend/verification/career-sprint/full-backend.txt` and `backend/verification/career-sprint/recommendations-performance.txt`; their relevant results are retained below. Existing historical verification artifacts were not deleted.

## Formatting / cleanup

Installed `frontend/node_modules/prettier/bin/prettier.cjs` write/check used explicit changed paths only. Existing CommonJS single-quote style was retained. Main Sprint/backend files use trailingComma=none, printWidth=120, endOfLine=lf; the two existing handoff files retain trailingComma=all and printWidth=100. No whole-repository formatting, source asset/license edits, Git reset or Git clean was used.

Unused legacy planning imports, obsolete weakness inference/context caches and redundant code were removed. No screenshots, Playwright traces or temporary script files were created. Fixture cleanup deletes only freshly allocated fixture owners' records. Historical release screenshots/reports/scripts were retained. Final syntax/format/whitespace/test checks follow cleanup.

## Focused / full / MongoDB test results

- Initial existing Sprint baseline: 24/24 passed.
- Full `npm test` parallel run: 362/364 passed. The new DST test had a working-directory-dependent import (fixed). The unchanged Recommendations performance test measured memory p95=50.43 ms against its existing <50 ms target; isolated retry measured 52.48 ms. No Recommendations engine/threshold change was made.
- Final complete backend run: `node --test --test-concurrency=1 src/tests/**/*.test.js` from `backend`: **364/364 passed, zero failed/cancelled/skipped**, 121.25 seconds. Serial execution avoids global test-worker contention without changing thresholds or excluding tests. Includes real Mongo/JWT Sprint, Recommendations and Learning Hub integration suites.
- Final post-cleanup focused run: **50/50 passed, zero failed/cancelled/skipped**, including the real MongoDB/JWT suite. Source finalization checks are retained in `validation.json`.
- Existing `careerSprintPerfMeasure.js`: cold p50=77.89 ms/p95=99.8 ms; memory p50=0.04 ms/p95=0.09 ms; Redis p50=15.45 ms/p95=16.28 ms; deterministic planning p95=48.04 ms; AI planning p95=175.06 ms. Five overview callers shared one signal call/two Mongo reads. These use the existing simulated-provider/database probe; they are not live database latency measurements.

MongoDB/JWT tests use real Mongo and JWT; optional providers and downstream notifications are mocked to isolate Sprint state and prevent external side effects. Default sandbox Mongo failures were EACCES; the approved network-enabled run passed. Fixtures are scoped to fresh owner IDs and cleaned afterward. These are not a live browser/server release smoke or a multi-process Redis proof. Frontend tests/build/typecheck were not run because no frontend implementation changed.

## Product decisions requiring approval

1. Define the requested 48-hour restore policy: elapsed from the last real completion, first missed midnight, or broken detection? The existing three-missed-day policy remains until resolved.
2. Define an owned IANA timezone source and migration policy for existing server-calendar sprint/streak records. The client chat timezone is not a timezone policy for every application user.
3. Confirm whether XP/levels/streak continuity are sprint-scoped or lifetime counters. The existing implementation is sprint-scoped; this patch does not silently aggregate or rewrite history.
4. Define completed-task historical correction and direct deletion semantics beyond explicitly uncompleting first. Define changed-context draft acknowledgement/versioning rather than silently applying stale scenarios.
5. Review the documented defensive 366-day window and 500-task insertion limits before deployment.

## Remaining issues

- Per-user timezone behavior and an actual 48-hour restore boundary are not verified or implemented because the policy conflicts above remain unresolved.
- Legacy records do not have occupancy reservations; review/backfill must detect historical overlaps without deleting user history. The audit found no currently active conflicts, not proof of no historical overlaps.
- Cross-process Redis/memory invalidation, in-flight Redis write races and restart consistency need multi-worker verification before a production-quality cache claim.
- Modern Recommendations snapshot action cards are not fully adapted into deterministic planning; bounded matching legacy technology terms remain advisory. GitHub-specific defects require explicit compatible repository evidence rather than score inference.
- Draft imports remain proposed user actions but do not yet enforce an explicit changed-active-context acknowledgement contract.
- Complete AI factual truth cannot be proven by the existing lexical grounding validator. Hard score/state separation is tested; semantic unsupported personal claims and live-provider quality need further safeguards/verification.
- Full regressions pass with serial workers; parallel Recommendations timing failures are retained above and should be considered when choosing CI worker concurrency. No thresholds or locked modules were changed to hide failures.

**NEXT: Career Sprint Frontend.** Do not begin frontend implementation until the backend release blockers are resolved.
