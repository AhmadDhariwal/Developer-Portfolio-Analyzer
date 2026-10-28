# DevInsight AI solution architecture charter

Permanent decision reference. Established 25 October 2026 for Scenario Simulator production finalization.

## Principles

1. Correctness and coherent ownership take precedence over isolated symptom patches.
2. Preserve the Angular/Express/MongoDB modular monolith, locked scoring rules and historical records.
3. Pure calculations use exact versions, immutable rule inputs and reproducible snapshots. New behavior requires a new version.
4. Evidence, self-claims, career intent and recorded activity remain distinct. Missing evidence is unavailable, never fabricated ability or inability.
5. Baselines are explicit confirmed planning assumptions. No new composite weights or statistical prediction claims are authorized.
6. Authentication establishes ownership; every persistence and integration lookup independently enforces it.
7. Database uniqueness and atomic document mutations enforce retries and concurrency. Process caches cannot establish correctness.
8. Bound reads, deadlines, admission and payloads. Add infrastructure only after measurement demonstrates its benefit.
9. Preserve compatible APIs through additive envelopes and legacy readers. Never destructively migrate history.
10. Acceptance requires integration, failure, concurrency and measured performance evidence as well as unit tests.
11. Finalize every stage with explicit-path formatting, cleanup of task-owned artifacts, relevant checks and an exact inventory.

## Approved coordination boundaries

The user's production-finalization request authorizes the reviewed Scenario changes and small additive Sprint provenance/receipt and Developer Signal intent fixes. Shared GitHub, Resume, portfolio, Skill Gap and Sprint scoring formulas remain locked. Existing downstream response fields remain compatible. Any broader scoring policy change or destructive migration requires a separate reviewed decision.

## Stage gates

| Stage | Gate                                                                                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0    | Characterize legacy outputs/defects and API/index contracts before engine changes                                                                          |
| P1    | Exact legacy parity; v2 invariants, strict assumptions, isolated source failures and immutable snapshots pass                                              |
| P2    | Owned exports with durable replay and calendar semantics; intent isolation and typed frontend state pass                                                   |
| P3    | Disposable Mongo/index/concurrency, two-worker, failure/load, authenticated browser and final frontend/backend checks pass or explicit blocker is recorded |

Do not advance past a failed correctness gate. Infrastructure unavailable for acceptance is a blocker, never an implicit pass. Deployment readiness is separate from local implementation readiness.

## Decision log

- ADR-01: Adopt the target in `SCENARIO-SIMULATOR-ARCHITECTURE-REVIEW.md`; no additional service, database, queue or mandatory Redis.
- ADR-02: Preserve legacy numerical behavior behind an exact legacy engine; opt-in `scenario-planning-v2` fixes canonical ordering, valid zeros, strict validation and effort units.
- ADR-03: Context reads existing records once, with source-specific status/provenance and bounded work. No external reanalysis on simulation requests.
- ADR-04: Insert-only evaluations use existing user/hash uniqueness; historical records remain untouched. Authoritative history revalidates Mongo.
- ADR-05: One proposal builder supports explicit draft/active export. Receipt and resulting work commit atomically in the existing Sprint document.
- ADR-06: Use existing optional shared infrastructure only when configured and verified. Otherwise report multi-instance quota enforcement as a production blocker.

Stage results, exact files, measurements and rollback instructions are retained under `backend/verification/scenario-simulator/`.

## Implementation decision updates

- ADR-07: V2 uses plan-only calculation context. Source observations inform suggestions and provenance, not numerical baselines or claimed confidence. This makes evaluations reproducible during dependency outages without storing unrelated private evidence.
- ADR-08: Retain the existing unique user/hash index and use insert-only snapshots. A measured cursor-index experiment justified `{userId,createdAt,_id}`: 20 rows examined instead of 1,000. Production creates that index explicitly after a read-only audit; no data migration or automatic index deletion is authorized.
- ADR-09: Preserve self-reported completed work as recorded activity. The compatibility completed-skill field remains present but does not assert proficiency.
- ADR-10: Export receipts persist for the Sprint lifetime with a hard 128-receipt limit; source-item provenance is capped at 500. Reject at capacity rather than losing retry protection through eviction.
- ADR-11: Reuse existing optional Redis for atomic shared quotas. Production fails closed when it is unavailable; local fallback requires an explicit single-instance deployment setting.
- ADR-12: Mutation target lookup uses owned active-window references, not the display overview. Export cannot implicitly execute inactivity/streak updates.
- ADR-13: Abort source operations only for deadlines/cancellation, never after successful completion. Retain failed capacity evidence and rerun the original workload after corrections.
- ADR-14 (final): MongoDB is always the sole integration admission authority for counters, cooldowns and leases through the existing transaction-capable connection. Redis is optional caching, selected explicitly by environment (local Redis in development, Upstash TLS in deployment), and cannot own integration admission counters. The earlier selectable Redis/Mongo implementation is superseded; `INTEGRATION_GOVERNANCE_STORE` no longer selects an authority. Rollout requires draining legacy Redis-governed workers and preserving outstanding budgets/cooldowns. Mongo admission failures remain fail-closed; other modules and policy limits are unchanged.
- ADR-15: Credential-free LeetCode, numeric Stack Overflow and explicit Dev.to observations may reuse versioned, public-only Mongo snapshots for five minutes. Never share OAuth/private data, ownership or account scores; normalize and persist each account independently. Mongo leases and generation fencing coordinate fetches, with bounded local single-flight/waiting and no stale-on-error reads. Reuse consumes the existing account request budget; only actual outbound attempts consume provider budgets. Redis is not required on this path. Batch governance commands only inside the existing atomic transaction; retain all policy limits and documents.

P0/P1/P2 correctness gates passed their focused checks. P3 local persistence, worker restart, browser and short-load evidence is retained; deployment-equivalent soak, live shared-service verification and production topology/index confirmation remain release gates. Passing local tests never overrides those gates.
