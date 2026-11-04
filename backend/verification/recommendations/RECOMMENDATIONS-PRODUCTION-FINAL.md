# Recommendations production finalization

Date: 3 November 2026 (Asia/Karachi).

**DEVELOPMENT COMPLETE — STABLE CANDIDATE — PRODUCTION GATES PENDING**

This status describes the implemented Recommendations hardening, not deployment approval. Local cross-module failures and any unresolved browser gates below remain release blockers. No live-provider, deployed performance, fleet security or rollout acceptance is claimed.

## Scope and architecture

Work took place on the explicitly authorized existing `fix/recommendation` branch. The initial index and working tree were clean. Source branch: `fix/recommendation`; PR target: not applicable. No commits, pushes, PRs, merges, deployments, production configuration changes, dependency changes, schemas or destructive migrations were performed.

The existing Angular/Express/Mongo modular monolith, architecture charter, Recommendations backend report, frontend refinement report and current Skill Gap consumer contract were inspected. The existing parent and two presentation children remain appropriate; no extra extraction or redesign was justified. HTTP, authentication, state and orchestration remain in the parent/service.

The canonical developer context selects the owned active GitHub identity and selected ResumeFile/ResumeAnalysis. Compatible AnalysisCache evidence feeds recommendationEngineService; recommendationService handles cache/source orchestration and immutable snapshots; narrative enrichment remains separate; history and server-resolved Sprint handoff retain existing services. Supporting portfolio/Sprint signals supply recorded follow-through context; market demand, calibrated readiness and estimated gains are not invented.

## Confirmed defects and corrections

- Require the current Skill Gap analysis, evidence policy, taxonomy and requirement-matrix versions in Mongo lookups and compatibility checks. Pass profile revision into that check. Historical records remain readable; they cannot supply current evidence.
- Keep current positive top-level repository testing evidence authoritative over contradictory nested flags. Map `missing_projects_section` to the actual `sectionPresence.projects` flag, suppressing resolved warnings.
- Version caches and source hashes as `v7-recommendations-evidence-policy`, preventing v6 cached responses or immutable snapshots from silently replacing corrected output. The approved rule, scoring formulas, priority weights and categories remain unchanged.
- Partition the same ranked actions across four review horizons: first 4, next 8, next 12, and remaining actions. These are suggested review slots, explicitly not promises about effort or completion time. No actions are duplicated or omitted from the roadmap.
- Revalidate GitHub, resume and compatible Skill Gap revisions after generation. A changed source returns 409 before result persistence; an in-process follower retries passively against current evidence.
- Add dedicated Mongo-authoritative request admission, owner serialization and commit fencing. Optional Redis acquisition/release errors cannot turn useful deterministic output into provider failures. Count actual provider attempts correctly, including zero attempts after budget denial/cancellation.
- Scope frontend and backend preview/in-flight cache identities to their owners. Include preview resume handles. Account switches and invalidation discard late browser responses; an older request finalizer cannot delete a replacement request.
- Correct localized contrast and small-target defects using existing theme text colors and 24 px minimum targets. Preserve typography, component structure and desktop/mobile layout; no templates were changed.

## Source-to-action traceability and accuracy

| Recorded evidence                                                   | Permitted action                          | Suppression / uncertainty                                                                          |
| ------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Current compatible Skill Gap PARTIAL / CLAIMED_ONLY / NOT_EVIDENCED | Build technical proof for the named skill | Does not assert inability; no demand/gain numbers                                                  |
| Current Skill Gap UNKNOWN                                           | Low-priority evidence review              | Never asserts missing competence                                                                   |
| DEMONSTRATED                                                        | No outstanding skill action               | Positive evidence suppresses work                                                                  |
| Repository `hasReadme === false` / effective `hasTests === false`   | Documentation High / testing Medium       | Unknown flags do not establish defects; current true suppresses contradictory legacy false         |
| Selected resume deterministic warning                               | Severity-based resume review              | Arbitrary AI concerns are ignored; detected sections and sufficient metrics suppress resolved work |
| Recorded empty portfolio / repeated unfinished Sprint focus         | Supported follow-through                  | No claim of mastery or automatic completion                                                        |
| Missing/stale source                                                | Evidence/context review                   | Null remains unavailable; zero remains an observed zero                                            |

Independent golden fixtures define ten expected actions across six cases without using engine ranking/ID helpers for expected answers: **0 false positives; 0 missing legitimate actions**. This is synthetic fixture accuracy, not population accuracy. Stable semantic IDs, determinism, ranking, deduplication, explicit negative/unknown evidence and all four horizons are covered. Broader independently labeled real-world accuracy remains a production gate.

Ranking remains High=3, Medium=2, Low=1, then approved numeric impact where available, then stable ID. New actions keep estimated impact null and effort unavailable. Disappearing actions do not establish completion. Existing Sprint completion is recorded activity, not demonstrated proficiency.

## API admission, cancellation and concurrency

All Recommendations generation/profile endpoints and Sprint handoff use dedicated admission; saved-preview/history operations have separate read admission. Existing auth remains before controls. No endpoint was added or removed.

Mongo transactions use the existing governance collection, `_id` uniqueness and expiry TTL. Redis has no authority over quotas or commits. Failure is sanitized 503 with Retry-After; exhaustion is 429 with remaining-window Retry-After; oversized bodies are 413 before charging.

Hourly policy: owner profile 30, authenticated preview 15, guest 5, explicit refresh 5, read/preview storage/history 120, actual Recommendations AI attempts 5; shared IP 120. Internal AI admission also charges the IP counter. Input is capped at 40,000 UTF-8 bytes; inline resume text at 12,000 characters; identity strings at 200 characters. Large saved-preview payloads can therefore receive 413. An attempted 256 KB exception was rejected by automatic approval review and was not applied.

Reservations allow eight global jobs and one generation per owner across workers/modes. Lease lifetime is 60 seconds, contention waiting is bounded at 10 seconds, request cancellation is signaled after 45 seconds/disconnection, and provider work uses the existing seven-second deadline with zero retries. A waiter disables refresh before reading the winner's compatible result. An owner-token update within the result transaction fences expired/replaced/cancelled workers. A crashed worker's reservation expires; current history is preserved.

Real disposable Mongo tests use three separate Node processes: **six guest admissions → five accepted and one 429**. Lease joining, release, expiry, old-token rejection, cancellation and reacquisition pass. Existing concurrent generation fixtures measure **one GitHub attempt, one AI attempt, one signal aggregation and two persistence operations for five simultaneous requests**. This is local controlled evidence; multi-host full-pipeline provider accounting and failure/clock behavior still require staging.

## MongoDB, indexes and cache

No schema/index definitions or production collections were changed. Existing Recommendation owner/context indexes and the partial unique owner/version/contextHash index are preserved. Existing migration idempotence is tested only against disposable Mongo. Snapshot writes remain insert-only; history is owned, bounded and distinguished from current results. AnalysisCache retains its seven-day expiry index; application freshness is checked explicitly rather than relying on prompt TTL deletion.

A disposable 1,000-row contextual Recommendation query with a 20-row limit returns 20 rows with **20 keys and 20 documents examined**. This measures the owner/stack/level/createdAt query shape in the retained test; it does not prove every history/cache query plan or deployment cardinality. Production index presence, owner-only history tie-break sorting, TTL timing and realistic-volume explain/soak remain release checks. No unmeasured index optimization was introduced.

| Layer   | Current behavior                                                                                                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser | Profile results in memory for 15 minutes; saved-preview lists seven minutes. No personalized Recommendations LocalStorage result persistence exists in this checkout. Owner/request revision checks discard late results. |
| Node    | Default 60-second memory cache; sources/context checked before compatible reuse.                                                                                                                                          |
| Redis   | Optional result cache: 900 seconds, 120 ms lookup budget. Temporary preview cache uses the existing 1,800 seconds. Preview keys now include hashed owner scope.                                                           |
| Mongo   | Owned contextual compatible cache and immutable Recommendation snapshots; resume-only snapshot reuse retained.                                                                                                            |

Current identity/fingerprint covers owner/mode, GitHub identity, selected resume/analysis, career stack/level, relevant source evidence and versions. Existing developer-signal invalidation fans out to Recommendations and downstream caches. Account changes cannot share in-flight private data. Cross-device browser freshness can still lag until the bounded browser cache expires; deployment-level session/invalidation acceptance remains required. Optional temporary-resume caches remain process-local without shared routing/cache, as the retained cross-module acceptance evidence explicitly reports.

## AI and privacy boundaries

Only supplemental target-anchored learning ideas reach current Recommendation output. Deterministic recommendations, links, IDs, priorities, scores, difficulty and roadmap are not replaced by model output. Model pollution, malformed/failed responses, timeout configuration, cancellation, quota exhaustion, prompt-injection vocabulary and Redis failure regressions retain deterministic fallback. The prompt receives structured bounded signal summaries and deterministic targets, never raw resume text; preview cache tests enforce owned handles and summary-only content. No paid/live AI request was performed.

Audit snapshots contain bounded derived output, not uploaded resume bytes. AIVersion history has no TTL in the inspected schema. Retention/privacy policy and deployment access/deletion behavior need explicit production acceptance; no historical records were deleted or retention schema silently changed.

## Cross-module and UI verification

Dashboard/Readiness, Skill Gap, Resume, GitHub, Courses, Career Sprint, Scenario, Weekly Reports and Notifications suites were included in the local cross-module run. Recommendations retain source confidence, null/zero semantics, server-resolved idempotent Sprint handoff, owned previews/history and existing contextual analyzer/Courses destinations.

The historical browser verifier expected obsolete typography, exact button names and source links outside their current disclosures. It now follows current source typography (26 px title, 17 px overview heading), current pagination/disclosure labels and records first-viewport positions instead of imposing the previous layout. Other module destination API fixtures return controlled unavailability instead of malformed success payloads. CSS-gradient contrast requires screenshot/manual assessment rather than background-color-only math; gradient elements are excluded from that automated calculation, not marked contrast-passed.

Before-fix local light screenshots/geometry are retained under `production-final/ui-before`; final browser results/screenshots belong under `production-final/ui`. This is fixture-based UI evidence, not a deployed visual acceptance. Exact dark/System before/after screenshot parity cannot be claimed without matching retained baselines. The final run passes 24 viewport/theme layouts, three complete theme interaction flows, seven page states and 12 retained screenshots with zero runtime or automated contrast/visible-target findings. Eight comparable light-theme geometry samples preserve typography and workspace width; screenshot pixel differences reflect the documented accessibility corrections. The target-size checker now excludes links inside closed disclosures using actual visibility instead of counting their retained layout rectangles. Final browser totals are recorded in `production-final/ui/results.json` and the verification summary.

## Test results and production gates

- Final focused backend: **47 passed, zero failed/skipped**, including real Mongo/JWT persistence, current-source conflicts (including a new Skill Gap assessment during AI), history/preview ownership, Sprint idempotence, cross-process quotas, fencing and indexed query evidence.
- Full Angular run: **540 passed in 92 files**. An earlier sandbox run could not load tests; the first unsandboxed run had one unrelated scheduling timeout. That test passed alone, then the full suite passed without weakening timeouts.
- Production build and app TypeScript noEmit: passed. Existing landing-page stylesheet warning remains: 56.67 KB against a 48 KB warning budget; this task does not modify that file.
- Broad backend run: **327 passed / 12 failed / zero skipped (339 total)**. This earlier run included Recommendations source-race/performance failures that the final focused run resolves. Remaining independent failures include missing resume PDF fixtures (`standard.pdf`, `empty.pdf`) and two Courses evidence/cache assertions. Parent subtests contribute to Node's failure totals. Preserve the full log; do not report this broad gate as passed.
- Synthetic performance sample: cold p50/p95 282.30/299.15 ms; shared-cache path 93.76/95.23 ms; memory path 31.14/31.79 ms. These use controlled/mock providers and cache timing, not production Mongo/provider latency. A loaded broad run exceeded the existing 50 ms memory threshold; final isolated focused checks pass without changing the threshold.
- Formatter write/check, changed-JavaScript syntax and Git whitespace validation: required for every final changed file; exact final results belong in the retained verification summary.

| Gate                                                                  | Status       | Evidence / remaining acceptance                                                  |
| --------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------- |
| Recommendation correctness and golden fixtures                        | PASS locally | Final focused backend and independent expected actions                           |
| Mongo-authoritative admission and fencing                             | PASS locally | Disposable replica set, three quota workers, token/cancellation recovery         |
| Owned persistence/history/Sprint integration                          | PASS locally | Real Mongo/JWT regression                                                        |
| Frontend logic, TypeScript and production compilation                 | PASS locally | Full Angular tests, noEmit, build                                                |
| Broad cross-module suite                                              | FAIL         | Missing resume PDF fixtures and Courses contract/cache failures need resolution  |
| Current responsive browser interactions/accessibility                 | PASS locally | Retained browser results; never infer pass from partial execution                |
| Exact all-theme visual parity                                         | BLOCKED      | Historical baseline differs; only current local light pre-fix captures available |
| Live-provider behavior, fleet security, privacy retention and rollout | BLOCKED      | Authorized staging/live-provider and policy acceptance not performed             |
| Deployed p50/p95, memory, cache efficiency, index/TTL and soak        | BLOCKED      | Local synthetic timings cannot establish deployed performance                    |

## Finalization and inventory

The exact changed/new file inventory, formatting/check statuses, final UI totals and cleanup are retained in `production-final/verification-summary.json`, `production-final/changed-files.json` and `production-final/cleanup.json`. All source remains in existing services, middleware, tests, fixtures, scripts and component folders. No source files moved or deleted.

Cross-module tests rewrote six historical verification reports. Their new synthetic evidence was copied to `production-final/cross-module-evidence`, then the original Git baseline content was restored; unrelated historical reports are not part of this change. Disposable Mongo fixtures stop their own processes and remove only their verified task-owned temporary files. Essential logs, screenshots and before/after evidence are retained. No destructive Git cleanup/reset, recursive deletion or deletion of unrelated/untracked user work was used.

Reproduce focused backend checks with `node backend/src/scripts/verifyRecommendationsLocal.js --focused`. Omitting `--focused` runs the broader related suites in a disposable database; those suites can emit their established verification reports, which must be preserved/restored as above. Browser verification accepts `PLAYWRIGHT_MODULE` for an installed runtime and `RECOMMENDATIONS_UI_OUTPUT` for isolated evidence output.

## Operational security incident

A process diagnostic printed an unrelated Google API key from another process command line into tool output. The credential was not used or saved into repository files. It must be revoked or rotated; the value is intentionally not reproduced in this report. This is an outstanding operational security action, not a source-code remediation or authorization to modify live credentials.

The index was staged externally during this task. It was preserved without staging or unstaging files. Later working-tree fixes are newer than some staged snapshots; all reported final tests cover the working tree. Review and stage those final edits before committing.
