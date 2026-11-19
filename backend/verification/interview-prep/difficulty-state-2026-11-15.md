# Remaining Easy/Medium practice-state correction — 2026-11-15

Branch/source: fix/bug-01, existing ref c9da3ce000bef619b534c4e35f78620a4c806764. PR target not applicable. Previous Interview Prep corrections were already staged; concurrent public-auth work was already present. Both were preserved. No commits, deployments, database/schema/authentication changes, dependency installation or live provider requests.

## Exact cause and trace

The existing dropdown called cancelPractice(), which cancelled pending work but did not invalidate the displayed practiceQuestions array. A previously loaded Medium drill therefore remained visible immediately below an Easy generator selection. The previous fix cleared incompatible records only when Generate was clicked. Its success callback then assigned response.questions without validating against the submitted filters. A separate saved-session bug refreshed activePracticeSession but did not replace the displayed practiceQuestions array with the refreshed snapshot.

The current component does not automatically populate a default library practice drill. Loaded drills originate from a previous generation result or resumeSession(). The supplied visual evidence cannot distinguish those origins or establish a backend failure. The authenticated browser bridge failed initialization (missing kernel assets), so the original user's request/response is unavailable.

Actual fixture browser Network captures are retained in frontend/verification/interview-prep/difficulty-state-2026-11-15/results.json. They show the app submits difficulty=easy; a deliberately faulty response with difficulty=medium is rejected without rendering a practice card. A legitimate fixture Easy response displays actual Easy + Verified library metadata. These are real HTTP exchanges from the built browser app with controlled local responses, not evidence from a production account.

Controller → generateFreshInterviewQuestions → repository/Mongo predicate → quality-controlled AI → filtered verified fallback was inspected. Current production service filters remain authoritative; new backend regressions reject Medium, Hard and Senior AI candidates for Easy with zero persistence and explicit 503 insufficiency. Canonical bank/search cache keys already include difficulty, and normalized Session fingerprints include filters/count. Existing owner checks, immutable Session snapshots and deduplication are unchanged. Tests exercise Easy/Medium/Hard cache separation. Live Mongo records and live AI output were not queried.

## Correction

- Difficulty changes cancel requests and immediately clear incompatible drills, including active progress state; no generation request is implied by a dropdown change.
- Response acceptance checks every question and any nested saved-session snapshot against the captured request's difficulty, technology, category, source and tags. A mismatching set is rejected in full; actual question metadata is never relabeled to match the form.
- A persistent drill label identifies Existing library question set, New AI-generated set or Saved practice session, with recorded difficulty and explanation that generator settings apply to the next set.
- Reopened historical Medium sessions remain explicitly identified as saved Medium snapshots even when the generator is configured for Easy. Selecting Easy subsequently clears an incompatible drill. Fresh owned-session retrieval updates the actual displayed question array, index, source context and self-checks.
- Empty results show explicit insufficient-results feedback. Cancellation/version guards and failed requests cannot restore an incompatible old drill.
- The local preview fixture itself ignored requested generation difficulty; it now filters candidates and returns explicit insufficiency, and records Interview Prep request bodies. This prevents verification tooling from silently substituting a different difficulty.

## Exact files changed in this follow-up

- frontend/src/app/pages/interview-prep/interview-prep.component.ts
- frontend/src/app/pages/interview-prep/interview-prep.component.html
- frontend/src/app/pages/interview-prep/interview-prep.component.spec.ts
- frontend/scripts/interview-prep-preview.cjs
- frontend/scripts/verify-interview-difficulty-state.cjs (new reusable Playwright check)
- backend/src/tests/interviewQuestionFilters.test.js
- backend/verification/interview-prep/difficulty-state-2026-11-15.md (this report)

Retained essential browser evidence:
- frontend/verification/interview-prep/difficulty-state-2026-11-15/results.json
- frontend/verification/interview-prep/difficulty-state-2026-11-15/before-medium-drill.png
- frontend/verification/interview-prep/difficulty-state-2026-11-15/easy-selection-cleared.png
- frontend/verification/interview-prep/difficulty-state-2026-11-15/easy-medium-response-rejected.png
- frontend/verification/interview-prep/difficulty-state-2026-11-15/easy-result-390.png
- frontend/verification/interview-prep/difficulty-state-2026-11-15/easy-result-1440.png

## Verification

- Focused frontend: npm test -- --watch=false --include=src/app/pages/interview-prep/**/*.spec.ts --include=src/app/shared/services/api.service.spec.ts: 30/30 PASS across three files. Includes changing Easy over an existing Medium drill, valid Easy results, invalid Medium responses, mismatching nested Session snapshots, no Easy results, failed Easy requests, saved-session reopening/refreshed arrays, API transport and actual source rendering.
- Focused backend: node --test backend/src/tests/interviewQuestionFilters.test.js backend/src/tests/interviewPrepService.test.js backend/src/tests/interviewPrepHardening.test.js backend/src/tests/interviewPrepCache.test.js: 22/22 PASS. Final added Easy-versus-Medium cache assertion rerun: 6/6 filter tests PASS.
- Installed TypeScript noEmit against frontend/tsconfig.app.json: PASS.
- Production build: PASS, 3.98 MB initial bundle. Existing Jobs and Public Portfolio stylesheet warning budgets remain.
- Playwright against the built app: PASS, five scenarios, zero page errors. Desktop 1440 and phone 390 screenshots retained and visually inspected. Screenshot captions and results explicitly identify synthetic fixture data.
- Initial Playwright harness run correctly rejected a fixture technology mismatch (React returned for MERN). The harness was corrected to use the actual requested technology and rerun successfully. Final results replace that task-only failed run; no application validation was weakened.
- Prettier explicit write/check on all six changed source/test/script paths: PASS. Backend retains singleQuote/trailingComma none/printWidth 110. Frontend uses its repository configuration. Script/test syntax and working/staged whitespace checks: PASS.

## Remaining limits and finalization

Original-account Network data, persisted account-specific Mongo values and live provider execution remain unverified. The screenshot is not attributed to a backend failure. The confirmed frontend/fixture gaps and the corrected behavior are proven through component, service and controlled browser regressions.

No source files moved or deleted. All screenshots/results are essential final evidence and retained. No abandoned temporary scripts or logs were created; the reusable verification script is in frontend/scripts. The Playwright task-owned server/browser were closed in finally; an existing preview server, if present, is reused without termination. Concurrent and staged user work was preserved.
