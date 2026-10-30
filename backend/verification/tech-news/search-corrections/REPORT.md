# Tech News UI and DevOps search corrections

24 October 2026, Asia/Karachi. Acceptance scope: configured local backend, real authenticated API, built Angular UI, and focused isolated regression tests.

STATUS: VERIFIED

FOR YOU FILTER CORRECTED: YES

EXPLORE DEVOPS SEARCH VERIFIED: YES

## Confirmed causes and correction

For You still rendered the shared category selector and clickable technology-topic buttons. The backend cleared its search text but applied the category to catalog candidates, and the frontend carried that category between views. An authenticated baseline returned 149 week-matching articles without the category but only 20 with stale `category=DevOps`. The fix hides both category and technology/search controls in For You, clears hidden state on entry/submission, omits those wire parameters, and ignores legacy hidden category/search values before backend catalog lookup. Shape/length validation remains; Explore search validation and category filtering remain. Date, source and existing popularity filters remain available. Developer Context, evidence, pagination, the 50/30/20 ranker, saved items and history are preserved.

DevOps initially had **zero records in the authoritative catalog**, not a missing Mongo index or failed alias lookup. All 109 stored articles were inspected: none matched the existing DevOps taxonomy, and all eight indexes were present. A legacy topic snapshot reported an earlier DEV search, but those cached results were not catalog records. The catalog-first feed returned HTTP 200, zero items, `coverage_gap` and `not_needed/catalog_only` on an ordinary read. The generic warm-up empty panel obscured the distinction between a read without discovery, pending discovery, and a blocked source attempt.

One explicit authenticated `mode=explore&search=devops&date=month&discover=true` request admitted one governed job. HN search accepted six articles and DEV search accepted 28. The existing worker persisted 34 accepted articles, advanced catalog versions and returned HTTP 200 with 34 total/12 items, `sufficient/ready`, **without a backend restart**. No fabricated articles, broadened filters or quota resets were used. Discovery admission, provider transports and classification did not require replacement.

The corrections normalize search text to lowercase on the Angular wire, suppress discovery when search is cleared, retain ordinary filter/page/catalog-refresh read behavior, and display the actual enrichment reason in the empty panel. Pending/searching/processing, waiting/quota limits, exhausted, disabled and unavailable messages retain their separate state handling. For an empty catalog-only search, the UI explicitly says sources were not requested and identifies the explicit search/check action. Filter-exclusion diagnostics now use `broadTotal - total`, rather than only the returned page; this fixes misleading exclusion counts on paginated or empty filtered results.

## Real API evidence

| Request                                        | Before correction                                        | Final read-only acceptance                                 |
| ---------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| For You, week, no hidden filters               | 200; 149 total                                           | 200; 150 total                                             |
| Same For You with stale DevOps category/search | 200; 20 total                                            | 200; 150 total; identical item order to unfiltered For You |
| Explore DevOps, week                           | Initially 200; zero before discovery; 29 after discovery | 200; 30 total, 12 items                                    |
| Explore DevOps, month                          | Initially zero; 34 after discovery                       | 200; 35 total, 12 items                                    |
| Explore DevOps, month, Frontend category       | 200; 2 total                                             | 200; 2 total; category remains effective                   |

Totals increased as the normally running governed ingestion added a real article. Five DevOps matches fall outside the selected week; no date filter was widened implicitly. The final catalog has 162 articles, including 35 DevOps records from HN/DEV. All DevOps records have the expected `searchTerms` membership, and no text-matching record is missing its DevOps tag. Actual query plans use `technologies_1_publishedAt_-1_canonicalId_1` via IXSCAN. Before/after index inventories match exactly.

The worker heartbeat was present (about 1.4 seconds old at final capture). HN/DEV search admission, provider budgets and next eligibility are retained in `api-after.json`. Kubernetes was blocked by its normal daily budget, with next eligibility at `2026-10-24T00:00:00Z`; it was not required for successful HN/DEV discovery. Restricted/unapproved providers remain unchanged. Ordinary authenticated reads did not change any provider request counters. The browser's deliberate Check for New Articles action returned `queued`; the completed worker subsequently reported `no_newer`, zero inserts and a successful-check timestamp, without pretending duplicates were new articles.

Evidence:

- [Initial tool observations](initial-observation.json): initial zero catalog coverage, eligible admission, real accepted source counts and visibility without restart.
- [Authenticated API before](api-before.json) and [after](api-after.json): response summaries, index plans, multi-tag examples, worker state, provider admission and unchanged counters during reads. No token/account details or credentials are saved.
- [Browser baseline](../../../../frontend/verification/tech-news/search-corrections/before.json) and [final browser acceptance](../../../../frontend/verification/tech-news/search-corrections/after.json): real API, no mocked news. The final flow checks all hidden controls, normalized `devops` with `discover=true`, date changes, pagination, both refresh actions, and return to For You; eight authenticated feed requests, four grouped checks, zero runtime errors.
- Screenshots: [baseline Explore](../../../../frontend/verification/tech-news/search-corrections/before.png), [final Explore](../../../../frontend/verification/tech-news/search-corrections/after-explore.png), [final For You](../../../../frontend/verification/tech-news/search-corrections/after.png).

## Focused validation and finalization

Exact results and file inventory are retained in [validation.json](validation.json).

- 23 affected backend unit/contract tests passed, zero failed/skipped, including ranking/evidence, admission/deduplication, limits and legacy hidden parameters.
- One isolated Mongo test passed, zero skipped. A uniquely named `news_search_test_<UUID>` database verified indexed aliases, AND keyword matching, multi-tags, source/date constraints, pagination/totals, and cross-worker cache invalidation following ingestion. Its database was removed by its ownership-checked teardown; application data was not used as a synthetic fixture.
- 52 tests passed across the two affected Angular files, zero failed. Coverage includes UI controls, normalized requests, empty states, read-only interactions, evidence, saved/history and cancellation.
- TypeScript no-emit and the production build passed. The existing unrelated landing-page SCSS warning remains: 55.89 kB against a 48 kB warning budget.
- Explicit changed-source Prettier write/check, JavaScript syntax checks, and staged/unstaged Git whitespace checks form finalization. No repository-wide formatting or unrelated refactor was performed.
- An initial Angular test attempt failed in sandbox temporary-file rename before executing tests; rerunning with reviewed access resolved that environment problem. Intermediate new-test fixture/type mistakes were corrected before final validation.

No credentials, environment settings, provider approvals/ceilings, catalog indexes, infrastructure or locked modules were edited. The verified local backend was restarted once to load the personalization correction and remains running. The DevOps discovery/visibility proof occurred before that restart. Task-owned browser helper processes were closed; no helper server is retained. No source or evidence file was moved/deleted, and no unrelated/untracked user work was cleaned up. Historical evidence and staging were preserved. Build output remains in the normal ignored build directory for the user's preview.

No remaining blocker is identified for this focused local acceptance. Earlier production deployment/source-contract/capacity prerequisites in CATALOG-FINALIZATION.md are not promoted to production verification by this task.
