# Dashboard data corrections

Verified on `fix/bug-02` against the Developer account identified by the supplied email, the display name Ali, and the GitHub username `ahmaddhariwal`. The initial working tree was clean at `38736410`. No PR target applies. No commit, push, deployment, dependency change, schema change, or scoring-formula change was made.

## Widget acceptance matrix

| Widget | Result for the authorized account | Positive case exercised in isolation | Before and after |
| --- | --- | --- | --- |
| Comparable Portfolio Readiness | No current verified portfolio assessment and no comparable pair. All three durable portfolio archives lack scoring-rule provenance. The separate overall readiness value of 49 uses GitHub evidence and the integration blend. | The first scored response matches the current portfolio value with one history point. A second verified assessment gives two distinct points matching the two scorer responses. Browser checks assert the SVG coordinates and current numeric label. | [Before](before-readiness.png) · [After](after-readiness.png) |
| Contribution Activity | The accepted GitHub snapshot contains totals for five sampled repositories and no dated series. Two older analysis records contain month names without years. Neither establishes a monthly count for the accepted revision. | An explicit sync persists UTC year-month buckets for attributable commits. HTTP tests compare every returned bucket with the saved record. Browser checks distinguish a measured zero from an unavailable series. | [Before](before-activity.png) · [After](after-activity.png) |
| Skills Radar | Code Quality **33**, Industry Readiness **65**, Project Impact **47**, Skill Coverage **unavailable**. Desktop and mobile checks match the three meter values and verify that coverage has no meter. | Four measurements render the radar. Partial measurements render labeled meters on the same 0–100 scale. | [Before](before-charts.png) · [After](after-charts.png) |
| Skill Gap Overview | The selected Default Resume matches the saved assessment. Its GitHub revision differs from the owned, accepted revision, so the Dashboard explains why reassessment is needed. In the saved assessment React is claimed, TypeScript has partial evidence, and 18 required skills are unknown. | Fresh and previously saved assessments give disjoint missing and detected lists. The isolated HTTP test compares coverage with Skill Gap. Browser checks cover measured coverage, weak skills and missing skills after a second tab refreshes. | [Before](before-skills.png) · [After](after-skills.png) |
| Language Distribution | GitHub Analyzer and Dashboard return identical code-language shares from saved byte counts. Displayed values are JavaScript **63.48%**, TypeScript **36.49%**, Python **0.03%**, and Batchfile **<0.01%**. | Browser tests compare both screens through navigation, normal reload, cache-bypassing reload, cross-tab refresh and account switching. | [Analyzer](browser/github-language-evidence.png) · [Dashboard](browser/dashboard-language-radar.png) |

The account screenshots are fresh captures of the before and after local builds replaying the corresponding account handler fields in an isolated browser. The three original screenshot files were unavailable in this chat. The fresh baseline already withheld stale skills for this account. The retained saved Skill Gap record reproduced the classification defect separately. No live recalculation or sync was performed for the account.

## Root causes and corrections

**Portfolio readiness.** The component gated its content on trend availability, despite the summary already exposing a separate current portfolio measurement. History also depended on the presence of a current cache rule, and unrelated archives or cached copies could consume its 32-row limit. The component now reads current portfolio readiness independently. The history query selects the owner, normalized GitHub identity, career stack, experience, selected resume analysis, scoring rule and assessment cutoff, then deduplicates before selecting the most recent 32 assessments. The existing verified scorer supplies the source-revision hash, assessment hash, scoring rule and assessment date. A verified archive-write error now reaches the caller. The Dashboard honors an explicitly unavailable canonical score even when a legacy numeric field contains zero. Focused provenance tests and the two-worker scoring test passed.

**Contribution activity.** The active GitHub analyzer read aggregate contributor totals. Its dated-commit helper was disconnected, and persistence cleared the series on every newly accepted analysis. The new path queries author-filtered default-branch commits in the analyzer’s sampled original, non-archived repositories over six UTC calendar months. It counts each SHA once, includes the year, and saves the series with the accepted analysis. Missing or incomplete pages cannot establish a complete series. Legacy labels without a year are excluded. Passive saved reads issue no additional GitHub requests. This chart covers sampled commits and does not represent the entire GitHub contribution calendar. The provider fixture, persistence, Dashboard HTTP and browser assertions passed.

**Skills radar.** The fallback used overall GitHub health (51) for Code Quality despite a saved dimension of 33. The frontend also disabled line and fill for the entire radar if any value was missing. Code Quality now reads the accepted dimension. The partial-data view shows a labeled meter per available value, while the complete-data view retains the radar. The selected resume inputs were 71, 81, 56 and 50, yielding 65. The project-impact inputs were 25, 25, 100 and 39, yielding 47 under the existing formula. The saved-record comparison, mobile and desktop checks, and full-radar browser test passed.

**Skill Gap and Recommendations.** The evidence resolver already distinguished `CLAIMED_ONLY`, `PARTIAL`, `NOT_EVIDENCED` and `UNKNOWN`. The compatibility projection put claimed and partial requirements into both Your Skills and Missing Skills. Recommendations also put every non-demonstrated required skill in its missing signal. New projections, reads of previously saved evidence, both Dashboard skill endpoints, and recommendation signals now reserve the missing classification for required skills marked `NOT_EVIDENCED`. Detected claims and partial evidence remain visible as needing stronger proof. The existing coverage rule continues to withhold a number when a required skill is unknown. For a compatible assessment, the Dashboard identifies the affected requirements. For the authorized account, the accepted GitHub revision was 14:19:36.649 UTC on November 18 and the saved Skill Gap reference was 14:20:31.475 UTC. The freshness check correctly rejects that mismatch. All 18 unknown required skills are recorded in the source comparison. [Source comparison](source-comparison.json)

**Language and freshness.** The authorized record retains rounded legacy percentages alongside the accepted byte weights. The Dashboard already preferred the raw weights. The Analyzer’s cache presentation also accepts the raw weights nested in saved GitHub signals when a legacy result lacks top-level weights. The summary continues to validate two matching source reads and derives its HTTP validator from the response. The four Dashboard handlers agreed on their overlapping fields. Browser tests recorded one explicit GitHub sync and zero AI requests, with external provider traffic blocked. [Browser results](browser/results.json)

## Verification boundary

The account lookup checked the supplied email, Developer role, display name and GitHub username before inspecting dependent records. Application-model initialization during diagnosis issued five MongoDB `createIndexes` commands, crossing the requested read-only boundary. A disposable reproduction identified all five as Scenario Simulation schema indexes whose development-mode initialization overrides the global setting. The monitored run observed 28 finds, five aggregations and five index commands, with no record inserts, updates or deletes. Whether any index was newly created on the account database is unknown. Live application-handler runs stopped after discovery. The final independent comparison used native MongoDB finds only. The report does not certify read-only database access for the entire diagnosis.

Mutation tests used disposable loopback MongoDB and Redis. The browser tests exercised fixture providers. A real GitHub commit sync and a recalculation on the authorized account were deliberately unexecuted. [Before handler fields](before.json) · [After handler fields](after.json) · [Isolated integration results](integration-regression.json)

## Follow-up on the localhost screenshot

The screenshot shows a newer, compatible Skill Gap assessment. The account's saved Recommendations and Skill Gap timestamps were 17:27:14.584 and 17:27:26.792 PKT on November 19. A native MongoDB find confirmed four saved cards. The Dashboard used the later Skill Gap save to flag Recommendations as stale and discarded their preview. It now shows the same-profile cards with a clear refresh notice. The separate Recommendations endpoint resolves the active GitHub username before checking its revision, and the Command Center identifies an older project as the last saved recommendation.

| Widget | Expected result for this account after loading the updated code |
| --- | --- |
| Recommendations | Four last-saved cards stay visible alongside the fresh Skill Gap assessment. The refresh notice identifies their age relative to the latest evidence. |
| Comparable Portfolio Readiness | The new **Assess saved portfolio** button calculates from saved profile evidence and updates the score on success. It runs only on explicit action and incurs no AI generation. Trend availability still requires distinct comparable records. |
| Contribution Activity | The card links to GitHub Analyzer for an explicit sync. The accepted old snapshot still lacks a dated series. |
| Skills Radar and Skill Gap | The three measured values remain visible. Target coverage stays unavailable while required evidence is unknown. The Command Center now distinguishes an assessment with no confirmed missing skills from a missing assessment. |
| Interview Readiness | The saved recommendation record has no interview-readiness score. The widget stays unavailable. |
| Sprint | The Command Center identifies a fully completed sprint instead of prompting the developer to start a task. |

The focused Dashboard suite passed 35 tests. The full Angular suite passed 715 tests. TypeScript and the production build passed, with existing build-budget warnings. The two-worker MongoDB and Redis follow-up passed both checks. The earlier full backend run returned 1,100 passed, 7 failed, 1 cancelled and 23 skipped. The failures remain documented separately. [Isolated workflow](integration-followup.json) · [Full backend run](backend-regression.json)

### Follow-up source changes

- `backend/src/modules/dashboard/dashboardcontroller.js`
- `backend/src/modules/workflows/analysiscontroller.js`
- `backend/src/tests/dashboard/dashboardEndpoints.test.js`
- `frontend/scripts/verify-developer-evidence.cjs`
- `frontend/src/app/features/developer/pages/dashboard/components/dashboard-progress/dashboard-progress.component.html`
- `frontend/src/app/features/developer/pages/dashboard/components/dashboard-progress/dashboard-progress.component.ts`
- `frontend/src/app/features/developer/pages/dashboard/dashboard.component.html`
- `frontend/src/app/features/developer/pages/dashboard/dashboard.component.ts`
- `frontend/src/app/shared/services/api.service.ts`

Playwright passed eight checks, including an explicit portfolio assessment that updated the score to the fixture value while the saved language chart stayed populated. The browser recorded exactly one assessment request and zero AI requests. [Browser results](browser-followup/results.json) · [Assessment screenshot](browser-followup/portfolio-assessment.png)

Prettier ran in write and check modes. The follow-up moved and deleted no repository source files. The duplicate fixture captures `dashboard-language-radar.png`, `dashboard-skill-gap-recommendations.png`, `dashboard-sprint-velocity.png` and `github-language-evidence.png` were removed from `browser-followup` after the run. The original evidence remains under `browser`. Both disposable test trees and their generated PDF fixtures were cleaned up.

## Final data-accuracy closure

| Requirement | Evidence and resulting behavior |
| --- | --- |
| Recommendations | The preview now carries the saved description, priority and generation time when recorded. A later dependency revision preserves cards for the same owner, profile and Default Resume, with **Refresh Recommended** visible. The existing AI-only notice applies to current deterministic cards with outdated enrichment. |
| Contribution Activity | The accepted account snapshot has 14 repository rows and zero dated contribution buckets. The fallback now shows repository counts, recent recorded pushes and available repository-wide commit totals. A complete sampled monthly series takes precedence. Pagination follows GitHub's next-page header and rejects a conflicting author identity. |
| Portfolio Readiness | A current score has its own meter. Its detail panel shows available numeric scoring components, timestamp and scoring-rule version. History deduplicates by verified source revision even if the archive contains multiple assessment IDs. |
| Skill Gap and source identity | The authorized account's accepted GitHub revision, Skill Gap GitHub reference and Recommendation GitHub reference match. The Recommendation Resume reference matches the selected Default Resume. The saved coverage remains null. The native query confirmed a persisted portfolio assessment and Recommendation fingerprint. |
| Index audit | The follow-up audit observed four finds and one index listing, with zero `createIndexes` commands. The five index names previously attempted are present. The current inventory cannot attribute their creation to the earlier commands. |

[Native account audit](closure-account-audit.json) · [Before activity](after-activity.png) · [Before readiness](browser-followup/portfolio-assessment.png) · [Before recommendations](browser/dashboard-skill-gap-recommendations.png)

The fixture captures show [repository evidence](browser-closure/dashboard-language-radar.png), [saved recommendations](browser-closure/saved-recommendations.png) and [portfolio score and provenance](browser-closure/portfolio-assessment.png). These captures use controlled data. Playwright verified the fallback, trend and meter states, then reloaded the assessment without issuing a second assessment or an AI request. [Browser assertions](browser-closure/results.json)

### Closure verification and regression triage

| Gate | Status | Evidence |
| --- | --- | --- |
| Saved recommendations, source transitions, explicit regeneration and stale recovery | PASS in fixtures | Two-worker HTTP tests exercised source changes, failed generation, recovery and refreshed snapshots on disposable MongoDB and Redis. Playwright verified that saved content and priority remain visible with the stale notice. |
| Passive Dashboard reads | PASS in fixtures | Playwright recorded zero AI requests and one explicitly initiated GitHub sync. External provider traffic was blocked. |
| Dated activity and repository fallback | PASS in fixtures | Focused endpoint tests distinguished saved repository metrics from authored monthly counts. Browser coverage exercised both states. |
| Current score, trend and reload | PASS in fixtures | Source-revision deduplication passed the provenance tests. The assessment button, score meter, provenance display and reload passed Playwright. |
| Skill Gap and selected Default Resume propagation | PASS in fixtures | The two-worker test exercised selected-resume changes and saved data propagation. The native audit confirmed compatible account source timestamps and null coverage. |
| Frontend regression, TypeScript and production build | PASS | 715 tests passed across 120 files. After the final styling edits, all 20 Dashboard Angular tests and all eight Playwright workflows passed. The TypeScript and production builds passed with existing budget warnings. |
| Previous backend failures | PARTIAL | The profile and resume tests now assert the Default Resume contract. The isolated preview worker resolves dependencies through the harness's `NODE_PATH`. All 20 resume and preview rerun tests passed. The historical Skill Gap case and resume upload cancellation cleared. The Interview Prep API test passed in one serial run and returned 503 in subsequent serial and full runs. |
| Full backend regression | FAIL | The final complete run recorded 1,105 passes, four failures, zero cancellations and 23 skips. The four failures include the Course Catalog and Interview Prep parent suites. The failing child cases were scheduled archival and authenticated Interview Prep API contracts. |

[Two-worker integration](integration-closure-regression.json) · [Unchanged baseline failures](baseline-closure-regression.json) · [First full closure run](backend-closure-regression.json) · [Final full run](final-backend-closure-regression.json) · [Final targeted rerun](final-recheck-closure-regression.json)

Course Catalog passed the serial follow-up. The remaining Interview Prep failure occurs at the authenticated JavaScript search request. It returns `503 Interview service is temporarily busy. Please retry.` before the test reaches the practice and session assertions. The response comes from Interview Prep coordination. The underlying reservation error is unavailable because the service maps it to the generic 503. The Dashboard closure leaves admission behavior in place. [Serial failures rerun](serial-failures-closure-regression.json) · [Interview diagnostic](interview-diagnostic-closure-regression.json)

### Closure source inventory

- `backend/src/modules/dashboard/dashboardcontroller.js`
- `backend/src/modules/dashboard/services/dashboardHistoryService.js`
- `backend/src/modules/dashboard/services/dashboardProgressService.js`
- `backend/src/modules/github/services/githubservice.js`
- `backend/src/tests/dashboard/dashboardEndpoints.test.js`
- `backend/src/tests/dashboard/dashboardProvenance.test.js`
- `backend/src/tests/interview-prep/interviewPrepFinalization.integration.test.js`
- `backend/src/tests/profile/profileSettingsProduction.test.js`
- `backend/src/tests/resume/resumePipelineFinalization.test.js`
- `backend/src/tests/skill-gap/skillGapAcceptance.test.js`
- `frontend/scripts/verify-developer-evidence.cjs`
- `frontend/src/app/features/developer/pages/dashboard/components/dashboard-progress/dashboard-progress.component.html`
- `frontend/src/app/features/developer/pages/dashboard/components/dashboard-progress/dashboard-progress.component.scss`
- `frontend/src/app/features/developer/pages/dashboard/components/dashboard-progress/dashboard-progress.component.ts`
- `frontend/src/app/features/developer/pages/dashboard/dashboard.component.html`
- `frontend/src/app/features/developer/pages/dashboard/dashboard.component.scss`
- `frontend/src/app/features/developer/pages/dashboard/dashboard.component.ts`
- `frontend/src/app/shared/models/dashboard.model.ts`

No source files were moved or deleted. The duplicate captures `browser-closure/dashboard-sprint-velocity.png` and `browser-closure/github-language-evidence.png` were removed. Their prior equivalents remain in the verification history.

The closure also added this report section and a summary in `DEVELOPER-END-TO-END-ACCEPTANCE.md`. Prettier write and check, JavaScript syntax checks and Git whitespace checks passed.

### Real-account browser gate

**BLOCKED** for live mutation and authenticated browser acceptance. No live assessment, GitHub sync, Skill Gap reassessment or Recommendations regeneration was performed during this closure. To complete the manual gate, sign in on the authorized account and confirm the saved cards and matching source timestamps. Explicitly sync GitHub, verify the dated series or the repository evidence fallback, assess the saved portfolio, and reload. Reassess Skill Gap and verify React and TypeScript against the accepted GitHub revision and Default Resume. Explicitly refresh Recommendations, verify the stale label clears when generation succeeds, and check that F5 and a second tab retain the same values.
