# Tech News smart discovery backend

Historical implementation report. Its topic limits and frontend verification gate are superseded by [TOPIC-COVERAGE.md](./TOPIC-COVERAGE.md), including the Redis verification finalization acceptance decision. The original status and evidence below are retained as history; remote write verification remains a separate deployment requirement.

STATUS: BLOCKED

READY FOR TECH NEWS DISCOVERY FRONTEND: NO

Backend implementation and controlled/isolated-Mongo verification are complete. The remaining verification gate is execution of the new atomic queue/Lua test against a separate disposable Upstash endpoint. NEWS_TEST_REDIS_URL is not configured; the application Redis database was not used for write testing. A configuration question was raised during implementation. No source has been enabled or approved by this task.

## Architecture and actual behavior

Reviewed AGENTS.md, backend REPORT.md/CONTRACT-FIX.md, frontend REPORT.md/CONTRACT-INTEGRATION.md/PAGINATION.md and the actual news routes, controller, cache models, ingestion scheduler, provider governance, normalization and ranking. The previous architecture is retained: normal feed requests read cached data and canonical account signals, never fetch providers or call AI. The existing once-per-minute ingestion scheduler now also processes one discovery job through the existing distributed lease infrastructure.

Discovery supports exactly 16 public topics: javascript, typescript, react, angular, vue, node, python, rust, golang, docker, kubernetes, security, sql, postgres, llm and linux. Exact normalized aliases include node.js/nodejs, go lang and postgresql. Arbitrary searches still work against cached feed articles; unsupported discovery queries are never sent upstream. No account ID, resume, skill evidence, private repository, raw user query or credential enters the public job/cache keys.

When fewer than six articles match the complete filtered cached set (before pagination), coverage classifies the result:

- sufficient: at least six matches, including when the requested page itself is empty.
- general_pool: no explicit topic query; existing scheduled broad ingestion remains responsible.
- unsupported_query: the query has no allowlisted discovery topic.
- restrictive_filters: a source restriction, high-popularity threshold, today-only window, incompatible category, or sufficient broader cached topic coverage makes further discovery inappropriate. Filters are never silently relaxed.
- source_exhausted: a selected source's last successful ingestion reported zero articles; this describes that bounded ingestion result, not the source's entire archive.
- coverage_gap: an eligible topic has low broader coverage and broad enough filters. A category consistent with the existing category classifier, such as React/Frontend, remains eligible.

Only genuine gaps with discovery enabled and at least one explicitly approved/budgeted source can enqueue work. Repeated queries, aliases, filter combinations, pagination and different accounts converge on one shared topic job. Each feed merges at most 300 existing public articles with at most 40 articles from its selected topic, then uses unchanged server filtering, deterministic 50/30/20 ranking, skill-evidence projection and pagination. No additional articles are fabricated or promised.

## Sources and permissions

All discovery providers default to zero budgets and require NEWS*DISCOVERY_ENABLED=true plus NEWS*<KEY>\_CONTENT_APPROVED=true and positive DAILY_BUDGET/MONTHLY_BUDGET values. Existing platform newsEnabled=false also disables discovery. Flags do not confer content rights: operators must approve their intended metadata display/retention and upstream terms before activation.

| Key              | Source / bounded request                                                                                                                           | Metadata retained                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| hackernewssearch | Existing HN Algolia Search, now with one normalized topic and a 30-day date constraint, maximum 30 stories                                         | Original title/URL/date, HN discussion attribution and reported points; no story body                    |
| githubreleases   | Public releases from fixed topic/repository mappings, maximum 20 entries; no user-selected repository or token                                     | Repository/release name, original release link/date; drafts/prereleases excluded; no release body/assets |
| githubadvisories | Public reviewed GitHub advisories, maximum 30 entries, ecosystem where applicable; headline must independently match the topic                     | Summary headline, GitHub advisory link/date; withdrawn entries excluded; no advisory body                |
| lobsters         | Official public per-tag RSS, maximum 40 metadata entries; tags verified against the official tag catalog and results filtered locally to the topic | Original title/link/date and discussion attribution; no HTML body, votes or invented engagement          |

All targets are fixed HTTPS URLs. Requests use seven-second Axios and AbortSignal deadlines, no redirects, one MiB response limits, no account credentials, no immediate retries and sequential fallback. The conservative RSS reader accepts bounded RSS metadata, rejects DTD/entity declarations and malformed item boundaries, and never resolves entities or fetches embedded links. No package dependency was added.

Primary references checked:

- [HN Search API and published limits](https://hn.algolia.com/api).
- [GitHub public release API](https://docs.github.com/en/rest/releases/releases), [global advisory API](https://docs.github.com/en/rest/security-advisories/global-advisories), [rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) and [API terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#h-api-terms).
- [GitHub Advisory Database license](https://github.com/github/advisory-database/blob/main/LICENSE.md).
- [Lobsters public RSS documentation](https://lobste.rs/about) and [supported tags](https://lobste.rs/tags). Public RSS availability alone is not represented as blanket republication permission.

## Quota, queue and cache safeguards

- Existing atomic provider daily/monthly quotas, concurrency slots, minimum intervals, shared circuits and Retry-After handling apply to every discovery attempt. Independent discovery budgets do not alter existing paid-provider budgets. HN broad/search adapters and GitHub release/advisory adapters propagate upstream 429/403/exhausted-header cooldowns to their sibling, preventing fallback from bypassing an upstream limit.
- Daily/monthly configuration ceilings remain 1000/30000, concurrency one, default interval 20 minutes. GitHub discovery adapters have a hard five-minute per-adapter floor (at most 24 requests/hour combined, before further budgets/cooldowns); Lobsters has a ten-minute floor; HN discovery has a one-minute floor. Operators must reserve capacity for other users of the same upstream IP/account.
- Versioned news:v1:{discovery} keys use atomic enqueue/claim/commit scripts, at most 16 pending topics and a global daily job budget of 12 by default (NEWS_DISCOVERY_DAILY_JOBS, clamped to 1–48). Existing authentication and account feed/refresh/mutation rate limits are unchanged. The topic allowlist bounds distinct user-induced keys regardless of account/filter permutations.
- One 90-second token-owned global discovery worker lease; one job per scheduler tick; maximum four sequential provider attempts per job. Fallback stops once six distinct URLs have been collected across sources. Queue jobs retain a two-minute visibility deadline for recovery after a worker crash. Queue keys expire after one hour. Lost lease tokens cannot publish state/data or remove another worker's job.
- State deduplication/retry suppression: ready 30 minutes, completed empty searches two hours, quota-limited one hour, source/persistence failure five minutes. A global daily-job denial becomes eligible again at the next UTC day. Provider governance remains authoritative even after a discovery-state retry time passes. No uncertain attempt is refunded or automatically replayed locally.
- Public topic articles follow bounded Memory → existing Upstash client → MongoDB storage. Memory/inflight/state maps have at most 16 topic entries; reuse/miss windows are five seconds. Topic documents retain at most 40 normalized articles for at most six hours per source's actual successful fill. Partial/empty failures do not renew retained source ages. URL/title deduplication, safe URLs and existing 30-day/future-date checks apply. Reads remove expired/unapproved sources and preserve accurate remaining-source timestamps.
- NewsTopicCache reuses the existing news article schema and unique cacheKey / expiresAt TTL indexes in a separate collection. This is necessary because Dashboard selects the newest general NewsCache document: topic documents must not become its general-news result. Existing records, indexes, Saved/Read Later data and Dashboard behavior are untouched. Mongo persists before Redis publication; conditional attemptedAt upserts and token-owned Redis commits reject older/lost fills.
- Redis unavailable: cached Mongo/memory browsing remains usable; enqueue and provider admission fail closed. Persistence failure retains the previous cache and reports unavailable. No raw provider exception, credential or private context is included in statuses/logs.

## Additive API contract

GET /api/news retains all previous fields and adds:

```json
{
  "coverage": {
    "status": "coverage_gap",
    "topic": "react",
    "cachedMatches": 0,
    "minimum": 6
  },
  "enrichment": {
    "status": "queued",
    "reason": "background_discovery",
    "nextEligibleAt": null
  }
}
```

Enrichment status is not_needed, disabled, queued, searching, ready, exhausted, quota_limited or unavailable. Completed attempts may also include lastAttemptAt and a public sourceHealth array containing provider key/status/articlesFound. Cached topic fills add telemetry.discoveryDiagnostics; existing freshness/lastUpdated/providerUsed incorporate contributing topic data. Existing source filter normalization additionally recognizes GitHub Releases, GitHub Security Advisories and Lobsters.

nextEligibleAt is the earliest time to reconsider **discovery queue admission** after the relevant state cooldown, not a promise of an upstream request, completion or new articles. It is null while queued/searching or when no retry time is established. Provider quotas/circuits can still deny admission. exhausted means the attempted configured sources returned no usable topic articles during that bounded attempt; it does not mean every upstream page has been searched. ready means a fill was cached, not that all current filters will match it. General searches without an eligible topic continue to rely on the ordinary ingestion pool.

## Focused verification

Final controlled command:

`node --test backend/src/tests/newsDiscovery.test.js backend/src/tests/newsHubHardening.test.js backend/src/tests/newsContract.test.js backend/src/tests/newsPagination.test.js`

**22 passed, 0 failed**: eight discovery cases plus fourteen existing focused contracts. Covers classification, compatible/incompatible categories, unapproved budgets, upstream sibling cooldown propagation, 30 concurrent-shaped queue requests, no queueing of restrictions, cache miss deduplication, Mongo fallback, expired/unapproved data, controlled adapters, HTTPS/timeouts/no redirects/no credentials, RSS DTD rejection, 429, sequential fallback/early stop, completed-empty results, quota/unavailable states, lost ownership, failed persistence, bounded deduplication/stale age, unchanged ranking/pagination/provenance and account separation. Actual queue Lua is not validated by these controlled Redis doubles.

`node --test backend/src/tests/newsDiscovery.integration.test.js` with NEWS*TEST_MONGODB_URI pointing only to a task-owned MongoDB 8.2 process at localhost:27129: **one passed, one skipped**. The actual Mongo test verifies topic collection separation, unique/TTL indexes, persisted public-only fills, cold-worker Redis-outage fallback and source/document expiry. A random news_discovery_test*<UUID> database is dropped, the process is stopped, and its checked task-owned temporary directory is removed. Initial sandbox loopback/background-process restrictions were resolved by running startup/test/shutdown together outside the sandbox.

The **skipped disposable Upstash case is the remaining blocker**. It is retained with guarded isolated-target setup and exact-key cleanup. It exercises actual Lua queue deduplication, queue/global/provider budgets, worker contention, negative-cache TTL, shared upstream cooldowns, lease fencing and crash recovery. Run it with a separate disposable endpoint using NEWS_TEST_REDIS_URL and NEWS_TEST_REDIS_DISPOSABLE=true; the fixture rejects the configured application endpoint/credentials. No real Upstash queue verification is claimed.

All nine changed JavaScript files passed explicit-path Prettier write/check (single quotes, no trailing commas, width 120) and node --check. This report passes formatting. Working-tree/staged Git whitespace checks pass. No frontend changes, paid API calls, application provider requests, production database writes, full suites or browser matrices occurred. Documentation references were browsed separately from controlled ingestion tests.

## Exact file inventory

Modified:

1. backend/src/controllers/newsController.js — additive coverage/enrichment projection.
2. backend/src/services/newsService.js — topic-cache merge/coverage, new source names and scheduler hook; unchanged ranking/filter/pagination engines.
3. backend/src/services/newsGovernanceService.js — approved source keys, conservative floors and sibling upstream cooldowns.
4. backend/src/utils/newsFormatter.js — permit the three additional attributed source names.

Added:

1. backend/src/models/newsTopicCache.js — reused article schema in an isolated public-topic collection.
2. backend/src/services/newsDiscoveryProviders.js — finite topic mappings, controlled public source adapters and safe metadata normalization.
3. backend/src/services/newsDiscoveryService.js — bounded topic cache, coverage decisions and distributed background queue/worker.
4. backend/src/tests/newsDiscovery.test.js — eight controlled discovery tests.
5. backend/src/tests/newsDiscovery.integration.test.js — isolated Mongo and disposable Upstash checks.
6. backend/verification/tech-news/DISCOVERY.md — this report.

No source files moved/deleted; no dependency/lockfile changed. Task-owned Mongo runtime files were cleaned after verification; historical reports and screenshots were preserved.

## Deployment and limitations

Before enabling discovery: pass the disposable-Upstash verification gate; approve provider usage/content permissions; set explicit budgets and the feature flag; deploy/verify the topic collection's existing-pattern unique/TTL indexes through the normal reviewed process; and run at least one existing ingestion-enabled worker. No approval/configuration was changed here.

Coverage is intentionally conservative and finite. No arbitrary topic/repository search, upstream pagination crawl, full article/advisory body ingestion or live AI generation is added. New source results appear only through the matching topic's cached pool, rather than rewriting the general ingestion pool. Redis outage prevents enrichment while retaining useful cached browsing. Final frontend integration must consume the additive states without treating queued/ready as a guarantee of more matching articles.
