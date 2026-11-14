# Developer Dashboard follow-up acceptance — 2026-11-12

## Decision

Local implementation and verification are complete except for the **trusted history producer/schema approval**, which remains pending. Production acceptance is **BLOCKED**. No deployment, commit, push, merge, secret change, index addition, dependency addition or historical-data migration was performed.

Source/current branch: `fix/dashboard`. Integration target: not applicable (no PR requested). Baseline HEAD: `3ca9e333723367ddb3b4b7b210d5f2c2d62ef165`; the worktree/index were clean at preflight. Earlier audit evidence remains in the parent folder.

## Implemented consistency contract

`dashboardConsistencyService` canonicalizes and fingerprints projected source facts, including identity, values, records, timestamps and revisions. It compares two complete reads and retries one pair when they differ. Four reads are the maximum; continued changes return HTTP 409 / `DASHBOARD_EVIDENCE_CHANGED` with Retry-After instead of a mixed successful response. Content comparison catches deletion and same-millisecond value changes; it does not depend solely on a maximum timestamp. This is practical bounded optimistic validation, not distributed transaction isolation or a promise that no write can occur after validation.

The scope includes owner, case-insensitive escaped GitHub identity, active career/experience and selected owned resume identity. Score-affecting caches use that scope. Personal activity such as the latest saved Sprint is owner-scoped and labeled as such; Jobs/News remain shared public catalog signals, not personalized evidence. Dependency age comparison now uses actual millisecond order rather than a one-second tolerance.

Summary charts and all progress widgets use this same validated snapshot. Independent contribution/language calls no longer introduce a later snapshot into the main page. The six existing routes remain available. Existing frontend cancellation, lifecycle protection and authenticated in-flight sharing remain covered.

Dashboard's content revision belongs to Dashboard. Its optional canonical `dependencySignalHash` is left empty rather than publishing a different algorithm into the shared developer-signal cache. Existing mutation services retain invalidation ownership; normal page entry/refresh reads durable evidence across API processes. There is no new response TTL cache or Redis requirement. No mounted-page push subscription was introduced.

## Query design and budgets

- Three overlapping AnalysisCache reads become a single owner/profile-prefiltered `$facet` with narrowly projected scoring/skill/action data. Existing indexes are reused; maximum execution time is 1.5 seconds and disk spill is disabled. Full shared developer-signal aggregation is removed from the Dashboard read path.
- Learning counts are aggregated in MongoDB with bounded status groups and five recent completion titles; arbitrary course records/notes are not transferred to Dashboard memory.
- Integration analytics counts every matching sync in the selected 1–30-day window. `$topN` retains only two measurements per known provider, preferring successful records. Response/group state is bounded to nine providers and two retained measurements each. The database must still scan qualifying window records for exact counts; it has a 1.5-second budget and no disk spill. Budget exhaustion returns 503, never truncated counts presented as complete.
- History scans are bounded to the latest 32 `portfolio_score` versions using the existing owner/source/version index, with bounded scalar score projection and a 1.5-second query budget. Caller-authored archive payloads are not transferred wholesale.
- No index was added: retained plans and fixture cardinalities do not justify write amplification or production index provisioning. The facet still filters/scans owned cache rows and can sort within facets. Representative high-cardinality evidence remains required.
- Per-request source fan-out still produces pool queues. Two fixture processes each used maxPoolSize 10; pool checkout/wait peaks and failures are retained in local-acceptance.json. No production pool setting was changed based on fixture data.

## Data and scoring corrections

Unknown GitHub username provenance or a missing usable source revision cannot establish current evidence. Legacy records are preserved and excluded; nullable counters and empty contribution data replace synthetic zero signals. Missing readiness is nullable, and a GitHub-health fallback is labeled explicitly. Missing resume percentages remain null rather than becoming zero. A current portfolio score of zero remains measured zero.

Recorded portfolio effective weights are displayed when the scorer has renormalized weights around unavailable inputs. Nominal stack weights remain the fallback model explanation. The established stack weights and positive-integration 85/15 blend are unchanged. Dashboard does not reconstruct project impact or industry readiness from unrelated repository counts or GitHub health. Canonical scoring breakdown nulls remain null.

The normal server-resolved portfolio POST previously used a resume cache key incompatible with Dashboard's selected-resume key. `analysiscontroller` now uses the same owned selected-resume identity and canonical Skill Gap coverage in normal profile mode. Client-supplied preview evidence keeps a separate legacy cache identity and cannot become a canonical selected-resume assessment. Explicit POST generation behavior remains separate from Dashboard GETs; no GET calls GitHub or AI. Unit tests and the local two-process end-to-end harness exercise this producer-to-reader path.

Freshness now distinguishes durable saved Resume/Sprint/Learning/Report facts from short-lived feeds. News uses its existing 20-minute policy; Skill Gap uses its seven-day cache horizon plus dependency checks; Recommendations/GitHub retain daily age guidance. Jobs must pass their own freshUntil/validThrough/visibility predicates. One canonical freshness map drives source metadata, availability and evidence completeness. Durable facts are labeled Saved evidence, not falsely described as newly refreshed.

## New or enhanced widget contracts

| Widget                         | Authoritative provider and deterministic meaning                                                                                           | States / cache and scope                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Comparable portfolio readiness | dashboardHistoryService; only server-provenanced assessments with the same owner/profile/resume/rule, deduplicated by assessment hash/time | Reader and typed graph/accessible table implemented; actual trusted producer/schema remains approval-blocked. Unknown/user-authored history is excluded.          |
| Sprint velocity                | Latest owned Sprint tasks; recorded completion counts and points in seven UTC calendar days; canonical weighted progress remains separate  | Missing Sprint is unavailable; undated/invalid completions are excluded and disclosed; source snapshot revision drives refresh. UTC weekday regression is tested. |
| Skill evidence                 | Current canonical Skill Gap classification; proven versus claimed-not-proven counts, without a new coverage formula                        | Unknown classification remains unavailable; existing Skill Gap coverage widget is reused rather than duplicated.                                                  |
| Evidence completeness          | Available/current-valid/stale/missing counts over the ten declared source families; aliases are not double-counted                         | Explicitly source availability, not developer quality or calibrated confidence.                                                                                   |
| Learning completions           | Owned UserCourseProgress; at most five recorded completed course titles/dates                                                              | Counts remain user-entered/self-reported; absent completion dates are not invented.                                                                               |
| Integration connectivity       | Owned connected IntegrationConnection records plus exact sync attempt totals from the bounded aggregation                                  | Loading/error/zero-connections states; historical sync data does not establish current ownership or skill verification.                                           |
| GitHub activity/languages      | Projected verified Analysis facts embedded in the validated summary                                                                        | No additional secondary request; unavailable identity is explicit. Repository history remains unsupported when username/rule provenance is absent.                |
| Career actions                 | Existing scoped Skill Gap, Recommendations, Sprint, Jobs and public News data                                                              | Existing workflows/links preserved; missing Skill Gap evidence is not described as no skill gaps.                                                                 |

New Angular contracts are in `shared/models/dashboard.model.ts`; feature-local components live under `pages/dashboard/components/`. New charts include exact accessible tables, keyboard-operable details, chronological spacing, UTC day labels, theme tokens and no motion-dependent interaction. Loading/stale/error/missing/zero states are explicit.

## Important history trust finding and approval blocker

The legacy 25-day AnalysisCache lookup has been removed; seven-day caches are not durable trend history. However, merely switching to AIVersion was insufficient: `aiversioncontroller.createAiVersion` accepts user-authored outputs, source names and metadata. Those fields cannot authenticate a scoring assessment. The local harness submits such an archive through the real API and confirms it cannot fabricate a trend.

The Dashboard reader requires a top-level server-owned producer marker, resolved identity, assessment time/hash and matching scoring rule. Existing schema/producer contracts do not write that proof. Therefore readiness history stays unavailable rather than promoting legacy archives. No legacy row is backfilled or relabeled. Cached copies would deduplicate by the assessment hash/time rather than falsely becoming new assessments.

An additive optional AIVersion provenance field and server-only producer handoff are described in [PROVENANCE-DESIGN.md](PROVENANCE-DESIGN.md). Approval was requested because AGENTS.md explicitly says, **"Never change APIs, dependencies, or schemas without approval."** The optional schema/producer extension has not been performed without an answer. All other local work continues independently. Repository trend provenance also remains unavailable for legacy GitHub history; no identity is inferred from the current username.

## Monitoring

`prometheus-alerts.yml` now compares `dpa_http_request_duration_ms_bucket` with **1800 milliseconds**, matching its existing 1.8-second annotation and five-minute alert duration. The error-rate policy is unchanged. A focused regression validates metric-unit/threshold alignment. Prettier parses the YAML successfully. Promtool and a running Prometheus instance were not available; deployment and live alert evaluation remain external gates. Configuration was edited locally only, not deployed.

## Upstream contract review

GitHub and Resume remain the owners of saved analysis. Skill Gap owns evidence coverage and requirement versions; its source contract is used directly (the feature guide's older v6 description is not treated as the actual v9 producer contract). Recommendations own action snapshots. Sprint owns points/completion/timestamps. Learning owns self-reported progress. Jobs/News own public freshness predicates. Integrations own persisted insights/connections/logs. Weekly Reports retain their distinct scoring semantics and are not silently substituted for portfolio readiness. Notifications remain recipient-owned and Dashboard GETs create no notifications. Team/recruiter/admin scopes remain separate.

Both directions were checked: Dashboard consumes persisted evidence and never mutates these sources during GETs; their existing writers/client invalidators continue to clear dependent state. The portfolio producer's canonical identity mismatch was corrected without changing its established scoring weights. No controller cycle or duplicated coverage formula was introduced. Existing backend/frontend cross-module regressions are included in validation.json.

## Acceptance evidence

Exact current timing, throughput, operation counts, payloads, index plans, aggregation state and connection-pool observations are in [local-acceptance.json](local-acceptance.json). The parent local-acceptance.json is the retained before baseline: 27 summary operations, four page requests, 7,824 bytes, p95 352 ms. These are synthetic observations, not a controlled production capacity experiment; the new fixture also includes 5,000 integration rows, forged archives and an explicit portfolio producer POST. Payload growth reflects the added facts, not duplicate requests.

Final PASS/FAIL/BLOCKED results and command summaries are in [validation.json](validation.json). Source/index/worktree checks and exact changed paths are in [file-inventory.json](file-inventory.json). Native fixture data is verified task-owned, stopped and cleaned by the harness; final screenshots and JSON plans remain. No source files were moved or deleted.

External BLOCKED gates: approved staging URL/account; representative real-data load, index write overhead and pool saturation; multi-host API/multi-member Mongo failover and distributed outage tests; live Prometheus rule evaluation. The local loopback tests do not replace these gates. The history schema/producer approval is a separate explicit local blocker. Production readiness is not claimed.

## Final measured acceptance

| Gate                                       | Result                                                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Backend Dashboard and upstream regressions | PASS: 109 tests, 108 passed, one existing optional replica configuration skip, zero failures                                           |
| Frontend regressions                       | PASS: 633 tests across 106 files                                                                                                       |
| TypeScript and production build            | PASS; 3.91 MB initial bundle. Existing unrelated Landing/Jobs stylesheet budgets remain warnings                                       |
| Authenticated local browser                | PASS: Light/Dark/System, 390px responsive view, keyboard details, chart data, source mismatch, refresh failure and initial-load outage |
| Two-process API and database fixture       | PASS: real JWT isolation, canonical portfolio producer, immediate source updates, ETag/304, forged archive rejection                   |
| Trusted history producer                   | BLOCKED: additive server-owned provenance schema approval pending                                                                      |
| External acceptance                        | BLOCKED: staging/account/topology unverified; representative load/failover and live Prometheus evaluation unavailable                  |

Final synthetic run: 22 summary operations and 26 page operations versus 27/37 baseline; two page requests versus four. Summary payload is 10,577 bytes versus 7,824. Thirty requests at concurrency ten measured p50 275 ms, p95 335 ms, maximum 337 ms and 34 requests/second. Baseline p95 was 352 ms; changed fixtures and run variability prevent attributing that difference to code alone. Both API processes reached ten checked-out connections and 26 waiting checkouts with zero checkout failures. These observations identify remaining fan-out pressure, not demonstrated production capacity.

Exact comparisons are retained in [comparison.json](comparison.json). Final screenshots were inspected; no browser console errors were recorded. There were no new dependencies, indexes, repository-file moves or deletions. The native fixture removed 183 verified task-owned temporary database files after shutting down its processes; essential evidence and all earlier baseline artifacts remain.
Finalization: Prettier write and check passed for every changed source file using explicit paths and the repository frontend configuration/backend conventions. Syntax checks passed for all 11 changed JavaScript files; TypeScript noEmit and working-tree/index whitespace checks passed. No abandoned debug code or disposable task artifacts remain. Exact modified/added paths are in file-inventory.json; no repository files were moved or deleted.
