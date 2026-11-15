# Interview Prep filter corrections — 2026-11-15

Source: clean main at c9da3ce000bef619b534c4e35f78620a4c806764. Authorized implementation branch: fix/bug-01 at that revision. PR target: not applicable. No commits, pushes, deployments, schema/dependency changes or provider requests were performed for this task. The final index was externally staged during verification and was preserved.

## Root causes and corrected flow

Generation fallback selected Top seed records without difficulty filtering. It also discarded the focus query, category, tags and source; its minimum-count floor could request more questions than intended. JavaScript's unchanged curated bank contains Medium/Hard/Senior questions and no Easy questions: Easy cannot honestly be filled from that bank.

The generation controller forwarded only difficulty and topic, while saved-session calls forwarded none of the practice filters or count. Session idempotency fingerprints omitted those filters. The frontend could retain a prior Hard practice set after a failed Easy request. AI metadata normalization discarded reported technology and could associate structured metadata with the wrong item after filtering an array.

Generation now reads a filtered owned-independent shared bank before the existing AI fallback, limits the final deduplicated set to the requested count, and rechecks every candidate against the requested difficulty, canonical technology, category, any-tag predicate, text query and source. AI constraints are included in the existing provider prompt and checked before persistence and after rereading stored records. No bank label is rewritten to claim an Easy question. Filtered partial sets explicitly identify insufficiency; no matching fallback produces a safe insufficient-results response.

Library Top-30 composition/ranking remains unchanged. All-library and search predicates are applied in Mongo before skip/limit. Library and seed fallback filters are normalized; exact prebuilt source no longer accepts verified_seed records. Filtered search uses the paged filtered lookup rather than the single-answer reuse path that omitted constraints. Repository technology identifiers and AI-reported technology aliases share canonical normalization (system_design → system-design). The existing any-tag / any-search-term semantics are retained.

Bank and search cache namespaces were versioned; keys include canonical topic, difficulty, sorted tags, category, source, page and limit (plus query and lookup mode for search). AI coordination keys continue to include the complete prompt. Frontend in-flight sharing includes the full request payload. Saved-session fingerprints include normalized filters and requested count. Existing ownership checks, immutable snapshots, request-key conflict handling, deduplication and provider fallback remain in place.

Question cards already render difficulty, technology and source from each returned question; this was audited and preserved. The practice heading now uses the returned question technology, and incompatible prior practice results are cleared before retrying with new filters.

## Exact changed source files

- backend/src/controllers/interviewPrepController.js
- backend/src/repositories/interviewQuestionRepository.js
- backend/src/services/interviewPrepService.js
- backend/src/services/interviewQuestionFilters.js (new)
- backend/src/services/providers/interviewAIProvider.js
- backend/src/tests/interviewQuestionFilters.test.js (new)
- frontend/src/app/pages/interview-prep/interview-prep.component.ts
- frontend/src/app/pages/interview-prep/interview-prep.component.spec.ts
- frontend/src/app/shared/services/api.service.spec.ts
- frontend/src/app/shared/services/api.service.ts
- frontend/src/app/shared/services/interview-prep.service.ts
- backend/verification/interview-prep/filter-corrections-2026-11-15.md (this report)

Existing API routes are reused. Existing POST generation and session payloads now forward the optional category, tags, source, difficulty, focus and count fields; no new routes, database schema or dependencies.

## Validation

- Final focused backend run: 60 passed, zero failed/skipped across filters, service, hardening, performance, cache, orchestrator, quality, normalization and curated catalog suites. Regression tests exercise every filter alone/combined, captured Mongo predicates before pagination, mismatched saved/verified/AI output rejection, cached filter isolation, count limits and private Session fingerprints/snapshot metadata. Database predicates and AI faults are deterministic fixtures; this does not certify live account data.
- Full backend npm test: 832 tests; 743 passed, 63 failed, 26 skipped. Failures include loopback EACCES, disposable Mongo readiness, missing resume PDF fixtures and timing/assertion failures in unrelated modules. Two Interview Prep real-Mongo suites were explicitly skipped. A clean full-backend pass is not claimed.
- Full frontend npm test -- --watch=false: initial sandbox invocation failed before execution with EACCES on tooling port 63380. Loopback-enabled retry ran 644 tests: 641 passed and three 5-second timeouts (GitHub Analyzer initialization, Portfolio Settings analytics initialization, Resume Analyzer initialization). Interview Prep had no failing test in this run. Final component-only rerun recorded below.
- TypeScript noEmit: passed, including the final stale-practice-result change.
- Production build passed with initial bundle around 4.09 MB / 4 MB warning and existing Landing, Jobs and Public Portfolio stylesheet warnings. Final build rerun recorded below.
- Prettier explicit write then check: passed. Backend options: singleQuote, trailingComma none, printWidth 110; frontend uses frontend/.prettierrc. JavaScript syntax and working/staged Git whitespace checks passed.

## Cleanup and limitations

The full regression suite generated two unrelated synthetic PDF outputs, absent at clean preflight and written by weeklyReportsRefinement.test.js. Only these exact temporary files were deleted after checking their resolved paths: backend/verification/weekly-reports/refinement-2026-11-11/pagination.pdf and snapshot.pdf. No source files moved/deleted. Existing caches/build output retained. Four tracked report rewrites observed during the suite were no longer modified when the suite finished; no restoration of them was performed by this task.

Live Mongo/Redis accounts, live provider generation and authenticated browser acceptance were not exercised. Full-regression failures above remain unresolved outside the requested scope. No live browser screenshot claim is made.

The existing router accepts comma-separated tag strings, while UI state uses tag arrays. Generation and Session HTTP calls now serialize tags to that existing wire contract. Added an API transport regression test. Final component/card Angular rerun passed 20/20 before this transport regression was added; the combined final rerun is recorded below.

## Final verification additions

Final combined focused Angular invocation (Interview Prep component/card plus API service): 24 tests passed (18 Interview Prep component, 6 API transport/cache), zero assertion failures. Vitest exited 1 because the question-card worker failed to start within its timeout; this is recorded as an infrastructure error, not a clean aggregate pass. The preceding component/card-only run passed all 20 tests including both unchanged question-card tests. New tag serialization and source-filter stale-result changes are covered by the final 24 passing tests. Final TypeScript compilation passed.

Concurrent public-auth work appeared after preflight in frontend/src/app/shared/services/landing-theme.service.ts, frontend/src/app/shared/styles/_public-theme-tokens.scss, frontend/scripts/audit-public-auth-responsive.cjs and frontend/verification/public-auth/. These were not edited or removed by this task. The staged index was preserved as observed; no git add, reset, commit or deployment was performed.
