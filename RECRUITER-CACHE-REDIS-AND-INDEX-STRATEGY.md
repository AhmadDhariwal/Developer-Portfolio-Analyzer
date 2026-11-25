# Recruiter cache, Redis and index strategy

The browser issues a new dashboard or analytics request per subscription. Recruiter responses set private, no-store. MongoDB remains authoritative for tenant policy, candidate permission, memberships and all job and pipeline records.

The shared Redis client can cache computed Recruiter analytics metrics and charts used by both dashboard and analytics. RECRUITER_SUMMARY_CACHE_TTL_SECONDS enables the cache. The default is disabled pending representative latency and request-frequency measurements. Positive TTL values are capped at 300 seconds. The versioned key includes the organization, recruiter, active team IDs, UTC day, and a SHA-256 digest of the MongoDB inputs used for the summary. Jobs, matching, shortlists, analysis events, membership and visibility changes invalidate affected computations by changing that identity. Expiry removes superseded entries. The code uses a shared five-second lock, one short wait on contention, bounded client commands and direct computation on outage. The path does not keep a process-local response cache. All instances apply the same input revision after recovery. Candidate details, dashboards with identifiable widgets, authorization and mutations bypass this cache.

This cache saves summary computation on a hit. It still incurs the MongoDB reads needed to establish freshness, and production benefit remains unmeasured. Candidate projections remain authoritative requests. Batch hydration reduces per-item queries for matches, shortlists, comparison, activity and dashboard widgets. Match generation uses a transactional bulk write.

| Query                            | Predicate and order to evaluate                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Recruiter jobs                   | Equality on organization and recruiter, descending updatedAt                                               |
| Recruiter matches and shortlists | Equality on organization and recruiter with optional job, descending updatedAt                             |
| Recruiter activity               | Equality on organization and actor, descending timestamp                                                   |
| Candidate visibility             | Role, explicit opt-in, active status and organization where applicable, with a deterministic User ID order |
| Evidence hydration               | User ID batches and descending evidence timestamps for historical collections                              |

The disposable HTTP suite includes executionStats for the scoped job list. Its fixture is a correctness sample. Independent Node processes verified cache hits across workers and fresh input handling on Redis recovery using a disposable Redis 7 server. Production selectivity, p95 latency and write cost need representative measurements before proposing compound indexes or rollout. No index migration was applied.
