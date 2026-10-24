# Tech News Hub frontend finalization

Date: 22 October 2026

STATUS: BLOCKED

READY FOR TECH NEWS FINAL E2E: NO

The frontend implementation for the existing API is verified. Full requested completion is blocked by two capabilities absent from the locked backend contract: reversing a Read Later completion, and distinguishing proven skills from resume claims within the aggregate detected-skills list. No backend change or destructive delete/recreate workaround was made. These require a backend capability decision before all requested acceptance criteria can pass final E2E.

## Scope and inspected contracts

Read repository AGENTS.md, frontend/docs/developer-ui.md, the shared Developer UI report/tokens, the latest backend/verification/tech-news/REPORT.md, and actual news controller/routes/services/models/middleware. No separate Tech News architecture document exists in the checkout; the backend report and implementation provide the architecture. All 15 pre-existing staged backend files were preserved; this task has no unstaged backend diff. No dependency, lockfile, shared shell, scoring engine, theme service or unrelated module was changed.

The implemented API calls remain:

| Operation                         | Existing contract                                                                |
| --------------------------------- | -------------------------------------------------------------------------------- |
| Feed, search, filters, pagination | GET /api/news; tab/category/source/date/search/popularity/page/limit             |
| Explicit context refresh          | GET /api/news with refresh=true; never used for ordinary filter changes/retry    |
| Saved library                     | GET /api/news/saved?type=bookmark or read_later&page=N&limit=50                  |
| Save/queue                        | POST /api/news/save with normalized article fields and type                      |
| Remove                            | DELETE /api/news/save/:id                                                        |
| Complete reading                  | PATCH /api/news/save/:id/read with empty body; server timestamp is authoritative |

The PATCH handler deliberately preserves an existing readAt and ignores attempts to reset it. There is no unread route/field contract. The UI preserves that completion, explains that it cannot be reversed here, and supports viewing unread entries and completed reading history. Bookmarking a queued article preserves the queue/history entry rather than simulating an atomic move through two destructive operations.

## Implemented UI and behavior

- Unboxed Manrope heading, indigo actions, divided library metrics, horizontal view navigation, clean article cards and a responsive reading desk using existing Light/Dark/System semantic tokens. Shell-owned padding and theme controls are reused; no second palette or font is installed.
- For You, Trending, Latest, Bookmarks and Read Later remain available. Search supports Enter; category/source/date/popularity controls submit together, reset preserves the active feed tab, and topic shortcuts apply searches. Feed order and pagination remain server-authoritative; appended items are deduplicated without re-ranking.
- Article titles, original-source links, publisher attribution, publication dates, excerpts, rank/relevance scores, matching detected skills, growth gaps, market demand and explanations are displayed from API metadata. Native disclosures expose explanations/context/source checks without crowding the reading desk.
- Unknown or invalid scores remain null; a zero rank remains zero with a zero-width bar. Rank is never substituted from relevance. No popularity, article body, score, reading timestamp or skill certification is invented. Broken images are replaced with a neutral category placeholder and do not recursively retry a remote fallback.
- Bookmark/queue toggles, Remove, Mark Read and additive Bookmark actions wait for server acknowledgement. Per-article pending keys block duplicates, list reads are cancelled around writes, and failures reconcile server state without global optimistic rollback. A missing/invalid save acknowledgement is treated as failure. Confirmed server readAt values remain in history.
- Saved pages can be loaded beyond the first fifty records per type. Reading-status filters apply to loaded records and are labeled accordingly. Server totals are displayed only after a successful library response. Normal browsing can identify saved items loaded into the current library; for a saved article outside those loaded pages, POST remains backend-idempotent and returns the existing record rather than creating a duplicate.
- Loading skeletons and updating messages, empty filtered results, warming, stale snapshots, partial-source outages, offline, 429 and 503 states are distinct. Previously loaded results remain visible on refresh/pagination failure. Filter/context/account changes clear mismatched results rather than presenting them under new filters.

## Request lifecycle, account protection and integration

The service holds at most thirty account/revision-scoped request entries in memory. Successful feed responses can be reused for fifteen seconds; saved responses for five seconds. Concurrent identical requests share one transport. shareReplay uses refCount=true, and component cancellation plus revision/account guards prevent obsolete responses from committing after filters, views, career context, logout or account changes. No personalized response or saved-ID set is newly written to localStorage. The old twenty-minute feed/five-minute library caches and indefinitely completed request signatures are removed from this page.

Entering a saved view, explicit library sync, and returning to a visible/focused window after thirty seconds revalidate account data. Revalidation does not imply a backend refresh flag. There is no automatic provider/AI generation, retry loop or background polling. The existing news invalidation callback responds to Developer signal invalidation; canonical account/career-profile changes reset local state and requests. Dashboard integration and its existing invalidation implementation are untouched.

Retry-After accepts seconds or HTTP dates. Cooldowns are account- and request-kind-scoped, cannot be shortened, and are checked before sending HTTP. The UI shows retry countdowns. A 503 cooldown on explicit refresh also blocks ordinary feed calls during its window. A refresh-specific 429 does not consume ordinary refresh flags through filtering. New account data is never read from another account's cache. Failed mutations are never automatically replayed.

Common URL validation rejects non-HTTP(S), credentials, custom ports, IP/local/internal hosts and malformed URLs. Normalized article and saved-item responses must have safe external URLs. External links use noopener/noreferrer, images use lazy loading, async decoding and no-referrer, and all text is escaped through Angular bindings. No provider credentials or direct external news API calls are introduced.

## Focused verification

### Tests and compilation

- `npm test -- --watch=false --include=src/app/shared/services/news.service.spec.ts --include=src/app/pages/news/news.component.spec.ts`: **21 passed in two files**. Covers account switching, stale-response cancellation, shared subscriptions, bounded reuse, HTTP teardown, saved pagination, duplicate saves, server acknowledgement, read timestamps/history, removal-error reconciliation, filter reset, authoritative zero ranking, stale/partial labels and Retry-After including 503 refresh-to-browse protection.
- `node frontend/node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.app.json`: passed.
- Exactly one production `npm run build`: passed, 51.458 seconds. Initial bundle: 3.07 MB raw / 502.62 kB estimated transfer. Existing unrelated warning: landing-page.component.scss is 55.89 kB against a 48 kB warning budget. News styles do not introduce a budget warning.
- Initial sandbox test execution could not rename Vitest temporary cache files. The same focused tests ran successfully with execution approval outside that sandbox. This was not an approval rejection.
- No full backend suite, full frontend suite, exhaustive E2E, paid provider, production database or live AI request was run.

### Controlled browser verification

`frontend/scripts/verify-news-ui.cjs` serves the retained production build locally and intercepts every API/external request with explicit synthetic fixtures. Existing shell/profile requests are controlled too. Test article content, artwork, dates and scores are synthetic verification inputs, not production news or proof of provider correctness.

**14 focused browser checks passed; zero page runtime errors.** Desktop 1440x1000 and mobile 390x844 Light/Dark layouts have no horizontal document overflow and use Manrope. System mode follows live browser OS color-scheme changes. Verified all views, append pagination, filter submission with Enter, reset, cancelled obsolete search, acknowledged save/remove, read completion/history, reload persistence, account reload isolation, source states, offline retention, 429 countdown and 503 retention. Mobile disclosure/category submission was checked explicitly.

Fixture corrections: the first synthetic JWT lacked the application's required issuer/audience; the test fixture was corrected. Two UI assertions initially checked before Angular rendered the state; explicit render/visibility waits corrected the harness. Thirteen checks passed before the final mobile visibility wait was corrected; only that remaining mobile interaction was rerun against the unchanged production build. A second full browser matrix and a second production build were not run. The reusable script retains the corrected waits and defaults to running all focused checks afresh.

Screenshots were inspected directly:

| Evidence                  | File                                                       |
| ------------------------- | ---------------------------------------------------------- |
| Desktop Light             | [desktop-light.png](desktop-light.png)                     |
| Desktop Dark              | [desktop-dark.png](desktop-dark.png)                       |
| Mobile Light              | [mobile-light.png](mobile-light.png)                       |
| Mobile Dark               | [mobile-dark.png](mobile-dark.png)                         |
| Mobile article controls   | [mobile-dark-articles.png](mobile-dark-articles.png)       |
| Persisted reading history | [desktop-reading-history.png](desktop-reading-history.png) |

Machine-readable results: [browser-results.json](browser-results.json).

## Finalization and exact files

All sixteen changed TypeScript/HTML/SCSS/verification-script files were formatted using the installed frontend Prettier and frontend/.prettierrc, then checked with the same explicit paths. Report/results were also formatted and checked. The two CommonJS scripts passed node --check, TypeScript passed, focused tests passed again after cleanup, and working/staged Git whitespace checks passed. No source file was moved or deleted.

Existing staged backend changes were preserved. All retained screenshots, scripts, fixtures and reports are task-owned verification evidence. Repeated screenshot captures replaced the same paths; no duplicate image files remain. An accidental duplicate screenshot entry in the results array and temporary resume/debug harness branches were removed. No temporary credential, trace, log, standalone throwaway script or unrelated file was deleted. Shared Angular caches and the essential production build were preserved; their ownership predates or supports this verification.

Modified:

1. `frontend/src/app/pages/news/news.component.ts` — scoped lifecycle, feed and library state, acknowledged mutations, retry handling and revalidation.
2. `frontend/src/app/pages/news/news.component.html` — reading desk, five views, truthful source/evidence states, library/history and accessible controls.
3. `frontend/src/app/pages/news/news.component.scss` — existing semantic themes, responsive layout and focus styling.
4. `frontend/src/app/shared/components/news-card/news-card.ts` — safe links, neutral broken-image handling and zero-accurate score width.
5. `frontend/src/app/shared/components/news-card/news-card.html` — attribution, original links, server scores, evidence disclosures and saved controls.
6. `frontend/src/app/shared/components/news-card/news-card.scss` — responsive, theme-aware cards.
7. `frontend/src/app/shared/components/news-filters/news-filters.ts` — preserve tab on reset.
8. `frontend/src/app/shared/components/news-filters/news-filters.html` — native form/Enter submission and named inputs.
9. `frontend/src/app/shared/components/news-filters/news-filters.scss` — responsive, theme-aware search/filter form.
10. `frontend/src/app/shared/models/news.model.ts` — current freshness/attribution metadata, nullable unknown scores and saved pagination envelope.
11. `frontend/src/app/shared/services/news.service.ts` — bounded account-scoped reuse, cancellation, API normalization and cooldowns.

Added:

1. `frontend/src/app/shared/utils/news-presentation.ts` — safe URLs, reported numbers, dates and Retry-After parsing.
2. `frontend/src/app/shared/services/news.service.spec.ts` — ten focused transport/cache/security/backoff checks.
3. `frontend/src/app/pages/news/news.component.spec.ts` — eleven focused lifecycle/action/presentation checks.
4. `frontend/scripts/news-browser-fixture.cjs` — explicit synthetic news/source/artwork fixtures.
5. `frontend/scripts/verify-news-ui.cjs` — reusable production-build browser verification.
6. `frontend/verification/tech-news/REPORT.md` — this report.
7. `frontend/verification/tech-news/browser-results.json` — actual browser results.
8. `frontend/verification/tech-news/desktop-light.png`.
9. `frontend/verification/tech-news/desktop-dark.png`.
10. `frontend/verification/tech-news/mobile-light.png`.
11. `frontend/verification/tech-news/mobile-dark.png`.
12. `frontend/verification/tech-news/mobile-dark-articles.png`.
13. `frontend/verification/tech-news/desktop-reading-history.png`.

Moved/deleted source files: none. Deleted physical task artifacts: none; only duplicate metadata and temporary debug/resume code were removed in place.

## Remaining acceptance limits

1. **Mark Unread is blocked.** The existing backend completion operation is idempotent and one-way. Reversing it requires a reviewed server operation that preserves ownership/history. Deleting and re-saving would lose IDs/timestamps/history and is incompatible with this task's constraints.
2. **Per-skill proven/claimed classification is unavailable.** The UI separates detected matches from growth/recommended learning and explicitly discloses mixed evidence. It cannot truthfully classify each aggregate detected skill without authoritative provenance in the response.
3. Saved-library reading-status filters apply to loaded pages; additional pages are available through Load More. Feed saved-state badges cover loaded saved records; backend-idempotent POST safely resolves records beyond those pages. These are disclosed pagination boundaries, not fabricated persistence guarantees.
4. Final real-system E2E, actual provider rights/data, cross-device network behavior and production latency remain outside this controlled frontend verification. Backend deployment prerequisites from its report still apply.

Stop point: frontend implementation and focused verification only. Do not modify the verified backend or begin final E2E implicitly.
