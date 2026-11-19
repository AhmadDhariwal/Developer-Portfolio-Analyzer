# Default Resume and Recommendations conflict verification

2026-11-18. Source branch fix/bug-02. PR target not applicable.

## Confirmed behavior

A read-only probe of the affected saved account found that Default and Active both pointed to the file ending in 0b6df8. Its latest owned analysis ended in 0b6e1c. With database writes and provider calls disabled, the Recommendations fingerprint agreed at generation and verification on that stable snapshot. The original failed request's inputs were unavailable.

The isolated HTTP regression reproduced a 409 for the same operation when analysis finished during generation. Initial Recommendations input had resumeAnalysisId equal to no-resume for the selected Default. The second read found a newly accepted ResumeAnalysis._id for that same file. The fingerprint correctly changed. Before this fix, the browser surfaced the conflict and stopped. The regression verified that a single deterministic request after the conflict uses the new ID and incurs zero additional AI calls. A separate MongoDB fixture verified that a real change in compatible Skill Gap during generation still returns 409.

Two other code defects made selection less reliable. Active Resume took precedence over Default, and upload could move Active. Recommendations also used a broad Skill Gap candidate lookup before generation and a different, resume-scoped lookup during verification. That allowed separate revisions to enter the comparison. The saved context, accepted ResumeAnalysis, GitHub revision and compatible Skill Gap now share one reader for initial generation, reuse of in-flight work and the final comparison.

## Affected paths

- **Resume and shared developer context.** Default wins over legacy Active. Skill Gap, Recommendations, Portfolio Score and Dashboard use the explicit Default only. The file must belong to the signed-in account. Matching analyses are ordered by analyzedAt, createdAt and ID. Upload retains an existing Default and its Active selection. Viewing another file in the Resume Library stays available.
- **Missing analysis and caches.** Each unanalyzed Default has a distinct cache identity with resumeAnalysisId set to no-resume. Browser invalidation runs after successful selection, clears dependent caches and carries an owner-scoped source event across tabs. Existing owned snapshots remain in storage.
- **Skill Gap and Portfolio Score.** Current lookups use the same default identity. The Skill Gap write verifies both the current selected file and current accepted analysis in its existing transaction. Portfolio Score and Dashboard use the exact resume identity for cache and provenance matching.
- **Recommendations.** One bounded deterministic recovery handles a 409. It sends no frontend resume selection and cannot repeat AI work. A second conflict is surfaced. Existing owner guards discard invalidated responses. Explicit refresh remains opt-in and concurrent requests share the current result through the existing owner lease. Tests checked successful enrichment clearing Refresh Recommended, including a second worker reading the result.

## Validation

- **Angular suite** — 715 passed in 120 files. TypeScript and the production build passed. The existing bundle, Jobs stylesheet and Public Portfolio stylesheet size warnings were emitted.
- **Two-worker HTTP and Playwright** — Real loopback MongoDB and Redis, controlled GitHub and AI responses, and synthetic accounts. Uploaded two PDFs through the API, kept the existing Default through an upload, selected the new file, checked unavailable analysis, accepted a new analysis mid-request, and recovered without AI. Checked matching Skill Gap, Portfolio Score and Dashboard identities, GitHub Sync, cross-account rejection, Redis outage recovery and overlapping explicit refresh. One controlled provider call served two simultaneous refresh requests. In a fresh headless Edge profile, a Default switch in Resume Analyzer refreshed the visible Recommendations tab through the other worker with zero paid requests.

- **Affected backend matrix** — 119 passed and four failed in the broader initial run. Three of the four hit disposable MongoDB startup or transaction deadlines. The warm-cache timing assertion also exceeded its existing limit. Stage reads were then kept parallel while retaining one canonical Skill Gap ordering and exact resume compatibility.
- **Final focused rerun** — 18 passed, zero skipped. It covered the four previously failing areas and reran the complete two-worker and browser regression against the final code. Recommendations MongoDB, Skill Gap MongoDB, recommendation admission and the warm-cache performance assertion all passed.
- **Formatting and repository checks** — Changed source paths passed Prettier and JavaScript syntax checks. Working-tree whitespace validation passed. The staged baseline still has an EOF whitespace warning in backend/src/tests/fixtures/developerFreshnessWorker.js.
- **Cleanup** — Uploaded PDFs created by the test were removed by their fixture. Disposable MongoDB and Redis processes were stopped. No repository files were moved or deleted.

## Exact file inventory

- `backend/src/core/developer-context/developerContextService.js`
- `backend/src/core/developer-context/developerSignalService.js`
- `backend/src/core/storage/storedAssetService.js`
- `backend/src/modules/dashboard/dashboardcontroller.js`
- `backend/src/modules/recommendations/services/recommendationEngineService.js`
- `backend/src/modules/recommendations/services/recommendationService.js`
- `backend/src/modules/resume/resumecontoller.js`
- `backend/src/modules/skill-gap/services/skillGapCacheContract.js`
- `backend/src/modules/skill-gap/skillgapcontroller.js`
- `backend/src/modules/workflows/analysiscontroller.js`
- `backend/src/tests/core/developerContextService.test.js`
- `backend/src/tests/core/developerEndToEndFreshness.integration.test.js`
- `backend/src/tests/dashboard/dashboardEndpoints.test.js`
- `backend/src/tests/dashboard/dashboardPortfolioScope.test.js`
- `backend/src/tests/fixtures/defaultResumeBrowser.js`
- `backend/src/tests/fixtures/developerFreshnessWorker.js`
- `backend/src/tests/recommendations/recommendationsMongo.integration.test.js`
- `backend/src/tests/recommendations/recommendationsPerformance.test.js`
- `backend/src/tests/skill-gap/skillGapFocusedReview.test.js`
- `backend/src/tests/skill-gap/skillGapMongo.integration.test.js`
- `backend/src/tests/skill-gap/skillGapProduction.test.js`
- `backend/src/tests/skill-gap/skillgapHardening.test.js`
- `backend/verification/data-freshness/default-resume-409.md`
- `frontend/src/app/features/developer/pages/recommendations/recommendations.component.ts`
- `frontend/src/app/shared/services/api.service.ts`
- `frontend/src/app/shared/services/frontend-cache-invalidation.service.ts`
- `frontend/src/app/shared/services/recommendations.service.spec.ts`
- `frontend/src/app/shared/services/recommendations.service.ts`
- `frontend/src/app/shared/services/resume.service.ts`
