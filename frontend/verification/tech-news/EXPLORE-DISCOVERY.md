# Tech News Explore and smart discovery frontend

Date: 22 October 2026

STATUS: VERIFIED

READY FOR TECH NEWS FINAL E2E: YES

## Experience and contracts

Explore is a sixth prominent view beside For You, Trending, Latest, Bookmarks and Read Later. It initially requests broad cached technology news with `GET /api/news?mode=explore&tab=latest`, using the existing date/page/limit contracts. Search/category/source/date/popularity choices remain explicit and survive view changes; Explore never adds career skills to a query. For You and the existing Trending/Latest views send `mode=personalized` and retain the backend's existing ranking. Saved views and their server acknowledgement, read/unread history and Load More behavior are unchanged.

The frontend forwards all forty backend topics, aliases and unknown search terms without a client allowlist or additional matching/ranking. Matching, ordering, limits, totals and numbered Previous/Next pagination remain backend-authoritative. Source choices now include GitHub Releases, GitHub Security Advisories, Kubernetes Blog and Lobsters as cached publishers; choosing a publisher does not activate a provider. Multiword queries retain spaces while typing and normalize on submission. Reset preserves Explore mode; submitted search/filter/view changes reset to page one.

Additive typed `coverage`, `enrichment`, `mode`, `license` and `licenseUrl` fields are consumed from the existing API. Explore hides developer-context disclosures, personal rank/relevance and skill explanations. Cards retain original titles, dates, excerpts, publisher links and safe license links. Personalized evidence labels and 50/30/20 explanations remain available in personalized feeds. No scores, content, engagement, completion dates or search results are generated locally.

## Discovery and request lifecycle

- Coverage distinguishes cached matches, unsupported queries, restrictive filters, source exhaustion and eligible gaps using backend classifications. Enrichment distinguishes queued, searching, ready, exhausted, quota-limited, disabled and unavailable. Next eligible times and supplied source-check counts remain backend values. Ready describes the last cached topic search; filters can still yield no results. Neither eligibility nor pending work promises more articles.
- Pending first-page discovery permits at most four ordinary cache revalidation requests, twenty seconds apart. A completed response schedules at most one timer. There are no immediate retries and no automatic `refresh=true` requests. Automatic checks stop at their cap, on terminal status/error, on page two or beyond, while offline/hidden, or when Retry-After blocks requests. Users can check again through existing navigation, focus/reconnect revalidation or the explicit refresh control.
- Timers and requests are cancelled or fenced across filters, views, scope/account/career changes and component destruction. Leaving page one cancels polling; returning can use its remaining check allowance. Scope/filter changes start a new bounded cycle. Pending requests and failed updates keep already loaded matching articles visible; changing filters clears mismatched results.
- Existing fifteen-second feed/five-second saved reuse, thirty-entry request bound, account/revision cache keys, request deduplication/ref-counted cancellation, saved mutation reconciliation, offline retention and account-specific Retry-After remain intact. Mode is now part of HTTP parameters and therefore the request/cache key. The new automatic checks bypass only local response reuse, never provider governance.
- Browsers use only the existing application API. There are no provider URLs, provider credentials, AI calls, ingestion calls on pagination or persistent personalized client caches added by this task. Existing Dashboard/context invalidation and backend source approvals, quotas and workers are unchanged.

## Focused verification

- `npm test -- --watch=false --include=src/app/shared/services/news.service.spec.ts --include=src/app/pages/news/news.component.spec.ts`: **39 passed, zero failed**, across two files (16 service, 23 page/component). Covers Explore/personalized cache separation, shared reads, all forty topic names and aliases/unknown terms, safe licenses, account transport cancellation, authoritative pagination/filter resets, four-check cap and ready transitions, cancellation/offline/error paths, state labels, multiword typing and preserved saved actions/history/evidence/Retry-After tests. The initial sandbox attempt compiled successfully but Windows rejected Vitest's temporary-cache rename before test execution; the identical scoped command passed outside the sandbox.
- Application TypeScript: `node frontend/node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.app.json` passed.
- One `npm run build` production build passed. Existing unrelated warning: landing-page.component.scss is 55.89 kB against its 48 kB budget. No second production build was run.
- `node frontend/scripts/verify-news-ui.cjs --explore-only`, using the bundled Playwright runtime: **two targeted desktop-Light/mobile-Dark scenarios passed, zero page errors**. Verified broad Explore without personal scores/context, next-page requests without refresh, Enter search/reset to page one, retained queued matches, ready updates, unsupported empty search, attribution/license links, return to personalized mode and no document overflow. All API/external traffic was controlled or blocked; no live backend/provider requests occurred. The sandbox denied localhost browser access; the controlled checks passed outside it. Only these two scenarios were rerun after correcting sticky-header screenshot positioning and fixture source metadata; no old browser matrix was repeated.
- Final explicit-file Prettier write/check, browser-script `node --check`, application TypeScript and working-tree/staged Git whitespace checks passed. No backend suites, full frontend suite, new dependencies, paid calls or final real E2E ran. Existing theme/System/layout, saved reload persistence and account-isolation evidence is retained in earlier reports; current focused tests also cover saved contracts and account cancellation.

## Retained screenshot evidence

- [Desktop Light Explore](explore-desktop-light.png), 1440 px wide.
- [Mobile Dark Explore](explore-mobile-dark.png), 390 px wide.
- [Machine-readable browser results](explore-browser-results.json).

Screenshots were visually inspected. Their articles, imagery and HTTP responses are explicitly synthetic UI fixtures, not proof of live source availability.

## Exact files changed in this task

Modified:

1. `frontend/src/app/pages/news/news.component.ts` — Explore mode, discovery state copy and bounded cancellable revalidation.
2. `frontend/src/app/pages/news/news.component.html` — Explore guidance, discovery progress/status, mode-aware cards and empty states.
3. `frontend/src/app/pages/news/news.component.scss` — semantic-token discovery framing and responsive copy.
4. `frontend/src/app/pages/news/news.component.spec.ts` — focused Explore/discovery/filter lifecycle checks.
5. `frontend/src/app/shared/models/news.model.ts` — additive mode/status/license contracts and cached publisher choices.
6. `frontend/src/app/shared/services/news.service.ts` — mode-scoped API requests and safe license normalization.
7. `frontend/src/app/shared/services/news.service.spec.ts` — independent requests, taxonomy forwarding, account cancellation and license checks.
8. `frontend/src/app/shared/components/news-card/news-card.ts` — personalized presentation input.
9. `frontend/src/app/shared/components/news-card/news-card.html` — Explore score/context exclusion and supplied license attribution.
10. `frontend/src/app/shared/components/news-filters/news-filters.ts` — meaningful multiword search entry and mode-preserving reset.
11. `frontend/src/app/shared/components/news-filters/news-filters.html` — cached-source label.
12. `frontend/scripts/verify-news-ui.cjs` — isolated Explore-only browser path, retaining the old default checks.

Added:

1. `frontend/verification/tech-news/EXPLORE-DISCOVERY.md` — this final report.
2. `frontend/verification/tech-news/explore-browser-results.json` — focused controlled browser results.
3. `frontend/verification/tech-news/explore-desktop-light.png` — essential desktop evidence.
4. `frontend/verification/tech-news/explore-mobile-dark.png` — essential mobile evidence.

Removed: task-generated root `debug.log`, after verifying its creation during Chromium checks and its two DNS/Vulkan diagnostic lines. No source files were moved/deleted. Prior staged backend changes, historical reports and screenshots were preserved. No backend file, environment configuration, production database or application Redis key was modified by this frontend task.

## Remaining limitations

Final real E2E is intentionally deferred. Production results depend on backend source activation, approvals, quotas, retention and scheduled worker capacity. Four brief checks may finish before a queued job runs; the UI reports that limit and permits a later manual check without promising articles. Unsupported topics search cache only. Restricted/unapproved providers remain inactive. Backend remote Redis writes remain a separate staging/deployment validation requirement, as recorded in TOPIC-COVERAGE.md; frontend acceptance does not claim that verification occurred.
