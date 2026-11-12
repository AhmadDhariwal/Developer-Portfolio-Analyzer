> **Latest acceptance (2026-11-12):** see [approved provenance report](provenance-2026-11-12/REPORT.md), [validation](provenance-2026-11-12/validation.json), and [exact inventory](provenance-2026-11-12/file-inventory.json). Trusted history is implemented and passes local acceptance. External staging acceptance remains blocked. The earlier baseline below and the [preceding follow-up](followup-2026-11-12/REPORT.md) are retained historical evidence.

# Developer Dashboard audit and acceptance — 2026-11-12

## Acceptance decision

**Local implementation verified; production acceptance BLOCKED.** No production-ready
claim is made. All infrastructure used by this task was synthetic and loopback-only.
Existing application database/account configuration was not contacted. No dependencies,
schemas, scoring weights, secrets or deployment settings were changed. No commit, push,
merge or deployment was performed.

Authorized source/current branch: `fix/dashboard`. PR/integration target: not applicable.
The initial worktree/index were clean. Some task files were staged externally during the
session; that index was preserved. Review working-tree differences as well as staged
differences before any later commit.

## Supplied overview: verified claims

| Claim                                          | Source finding and resolution                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read/aggregate only                            | No normal GET initiated GitHub/AI generation, but summary created low-score notifications. Removed that GET side effect and dead GitHub persistence/generation helpers/imports. Historical notifications and all existing notification routes/types remain.                                                                                                                                                             |
| Two-minute backend summary cache               | FALSE: the map was never read or populated. Removed dead map/TTL; retained the exported upstream invalidation hook for compatibility. Do not activate a per-process TTL without a shared invalidation design.                                                                                                                                                                                                           |
| Active profile alignment                       | Partly true: username resolution existed, but portfolio/recommendation selection and historical comparison omitted identity constraints. Current reads now include selected resume identity and active username/stack/level; historical comparison binds username/stack/level. Explicit stored GitHub username mismatches are rejected. Legacy Analysis rows without provenance cannot prove their historical username. |
| RxJS forkJoin orchestration                    | FALSE: one summary request followed by four staged secondary requests. Summary now owns skills; browser verifies four requests total rather than five.                                                                                                                                                                                                                                                                  |
| Theme subscriptions and responsive breakpoints | FALSE as stated: chart palettes were fixed dark colors and no theme subscription existed. Theme-token surfaces, chart DOM-theme observation, mobile header repair, chart text alternatives, focus styles and reduced-motion support were verified locally.                                                                                                                                                              |
| Guaranteed sub-second loading                  | Not established by architecture alone. Local measured summary p95 was below one second, but staging/representative load is blocked.                                                                                                                                                                                                                                                                                     |
| Personal dashboard only                        | Existing component queried team analytics. Removed that personal-dashboard dependency and team KPI banner. Recruiter/admin/team modules were not edited.                                                                                                                                                                                                                                                                |

## Data lineage and ownership boundaries

| Upstream owner              | Authoritative data/query and transformations                                                                                                                                                                                                       | Invalidation / reverse impact                                                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Analyzer             | Latest user-owned Analysis, deterministic date/ID ordering; stored stats, languages, contribution activity. Mismatched explicit `githubSignals.username` is rejected. Zero-repository saved evidence is not automatically stale.                   | GitHub writer retains dashboard compatibility invalidator; frontend GitHub mutations clear developer caches. Dashboard does not persist repositories or rerun analysis.                                   |
| Resume Analyzer             | `developerContext.resolveResumeAnalysis` verifies the selected/default owned ResumeFile and selects that file's analysis. Missing selected evidence is never borrowed from another file.                                                           | Existing resume/profile invalidators retained. Dashboard passes the already-resolved resume into developer signals and constrains current portfolio/recommendation cache identity to it.                  |
| Skill Gap                   | `skillGapCacheContract.buildScope`: owner, escaped case-insensitive username, career, experience, resume hash/ID, producer version, rule/policy/taxonomy/matrix versions, non-temporary and retention scope. Coverage stays null or measured zero. | Existing Skill Gap client invalidation retained. Dashboard does not calculate canonical coverage from skill counts or language metadata. Existing consumer regressions pass.                              |
| Recommendations             | Current owned AnalysisCache with profile and resume identity; recommendation preview uses persisted priority/structured/project data. Legacy saved recommendations are owner/stack/experience scoped and marked stale.                             | Existing Recommendations invalidators retained. Dashboard GET does not generate recommendations or alter historical snapshots.                                                                            |
| Portfolio/readiness scoring | Saved portfolio score/breakdown is the preferred base. Explicit zero is retained. Existing stack weights and positive-integration 85/15 blend remain. Legacy Analysis default-zero fallback is preserved.                                          | Dashboard renders scores rather than modifying the owning scoring service. Old unblended portfolio history is compared only with current portfolio, never with a blended overall score.                   |
| Career Sprint               | Latest owned tasks; displayed completion uses existing weighted, duplicate-aware `sprintProgressScore`, not task-count percentage. Command Center selects an existing pending high-priority task.                                                  | Existing Sprint invalidation retained; Dashboard writes no tasks.                                                                                                                                         |
| Integrations                | Owned persisted insight, connected provider metadata, date-bounded projected sync logs. Failed syncs contribute to success rate but do not replace successful measurements in trend comparisons. Fabricated 45/65 confidence defaults removed.     | Existing integration persistence invalidation retained; Dashboard does not sync providers. Integration read failure degrades to missing evidence.                                                         |
| Job Hub                     | Shared job snapshot must be retained, fresh, visible and still valid; projected title/company/skills/timestamps with stable sort. Presented as recent, not personalized top-ranked demand.                                                         | Shared job worker remains owner. Dashboard reads durable data on refresh; no user-owned job writes.                                                                                                       |
| Tech News                   | Canonical public pool `news:v3:public:pool`, existing unique key, projected topics/timestamps. Never picks an arbitrary legacy/personalized cache row.                                                                                             | Shared news ingestion remains owner. No scraping or provider refresh; dashboard does not add a NewsCache index.                                                                                           |
| Learning Hub                | Owned UserCourseProgress, projected status/timestamps, existing unique course identity. Counts are labeled user-entered/self-reported.                                                                                                             | Existing progress writer's compatibility invalidator retained. New feature-local component displays already-present summary data.                                                                         |
| Weekly Reports              | Latest owned report by reporting period with stable ties. Freshness uses persisted update/create time before period-end fallback.                                                                                                                  | Existing report invalidation retained. Dashboard never regenerates reports or rewrites history.                                                                                                           |
| Notifications               | No notification writes during Dashboard GET. Existing low-score historical rows remain readable.                                                                                                                                                   | Intentional behavior correction: repeatedly visiting Dashboard no longer produces a low-score alert. Existing analysis/report/profile notification producers and notification contracts remain unchanged. |

Evidence paths: `backend/src/controllers/dashboardcontroller.js`,
`backend/src/services/developerContextService.js`, `developerSignalService.js`,
`skillGapCacheContract.js`, `dashboardMetricsService.js`, `scoring/sprintProgressScore.js`,
`scoring/portfolioScore.js`, `newsPoolService.js`, and each named model. Frontend ownership
and invalidation are visible in `frontend-cache-invalidation.service.ts`, GitHub, Resume,
Skill Gap, Recommendations, Career Sprint, Integrations and Weekly Report services.
No cross-module controller/service cycle was introduced; the metrics service imports
only scoring and Skill Gap contracts.

## Widgets, accuracy and caching

- Readiness cards now show source-owned measurements; missing resume/portfolio/interview
  evidence remains unavailable. Interview readiness is not synthesized from a fixed 70
  session bonus or Sprint activity. Target Skill Coverage replaces the invented job-based
  72-point market component. Overall scoring weights/formula were not redesigned.
- Learning counts and weighted Sprint completion are supported by persisted evidence.
  Unsupported developer percentiles, synthetic growth arrows, team KPIs and calibrated
  confidence claims were removed. Availability is explicitly labeled as such.
- Summary skills are applied once. A fifth secondary skills request can no longer change
  radar dimensions later. Request cancellation, destruction, stale completion protection,
  in-flight sharing, empty activity reset and denied/quota-limited browser storage have
  dedicated frontend coverage. Refresh failures identify previously displayed data as
  potentially stale instead of silently declaring success.
- Summary is revalidated on entry/refresh; secondary reads bypass local cached snapshots
  after summary validation. Explicit Dashboard cache reads use 60 seconds. There is no
  backend cached response to become stale in another API process. This does not create a
  push update channel for a page left open indefinitely.
- Summary validators support strong, weak, list and wildcard matching. All six routes
  set private/no-cache. A 304 saves response transfer; it does **not** eliminate query
  fan-out, since evidence must be read before its validator is known.
- Missing GitHub evidence has null dates and missing availability. Future dates are not
  fresh. Portfolio dependency staleness is surfaced. Language normalization rejects
  non-finite values and cannot produce a negative final bucket from rounding.

## Query and performance evidence

See [local-acceptance.json](local-acceptance.json) for exact endpoint timings, byte sizes,
Mongoose operation counts (including authentication), winning plans and declared indexes.
The fixture ran two independent API processes with maxPoolSize 10 each, a single-member
disposable replica set, two users, 30 requests at concurrency 10 and 500 news-cache rows.

- Final synthetic summary p50 **209 ms**, p95 **352 ms**, max **354 ms**; payload **7,824 bytes**.
- Summary performed **27 Mongoose operations** on this fixture. Duplicate GitHub/resume
  reads were reduced and several large queries projected, but shared developer signals
  still add material fan-out. Client HTTP cancellation does not cancel already-dispatched Mongo queries. No blanket sub-second capacity claim follows from this test.
- Browser captured exactly `/summary`, `/contributions`, `/languages`, and
  `/integration-analytics`. The redundant `/skills` call is gone.
- Canonical NewsCache lookup: `cacheKey_1` IXSCAN, **1 key / 1 document examined**.
  Prior global expiry-and-sort lookup: **500 keys / 500 documents plus SORT**. This fixes
  the observed pattern with the existing unique index and no additional write overhead.
- AnalysisCache portfolio lookup still requires SORT. Current compound indexes cannot
  fully support every profile/resume/type/date lookup; partial missing-skills indexes do
  not cover legitimate empty-gap evidence. Fixture cardinality and representative write
  overhead were insufficient to justify another index. No schema/index changes were made.
- Existing connection bootstrap does not configure explicit pool/wait-queue limits.
  Production pool pressure/sizing remains unmeasured. Integration analytics still reads
  the selected 1–30-day log window; projection reduces transferred fields but does not
  bound record count. Large-window aggregation needs representative measurement.
- `prometheus-alerts.yml` labels its latency threshold as 1.8 seconds, while
  `metricsService.js` emits milliseconds and the expression compares against `1.8`.
  The fixture meets the intended 1,800 ms interpretation; the configured alert has a unit
  mismatch. Production observability configuration was not modified under this task.
- No Redis/distributed response cache was added: measurements did not justify its
  consistency and invalidation cost. Two-process immediate visibility and cross-process
  304 behavior were verified against the same durable database.

## Verification matrix

| Gate                                                                                          | Actual result                                                                              |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| All six dashboard routes: authentication, contracts, owner-scoped reads, failures             | PASS — dedicated HTTP fixture tests with real JWT middleware                               |
| Expired sessions, deleted user and auth storage failure                                       | PASS — 401/503 fail closed                                                                 |
| Zero/null, missing evidence, ETag/304, upstream changes and concurrent summaries              | PASS                                                                                       |
| Backend focused cross-module regressions                                                      | PASS: 103 tests; one optional existing profile replica-set test SKIPPED (104 total)        |
| Frontend full suite                                                                           | PASS: 105 files, 629 tests                                                                 |
| TypeScript application noEmit and changed JS syntax                                           | PASS                                                                                       |
| Production Angular build                                                                      | PASS; existing Landing Page/Jobs style-budget warnings remain                              |
| Local real MongoDB, real auth, two users, two API processes                                   | PASS — fixture only                                                                        |
| Upstream write visible in both API processes / shared ETag                                    | PASS                                                                                       |
| Chrome: authenticated desktop/mobile; Light/Dark/System; request count; refresh               | PASS — no page errors; retained final screenshots visually inspected                       |
| Formatting and Git whitespace                                                                 | Final explicit-path write/check and both index/worktree checks recorded in validation.json |
| Approved staging URL/account, representative data and load                                    | BLOCKED — provenance/configuration not established                                         |
| Multi-host API replicas, multi-member Mongo failover, distributed outages and pool saturation | BLOCKED — fixture does not represent that topology                                         |

Initial sandbox test runs failed before execution because Vitest could not rename its
temporary modules and local sockets/native Mongo were restricted. Authorized reruns
outside the sandbox passed. An explanation assertion and the browser fixture's Angular
option-value assertion were corrected; these earlier failures are retained as history in
validation.json, not misreported as current acceptance failures.

## Remaining release risks and decisions

1. **No atomic cross-module snapshot.** Parallel Mongo reads and shared signal summaries
   can observe different write instants. GitHub/selected-resume reuse and single-source
   skill rendering reduce this risk; optimistic revision fencing or a durable aggregate
   snapshot needs an explicit broader data-platform design and representative concurrency
   validation. Dashboard does not promise transaction-level consistency.
2. **Historical trend retention.** AnalysisCache expires after seven days; its legacy
   25-day historical lookup usually cannot support a monthly trend. UI correctly reports
   no comparable history. Do not silently substitute Weekly Report scores, which use
   different semantics, or change retention/history schemas without approval.
3. **Legacy provenance.** Analysis lacks a mandatory top-level source-username/versioned
   identity. Explicit mismatches are rejected; legacy rows without that provenance remain
   a compatibility limitation. Legacy readinessScore zero is also a schema default, so
   it cannot universally distinguish unscored from measured zero.
4. **Freshness policy.** Existing general 24-hour source-age guidance remains heuristic;
   module-specific validity/freshness and exact scoring provenance should be aligned in a
   shared contract before claiming universal evidence freshness. Job eligibility and
   selected-resume/Skill Gap scope are enforced directly.
5. **Scale and reliability.** Summary query fan-out, unbounded dated integration logs,
   production indexes/pools, multi-member failover and representative authenticated load
   remain staging acceptance gates. There is no new claim of distributed-cache readiness.
6. **Source UI limitations.** Recommendation previews may be empty until the active
   profile/resume has matching persisted evidence. Deprecated provider detail fields in
   the existing integration UI are not newly populated or inferred by this work.

## Finalization and inventory

Exact changed/added paths, task-owned temporary cleanup, and the absence of moved/deleted
repository source files are recorded in [file-inventory.json](file-inventory.json).
Final source formatting, checks and validation summaries are in
[validation.json](validation.json). The local harness stopped its two API processes and
Mongo child and removed 174 verified fixture storage files. Final screenshots and JSON
evidence remain. Historical/user work and external staging were preserved.
