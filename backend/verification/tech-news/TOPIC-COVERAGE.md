# Tech News topic coverage and source activation

Date: 22 October 2026 (Asia/Karachi)

STATUS: VERIFIED

READY FOR TECH NEWS DISCOVERY FRONTEND: YES

PRODUCTION REMOTE REDIS WRITES VERIFIED: NO

Implementation and the existing 35 focused tests passed. Under the Redis verification finalization acceptance policy, isolated real local Redis Lua verification combined with existing read-only Upstash PONG/TLS evidence is sufficient for frontend development. No application blocker was found in the compatibility and failure-path audit. Remote Upstash writes remain unverified and require separate staging/deployment validation; they are not a frontend prerequisite. No new URL, account, database or credentials are required for this acceptance decision.

Previously authorized temporary local Redis and Mongo instances were tested and removed. Application Upstash was contacted only through read-only PING/probe-only initialization. No application test keys were created. This finalization performed no network probes, provider calls or database writes.

This report supersedes the 16-topic and local queue-verification limitations of DISCOVERY.md; that historical report and prior frontend/backend evidence are retained.

## Search and personalization contracts

- Existing GET `/api/news` requests retain personalized behavior and the unchanged 50/30/20 ranking engine. For You, Trending, Latest, bookmarks, read/unread history and ownership endpoints are preserved.
- Additive `mode=explore` supports independent technical interests on the existing authenticated route. For example: `/api/news?mode=explore&search=DevOps&date=month&page=1&limit=12`. Explore skips canonical career-signal lookup, returns `recommendedBasedOn: null`, empty personal skill evidence/match arrays and null personal rank/relevance scores. It orders by publication date and stable ID; with tab=trending it orders first by actual popularity. No personal score is fabricated or replaced with a new scoring engine. Response `mode` identifies the selection. Omitted mode remains personalized; invalid mode returns 400.
- Search uses topic aliases against cached titles/descriptions/tags when recognized. An unknown technical query can still find literal matches in the existing cache; it is never forwarded as an arbitrary upstream query. Unknown discovery coverage remains explicitly unsupported rather than manufacturing a result.
- First-page coverage gaps enqueue shared background jobs. Pagination can only read existing job status; it cannot create a discovery job or call providers. Filtering, ranking and page slicing still operate server-side over the available cache. Subsequent reads see worker-published results without a synchronous upstream fetch.
- Explicit `refresh=true` can revalidate a recognized topic older than thirty minutes on page one, using the existing refresh rate limit and shared topic cooldown. It never bypasses quotas or forces a provider request. Ordinary navigation does not request revalidation. Queued/searching/exhausted/quota-limited/unavailable/ready states retain their documented non-guarantee semantics.

## Working bounded taxonomy

`backend/src/utils/newsTopics.js` is the shared extensible registry, capped at 64 topics and currently containing 40:

javascript, typescript, react, angular, vue, node, python, rust, golang, docker, kubernetes, devops, cicd, cloud, aws, azure, gcp, terraform, gitops, argocd, ansible, observability, linux, security, devsecops, ai, ml, llm, pytorch, tensorflow, sql, postgres, redis, mongodb, kafka, java, dotnet, gitlab, githubactions and webassembly.

Aliases include CI/CD, continuous integration/delivery/deployment, k8s, Amazon Web Services, Microsoft Azure, Google Cloud, cybersecurity, artificial intelligence, Node.js, PostgreSQL and GitHub Actions. Optional trailing "news"/"updates" is normalized. Topic categories, relevant term groups, fixed release repositories and approved feed tags live together. Request input cannot expand this registry, introduce a repository/URL, or create unbounded cache keys. DevOps matches relevant Kubernetes/Terraform/Docker/GitOps/observability stories even when their headline does not contain the literal word DevOps.

## Source activation and permissions

Backend `.env` is updated, remains Git-ignored, and was parsed/checked without exposing credentials. Existing API keys, application Redis credentials and test-endpoint values were preserved. These are **configured activation states**, effective when the backend reloads configuration; controlled test success is not a claim of live upstream reachability.

| Source/key                                 | Configured state                                                                                                                                                    | Daily/monthly budget                                | Interval                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------- |
| HN Algolia topic search / hackernewssearch | Approved public metadata API; enabled                                                                                                                               | 12 / 300                                            | 1 minute                                  |
| Dev.to tag discovery / devtosearch         | Existing public metadata adapter reused; enabled                                                                                                                    | 12 / 300                                            | 1 minute                                  |
| GitHub Releases / githubreleases           | Public fixed repositories, release identity/date/link only; enabled                                                                                                 | 6 / 150                                             | 20 minutes, with a hard five-minute floor |
| GitHub Advisories / githubadvisories       | Reviewed public advisory headlines, attribution/license; enabled only for relevant security/ecosystem topics                                                        | 6 / 150                                             | 20 minutes, hard five-minute floor        |
| Kubernetes official blog / kubernetesblog  | CC BY 4.0 feed metadata; enabled for related topics                                                                                                                 | 4 / 100                                             | 20 minutes                                |
| Lobsters RSS / lobsters                    | Adapter complete; remains inactive because deployment republication permission was not established                                                                  | 6 / 150 configured but ineffective without approval | 20 minutes, hard ten-minute floor         |
| NewsAPI / GNews                            | Keys present; production/content rights not established, effective budgets zero; no verification calls                                                              | 0 effective                                         | Existing policy                           |
| Reddit                                     | No configured access token/User-Agent; not approved/active                                                                                                          | 0 effective                                         | Existing policy                           |
| AWS official feed                          | Evaluated; not enabled. Public RSS availability does not resolve AWS site restrictions on commercial extraction/reuse                                               | None                                                | None                                      |
| GitLab official feeds                      | Evaluated; not enabled. Release feeds have moved to docs and use Atom; blog/release licensing and attribution handling must be verified for the intended deployment | None                                                | None                                      |

`NEWS_DISCOVERY_ENABLED=true` and prewarming are configured. Existing platform newsEnabled=false still overrides activation. Broad HN and Dev.to adapters retain their original budgets. Governance prevents configured but unapproved/zero-budget paid providers from being attempted and reports them disabled rather than pretending they suffered an outage. No paid source was activated.

Every discovery request still has a seven-second HTTP deadline, one MiB response cap, zero redirects, fixed HTTPS targets, sequential fallback and no immediate retries. At most four adapters are attempted per job; fallback stops after six distinct URLs. Dev.to uses its public tag API through the existing formatter. Kubernetes uses `https://kubernetes.io/feed.xml` through the bounded metadata-only RSS reader. Article/advisory bodies and release assets are not ingested. Kubernetes and GitHub advisory metadata carry additive `license`/`licenseUrl` fields, persisted by the existing article schema. Future frontend attribution should retain the original link/publisher and supplied license information.

Primary references reviewed: [HN Search API](https://hn.algolia.com/api), [Forem public article API](https://developers.forem.com/api/v1), [GitHub releases API](https://docs.github.com/en/rest/releases/releases), [GitHub advisory database license](https://github.com/github/advisory-database/blob/main/LICENSE.md), [Kubernetes website CC BY 4.0 license](https://github.com/kubernetes/website/blob/main/LICENSE), [Kubernetes blog reuse guidance](https://kubernetes.io/docs/contribute/blog/guidelines/), [AWS site terms](https://aws.amazon.com/terms/), [AWS feed documentation](https://aws.amazon.com/new/), and [GitLab official feed workflow](https://handbook.gitlab.com/handbook/marketing/product-and-technical-marketing/developer-advocacy/tools-and-platforms/workato/). Availability of an API/feed is not represented as a license to copy full third-party articles.

## Cache, workers and measured Redis correction

- Shared topic coverage remains Memory → Upstash → Mongo, with at most forty articles per topic and five-second local reuse/miss windows. Retention is now bounded to twenty-four hours per successful source fill; stale failures cannot renew source age. The forty-topic registry bounds current memory/storage keys, and the registry's hard ceiling is 64. Expired/unapproved sources are excluded on reads. The topic collection stays separate from the Dashboard general pool.
- Topic Mongo reads skip disconnected drivers, apply a 300 ms server limit and a 350 ms local deadline. A stalled topic query cannot hold a normal feed indefinitely; bounded negative memory reuse prevents immediate repetition.
- Queue capacity remains sixteen jobs, with a default twelve global jobs/day, token-owned leases, visibility deadlines, negative-cache cooldowns, atomic quota admission and shared upstream cooldowns. Dev.to broad/search adapters now share upstream cooldowns just like HN and GitHub siblings.
- Prewarming checks hourly through the existing scheduler and a distributed lease. It considers at most four normalized popular topics, currently DevOps/Kubernetes/security/AI. A separate shared counter caps prewarm admissions at four/day, included within the global twelve-job budget, reserving remaining capacity for user discovery. Fresh coverage is reused. No per-account background queue or personalized cache is introduced.
- A read-only direct Upstash diagnostic returned PONG, while the existing generic proxy reported unavailable. Two direct round trips measured 159 ms each, exceeding its fixed 150 ms command deadline. The shared getter now offers an optional bounded commandTimeoutMs; only news cache/governance/rate-limit callers opt into 1000 ms. Existing callers retain their 150 ms deadline and behavior. The news-scoped probe then returned PONG against configured Upstash using probe-only initialization (no revision/key writes). Tests verify both the preserved default and longer opt-in deadline. No locked scoring/module behavior was changed.

## Focused verification and cleanup

**35 passed, zero failed, zero skipped in the available final test runs**:

1. `node --test backend/src/tests/newsTopicCoverage.test.js backend/src/tests/newsDiscovery.test.js backend/src/tests/newsHubHardening.test.js backend/src/tests/newsContract.test.js backend/src/tests/newsPagination.test.js backend/src/tests/redisConnectionProbe.test.js`: **33 passed**. Includes eight new taxonomy/Explore/revalidation/prewarm/latency cases, source transport/license checks and existing ranking, provenance, pagination, ownership validation, quota and fallback contracts. Paid/source HTTP is controlled; no live news-provider requests were used for verification.
2. `node --test backend/src/tests/newsDiscovery.integration.test.js` with temporary localhost Redis and Mongo: **two passed**. Actual Redis Lua verifies concurrent enqueue/claim, provider/global budgets, negative-cache TTLs, upstream sibling cooldowns, lease fencing and crash recovery. The added cold DevOps case queues a miss, runs a controlled worker, publishes a shared topic fill, then returns it through Explore with no career lookup/provider HTTP in the feed. Actual Mongo verifies unique/TTL indexes, topic/general collection isolation, public persistence, cold-worker fallback and expiry.

The Redis runtime was pinned portable Redis for Windows 5.0.14.1 from its [maintainer release](https://github.com/tporadowski/redis/releases/tag/v5.0.14.1), bound only to localhost:27130 for test execution, never installed as a service or production dependency. MongoDB 8.2 used localhost:27129 and a random news_discovery_test database, dropped after the test. The final run removed 56 owned Redis keys and verified zero remaining. Both processes were stopped and their checked task-owned temporary folder removed. The temporary Upstash access-check tab was closed at its sign-in screen; no account/resource was created.

This is **actual Redis Lua verification and actual Upstash read-only connectivity verification**, not an Upstash-hosted queue write test. Remote write validation remains a separate staging/deployment requirement, with a separately authorized safe validation target and procedure. A disposable Upstash endpoint is no longer mandatory for frontend acceptance. Application Redis was never substituted for the isolated test target. Existing test-target safety guards remain unchanged.

Explicit-file Prettier write/check, JavaScript syntax checks and working-tree/staged Git whitespace checks pass. Redis infrastructure/probe files retain width 100 and no trailing commas; news files use width 120 and no trailing commas. No full repository suites, frontend tests/builds, browser matrices, production database changes or paid calls were performed. No dependency/lockfile changed. Historical reports/screenshots and pre-existing staged changes were preserved; no source files were moved/deleted.

## Implementation file inventory (preceding topic-coverage task)

Modified:

1. `backend/.env` (ignored/private) — reviewed source activation, safe budgets/intervals and bounded prewarming; existing credentials preserved.
2. `backend/src/controllers/newsController.js` — additive mode response and null Explore context.
3. `backend/src/middleware/newsMiddleware.js` — mode validation and news-scoped Redis deadline.
4. `backend/src/models/news.js` — additive attribution license fields, inherited by topic storage.
5. `backend/src/services/newsDiscoveryProviders.js` — shared taxonomy, Dev.to/Kubernetes adapters, topic-aware selection/queries and license metadata.
6. `backend/src/services/newsDiscoveryService.js` — categories, retention/read deadlines, pagination-only status, controlled revalidation and bounded prewarming.
7. `backend/src/services/newsGovernanceService.js` — new governed sources, shared Dev.to cooldown and news Redis deadline.
8. `backend/src/services/newsPoolService.js` — news Redis deadline only.
9. `backend/src/services/newsService.js` — independent Explore, alias matching, source-policy diagnostics and prewarm scheduling.
10. `backend/src/services/redisCacheService.js` — optional bounded per-caller command deadline; existing defaults preserved.
11. `backend/src/tests/newsDiscovery.integration.test.js` — accurate Redis/Upstash target label and controlled cold DevOps round trip.
12. `backend/src/tests/newsHubHardening.test.js` — provider-policy dependency in the existing controlled ingestion fixture.
13. `backend/src/tests/redisConnectionProbe.test.js` — verify opt-in deadline/default compatibility.
14. `backend/src/utils/newsFormatter.js` — Kubernetes source and normalized license metadata.

Added:

1. `backend/src/utils/newsTopics.js` — bounded forty-topic taxonomy and shared aliases/matching.
2. `backend/src/tests/newsTopicCoverage.test.js` — eight focused checks.
3. `backend/verification/tech-news/TOPIC-COVERAGE.md` — this report.

## Redis verification finalization audit

The finalization reviewed the discovery enqueue/claim/searching/commit scripts, provider admission/release/cooldown/counter scripts, public pool publication, shared Redis client, scheduler error handling and isolated test fixture. No confirmed compatibility or runtime defect required a source change.

- The configured interface is the existing native Node Redis client over TLS, not a REST client. Scripts use its `eval(script, { keys, arguments })` contract with string arguments. Commands are standard Redis string, counter, expiry and sorted-set operations: GET/SET with NX/EX/PX, DEL/EXISTS, INCR, PTTL/PEXPIRE/PEXPIREAT, ZADD/ZREM/ZCARD/ZSCORE/ZRANGEBYSCORE/ZREMRANGEBYSCORE. Health reads use MGET. Pool publication uses Redis Lua's existing `cjson.decode`. The isolated Redis 5 runtime executed the queue/governance scripts successfully. This is a static interface compatibility assessment plus local functional evidence, not proof of hosted command permissions or remote multi-key EVAL behavior.
- News commands retain a 1000 ms caller deadline; the generic default remains 150 ms. Connection attempts have a 3000 ms socket timeout and bounded reconnect attempts. Offline command queuing is disabled. A command deadline cannot cancel an already transmitted write: uncertain admission is denied, reservations are never refunded, and there is no local queue/provider fallback or immediate retry. Atomic topic admission, the shared daily counter and existing queue membership prevent duplicate admission when a timed-out enqueue actually succeeded.
- Queue claims have a 120-second visibility deadline and the worker has a token-owned 90-second lease. Claim, searching-state and result publication scripts check ownership atomically; lease release compares the token. Publication updates state, removes the job and writes the topic snapshot in one EVAL. Lost ownership cannot publish a Redis result or populate worker memory through that commit. Mongo persistence checks ownership before writing and uses an attemptedAt condition to prevent an older attempt overwriting a newer snapshot. Redis/Mongo are not represented as a cross-store transaction.
- Redis admission errors fail closed before provider requests. Provider reservations retain atomic budgets/concurrency/interval controls, bounded HTTP timeouts, shared cooldowns and expiring slots. Scheduler failures are caught. Feed requests read bounded local/Redis/Mongo snapshots; Redis read failures preserve Mongo fallback and source-age/expiry checks. Pagination never admits discovery work. No keys, quotas, cache contracts or scheduling behavior changed.
- Existing evidence covers concurrent enqueue/worker claims, queue capacity, provider/global budgets, cooldown TTLs, lease fencing, visibility recovery, source expiry and cold Mongo fallback. The 33 controlled tests and two actual local integration tests were reused without rerunning them. No source code changed, so additional tests or JavaScript syntax checks were unnecessary in this documentation-only finalization; the preceding passing syntax results remain applicable.

Finalization changes only `backend/verification/tech-news/TOPIC-COVERAGE.md` (current acceptance decision and audit) and `backend/verification/tech-news/DISCOVERY.md` (historical-report pointer). Explicit-file Prettier write/check and working-tree/staged Git whitespace validation pass. No files were moved or deleted, no temporary artifacts were created, and all preceding staged work was preserved.

## Remaining deployment requirements

Before claiming production remote Redis writes verified, separately validate hosted EVAL/multi-key execution, write permissions, TTLs, lease behavior and latency under an authorized staging/deployment procedure. PONG/TLS does not prove these capabilities. This limitation does not block frontend integration; no application Redis test writes are authorized or performed by this task. Restart/deploy the backend to load the new source settings; retain normal reviewed index deployment practices. Future frontend work should opt into mode=explore and display truthful coverage/enrichment/license metadata. AWS, GitLab, Lobsters and paid providers require the permissions/activation decisions listed above; their inactivity is deliberate and does not prevent the approved public sources from serving supported topics.
