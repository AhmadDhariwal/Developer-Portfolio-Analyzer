# Tech News production search and discovery finalization

Date: 23 October 2026

**STATUS: VERIFIED — implementation, isolated service E2E and approved live-provider checks.**

**READY TO LOCK TECH NEWS IMPLEMENTATION: YES**

**READY FOR PRODUCTION DEPLOYMENT: NO**

Hosted write validation and deployed acceptance remain explicit deployment gates below. This
report does not describe a completed production rollout or claim that synthetic browser
articles are live news. Earlier reports/screenshots remain historical evidence.

## Root cause and implemented behavior

Previously `topicFor('generative ai')` returned null and coverage classified it as
`unsupported_query`, so no provider job could run. DEV used tag lookup instead of keyword
search, and admitted jobs waited for the broad minute scheduler. The forty-topic taxonomy
remains intact for categories, aliases, fixed repository/feed relevance and prewarming;
free-text discovery no longer requires taxonomy membership.

A separate query utility accepts meaningful technical phrases of 2–80 characters, at most
six tokens and thirty-two characters per token. It normalizes case/spacing and selected
aliases, rejects URLs, email/identifier-like input, control characters and search operators,
and produces fixed-length hash keys for free text. Multiword matching requires every
meaningful concept, with bounded local synonyms such as AI/artificial intelligence,
async/asynchronous and vulnerability/security. It never expands into additional HTTP calls.
Only explicit public search text enters provider requests; no profile, resume, skill evidence,
user ID or integration token is sent upstream. Explore stays independent of career signals.

The flow is now:

1. Read the shared general pool and normalized query snapshot: Memory → Redis → Mongo.
2. Apply date/source/category/popularity and semantic query matching before totals/page slicing.
3. If coverage is insufficient, atomically deduplicate and admit one shared public job within
   queue, account and global limits. Cached results/status return immediately.
4. Wake the running discovery worker asynchronously; a separate five-second poll/heartbeat
   serves other workers and restart recovery. Provider requests never run in the feed handler.
5. Reserve distributed provider/shared-upstream quota, fetch bounded public metadata from
   fixed endpoints, validate/deduplicate it, persist and publish under lease/version fencing.
6. The existing bounded cancellable Angular revalidation reads newly cached results. Pagination,
   draft keystrokes and filter changes do not directly call providers or force ingestion.

## Provider capability and configuration

| Source                   | Capability and effective configuration                                                                                        | Verification in this task                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| HN Algolia               | Real `search_by_date?query=...`, story/date constraint; existing approval, 12/day and 300/month, one minute                   | One live request capped at five hits; one accepted recent `generative ai` article persisted and read from cache |
| DEV/Forem                | Public `/api/articles/search?q=...&top=30`; existing approval, 12/day and 300/month, one minute                               | One live request capped at five results; HTTP succeeded, no accepted `Python async` metadata matches            |
| GitHub Releases          | Fixed mapped public repositories only; existing approval, 6/day and 150/month, twenty minutes                                 | Controlled transport/filter checks; no live request                                                             |
| GitHub Advisories        | Reviewed advisories only for actual security/vulnerability queries; existing approval, 6/day and 150/month, twenty minutes    | Controlled checks; no live request                                                                              |
| Kubernetes Blog          | Relevant fixed RSS ingestion via scheduled taxonomy/prewarm discovery; existing approval, 4/day and 100/month, twenty minutes | Controlled RSS/attribution checks; no new live request                                                          |
| Cloudflare Changelog     | Optional fixed RSS metadata adapter implemented; approval false and budgets zero                                              | Disabled; no live metadata request or entitlement claim                                                         |
| Lobsters                 | Existing fixed tag RSS adapter; approval false; prior nominal 6/150 preserved but ineffective                                 | Remains disabled                                                                                                |
| NewsAPI / GNews / Reddit | Existing credentials retained; explicit false approvals and zero budgets                                                      | Never called or activated                                                                                       |
| arXiv                    | Evaluated as research, excluded from general-news ingestion and source lists; proposal comments only                          | No adapter or calls; separate research labeling/permission review required                                      |

Capability references: [HN Search API](https://hn.algolia.com/api),
[Forem keyword-search API](https://developers.forem.com/api/v1),
[Forem keyword/semantic distinction](https://developers.forem.com/semantic-search),
[Cloudflare RSS catalog](https://developers.cloudflare.com/fundamentals/new-features/available-rss-feeds/).
Forem semantic search requires authentication; this implementation uses its public keyword
endpoint and sends no API key. Feed availability alone does not approve reuse. arXiv papers
would need a separately labeled research flow rather than being presented as breaking news;
[its API terms](https://github.com/arXiv/arxiv-docs/blob/develop/source/help/api/tou.md) distinguish reusable descriptive metadata from individual full-text rights. No full texts would be copied without the applicable rights.

Existing HN and DEV broad pool defaults were made explicit at 72/day, 2200/month and twenty
minutes. Shared family quotas now atomically sum the existing sibling counters, without
resetting usage: HN/DEV families each 84/day and 2500/month with a one-minute shared interval;
GitHub family 12/day and 300/month with five minutes. Source and sibling concurrency/cooldowns
are checked in the same Lua reservation. These ceilings supplement independent adapter
budgets; no adapter can bypass its budget by switching to its sibling. Other applications
sharing the upstream account/IP must have capacity reserved by the operator.

## Admission, protection and worker behavior

- Existing authenticated feed/refresh/mutation request limits remain 120/3/30 per minute.
  New shared new-job limits default to three/minute and six/day per account. User identifiers
  are hashed only for admission counters and are absent from queue jobs, article snapshots
  and provider parameters. Quota denials for one account are not cached as public query state.
- Global jobs remain twelve/day, including up to four daily prewarm admissions for the existing
  DevOps/Kubernetes/security/AI selection. Queue capacity remains sixteen, with oldest eligible
  work claimed first. Different accounts/aliases share one normalized query job.
- A token-owned ninety-second worker lease, 120-second visibility timeout, expiring reservations,
  atomic claim/publication and attemptedAt-fenced Mongo upserts preserve crash recovery and
  stale-write protection. Worker heartbeats expire after twenty seconds; absent heartbeats yield
  `worker_unavailable` rather than pretending a queue is operational.
- Dedicated worker polling is five seconds, with an immediate asynchronous wake on new admission.
  The original broad pool scheduler stays at one minute. No broad ingestion is triggered per search.
- Discovery requests retain seven-second Axios/AbortSignal deadlines, one-MiB response bounds,
  zero redirects and zero immediate retries. At most four eligible adapters run sequentially;
  both approved keyword primaries can contribute before optional feed fallback stops.
- Existing Retry-After, quota-header cooldowns and circuit breakers remain in effect and now
  constrain sibling admission as well. Redis quota failure denies upstream calls; cached Mongo
  browsing remains available. No in-memory provider quota fallback exists.
- Startup validates configured news flags, budgets and cache limits. News configuration does not
  introduce user-controlled upstream URLs, credentials, paid activation or an AI enrichment call.

## Storage and cache behavior

The existing `NewsCache` public pool, `NewsTopicCache` collection and saved-item structures
are reused. No new query collection or article database migration is needed. Query lookups
use a unique bounded cache key, then filter at most forty embedded normalized query articles
alongside the existing bounded general pool. This makes publication dates/source/category
checks and pagination totals deterministic over available indexed results without regex scans.
Canonical URLs/IDs and normalized-title deduplication still run across providers.

Query memory maps now have configurable LRU/expiry bounds (128 default, 40–256 allowed),
five-second local reuse and bounded in-flight reads/admissions. Source retention is absolute,
24 hours by default; fresh search suppression is thirty minutes and empty-result suppression
is five minutes (30 seconds–15 minutes configurable). Cache reads never refresh source age.
Redis/Mongo query cardinality is bounded by global admissions and absolute expiry. Expired
articles and sources no longer approved by policy are excluded on reads.

Mongo retains unique `cacheKey` and TTL `expiresAt` indexes. The topic schema adds
`{ filters.topic: 1, expiresAt: 1 }` for normalized-topic/expiry lookup and disables disconnected
write buffering. Worker writes have a one-second server deadline and two-second driver timeout.
Mongo persistence precedes Redis publication; both reject stale owners/versions. Redis and
Mongo are not claimed to form a cross-store transaction.

Read-only configured Mongo inspection confirmed existing unique/TTL indexes for both public
cache collections and the saved unique owner/URL/type and owner/type/date indexes. The new
compound topic index was verified on isolated Mongo and is not yet present in the configured
application database. Deploy it through the normal reviewed index/startup procedure.

Dashboard still reads its separate general pool. Personalized evidence resolution and the
50/30/20 ranking formula are unchanged. Saved/Read Later ownership, read/unread history and
server timestamps survive the search changes; no existing application data was migrated.

## API and Angular behavior

Responses distinguish cached/sufficient coverage, queued, searching, ready, exhausted,
quota-limited, disabled, source-unavailable, worker-unavailable and infrastructure-unavailable
states. Safe last-attempt/source diagnostics and next-eligible times remain available; a queued
job is never labeled complete. Telemetry lists actual sources contributing to the filtered set.
A successful empty source search differs from an unavailable source or rejected reservation.

This Week stays seven days. Broader cached matches are counted separately, with explicit
Show This Month and broader source/category/popularity actions; neither changes filters until
selected. Enter submits free text. The existing four-check lifecycle is cancellable across
account/view/page changes and retains 429, visibility and offline guards. Only active work or
brief admission outages are polled; source failures/worker downtime do not create retry loops.
All six views, Manrope/indigo styling, Light/Dark/System, numbered navigation, attribution and
license links remain in the existing components. No frontend-direct provider access was added.

## Verification evidence and limits

- **38 controlled backend checks passed**: query validation/aliases/phrases, source capabilities,
  policy validation, quotas failing closed, expiry/negative cache, transport safety, partial
  failure/429/cooldowns, worker fencing, Explore independence, unchanged ranking, provenance,
  pagination and account isolation. These tests make no live provider calls.
- **8 isolated integration checks passed**, including the nested saved-history checks. Actual
  Redis Lua verifies shared queue admission/concurrency/visibility, provider/shared quotas,
  per-account minute/day limits and fencing. Actual Mongo verifies unique/TTL/compound indexes,
  source expiry, conditional writes, cold cache reads and reading-history concurrency/ownership.
- The new authenticated HTTP round trip submits twelve identical searches across two real test
  accounts: one shared job, no synchronous provider HTTP, then a running worker publishes fifteen
  controlled articles. Fourteen are within This Week; page two contains two, while This Month
  contains fifteen. A separate worker/process cache read sees the shared fill. Cached repeat,
  pagination and browser filter changes make no additional provider requests.
- **43 Angular service/page tests passed** in the focused suites, including free-text submission,
  explicit widening, worker/source outage copy, bounded revalidation, account cancellation,
  server pagination and retained saved/evidence contracts. Final source checks/build are recorded
  in the finalization manifest.
- Chromium used the actual authenticated news API and isolated Redis/Mongo, with controlled
  upstream articles and other shell API fixtures. Desktop Light and mobile System/Dark exercised
  rendered search results, explicit date widening, zero extra provider calls, no page errors and
  no mobile overflow. [Desktop evidence](../../../frontend/verification/tech-news/search-service-e2e.png)
  and [mobile evidence](../../../frontend/verification/tech-news/search-service-e2e-mobile-dark.png)
  are test data, not live-news screenshots.
- [Live provider evidence](search-live-results.json): one actual HN request produced the recent
  article “NLnet Publishes More Stringent Generative AI Policy” (HN timestamp 2026-10-21T19:06:10Z), which
  the real governed worker persisted in isolated Mongo and read back from cache. One actual
  DEV keyword request completed with zero accepted matches. These calls used five-result caps,
  existing approvals/budgets and read-only application quota preflight, with writes confined to
  isolated Redis/Mongo. Production counters were not written/reset. The initial conservative
  preflight made zero requests before its sibling-interval check was corrected to match policy.
- [Configured infrastructure evidence](search-infrastructure-results.json): actual application
  Redis PONG and cross-key read-only Lua succeeded; existing Mongo index definitions were read.
  No application key/document/index was written by diagnostic or test code. Normal application
  background activity, if running independently, was not stopped or used as test storage.

No full repository regression suite was run. A Vitest sandbox cache-rename restriction required
running the same focused command outside the sandbox. A browser fixture initially selected the
wrong theme-storage key; the fixture was corrected to use the application's System preference.
The existing unrelated landing-page SCSS production budget warning remains (55.89 kB vs 48 kB).

## Remaining production deployment gates

1. Restart/deploy the updated backend and frontend together, retaining the existing secrets and
   at least one ingestion-enabled worker. Deploy/confirm the additional topic compound index.
2. Execute hosted Redis write/lease/TTL/quota validation on an explicitly authorized safe staging
   endpoint. Local Redis execution plus hosted PONG/read-only Lua do not certify hosted writes.
   No application Redis test keys or counter resets are authorized or performed here.
3. Run one deployed cold live-provider → worker → Mongo/shared cache → Angular acceptance case
   under that environment's actual quota reservations. The live upstream/cache check and browser
   service E2E above are separate tests; they are not represented as one production browser run.
4. Review region latency and actual shared upstream entitlements before rollout. Cloudflare,
   Lobsters, arXiv and restricted commercial providers remain outside the enabled production scope.

## Finalization and exact file inventory

Changed source files were formatted in write mode with explicit paths, then checked using the
same options: backend single quotes/no trailing commas/width 120, frontend `frontend/.prettierrc`.
Markdown/JSON evidence was formatted and checked separately. Dotenv and Git ignore files have
no configured Prettier parser; dotenv parsing, key uniqueness, value preservation, secret
exclusion, whitespace and tracking rules were checked directly. JavaScript syntax, TypeScript,
focused tests, the production build and working-tree/staged Git whitespace checks are recorded
in [search-finalization.json](search-finalization.json).

The manifest lists every modified/added file and every removed task-owned runtime file by exact
path. It includes ignored `backend/.env` explicitly. No source or user file was moved/deleted;
only the command-line-verified task-owned Redis/Mongo runtime directory was removed after
retaining evidence and dropping the randomly named test databases. Previous reports, fixtures,
source assets and screenshots were preserved. No dependency or lockfile changed.
