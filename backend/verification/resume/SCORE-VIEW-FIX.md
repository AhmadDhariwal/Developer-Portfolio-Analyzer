# Resume score rendering and saved-result viewing

Status: fixed and locally verified.

## Root cause

The backend weighted score serializer returns pillar records as `{ value, weight, contribution, available }`. The frontend interface and view-model builder expected `score`, so `Number(undefined)` became NaN. Available flags and weighted contributions still rendered, and invalid progress values produced misleading filled bars. The earlier test/browser fixtures used the same incorrect `score` shape, hiding the integration mismatch.

## Corrected behavior

- Canonical `value` fields drive each pillar's number and progress bar. Earlier saved records using `score` remain readable.
- Explicit null, absent, blank, boolean, nonnumeric, NaN and infinite inputs cannot become displayed scores. Invalid scores show Unavailable; actual zero remains available as 0/100. Weighted contribution text is also checked for finite numbers. Overall scores use the same guard.
- Existing score formulas, weights and backend API output are unchanged. The frontend type now accurately describes the existing backend contract, with a compatibility field for older records.
- Upload still performs one upload followed by automatic analysis and displays the result immediately.
- The existing View Analysis button reuses the currently loaded result when file ID, fingerprint and analysis version match and library metadata does not indicate a newer analysis. It performs no new HTTP request in that case.
- Viewing a different/mismatched/newer saved version uses the existing result GET endpoint. It does not generate another analysis. Missing saved results keep the existing Analyze Resume action; explicit Refresh Analysis remains the way to request re-analysis.
- Failed reads for another file clear the old result rather than showing scores belonging to the previous file.

The proposed upload -> automatic analysis -> View Analysis flow has no requirement to repeat analysis simply to display the data. There is no additional button needed: View Analysis already serves that purpose. Re-analysis remains useful only as an explicit action or when no compatible saved result exists.

## Scope and finalization

Existing authorized branch: fix/resume. PR target: not applicable. Preflight ref: 8f13941a288674e9df29a204e3a319583edd3ed5. Existing staged upload-contract changes were preserved. No commit, push, deployment, database changes or file deletions were performed.

Exact changed/new source paths:

- `D:/Developer-Portfolio-Analyzer/frontend/src/app/shared/models/resume.model.ts`
- `D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/resume-analyzer/resume-presentation.ts`
- `D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/resume-analyzer/resume-analyzer.component.ts`
- `D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/resume-analyzer/resume-analyzer.component.spec.ts`
- `D:/Developer-Portfolio-Analyzer/frontend/scripts/resume-browser-fixture.cjs`
- `D:/Developer-Portfolio-Analyzer/frontend/scripts/verify-resume-score-view.cjs`

Documentation and retained verification paths:

- `D:/Developer-Portfolio-Analyzer/backend/verification/resume/SCORE-VIEW-FIX.md`
- `D:/Developer-Portfolio-Analyzer/frontend/verification/resume/score-view-frontend-tests.log`
- `D:/Developer-Portfolio-Analyzer/frontend/verification/resume/score-view-build.log`
- `D:/Developer-Portfolio-Analyzer/frontend/verification/resume/score-view/verified.json`
- `D:/Developer-Portfolio-Analyzer/frontend/verification/resume/score-view/verified-resume-analyzer-light-1440.png`
- `D:/Developer-Portfolio-Analyzer/frontend/verification/resume/score-view/verified-resume-analyzer-light-375.png`
- `D:/Developer-Portfolio-Analyzer/frontend/verification/resume/score-view/verified-resume-analyzer-dark-1440.png`
- `D:/Developer-Portfolio-Analyzer/frontend/verification/resume/score-view/verified-resume-analyzer-dark-375.png`

No source files moved or deleted. The exact task-created empty browser runtime directory `D:/Developer-Portfolio-Analyzer/frontend/verification/resume/score-view/runtime` was removed after the browser exited; no files were deleted during this finalization. No old evidence or user files were removed. Browser verification uses isolated synthetic accounts, local static serving and mocked API responses; the score object comes from the actual backend score aggregate rather than a hand-written scoring response. No real resume or credentials are used.

## Verification

- Full frontend suite: 85 files / 504 tests passed, zero failed; includes all 30 Resume Analyzer component tests.
- TypeScript application no-emit check: passed.
- Production build: passed.
- Browser checks: four cases passed: 1440px and 375px, light and dark; all eight values, progress aria values and fill widths match the actual backend aggregate; zero extra requests from View Analysis; no NaN/Infinity, page errors or overflow. Dark desktop screenshot also visually inspected.
- Explicit source Prettier write and matching check: passed.
- Verification JavaScript syntax: passed.
- Git staged/unstaged whitespace validation: passed.

Regression coverage includes canonical value fields and progress aria values, legacy score fields, malformed/missing/zero inputs, repeated View Analysis with no HTTP calls, upload and analyze once, GET-only file switching, fingerprint/version/time invalidation, explicit force refresh and failed-result isolation. Backend code did not change in this follow-up, so backend scoring/storage suites were not rerun. Existing external production gates remain unchanged.
