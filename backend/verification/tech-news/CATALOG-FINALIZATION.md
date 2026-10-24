# Tech News catalog finalization

24 October 2026, Asia/Karachi. Local implementation and controlled acceptance; no production rollout.

STATUS: BLOCKED — production acceptance prerequisites remain; local checks pass.

SHARED NEWS CATALOG: YES

ADAPTIVE PREWARMING: YES

CATALOG-FIRST FILTERING & REFRESH: YES

READY TO LOCK TECH NEWS IMPLEMENTATION: NO — retain deployment acceptance and provider-contract checks below.

READY FOR PRODUCTION DEPLOYMENT: NO

## Before and after

Previously, a 300-item general pool and 40-item topic snapshots with roughly one-day retention supplied searches and personalized ranking. Searches could not use a shared month-long history, and prewarming used a fixed four-topic list.

Now `NewsArticle` is the authoritative shared search/history store. Every accepted canonical URL has one catalog record regardless of technology overlap or provider. Existing pool/topic caches remain bounded compatibility mirrors for existing consumers and outage fallback. No new per-technology collection exists. Saved items, article URLs, user ownership and reading history remain in their existing collections. No locked module, Dashboard code, ranking formula, provider credential or application database was rewritten.

## Three collection methods

1. **Scheduled broad collection:** the existing minute scheduler enters a token-owned ingestion lease. HN and DEV retain broad feeds; approved GitHub releases/advisories and fixed RSS feeds also participate. GitHub releases rotate only reviewed taxonomy repositories. Each provider retains its own configured interval, daily/monthly ceilings, shared-family headroom, concurrency, Retry-After and circuit admission. Public HN collection no longer requires a fixed technology keyword. Empty/failed attempts remain paced. No user needs to be online.
2. **Adaptive prewarming:** the governed prewarm lease selects reviewed technology identifiers from distinct aggregated search demand and real recent catalog coverage. The default requires three distinct accounts within seven days, skips sufficient fresh coverage, selects at most two candidates per evaluation, and admits at most four prewarm jobs/day. Repeated searches by one account contribute at most one vote/topic across seven days; each account has at most eight topic contributions/day. Redis uniqueness tokens use HMAC, expire, and never include raw account IDs, private profiles or raw free-text search phrases. With no demand, bounded observed under-covered/stale catalog topics are candidates; an empty catalog yields no invented topics. `demand-only` disables fallback. Prewarm cannot join a nonempty queue, cannot consume six reserved daily user slots by default, and receives only the first half of each provider/family daily/monthly ceiling. Existing global worker serialization bounds concurrency.
3. **On-demand discovery:** an explicit changed search uses `discover=true`. The backend queries the indexed catalog first; sufficient fresh coverage needs no provider request. A genuine gap/stale query may admit one shared deduplicated background job. Searchable approved providers use the same Redis admission and validation/catalog ingestion pipeline. Existing queued/searching/processing/waiting/exhausted/unavailable states and negative-cache suppression remain. Page > 1 never admits discovery. Ordinary date/category/source changes and page rendering are read-only. Older clients keep the response envelope but must adopt `discover=true` if they relied on implicit search admission.

All accepted broad/adaptive/on-demand results pass the existing metadata normalizer and the same catalog `prepare`/`ingest` path. Invalid dates, URLs and sources are rejected. No full article bodies are collected.

## Catalog, retention, indexing and caches

The model stores canonical SHA-256 URL identity; validated title/excerpt/original URL/source/publisher/date/category/popularity/attribution/license metadata; multiple technology tags; indexed bounded word/phrase terms; timestamps; and absolute expiry. Tracking parameters/fragments are removed; HTTP/HTTPS and trailing root/path slash identities are normalized. Deduplication is by canonical URL, not similar titles that may identify different articles. First accepted attribution remains stable; additional validated technology/search terms merge into the existing record. Popularity is provider-reported metadata, not synthetic engagement; duplicate reingestion does not poll for updated engagement.

Retention is the minimum of 35 publication-based days, the configurable global ceiling and source-specific hourly limits. HN/DEV broad/search settings use the stricter limit. Cross-provider duplicates cannot extend expiry. Revoked approvals and tightened retention immediately affect query predicates; the reviewed migration tightens stored TTL dates. TTL deletion is asynchronous and readers enforce expiry without waiting for it. Restricted sources default to 24 hours and remain disabled. Approved maximums are operator responsibilities, not inferred licensing rights.

Additive indexes: unique canonical identity; expiry TTL; published date/canonical tie-breaker; technology/date; search-term/date; source/date; category/date. Ordinary MongoDB multikey indexes support exact taxonomy and AND-of-synonym word/phrase groups without arbitrary regex or Atlas dependencies. The new model disables automatic index creation. `migrateNewsCatalog.js` defaults to a read-only inventory; explicit `--apply` creates declared indexes and idempotently copies only eligible metadata from the exact public pool/discovery namespace, while tightening catalog TTL dates. No destructive index synchronization, collection deletion or legacy record rewrite occurs.

`catalog-results.json` retains actual MongoDB 8.2 query plans: technology, free-text, source, category and date queries used IXSCAN, with 0–3 examined documents in the tiny controlled fixture. These results verify query shape/index compatibility, not production-scale capacity. Trending popularity sorts and combined/deep-offset queries still require deployed load review.

Public response reuse is bounded Memory → Redis → MongoDB. Five-second query entries include a durable per-technology version for taxonomy queries and global version for other queries, source/retention policy and normalized filters. Ingestion advances affected versions after persistence, so other workers abandon older entries. Expiry is absolute, including source/date boundaries. MongoDB version reads are intentionally retained for cross-worker consistency; Redis does not remove every database read. A Redis outage preserves Mongo browsing but fails provider admission closed. A catalog outage uses the existing bounded stale compatibility snapshots and reports `catalogUnavailable`; it cannot supply the complete historical window. Personalized ranking is applied after public cache resolution, and existing account-scoped frontend cancellation/reuse remains.

## Feed and refresh behavior

**For You:** canonical Developer Context, unchanged 50/30/20 ranking and honest skill evidence. Its redundant technology search control is hidden and the backend ignores For You search text. Date/source/category controls remain useful. Personalized ranking considers at most 2000 recent matching candidates by default; telemetry reports `rankingLimited` and pagination describes that bounded window when exceeded.

**Explore:** independent indexed public catalog search with backend totals and pagination, categories/sources and Today/Last 7 Days/Last 30 Days. It does not resolve account career signals and returns no personalized ranking/evidence. Trending, Latest, Bookmarks, Read Later and retained read/unread history remain available.

**Refresh Results:** client bypasses response reuse and sends `bypassCache=true`; backend bypasses catalog query reuse and reads current stored data. Admission is suppressed, including for an empty/gapped search. Zero external news calls.

**Check for New Articles:** sends `refresh=true`; the backend admits a deduplicated eligible query or general-feed worker job. Quotas/cooldowns cannot be bypassed. General-feed polling reads the same shared state without admitting more jobs. Successful duplicate-only results return `no_newer`, with the successful-check time, rather than claiming new articles. Worker/offline/loading/cooldown guards and the existing bounded polling lifecycle remain.

## Configuration and provider audit

The environment inventory grew from 81 to **102** ordered keys: two catalog settings, seven adaptive settings and twelve hourly provider-retention settings. `NEWS_DISCOVERY_PREWARM_TOPICS` remains explicitly deprecated/ignored. Both environment files have matching keys and immediate comments; existing parsed credentials/effective assignments were preserved. Shared Mongo/Upstash connection secrets remain global. Startup validates ranges/relationships/unknown/duplicate keys and reports missing/deprecated keys without values.

`TECH-NEWS-CONFIGURATION.md` contains the full provider-by-provider credentials, account/documentation links, approval flags, daily/monthly budgets, minimum intervals, capabilities, retention and activation steps. HN, DEV, GitHub and Kubernetes approvals were retained. Lobsters remains unapproved; Cloudflare remains unapproved with zero budgets. NewsAPI/GNews/Reddit remain unapproved with zero budgets regardless of credential presence. Current provider rights are not established merely by public access. GNews detailed terms and the particular DEV keyword route require operator/live-contract acceptance; Reddit token renewal/deletion obligations need support before activation where required. No paid or live news request was made by verification.

Operational metrics added to the existing registry cover accepted/new/duplicate/failed ingestion, cache-tier reads, provider admission/denial reasons, queue delay, catalog size and reviewed topic coverage. Size/coverage gauges update during adaptive evaluation and may remain stale if it is disabled. No account/raw-query metric labels are introduced.

## Focused verification

- Backend focused unit/contract suites: 42 passed after the added hourly-retention check.
- Isolated integration suites: 13 passed, zero skipped, using task-owned localhost MongoDB and password-protected Redis 7.2.7. Controlled adapter responses only. Covers scheduled ingestion, gap discovery, canonical overlap, concurrent upserts, history/date queries, refresh without provider calls, manual duplicate-only checks, quota denial, worker recovery, cross-worker visibility, index plans, saved ownership and history.
- Catalog migration dry run/apply was tested on the disposable database, including unchanged legacy pool records and idempotent insert count. No migration was applied to production.
- Frontend service/component tests, TypeScript no-emit, production build and controlled browser checks are recorded in the final validation results below.
- Browser evidence under `frontend/verification/tech-news/catalog`: desktop Light and mobile Dark; both refresh actions, For You search omission, Explore explicit discovery, read-only date changes, no overflow, zero runtime errors. API responses/artwork are synthetic and all external requests are intercepted.
- Retained build warning: unrelated landing-page SCSS is 55.89 kB against its 48 kB warning budget. No News budget warning was introduced.

## Finalization, inventory and remaining requirements

Initial Git status was clean. Existing historical reports, screenshots, fixtures and unrelated files were preserved. Changed sources were formatted with explicit paths using the installed frontend Prettier, then checked with the same options; backend uses single quotes/no trailing commas/110-column wrapping and frontend uses its existing configuration. Syntax, whitespace and affected validation were repeated after task cleanup. No repository source was moved or deleted. Temporary local servers/build material are removed only by verified task ownership; no destructive Git cleanup/reset is used.

The exact modified/added inventory is retained in `catalog-files.json`, including the ignored local `backend/.env`. Essential screenshots, scripts, fixtures, query plans and reports are retained. Final validation outcomes are in `catalog-validation.json`.

Production acceptance remains blocked on hosted Redis isolated write validation, reviewed deployed indexes and source rights, running deployed workers, live provider/feed contracts, deployed browser/API acceptance and capacity/load review. Retention below one hour and provider deletion-event requirements need further implementation if the operator's contract requires them. Existing compatibility caches still mirror metadata; removing them would require a separate Dashboard/legacy consumer migration. No hosted credentials, production data or locked modules were changed to bypass these requirements.
