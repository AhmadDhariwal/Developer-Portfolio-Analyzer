# Tech News environment configuration

Updated: 23 October 2026. Full implementation and evidence: [SEARCH-FINALIZATION.md](SEARCH-FINALIZATION.md).

For a new installation, copy [backend/.env.example](../../.env.example) to `.env` and
supply your own credentials. For existing installations, merge missing keys; never replace
credentials, database URLs, JWT secrets or encryption keys. Startup loads `backend/.env`.
Mongo uses `MONGODB_URI`; Redis uses native TCP/TLS, with `REDIS_URL` taking precedence
over `UPSTASH_REDIS_HOST`, `UPSTASH_REDIS_PORT` and the database password in
`UPSTASH_REDIS_TOKEN`. Upstash REST credentials are not interchangeable with these fields.

All 115 original parsed local values and their original file bytes were preserved. The
configuration work appended 41 absent settings, for 156 unique local keys. The example
has 158 unique keys and covers every local key without copied live credentials. Existing
approvals, budgets, prewarming, other integrations and data were preserved. Legacy
`AUTH_COOKIE_NAME`, `JSEARCH_RETRIES` and `BRUTE_FORCE_LOCKOUT_MS` remain documented
for compatibility; they have no current runtime consumers. Do not rotate the settings
encryption key or its JWT-secret fallback during this upgrade.

## Active policy

These application ceilings do not establish upstream entitlements. Existing public-metadata
approvals were reused. No paid provider or unapproved feed was enabled.

| Adapter                   | Daily / monthly |   Interval | State                                                     |
| ------------------------- | --------------: | ---------: | --------------------------------------------------------- |
| HN broad pool             |       72 / 2200 | 20 minutes | Existing implicit permission                              |
| DEV broad pool            |       72 / 2200 | 20 minutes | Existing implicit permission                              |
| HN Algolia keyword search |        12 / 300 |   1 minute | Existing approval retained                                |
| DEV keyword search        |        12 / 300 |   1 minute | Existing approval retained                                |
| GitHub Releases           |         6 / 150 | 20 minutes | Existing approval; mapped public repositories only        |
| GitHub Advisories         |         6 / 150 | 20 minutes | Existing approval; security queries only                  |
| Kubernetes Blog           |         4 / 100 | 20 minutes | Existing approval; relevant taxonomy feed only            |
| Lobsters                  |     0 effective | 20 minutes | Approval false; existing nominal 6 / 150 preserved        |
| Cloudflare Changelog      |           0 / 0 | 20 minutes | Implemented optional RSS adapter; approval false          |
| NewsAPI / GNews / Reddit  |           0 / 0 | 20 minutes | Explicitly disabled; credentials preserved                |
| arXiv                     |      No adapter |        N/A | Research proposal only; commented settings have no effect |

HN and DEV use their public keyword APIs. GitHub news adapters do not send `GITHUB_TOKEN`
or account integration tokens. Platform `newsEnabled=false` overrides the news flags.

Shared upstream ceilings now sum the existing sibling counters atomically, preserving usage:
`NEWS_HACKERNEWS_SHARED_*` and `NEWS_DEVTO_SHARED_*` are 84/day, 2500/month, one minute;
`NEWS_GITHUB_SHARED_*` is 12/day, 300/month, five minutes. These shared limits supplement
each adapter's independent budget, concurrency, interval and cooldown. No counter migration
or reset is needed. Reserve capacity separately for consumers outside this application.

## Admission, cache and worker

- `NEWS_INGESTION_ENABLED=true` starts the worker in an ingestion-enabled backend process.
  `NEWS_DISCOVERY_ENABLED=true` allows approved discovery. Restart through the normal
  deployment process to load updated code and environment; no application process was restarted here.
- The broad scheduler stays at one minute. Discovery has its own five-second heartbeat/poll
  and an asynchronous immediate wake after admission. HTTP requests never await provider I/O.
- `NEWS_DISCOVERY_DAILY_JOBS=12` stays unchanged. Startup validates 1..48; use the feature
  flag, not zero, to disable discovery. Queue capacity is sixteen. Daily counters reset at UTC midnight.
- Per-account new-job admission defaults to `NEWS_DISCOVERY_USER_MINUTE_JOBS=3` and
  `NEWS_DISCOVERY_USER_DAILY_JOBS=6`. Reads of shared queued/cached results do not consume
  another job. Existing feed/refresh/mutation request limits remain 120/3/30 per minute.
- Prewarming retains `devops,kubernetes,security,ai` and four admissions/day within the same
  twelve-job global budget. It is checked hourly. Disable prewarming or set its daily jobs
  to zero to reserve job capacity for user activity; it is not a separate provider allowance.
- Fresh query lifetime: `NEWS_QUERY_FRESH_TTL_MS=1800000` (30 minutes). Source stale retention:
  `NEWS_QUERY_STALE_TTL_MS=86400000` (24 hours). Negative suppression:
  `NEWS_QUERY_NEGATIVE_TTL_MS=300000` (five minutes). Reads never renew source freshness.
- `NEWS_QUERY_MEMORY_ENTRIES=128` bounds LRU/expiry-managed local maps; local cache reads and
  state reuse last five seconds. In-flight cache reads/admissions are bounded. Redis/Mongo
  query cardinality is bounded by global admission, queue capacity and absolute expiry.
- `NEWS_DISCOVERY_RESULTS_PER_PROVIDER=30` caps primary search responses at thirty; live
  verification used five. A worker attempts at most four adapters sequentially, includes
  approved primary keyword sources, and applies relevance/date/URL validation before publication.
- Source concurrency is one. GitHub has a five-minute interval floor, Lobsters ten minutes,
  other sources one minute. Discovery HTTP has a seven-second deadline, one-MiB body cap,
  zero redirects and no immediate retries. Redis admission failure prevents upstream calls.
- Startup validates news flags and numeric bounds rather than silently accepting malformed settings.
  Endpoints, repositories and feed URLs remain fixed in reviewed backend code.

No frontend provider credentials or URLs were added. Explore accepts bounded meaningful
technical phrases outside the forty-topic taxonomy. Personalized evidence and 50/30/20
ranking, Dashboard's separate public pool and saved reading history remain intact.

## Verification targets and rollout

`NEWS_TEST_REDIS_URL` and `NEWS_TEST_MONGODB_URI` are blank in the template. Use separate
localhost runtimes for write tests. Remote disposable Redis tests additionally require
`NEWS_TEST_REDIS_DISPOSABLE=true` and different application credentials/host. Never reuse
application Redis for test writes. `NEWS_TEST_BROWSER=true` opts into the isolated browser
integration test; `NEWS_TEST_LIVE_PROVIDERS=true` opts into one bounded request per approved
primary after a read-only quota preflight. The live fixture uses isolated quota counters
and Mongo storage; it does not write application counters or certify concurrent production usage.

Application Redis PING/read-only multi-key Lua and existing Mongo index definitions were
checked. Actual HN metadata reached isolated Mongo and cache; DEV responded successfully
with no accepted matches for the selected query. Isolated HTTP/worker/cache/browser tests
passed with controlled upstream articles. Hosted write/lease testing against an authorized
staging endpoint and a single deployed live-provider-to-Angular acceptance run remain
production deployment gates. See the final report for exact evidence and file inventory.
