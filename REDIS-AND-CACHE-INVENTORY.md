# Redis, In-Memory, MongoDB & Browser Cache Inventory — Developer Portfolio Analyzer

**Audit Scope:** Complete inventory of every cache key, storage tier, TTL, bound/eviction policy, invalidation path, and multi-instance behavior verified in source code.

---

## 1. Shared Redis Infrastructure (`backend/src/core/cache/redisCacheService.js`)

- **Connection Resolution (`getRedisUrl`, `L37-61`)**:
  1. `process.env.REDIS_URL` (used directly if non-empty, e.g. `redis://127.0.0.1:6379`).
  2. Otherwise `UPSTASH_REDIS_TOKEN` + `UPSTASH_REDIS_HOST` (default `light-arachnid-164805.upstash.io`) + `UPSTASH_REDIS_PORT` (default `6379`) -> `rediss://default:<token>@<host>:<port>`.
  3. Otherwise Redis disabled (`redisEnabled = false`).
- **Operational Guardrails (`L4-25, L63-195, L241-251`)**:
  - Startup timeout: `REDIS_STARTUP_TIMEOUT_MS = 4000ms` (`backend/index.js:217`).
  - Connect timeout: `3000ms`; command proxy timeout: `150ms` default (customizable `[150..1500]ms` via `getRedisCacheClient({ commandTimeoutMs })` — News uses `1000ms`).
  - Queue cap: `commandsQueueMaxLength = 2000`, `disableOfflineQueue = true`.
  - Reconnect: client stops internal retries at `2`, then `scheduleReconnect()` retries every `15000ms`.
  - **Built-in L1 `memoryCache` (`L21-35, L199-234, L263-272`)**: `MAX_MEMORY_ENTRIES = 2000` (FIFO eviction), default TTL `CACHE_TTL_SECONDS = 3600s` (interview keys capped at `INTERVIEW_MEMORY_TTL_SECONDS = 30s`).
  - **Observed Bug (`L216, L223-228`)**: For non-interview keys, `getCacheJsonWithMeta` skips `PTTL` and assumes `3600000ms` remaining when promoting Redis hits into `memoryCache`, allowing process memory to hold stale payloads up to `3600s` for callers that set shorter Redis TTLs (`120s` Career Sprint, `900s` Courses/SkillGap/Recommendations, `1800s` Preview).
  - **Reconnect Cluster Blast (`L173`)**: On `ready`, any worker calls `redisClient.set('interview:revision:global', randomUUID())`, rotating the shared interview namespace across all instances.

---

## 2. Complete Redis Key & Namespace Inventory

| Prefix / Exact Key Pattern | Owner (`File:Line`) | Payload / Purpose | TTL & Env Override | Fallback When Redis Down | Invalidation Mechanism |
|---|---|---|---|---|---|
| `ai:response:<sha256>` | `core/ai/aiservice.js:338-411` | Normalized LLM JSON response envelope `{ __aiCacheV:1, value, provider, model }` | `AI_RESPONSE_CACHE_TTL_SECONDS` (default **`86400s` / 24h**) | `AIService.memoryCache` (`256` entries) | `invalidateCacheKey` / `invalidateCachePrefix` or `requestPolicy.cacheResponse === false` |
| `ai:deterministic:<sha256>` | `core/ai/aiservice.js:147-167` | Deterministic summary before optional LLM (e.g. Skill Gap) | `AI_DETERMINISTIC_CACHE_TTL_SECONDS` (default **`600s` / 10m**) | `AIService.memoryCache` (`256` entries) | `invalidateCachePrefix` / key identity drift |
| `github:analysis:github-v2:<username>` | `modules/github/services/githubservice.js:98-99` | Full normalized GitHub + AI profile analysis | `86400s` (**24h**) | `memoryAnalysisCache` Map + Mongo `GitHubAnalysisCache` | `forceRefresh:true` or SWR lock `lock:github_swr:<username>` |
| `github-save:<userId>:<username>` | `modules/github/githubcontroller.js:50-72` | Distributed save concurrency lock | `30s` (`SAVE_LOCK_TTL_SECONDS`) | Mongo `GitHubSaveLock` (`expiresAt` TTL) | Explicit `releaseCacheLock` in `finally` |
| `lock:github_swr:<username>` | `modules/github/services/githubservice.js:2078` | Background SWR refresh lock | `1200s` (**20m**) | Process `refreshJobs` Map | `releaseCacheLock` / 20m TTL |
| `resume:analysis:<ver>:<userId>:<fileId>:<hash>` | `modules/resume/services/resumeservice.js:79` | Deterministic + AI focus areas resume analysis | `2592000s` (**30d**) | `memoryResumeCache` (`128`) + Mongo `ResumeAnalysisCache` | `forceRefresh:true` or content hash / `ANALYSIS_VERSION` change |
| `rate_limit:parse_resume:<ip>` | `modules/resume/resumecontoller.js:857-897` | Preview resume PDF parse rate counter | `600s` (**10m**, max `10`) | `memoryRateLimitMap` | Fixed window expiry |
| `preview:resume:<uuid>` | `modules/resume/services/previewResumeCacheService.js:28-56` | Parsed temporary resume skills/claims | `1800s` (**30m**) | `AIService.memoryCache` (`256`) | TTL expiry |
| `preview:<cacheKey>` | `skillgapcontroller.js:2175`, `recommendationService.js:1266` | Preview-mode Skill Gap / Recommendations result | `1800s` (**30m**) | `skillGapMemoryCache` / `recommendationMemoryCache` | `signalHash` change or 30m TTL |
| `skill_gap:result:<userId>:<sha256>` | `modules/skill-gap/skillgapcontroller.js:2240,3045` | Profile-mode Skill Gap v9 result | `900s` (**15m**; env `SKILL_GAP_REDIS_TTL_SECONDS`?) | `skillGapMemoryCache` (`200`, `60s`) + Mongo `AnalysisCache` (`7d`) | `resumecontoller` calls `invalidateCachePrefix('skill_gap:result:<userId>:')`; `signalHash` mismatch |
| `recommendations:result:<sha256>` | `modules/recommendations/services/recommendationService.js:63-66,1266` | Profile-mode Recommendations v7 plan | **`900s`** (clamped `60..3600s`) | `recommendationMemoryCache` + Mongo `AnalysisCache` (`24h`/`7d`) + `Recommendation` | `sourceFingerprint` / `signalHash` mismatch |
| `recommendations:enrichment-lock:<id>:<signalHash>` | `modules/recommendations/services/recommendationGenerationService.js:7-17` | Prevents duplicate concurrent AI narrative enrichment | `60s` | Single-worker fallback | Explicit release / TTL |
| `courses:result:<userId>:<poolHash>:courses_pool_v6_evidence` | `modules/courses/services/courseRecommendationService.js:34-37,677` | Filtered personalized Learning Hub course pool | **`900s`** (clamped `60..3600s`; note L1 promotion = `3600s`!) | `courseMemoryCache` (`80`/`32MB`, `60s`/`15s`) + Mongo `AnalysisCache` (`6h`/`7d`) | `poolHash` includes `catalogRevision` + `evidenceFingerprint` |
| `career_sprint:overview-v4:<userId>:<revision>` | `modules/career-sprint/services/sprintOverviewCacheService.js:74` | Current Career Sprint overview + signal summary | **`120s`** (2m; L1 promotion = `3600s`!) | `overviewCache` Map (`500`, `60s`) | Revision hash over `{ sprint, previous, context, day, overdue }` + `invalidateCareerSprintCache` |
| `career_sprint:plan:<identity>` | `core/ai/aiTaskService.js:30,725,788` | Generated Sprint deterministic/AI task plan | `CAREER_SPRINT_PLAN_REDIS_TTL_SECONDS` (**`120s`**, min `30s`) | `planResultCache` (`300`, `120s`) | `context.fingerprint` change / `forceRefresh` |
| `interview:revision:global` & `interview:revision:topic=<t>` | `core/cache/redisCacheService.js:348-383` | Revision UUID namespaces for interview caches | **No TTL (persistent)** | Process `interviewRevisions` Map (`'0'`) | `invalidateInterviewPrepCache(topic)` & Redis `ready` reconnect |
| `interview:questions:bank=v14:block=top:topic=...` | `modules/interview-prep/services/interviewPrepService.js:65-69` | Top 30 bank payload (`:revision=...`) | `CACHE_TTL_TOP` (**`43200s` / 12h**; `30s` fallback) | `redisCacheService.memoryCache` (**`30s` cap**) + Mongo + Seed catalog | Topic/global revision UUID bump |
| `interview:questions:bank=v14:block=all:topic=...` & `mix:v1:...` | `interviewPrepService.js:66,246-278` | Paginated bank page & source mix (`:revision=...`) | `CACHE_TTL_ALL` (**`10800s` / 3h**; `30s` fallback) | Same as above | Topic/global revision UUID bump |
| `interview:search:filters=v3:v8:mode=...` | `interviewPrepService.js:67` | Bank search results (`:revision=...`) | `CACHE_TTL_SEARCH` (**`3600s` / 1h**) | Same as above | Topic/global revision UUID bump |
| `interview:custom:v7:coverage=1:topic=<t>:user=<h>:question=<h>` | `interviewPrepService.js:68` | Private custom Q&A answer (`:revision=...`) | `CACHE_TTL_CUSTOM` (**`86400s` / 24h**) | Same as above | Topic revision bump OR `deleteCacheKey` on custom session delete |
| `jobs:v2:public:pool` | `modules/jobs/services/jobPoolCacheService.js:2-48` | Serialized public job listings pool (Lua `PUBLISH` `observedAt` guard) | `MAX_AGE_MS = 300000` (**5m**) | `jobPoolCacheService.memory` (`15s`) + Mongo `JobCache` (`36h`/`7d`) | Worker/refresh Lua `PUBLISH` overwrite |
| `jobs:v2:lease:refresh`, `jobs:v2:refresh-gate`, `jobs:v2:rate:*`, `jobs:v2:gov:*`, `jobs:v3:hidden:*` | `jobs/services/*`, `jobsRateLimit.js`, `jobsHiddenAccessService.js` | Refresh lock (`60s`), cooldown gate (`60s`), rate buckets (`60s`/`15m`), provider quotas/cooldowns (`300s`/`6h`), hidden attempts/grants (`900s`/`300s`) | `60s`–`6h` | `jobsRateLimit` read falls back to local Map (`2000`); refresh/actions/hidden fail closed **`503`** | Lock release / expiry |
| `news:v3:public:pool` | `modules/news/services/newsPoolService.js` | Shared public news pool (`<=300` items) | Fresh `20m`, Stale `24h` | L1 `5s` mem + Mongo `NewsCache` | Worker `pool.refreshPool()` every 1m (60s spacing) |
| `news:catalog:query:<sha256>` | `modules/news/services/newsCatalogService.js` | Versioned filtered catalog query result | **`5000ms`** (or earliest article expiry) | L1 `memory` (`128`, `5s`) + Mongo `NewsArticle` | `catalog.ingest()` increments Mongo version & clears worker mem |
| `news:v1:{discovery}:topic:<key>`, `:queue`, `:worker` | `modules/news/services/newsDiscoveryService.js` | Topic discovery payload, ZSET work queue, worker heartbeat | Fresh `30m`, Retain `24h`, Neg `5m`, HB `20s` | L1 `memory` (`128`, `5s`) + Mongo `NewsTopicCache` (`discovery` worker stalls without Redis) | Topic `:version` increment / `ingest()` |
| `news:v3:request:*`, `news:v3:lease:*`, `news:adaptive:topic:*` | `newsMiddleware.js`, `newsService.js`, `newsAdaptiveService.js` | Rate limits (`60s`), ingestion/prewarm/worker leases (`30s`–`120s`), 7d demand counters | `30s`–`7d` | Rate-limiter falls back to `express-rate-limit` mem | Expiry / lock release |
| `public-portfolio:v3:<profileId>:<revision>` (+ `:lock`) | `modules/public-portfolio/services/publicPortfolioCacheService.js:5-131` | Serialized public portfolio DTO (`revision = sha256([content, user])`) | **`3600s` (1h)** stale / **`300s` (5m)** fresh; lock `10s` | L1 `cache` Map (`200`) + Mongo `PublicProfileCache` (`1h`) | Content-addressed revision change naturally busts old keys across all workers |
| `scenario:quota:<op>:<userHash>:<minBucket>` | `modules/scenario-simulator/middleware/scenarioSimulatorMiddleware.js:7-67` | Atomic Lua rate limits (`context:30`, `refresh:6`, `evaluate/history:60`, `save/delete:20`, `export:10`) | `60s` | **Prod: fails closed `503`** (unless `SCENARIO_LIMIT_MODE=single-instance`); non-prod: `express-rate-limit` mem | Fixed 60s window expiry |

*(Note: **Dashboard, Integrations, Weekly Reports, Notifications, Support, Auth, Profile, Recruiter, Admin, Super Admin, and `/api/workflows`/`/api/analysis`** do **not** read or write Redis keys directly; `Weekly Reports` and `/api/analysis` only touch Redis transitively via `AIService`'s `ai:response` cache.)*

---

## 3. Backend Process-Local In-Memory Caches & Unbounded Map Audit

| Symbol (`File:Line`) | Bounds / Eviction | TTL | Risks / Multi-Instance Impact |
|---|---|---|---|
| `redisCacheService.memoryCache` (`redisCacheService.js:21-22`) | Max `2000` (FIFO/insertion-refresh) | `3600s` (`30s` interview) | Extends `<3600s` Redis keys (Courses 900s, Career Sprint 120s) to `3600s` in local RAM on Redis hit! |
| `AIService.memoryCache` (`aiservice.js:24,83`) | Max `256` (FIFO) | `600s`–`86400s` | Used only when Redis disabled; per-process isolation |
| `aiTaskService.planResultCache` (`aiTaskService.js:24-32`) | Max `300` (LRU-refreshed) | `120s` | Safe (fingerprint-keyed) |
| **`githubservice.memoryAnalysisCache`** (`githubservice.js:34,108`) | **UNBOUNDED Map** (no max size!) | `24h` (`expiresAt`) | Unbounded heap growth if many arbitrary public GitHub usernames are analyzed; cleared only per-process |
| `resumeservice.memoryResumeCache` (`resumeservice.js:18,37`) | Max `128` (FIFO) | `30d` | Safe (version + content-hash keyed) |
| `skillGapMemoryCache` (`skillgapcontroller.js:59-71`) | Max `200` (FIFO) | `60s` (clamped `15s–5m`) | Safe (`signalHash` checked on read) |
| **`recommendationMemoryCache`** (`recommendationService.js:49-112`) | **UNBOUNDED Map** (no max size!) | `60s` (clamped `15s–5m`) | Should be bounded; cleared only per-process |
| `recommendationGithubSources` (`recommendationService.js:113`) | Max `500` | `60s` | Safe |
| `courseMemoryCache` (`courseRecommendationService.js:26-38`) | Max `80` / `32MB` | `60s` (`15s` fallback) | Safe (`poolHash`-keyed) |
| `courseCatalogSearchService.cache` (`L19, L330`) | Max `32` / `16MB` | `30s` | Peer instances lag up to `30s` after catalog ingestion |
| `sharedCourseCatalogService.{memory,curatedMemory,revisionMemory}` | Bounded | `5s`–`30s` | Peer instances lag up to `30s` after catalog ingestion |
| `courseDiscoveryStatusService.memory` | Max `64` | `5s` | Peer instances lag up to `5s` |
| `courseService.youtubeCache` | Max `40` | `6h` (`10m` empty) | Per-process YT API memoization + `youtube:control` Mongo breaker |
| `sprintOverviewCacheService.cache` (`L8`) | Max `500` | `60s` | Local process invalidated on write; hash includes DB snapshots |
| `newsService.signalCache` (`L291-315`) | Max `250` | `15s` | Invalidated on current worker only (`profilecontroller`/`careerSprintController`) |
| `newsCatalogService.memory`, `newsPoolService.memory`, `newsDiscoveryService.memory` | `128` / singleton / `128` | `5s` | Cleared on ingesting worker; peer workers lag max `5s` |
| `jobPoolCacheService.memory` & `jobController.coursePoolCache` | Singleton / `64` | `15s` / `15m` | `coursePoolCache` lags up to `15m` when catalog updates |
| `publicPortfolioCacheService.cache` (`L15-131`) | Max `200` (LRU-like) | `5m` fresh / `1h` stale | Content-addressed key eliminates stale cross-worker leaks |
| **`adminConsoleService.performanceCache`** (`adminConsoleService.js:19-62`) | **UNBOUNDED Map** | `5m` (`300s`) | **Zero write invalidation** + per-process drift across workers |
| **`platformSettingsService.settingsCache`** (`platformSettingsService.js:65-66,359`) | Single global snapshot | `60s` async / **∞ for `*Sync()`** | **Critical multi-worker bug**: `*Sync()` ignores `expiresAt`, never reloads, and `PUT /settings` only updates current worker |
| `oauthAuthService.consumedStates` (`oauthAuthService.js`) | Map of used nonces | Single-use OAuth | Process-local replay guard (multi-worker state could replay on another instance within 10m JWT TTL) |
| **`securityMiddleware.loginAttemptStore` & `MemoryStore`** (`securityMiddleware.js`) | `loginAttemptStore` **no size cap** (30m cleanup on trigger) | `10m` lockout / `10m–15m` windows | Rate limits & brute-force counters are per-process (`MemoryStore`), not shared in Redis |

*(In-flight coalescing Maps without cross-request TTL: `dashboardcontroller` none, `githubcontroller.saveJobs`, `githubservice.analysisJobs`/`refreshJobs`, `resumecontoller.analyzeInFlight`, `resumeservice.analyzeResumeJobs`, `skillgapcontroller.inflightSkillGapRequests` [cap 100], `recommendationService.recommendationInflight`, `courseRecommendationService.coursePoolInflight` [cap 8], `courseCatalogSearchService.pending` [cap 8], `sprintOverviewCacheService.pending`, `aiTaskService.generationInflight`, `interviewPrepService.inflightRequests`, `interviewGenerationFlight.flights`, `scenarioContextService.pending` [cap 32/256], `scenarioSprintExportService.inFlightExports` [cap 256], `integrationPublicSnapshotService.flights` [cap 32/128], `jobPoolCacheService.inflight`, `newsPoolService.inflight`.)*

---

## 4. MongoDB Caches, Snapshots & Governance/Coordination Collections

- **Materialized Caches (TTL-indexed or SWR)**:
  - `AnalysisCache` (`skill-gap/models/analysisCache.js:53`): TTL **`7 days`** on `createdAt`. Shared by Skill Gap (`v9`), Recommendations (`v7`), Courses (`6h` logical TTL checked in code), and Portfolio Score (`portfolio-score-v1`, no GitHub timestamp in key!).
  - `GitHubAnalysisCache`: Logical `24h` `expiresAt`; Mongo TTL index deliberately dropped (`ensureSWRCacheIndex`) to retain stale snapshots indefinitely for SWR.
  - `ResumeAnalysisCache` (`resumeAnalysisCache.js`): TTL **`30 days`** on `createdAt`.
  - `PublicProfileCache` (`publicProfileCache.js:3-11`): 1 doc per `profileId`, TTL **`1 hour`** (`expiresAt`).
  - `JobCache` (`jobCache.js`): Logical `freshUntil` `24–48h` (default `36h`), Mongo TTL `expiresAt` `3–?d` (default **`7 days`**).
  - `NewsArticle` (`newsArticle.js`): `expiresAt` TTL **`1–35 days`**; `NewsCache`: **`<=300` pool items**; `NewsTopicCache`: **`<=40` items/topic** (`30m` fresh / `24h` retain).
  - `IntegrationPublicSnapshot` (`integrationPublicSnapshotService.js`): **`5 minutes`** (`300s`), `32KB` cap.
- **User Domain Snapshots (No TTL, persistent until mutated/deleted)**: `Analysis` & `Repository`, `ResumeFile` & `ResumeAnalysis`, `Recommendation`, `SavedPreview`, `WeeklyReport` & `WeeklyReportRevision`, `CareerSprint`, `InterviewPrepSession` (`practice`/`custom`), `ScenarioSimulation`, `UserCourseProgress`, `UserJobAction`, `NewsSavedItem`, `IntegrationConnection` & `IntegrationInsight`, `WorkflowRun`, `AIVersion`, `Notification`.
- **Auth & Coordination / Lease Collections (TTL-indexed on `expiresAt`, `expireAfterSeconds: 0`)**:
  - `AIProviderAdmission` (slots, RPM/RPD quotas, circuit breakers), `IntegrationGovernanceState` (used by Integrations, Courses, Career Sprint AI, Notifications, Public Portfolio, Resume, Skill Gap, Recommendations), `WeeklyReportCoordination` (generation leases & cron checkpoints), `InterviewCoordination` (`runAI` leases/slots/60s cache + 10m rate limits), `InterviewJobLease` (15m ingest lease), `GitHubSaveLock` (30s fallback), `Otp` (5m), `PendingRegistration` (10m), `SupportTicketDedupe` & `SupportTicketQuota` (10m).
  - *Explicitly NON-TTL retry queues*: `AccountDeletionCleanup`, `StoredAsset`, `EmailDeliveryJob`, `SupportTicket.emailDelivery`, `WeeklyReport.emailDelivery`.

---

## 5. Frontend Browser Storage & In-Memory Cache Inventory

### 5.1 Browser `localStorage` Keys (`sessionStorage`: NONE, `ngsw`: NONE)
- `token`, `user`, `loginExpiry` (`AuthService`, `20h` max) — cleared on logout/401/expired init.
- `devinsight_career_profile` (`CareerProfileService`, `ownerId`-checked) — cleared on logout.
- `devinsight_profile_cache` (`ProfileService`, **`5m` TTL**, `_id`-checked) — cleared by `clearAllUserCaches()`.
- `devinsight_tenant_context` (`TenantContextService`) — reset to empty JSON on logout.
- `devinsight_theme` & `landing-theme` (`ThemeService`, `LandingThemeService`) — preserved across logout.
- `sa_nav_collapsed` (`SaShellComponent`) — UI layout preference, preserved across logout.
- `devinsight_resume_prompt_dismissed_at`, `_state`, `_permanent_dismiss` (`ResumeOnboardingService`, **`24h` cooldown**) — preserved across logout (cleared only on new signup OTP).
- `devinsight_portfolio_revision` (`PublicProfileService` fallback when `BroadcastChannel('devinsight-portfolio')` unavailable).
- `devinsight_public_jobs_state:<owner>` (`JobActionsService` read-only legacy migration import).
- `frontend_analysis_cache:<module>:...`, `frontend_analysis_cache_index:<module>:...`, `frontend_analysis_cache_signal_index:<module>:...`, `frontend_analysis_current_signal:<userId>:...` (`FrontendAnalysisCacheService`, default **`24h` TTL**):
  - Actively **read+written** across reloads by **`RecommendationsComponent` (`24h`)** and **`WeeklyReportService` (`15m` latest, `10m` history)**.
  - **Written only / never read** by `DashboardComponent` (`60s` TTL written, bypassed via `forceRefresh=true`) and `SkillGapService` (`currentSignalHash` only).
- `resume_analysis_cache:*` (`ResumeService`, `30d` TTL helper exists — **never called** by component; wiped by `AuthService.clearStorage()` & `clearAllUserCaches()`).

### 5.2 Frontend Service In-Memory Caches
| Service | Structure & Key | TTL / Lifetime | Clearing Triggers |
|---|---|---|---|
| `GithubService` | `memoryCache` (`${mode}:${username}`) | `<=24h` (`expiresAt`) | `GithubService.clearCache()`, `clearDeveloperSignalCaches()` (`analyzeAndSave`), `clearAllUserCaches()` |
| `RecommendationsService` | `profileCache` + `savedPreviewCache` | `15m` / `7m` | `'recommendations'` / `'saved-previews'` invalidation, `clearDeveloperSignalCaches()`, logout |
| `CareerSprintService` | `cache` Map (`history` only; `getCurrent` bypasses) | `12m` | Sprint mutations, `'career-sprint'`, `clearDeveloperSignalCaches()` |
| `ProfileService` | `memoryProfile` + `inflightProfile$` | `5m` | Profile save, `'profile'`, `clearAllUserCaches()`, cross-tab `storage` |
| `JobService` | `cache` Map (max `20`) | `30s` | `JobActionsService.update()`, `'jobs'`, user change |
| `NewsService` | `entries` Map (max `30`) | `15s` feed / `5s` saved | `'news'`, `clearDeveloperSignalCaches()`, user change |
| `NotificationService` | `cache` Map (max `50`) | `15s` | SSE `streamEvents$`, `disconnectStream()`, `'notifications'`, user change |
| `SupportService` | `cache` Map (max `20`, `shareReplay(1)`) | `60s` | Support mutations (missing on `SaSupportDetail` `409`!), `'support'`, logout |
| `ApiService.organizationsCache$` | `shareReplay({ bufferSize: 1, refCount: false })` | **Unbounded (`∞`)** | `createOrganization()`, `forceRefresh=true`, error — **NOT cleared on logout!** |
| `RecruiterHubService` | `dashboard$` & `analytics$` (`shareReplay(1)`) | **Unbounded (`∞`)** | Recruiter mutations call `clearCache()` — **NOT cleared on logout / no `clearAllUserCaches` hook!** |
| `Navbar.cachedRepos` | Component array per GitHub handle | Navbar lifetime | User logout (`user === null`) or handle change |
| `AdminConsolePageComponent.tabStates` | Component `loaded` map per tab | Component lifetime | `refreshActiveTab()`, org switch, in-page mutations |
| Inflight-only deduplicators | `CourseService`, `InterviewPrepService`, `PublicProfileService`, `SkillGapService`, `ApiService` (`scenario*Inflight`), `DashboardComponent.activeRequests` | Active HTTP request duration only | Completion/error, `cancel`/`clearCache` |


## Implementation addendum — 2026-11-17

redisCacheService.getCacheJsonWithMeta now uses one atomic GET/PTTL Lua snapshot for every namespace. Missing, expired, and no-expiry payloads are misses; memory expiry is bounded by remaining source TTL and the existing memory cap. Redis lock release now compares the token and deletes atomically. Existing TTL configuration is unchanged.

The original audit above is historical source evidence. Current implementation and acceptance limits are recorded in [DEVELOPER-DATA-FRESHNESS-FINAL.md](DEVELOPER-DATA-FRESHNESS-FINAL.md) and [DEVELOPER-MODULE-REFRESH-TEST-MATRIX.md](DEVELOPER-MODULE-REFRESH-TEST-MATRIX.md).
