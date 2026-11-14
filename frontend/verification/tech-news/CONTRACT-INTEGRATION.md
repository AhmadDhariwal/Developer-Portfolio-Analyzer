# Tech News frontend contract integration

Date: 22 October 2026

STATUS: VERIFIED

READY FOR TECH NEWS FINAL E2E: YES

This report supersedes the two frontend integration blockers in [REPORT.md](REPORT.md), using the verified [backend contract](../../../backend/verification/tech-news/CONTRACT-FIX.md). Earlier screenshots, browser results, production-build evidence and reports remain historical evidence and were preserved.

## Integration

- Mark Read and Mark Unread send `PATCH /api/news/save/:id/read` with `{read:true}` or `{read:false}`. The existing service method defaults to read for compatibility with existing callers. Opposite requested states have distinct request keys. Per-article pending controls prevent duplicate UI writes.
- UI changes wait for a valid server acknowledgement matching the saved ID, Read Later type and requested state. Failed or contradictory acknowledgements follow the existing error/reconciliation path; they never announce success or invent a local completion. No delete/recreate workaround is used.
- Saved GET and PATCH responses retain normalized `firstReadAt`, `lastReadAt`, `readCount` and current `readAt`. Missing history remains unknown rather than receiving client-generated dates/counts. The UI displays current Read/Unread status, first/latest completion dates and server completion count. Marking unread preserves the entry in Reading history and also makes it eligible for the Unread filter. Re-reading adopts the server's new latest date/count while preserving its original first date.
- Context `recommendedBasedOn.skillEvidence` and article `relatedSkillEvidence` display distinct labels for DEMONSTRATED (demonstrated implementation), PARTIAL (technical metadata only), CLAIMED_ONLY (not demonstrated), NOT_EVIDENCED (does not imply inability) and UNKNOWN (insufficient evidence). Unsupported statuses become UNKNOWN; absent metadata does not infer proof from legacy skill names. Evidence metadata and rule version remain available in the typed response. Recommendations, demand and growth areas remain separate from evidence classifications. No confidence is presented as a proficiency probability.
- Existing five views, styles/themes, filters, pagination, ranking, bookmarks, bounded account-scoped reuse/cancellation, Retry-After and career-context invalidation remain in place. Mutation acknowledgement still invalidates saved reads. No backend, dependencies, provider/AI integration, scoring engine, shared shell or production data changed.
- The retained controlled browser harness now understands read/unread history fields and expects the enabled Mark Unread action after completion. Its matrix was not rerun.

## Focused verification

`npm test -- --watch=false --include=src/app/shared/services/news.service.spec.ts --include=src/app/pages/news/news.component.spec.ts` from `frontend`: **27 passed, 0 failed** across two files (13 service and 14 page/component tests).

Six added tests cover explicit read/unread/re-read payloads, server timestamps/counts and saved-GET round trips; contradictory acknowledgement and HTTP errors; both evidence projections and unknown classifications; acknowledgement/duplicate guards and history retention through unread/library sync; failed unread reconciliation; and actual rendered context/article labels and read/unread buttons, pending status, re-read and component recreation from the server record. Existing focused coverage for account switching, cancellation, cache bounds, filters/pagination, saved failures and Retry-After also passes. All HTTP/provider behavior is controlled; no paid calls were made.

Angular's focused test build compiled the affected components and templates successfully. The initial sandbox execution reached compilation but Windows denied a Vitest temporary-cache rename before any tests ran (EPERM). The identical scoped command passed outside the sandbox.

- Application TypeScript: `node frontend/node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.app.json` passed.
- Explicit-path Prettier write and check passed for every file below using `frontend/.prettierrc`.
- `node --check frontend/scripts/verify-news-ui.cjs` passed.
- Working-tree and staged Git whitespace checks passed.
- No temporary scripts, screenshots, logs or other disposable task artifacts were created. No files were moved/deleted; existing staged changes and retained evidence were preserved. No unstaged backend changes were introduced.

No production build, full repository/backend/frontend suite or browser matrix was repeated. The previous passing production build and 14 browser checks are retained in REPORT.md/browser-results.json; they describe the earlier UI, not fresh browser verification of this integration. New behavior is verified by controlled HTTP tests and rendered Angular component tests.

## Exact task file inventory

Modified existing files (paths relative to repository root):

1. `frontend/src/app/shared/models/news.model.ts` — additive evidence/history types.
2. `frontend/src/app/shared/utils/news-presentation.ts` — shared evidence labels and bounded classification normalization.
3. `frontend/src/app/shared/services/news.service.ts` — explicit read boolean, acknowledgement validation, history/evidence response integration.
4. `frontend/src/app/shared/services/news.service.spec.ts` — three contract tests.
5. `frontend/src/app/pages/news/news.component.ts` — read/unread action and retained reading-history filtering.
6. `frontend/src/app/pages/news/news.component.html` — toggle, current status, history summary and context evidence.
7. `frontend/src/app/pages/news/news.component.spec.ts` — three contract tests including rendered templates/reload.
8. `frontend/src/app/shared/components/news-card/news-card.ts` — shared evidence label mapping.
9. `frontend/src/app/shared/components/news-card/news-card.html` — related evidence labels and honest legacy-signal wording.
10. `frontend/scripts/verify-news-ui.cjs` — controlled response/history compatibility and updated button expectation.

Added: `frontend/verification/tech-news/CONTRACT-INTEGRATION.md` (this report).

## Remaining work

No known frontend contract blocker remains. Final E2E against the deployed verified backend is the next acceptance stage and was intentionally not run. Backend current adapters may legitimately return no DEMONSTRATED skills; the UI does not synthesize them. Existing unrelated production-build stylesheet budget warning remains documented in REPORT.md.
