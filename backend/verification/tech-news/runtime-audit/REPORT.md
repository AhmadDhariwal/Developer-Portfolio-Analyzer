# Tech News discovery UX and final runtime audit

24 October 2026, Asia/Karachi. Scope: the configured local application, actual authenticated API/browser acceptance, isolated Mongo/Redis integration and controlled failure scenarios. This is not a production deployment approval.

STATUS: VERIFIED

DISCOVERY UX VERIFIED: YES

FULL NEWS FLOW VERIFIED: YES — local scope; controlled upstream fixtures are identified separately below.

ENV & PROVIDER AUDIT COMPLETE: YES

READY TO LOCK LOCAL IMPLEMENTATION: YES

READY FOR PRODUCTION DEPLOYMENT: NO

## Changes and timer meaning

Explore keeps the current catalog cards while a same-query discovery/check is queued, searching or processing. The existing status area is now a theme-aware bordered panel with a subtle, aria-hidden loader and a message identifying the number of visible cards, query and real phase. It announces status through the existing polite live region. Completed, no-newer, quota/account/global-job waiting, exhausted and unavailable states remain distinct. The loader exists only during the bounded active polling window; reduced-motion disables its animation. When four checks finish or polling pauses, the panel explains that discovery may continue and offers **Refresh Results**. No percentage/progress estimate or guaranteed article arrival is displayed.

The existing four checks at 20-second intervals remain catalog-only revalidations, not repeated discovery requests. Responses update cards, totals and catalog versions. The changes do not add a new polling loop, broaden filters or clear cards while revalidating the current query. Search changes still replace the previous query's results normally. For You's corrected controls, canonical Developer Context, 50/30/20 ranker, evidence, saved/history and pagination remain intact.

The purple **Wait …** label previously came from `NewsComponent.refreshSeconds`: the maximum of feed/refresh `Retry-After` deadlines and `enrichment.nextEligibleAt`. It was not a source-fetch duration. It now says **Check again in …**, with an accessible explanation of the blocking restriction. It explicitly states that eligibility is not a fetch or an article-arrival promise; Refresh Results remains a separate catalog read.

Authoritative backend sources:

- `newsDiscoveryService.processQueue`: completed checks use the later of `attemptedAt + NEWS_REFRESH_MIN_INTERVAL_MS` and actual source admission eligibility. The optional `eligibilityReason` identifies `manual_refresh_interval` or `provider_admission`.
- `newsDiscoveryService.coverage`: fresh-query suppression can return the remaining `NEWS_QUERY_FRESH_TTL_MS` interval, identified as `query_freshness`.
- `newsGovernanceService.reserve/inspect`: source/shared interval, concurrency, Retry-After, circuit, daily/monthly budgets produce precise reasons and deadlines. `enqueue` separately enforces global/account job budgets. These reasons are not collapsed into an active-search message.
- `newsController.getNews` supplies additive `serverTime`. Angular calibrates `nextEligibleAt` against it, while HTTP `Date` anchors absolute Retry-After values. Numeric Retry-After remains a duration. Legacy envelopes without the new optional fields still work.

The final real manual browser check returned **`quota_limited/discovery_daily_budget`**: the shared daily job allowance was **12/12**, even though HN/DEV keyword provider credits remained available. No job or source call was admitted by that denied check. It resets at **2026-10-24 00:00 UTC / 05:00 Asia/Karachi**; counters and ceilings were preserved. The UI now distinguishes this shared discovery-job limit from an account limit and a source limit. The prewarm attempt counter is not an admission count: denied evaluations can increment it beyond its configured ceiling; that never grants extra jobs.

## Complete data flow and evidence

| Flow                       | Behavior and verification                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduled broad collection | Existing minute scheduler enters the ingestion lease, admits each approved provider separately, normalizes metadata and calls catalog ingestion before publishing compatibility snapshots. Real HN/DEV/GitHub successes are recorded in the configured runtime. Isolated catalog integration traverses the actual broad path with controlled transport responses. |
| Adaptive prewarming        | Distinct HMAC account demand plus recent catalog coverage select reviewed taxonomy topics. An isolated real Redis/Mongo test proves three distinct accounts select Rust, admit one prewarm job, run the worker and persist tagged metadata. Repeated demand from one account does not meet the threshold; reserved user slots remain protected.                   |
| Explicit search            | Angular submits normalized `devops`, `mode=explore`, and `discover=true` only on a changed nonempty search. Indexed catalog results are read first. One shared Redis admission/worker job fills an eligible gap. Actual authenticated concurrent-user tests prove deduplication and worker-outage reporting.                                                      |
| Acceptance/dedup/expiry    | Existing normalization, canonical URL identity, multi-tags, publication-based expiry and revoked-source predicates remain. Isolated Mongo tests verify deduplication, concurrent upserts, strict expiry and retained attribution. No actual article body was collected by this task.                                                                              |
| Indexed filters/cache      | Real catalog has all eight existing indexes. Isolated 7/30-day, source/category, keyword, pagination, multi-tag and IXSCAN tests pass. Ingestion persists first and advances durable global/topic versions; another warm worker sees new data without restart.                                                                                                    |
| Personalized / public      | For You retains canonical signals, evidence and the 50/30/20 score; hidden category/search remain ignored. Explore does not resolve career signals or assign personalized scores. Real authenticated reads confirm context only in For You.                                                                                                                       |
| Refresh Results            | `bypassCache=true`, no refresh/discover flags. Date changes, pagination and catalog revalidation produce zero controlled provider transports. The read-only runtime probe also observed unchanged real provider counters across its four authenticated reads.                                                                                                     |
| Check for New Articles     | `refresh=true`, page one, shared admission and existing quota/interval protections. Isolated integration proves admitted work, precise denials and duplicate-only `no_newer`; the final real browser check correctly reports the shared job allowance denial.                                                                                                     |
| UI automatic visibility    | Actual authenticated isolated Angular/API/Redis/Mongo flow keeps 12 cards visible in queued/searching states. A controlled upstream adds one accepted article, and an automatic 20-second catalog poll changes the weekly total from 14 to 15 without reload or restart. The loader disappears and the authoritative cooldown is displayed.                       |
| Failure/concurrency        | Focused tests cover quota denial, shared headroom, source failure/circuit/Retry-After, Redis failure, lease loss, persistence failure, worker outage, account isolation and concurrent users. Application counters were not reset; write-sensitive manipulation used owned disposable namespaces/databases.                                                       |

The final retained runtime snapshot contains **211 real catalog records, including 37 DevOps articles**. Authenticated catalog reads return **31 week-matching / 37 month-matching DevOps results**, 12 items per returned page; For You returns 196 week-matching articles with Developer Context. Normal scheduled ingestion continues, so totals can subsequently change. Worker heartbeat, source policy, quota/reset state, actual index inventory and sanitized response summaries are in [runtime.json](runtime.json).

Real provider evidence and controlled evidence are separate. [Live browser acceptance](../../../../frontend/verification/tech-news/runtime-audit/live.json) uses the configured authenticated backend and real stored publisher metadata. [Isolated browser acceptance](../../../../frontend/verification/tech-news/runtime-audit/isolated-browser.json) uses real JWT authentication and real disposable Redis/Mongo/worker code with explicitly controlled upstream articles. Those screenshots are fixtures, not fabricated application catalog articles.

Screenshots:

- [Queued with 12 retained cards](../../../../frontend/verification/tech-news/runtime-audit/queued-light.png).
- [Searching with retained cards](../../../../frontend/verification/tech-news/runtime-audit/searching-light.png).
- [Automatic successful update and cooldown](../../../../frontend/verification/tech-news/runtime-audit/updated-cooldown-light.png).
- [Mobile dark successful-update panel](../../../../frontend/verification/tech-news/runtime-audit/updated-cooldown-mobile-dark.png).
- [Real Explore](../../../../frontend/verification/tech-news/runtime-audit/live-explore.png), [real check response](../../../../frontend/verification/tech-news/runtime-audit/live-check-result.png), [real For You](../../../../frontend/verification/tech-news/runtime-audit/live.png).

## Environment and provider audit

[ENVIRONMENT.md](ENVIRONMENT.md) inventories all **102 News keys** against actual consumers, absent-variable defaults, ranges, comments, optional/missing credentials and required operational prerequisites. Both environment files contain 196 unique keys with matching inventories, no missing News variables, no duplicate News assignments and valid ranges/relationships. Every News assignment has its immediate explanatory comment. All 196 parsed assignments per file were preserved. News credentials are never printed or copied into examples.

Verified comment corrections distinguish explicit example assignments from fail-closed runtime fallbacks: discovery/prewarm require explicit true; non-broad adapters default to no approval/zero budgets; missing adapter intervals default to 1200000 ms; absent shared budgets derive from effective family budgets. HN/DEV result limits and legacy discovery-memory limits do not control fixed RSS/GitHub caps or the independent catalog query cache. The intentionally unused `NEWS_DISCOVERY_PREWARM_TOPICS` remains for compatibility. Optional blank verification URLs/namespace are expected; disposable connections were provided only to test subprocesses.

[PROVIDERS.md](PROVIDERS.md) contains every enabled and disabled adapter's capability, actual admission, usage, retention, credential presence and exact operator activation steps. HN/DEV and their search adapters, GitHub releases/advisories and Kubernetes remain enabled with unchanged ceilings. Kubernetes is at 4/4 daily requests and has no confirmed successful feed in the captured pool; its live RSS contract remains a production gate. Lobsters remains unapproved despite numeric budgets. Cloudflare, NewsAPI and GNews remain unapproved with zero budgets; NewsAPI/GNews credentials are present but do not grant entitlement. Reddit additionally lacks its OAuth token and identifying user agent. Nothing was activated or reset.

Generic broad diagnostics still report some denied reservations as "Provider request failed". This audit uses authoritative admission reasons rather than declaring those paced sources offline. Source entitlement documents were not supplied, and no approval flag/key was treated as a contract. Verified current activation references are linked in the provider document and updated operator guide; no paid subscription or third-party message was sent.

## Tests, formatting and cleanup

Exact commands, results and changed-file inventory are in [validation.json](validation.json).

- **29 distinct focused backend unit/contract tests passed**. The final 17 affected configuration/feed/discovery cases also passed after cleanup and final metadata changes.
- **7 distinct isolated integration cases passed**, zero skipped: catalog flow, Redis governance/outage, Mongo/JWT ownership, refresh/shared quotas, upstream cooldown, authenticated free-text worker/browser round trip, adaptive demand/prewarm. The three affected refresh/browser cases were rechecked after eligibility metadata changes. Test teardown removed owned keys and databases.
- **55 Angular tests across the two affected files** cover card retention, phase text, bounded polling/loader shutdown, skew-corrected timing, shared/account/provider reasons, For You/Explore, filtering/pages, both refresh transports, evidence and saved/history behavior.
- TypeScript no-emit and production build pass. The existing unrelated landing-page SCSS warning remains (55.89 kB versus a 48 kB warning budget); News adds no budget warning.
- Changed sources use explicit Prettier write/check paths, backend JavaScript syntax validation and staged/unstaged Git whitespace checks. Environment syntax, key uniqueness, immediate comments and preserved assignments are validated separately; Prettier has no dotenv parser.

The disposable password-protected Redis was built in a verified task-owned WSL temporary directory and stopped after tests. Its database contained **zero keys** before shutdown; temporary build directories and the task-created duplicate archive were removed after path/ownership/content verification. [cleanup.json](cleanup.json) records those exact paths. No application Redis counter or Mongo collection/index was removed. No repository source/evidence file was moved or deleted. The existing historical catalog-results report was preserved; current integration explain evidence lives separately in [catalog-results.json](catalog-results.json). The local backend remains running with final News code. Historical evidence, staging and unrelated user work were preserved.

## Remaining production gates

No remaining local feature-verification blocker is identified. Locking this local implementation does not certify all upstreams or a deployed installation. Production still requires: actual publisher/account entitlements and retention/deletion review; supported token renewal/deletion processing where required; eligible Kubernetes and other deployed upstream contract checks; active deployed scheduler/worker heartbeat and native shared Redis acceptance; reviewed deployed indexes/migration, capacity/deep-pagination/compound-query load tests; deployed browser/auth/network acceptance and supported process management. Hosted/cluster Redis compatibility and production load are not established by local disposable tests. These gates preserve the earlier CATALOG-FINALIZATION scope.
