# Tech News Hub backend finalization

STATUS: VERIFIED

READY FOR TECH NEWS FRONTEND: YES

## Scope and architecture

The starting Git working tree was clean. Reviewed the actual news routes, controller, cache/saved/circuit models, five provider adapters, formatter, ranker, canonical Developer Context and developer signals, Dashboard consumer, startup lifecycle, existing Redis TCP/TLS client, and Jobs Hub governance/verification patterns. No separate supplied Tech News architecture artifact was available in this checkout; the implementation is the architecture evidence. Backend only; no scoring engine, frontend, production record, dependency or endpoint changes.

The existing GET feed and Saved/Read Later routes and payload contracts remain compatible. Feed requests read a bounded shared public pool and rank at most 300 articles locally. Refresh/bypass query flags refresh canonical user signals; provider ingestion runs only in the background. Empty cold starts return the normal response envelope with `freshness: warming`, without invented articles or synchronous provider calls. No AI call is introduced into browsing.

Dashboard continues reading the existing NewsCache model, lastUpdated and trendingTopics fields. Public ingestion writes those fields even when nobody opens the news page. Existing personalized cache records and circuit documents are preserved and expire through their existing TTL indexes; no destructive migration is required.

## Provider governance and content

`newsGovernanceService` adapts the established Jobs Hub Lua patterns into an independent news namespace. Every HTTP attempt reserves an atomic daily and monthly budget, one concurrency slot and a provider minimum interval before sending. UTC quota counters expire at the next day/month boundary. Credits are never refunded after uncertain transport failures. NewsAPI and GNews use separate credentials; the former's existing platform-settings fallback is retained.

| Provider key | Default daily/monthly budget | Default interval | Additional activation                                                 |
| ------------ | ---------------------------- | ---------------- | --------------------------------------------------------------------- |
| hackernews   | 72 / 2200                    | 20 minutes       | None                                                                  |
| devto        | 72 / 2200                    | 20 minutes       | None                                                                  |
| newsapi      | 0 / 0                        | 20 minutes       | Content approval and explicit budgets                                 |
| gnews        | 0 / 0                        | 20 minutes       | Content approval and explicit budgets                                 |
| reddit       | 0 / 0                        | 20 minutes       | Content approval, explicit budgets, OAuth access token and User-Agent |

Configuration prefix is `NEWS_<PROVIDER_KEY_UPPERCASE>_`; supported settings are `DAILY_BUDGET`, `MONTHLY_BUDGET`, `MIN_INTERVAL_MS`, and `CONTENT_APPROVED=true` for restricted providers. Daily/monthly ceilings are bounded at 1000/30000, concurrency is fixed at one, and interval cannot be shorter than one minute. Set budgets below the actual account entitlement and reserve capacity for other consumers of the same account. These application budgets do not discover account billing limits.

Each provider HTTP call has a seven-second Axios timeout and AbortSignal deadline, zero redirects and a 2 MiB response cap. Each adapter handles at most 100 input entries; GNews requests ten results. A run issues at most one request per enabled provider, including one rotating Reddit subreddit. There are zero immediate retries: future scheduled attempts must pass admission again. This bounds retries without multiplying paid requests. Retry-After accepts seconds or HTTP dates; shared cooldowns cannot be shortened. Exhausted quota headers and 401/403 trigger cooldown; three failures in ten minutes open a five-minute circuit. When shared Redis admission is unavailable, ingestion fails closed; cached browsing remains available.

The NewsAPI Developer plan excludes staging/production use ([terms](https://newsapi.org/terms)); GNews free access is limited to non-commercial uses ([terms](https://gnews.io/legal/terms-of-service)); Reddit commercial access needs approval ([terms](https://redditinc.com/policies/data-api-terms)). Setting a configuration flag does not grant permission. Operators must verify subscription rights, content display/cache retention permissions and attribution obligations before enabling a restricted provider. Descriptions are bounded excerpts; adapters do not fall back to full article bodies, HN story text or Reddit selftext. Publisher names and attribution links are preserved as additive article fields. Synthetic category fallback images remain decorative; no article or engagement data is generated.

## Cache, ingestion and resilience

- Versioned `news:v3:public:pool` uses Memory -> existing Upstash Redis -> existing Mongo NewsCache. Memory holds one public snapshot for five seconds, including negative-cache misses; concurrent local reads share one promise. Redis and Mongo retain absolute expiry rather than refreshing source age on reads.
- Source freshness is twenty minutes; each source is eligible for a maximum twenty-four-hour stale window. Expired sources are removed on reads, independently of healthy sources. Overall retention follows the newest retained source; displayed freshness follows the oldest retained source. Partial failures preserve each source's last successful timestamp.
- A worker-safe startup scheduler checks every minute, with a 120-second token-owned distributed ingestion lease and a shared twenty-minute attempt pace. A failed or empty run is paced too. Per-provider quotas additionally prevent duplicate calls after worker failure or uncertain writes. Set `NEWS_INGESTION_ENABLED=false` on workers that should not ingest.
- Mongo persists before publication. Lease ownership is checked before persistence, Mongo conditional upserts reject older fills using attemptedAt, and Redis Lua verifies both lease ownership and snapshot version. Lock release is compare-and-delete. No wildcard cache invalidation is used.
- Refresh replaces only the versioned public pool. There is no personalized feed payload in Redis/Mongo, so no cross-account ranking cache can leak. Personalized signal resolution is bounded to 250 account entries and fifteen seconds, with in-flight deduplication. Existing profile/sprint invalidation hooks evict locally; refresh resolves current canonical signals. Other workers and other signal updates converge within fifteen seconds. Failed signal resolution falls back to general relevance.
- Normal feed requests never call upstream providers. Mongo failure can use valid Redis/memory articles; Redis failure can use Mongo/memory articles. If every cache is cold or beyond retention, warming is accurately reported rather than manufacturing content.

## Accuracy, personalization and security

URLs accept only HTTP(S) public hostnames, reject credentials, custom ports, IP literals and local/internal hosts, strip tracking parameters/fragments, and preserve path case. Article dates must be real, no more than five minutes in the future and no older than thirty days. Provider source names/categories are validated; titles, descriptions and list sizes are bounded. URL and normalized-title deduplication run before publication. Popularity is finite, non-negative, provider-reported data; absent engagement stays zero. Category/topic matching uses word boundaries.

Canonical Developer Context and persisted GitHub, active Resume, Skill Gap, Career Sprint, Job demand and recommendation signals are reused. Recommendations influence relevance without being labeled detected/proven skills. Experience-keyword prose is excluded from detected skills. Gap explanations, skill explanations and demand explanations require matching article evidence. Ranking keeps the exact relevance/recency/popularity 50/30/20 formula, captures one clock per ranking pass and uses stable ID tie-breaking. Trending and Latest keep their original sorting contracts.

Every route authenticates through the existing HS256 issuer/audience JWT middleware before account-scoped limits. Shared Redis request limits are 120 feed/saved reads, three refreshes and thirty mutations per minute per authenticated user, with expiring process-local fallback during Redis outages. Private/no-store headers prevent proxy/browser cross-account response reuse. Structured query injection, unknown keys and unbounded pagination are rejected. Saved fields reject structured values, safe URLs are reused, owner filters remain mandatory, and the existing unique `(userId,url,type)` index resolves concurrent saves idempotently. Repeated Read Later completion preserves its first readAt using an explicitly enabled Mongoose update pipeline. No token or raw provider exception is logged by news ingestion.

## Focused verification

Final focused run: **27 passed, 0 failed, 0 skipped** across:

- `backend/src/tests/newsHubHardening.test.js` — eight controlled tests covering quality, URLs, date validation, ranking weights/ties, recommendation-vs-detected evidence, no-provider feed/refresh behavior, account isolation, bounded partial failure, Mongo miss deduplication, stale/cold cache handling, expired-source pruning and query validation.
- `backend/src/tests/newsHub.integration.test.js` — two focused integration cases using a separate free disposable Upstash database over Redis TCP/TLS and a task-owned local MongoDB 8.2 process. Actual Lua validates 25 simultaneous admissions across two clients, concurrency, daily/monthly budgets and TTLs, Retry-After persistence, circuit opening, token-owned leases, request limits, shared pool publication, partial stale fallback, lost-lease protection and outage fallback. Actual Mongo validates indexes, cache upserts, Redis publication, older-fill rejection, absolute expiry, eight concurrent saves, JWT authentication, foreign-owner rejection, readAt idempotency and private response headers.
- `backend/src/tests/developerContextService.test.js` — fourteen existing canonical context regressions.
- `backend/src/tests/redisConnectionProbe.test.js` — three existing read-only probe and disposable-target safety regressions.

Configured application Upstash: the existing probe-only client returned `Redis: PONG` without writing a revision or application key. Write tests used the separate disposable endpoint with different credentials, a random `news-test:<UUID>:` namespace, two clients and exact-key cleanup. The disposable native client verifies Redis semantics; its latency does not establish production performance through the unchanged 150 ms command proxy. Mongo used only port 27129 and randomly named `news_hub_test_<UUID>` databases, which were dropped after verification. No application Mongo URI was loaded by those tests. No live provider/paid AI calls, full repository suites, frontend tests or exhaustive E2E were run.

After runtime cleanup, the 25 controlled/canonical-context/probe tests passed again with zero failures or skips; the two real-database cases had already passed in the final 27-test run before the isolated services were removed.

Finalization: explicit-path Prettier write and check passed for all fourteen changed JavaScript files. Backend source uses single quotes, no trailing commas, two spaces and width 120; `backend/index.js` retains its established four spaces/width 100. Report Markdown was also formatted and checked. All changed JavaScript passed `node --check`. `git diff --check` and `git diff --cached --check` passed. No source file was moved or deleted. No unrelated or pre-existing user work was removed.

## Exact retained file inventory

Modified:

1. `backend/index.js` — start/stop news ingestion with application lifecycle.
2. `backend/src/controllers/newsController.js` — strict saved inputs, safe URLs, pagination and idempotent readAt.
3. `backend/src/models/news.js` — additive publisher and attributionUrl fields.
4. `backend/src/routes/newsRoutes.js` — authenticated news-specific limits and private response headers.
5. `backend/src/services/newsService.js` — background-only providers, controlled HTTP, bounded signals and feed ranking from public snapshots.
6. `backend/src/utils/newsFormatter.js` — bounded validated metadata, attribution and non-fabricated dates/popularity.
7. `backend/src/utils/newsRanker.js` — honest evidence, single ranking clock and stable ties, unchanged weights.

Added:

1. `backend/src/middleware/newsMiddleware.js` — shared request limits and feed validation.
2. `backend/src/services/newsGovernanceService.js` — provider budgets, concurrency, cooldowns, circuits and leases.
3. `backend/src/services/newsPoolService.js` — shared layered cache, retained source health and fenced ingestion publication.
4. `backend/src/utils/newsUrl.js` — common public URL validation/canonicalization.
5. `backend/src/tests/fixtures/newsHubRedisFixture.js` — isolated TLS Redis fixture with target guards and exact-key cleanup, adapted from the existing Jobs Hub fixture.
6. `backend/src/tests/newsHubHardening.test.js` — controlled focused checks.
7. `backend/src/tests/newsHub.integration.test.js` — real isolated Mongo/Upstash and authenticated route verification.
8. `backend/verification/tech-news/REPORT.md` — this architecture, deployment and verification evidence.

## Deployment requirements and limits

Verify the existing unique cache/saved indexes and TTL index exist through the normal reviewed database deployment process; this task did not run production index synchronization. Preserve those indexes and existing records. Configure available Upstash TLS access, start at least one ingestion-enabled backend worker and allow the initial background fill. Confirm actual per-account provider subscriptions, permitted display/retention and budgets before enabling restricted sources. Configure NewsAPI via `NEWS_API_KEY` or the existing platform settings; GNews only via `GNEWS_API_KEY`; approved Reddit requires `NEWS_REDDIT_ACCESS_TOKEN` and `NEWS_REDDIT_USER_AGENT`, and token renewal is an operational responsibility.

Staging should validate its actual provider credentials and response entitlements, deployment region latency, worker lifecycle and desired freshness labels. Provider permissions and live response behavior were not certified by synthetic tests. Redis outages intentionally suspend ingestion; an outage longer than the stale window returns warming with no articles. Process-local rate-limit fallback multiplies across workers during Redis outages, but cannot spend provider credits. Canonical signal changes on other workers may take fifteen seconds to appear; explicit refresh resolves them immediately. The scheduler follows process uptime and is not a durable job queue. No backend implementation blocker remains within the verified scope.

## Cleanup evidence

The final integration run removed 30 isolated Redis keys (28 + 2), verified zero tracked keys remaining and dropped its random Mongo databases. The separate task-owned Mongo process was stopped after its command line and runtime path were checked. The free scratch Upstash database is empty of test-owned keys and expires automatically after 72 hours; it was not claimed. Temporary credentials and Mongo runtime artifacts were deleted only under the verified task-created directory. Exact deleted temporary file inventory:

- `backend/verification/tech-news/.runtime/mongo.log`
- `backend/verification/tech-news/.runtime/mongo.pid`
- `backend/verification/tech-news/.runtime/upstash-private.txt`
- `backend/verification/tech-news/.runtime/mongo/_mdb_catalog.wt`
- `backend/verification/tech-news/.runtime/mongo/collection-17a18af9-d4f8-4eed-916a-af1ab45204e0.wt`
- `backend/verification/tech-news/.runtime/mongo/collection-4b275103-c326-439b-a97b-6393bcacfab0.wt`
- `backend/verification/tech-news/.runtime/mongo/collection-5e2bffad-b551-4b7f-9ce9-1c1c6973d69a.wt`
- `backend/verification/tech-news/.runtime/mongo/index-18531f6d-1464-43c7-88e3-4b533f2b0c13.wt`
- `backend/verification/tech-news/.runtime/mongo/index-30ff878f-06a3-423b-84b2-a82137cd371e.wt`
- `backend/verification/tech-news/.runtime/mongo/index-6a4ac6ba-7fee-4664-930e-28ac8acfff6e.wt`
- `backend/verification/tech-news/.runtime/mongo/index-e4948e25-6c60-4fca-ab75-2f9e41733ab2.wt`
- `backend/verification/tech-news/.runtime/mongo/mongod.lock`
- `backend/verification/tech-news/.runtime/mongo/sizeStorer.wt`
- `backend/verification/tech-news/.runtime/mongo/storage.bson`
- `backend/verification/tech-news/.runtime/mongo/WiredTiger`
- `backend/verification/tech-news/.runtime/mongo/WiredTiger.lock`
- `backend/verification/tech-news/.runtime/mongo/WiredTiger.turtle`
- `backend/verification/tech-news/.runtime/mongo/WiredTiger.wt`
- `backend/verification/tech-news/.runtime/mongo/WiredTigerHS.wt`
- `backend/verification/tech-news/.runtime/mongo/diagnostic.data/metrics.2026-10-22T08-44-55Z-00000`
- `backend/verification/tech-news/.runtime/mongo/diagnostic.data/metrics.interim`
- `backend/verification/tech-news/.runtime/mongo/journal/WiredTigerLog.0000000001`
- `backend/verification/tech-news/.runtime/mongo/journal/WiredTigerPreplog.0000000001`
- `backend/verification/tech-news/.runtime/mongo/_tmp/spilldb/WiredTiger`
- `backend/verification/tech-news/.runtime/mongo/_tmp/spilldb/WiredTiger.lock`
- `backend/verification/tech-news/.runtime/mongo/_tmp/spilldb/WiredTiger.turtle`
- `backend/verification/tech-news/.runtime/mongo/_tmp/spilldb/WiredTiger.wt`
- `backend/verification/tech-news/.runtime/mongo/_tmp/spilldb/WiredTigerHS.wt`
