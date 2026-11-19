# Project Data Flow Architecture & Executive Audit Summary — Developer Portfolio Analyzer

**Audit Mode:** Strictly Read-Only (zero source code, `.env`, Redis, or database modifications).  
**Evidence Standard:** Every path, key, TTL, interval, header, and defect below was verified directly in source files across `frontend/src/app/**`, `backend/index.js`, `backend/src/core/**`, and all `22` modules under `backend/src/modules/**`. Runtime durations of scheduled jobs were **NOT MEASURED** (no live jobs were triggered per audit restrictions).

---

## 1. End-to-End Request & Caching Architecture

Across DPA, the canonical request pipeline is:

```text
Angular Component
  └─▶ Feature Store / Shared Service
        ├─(Optional L0a: In-memory Map / BehaviorSubject / shareReplay)
        ├─(Optional L0b: browser localStorage — e.g. FrontendAnalysisCacheService 24h, ProfileService 5m, WeeklyReportService 10–15m)
        └─▶ HttpClient ─▶ authInterceptor (attaches Bearer JWT unless X-Skip-Auth; handles 401 logout & 503 Maintenance modal)
              └─▶ Express (backend/index.js)
                    ├─ Global Middleware: helmet CSP ─▶ cors ─▶ globalRateLimiter (in-memory) ─▶ requestContextMiddleware ─▶ express.json ─▶ Maintenance Mode gate (in-memory PlatformSettings snapshot) ─▶ /uploads static/B2 gate ─▶ metricsMiddleware ─▶ auditLogMiddleware (logs POST/PUT/PATCH/DELETE)
                    ├─ Router Middleware: protect / optionalProtect / authorizeRoles / requireOrganizationContext / admission rate-limiters & leases
                    ├─ Controller ─▶ Domain Service
                    │     ├─(Optional L1 Backend Process Memory Map)
                    │     ├─(Optional L2 Redis / Upstash via redisCacheService or direct client)
                    │     ├─(Optional L3 MongoDB Cache / Snapshot Collection — e.g. AnalysisCache, GitHubAnalysisCache, ResumeAnalysisCache, JobCache, NewsCache, NewsArticle, PublicProfileCache)
                    │     └─(On Miss / forceRefresh)─▶ Authoritative MongoDB + External APIs (GitHub, YouTube, Remotive/Arbeitnow/RemoteOK/JSearch/Jooble/Adzuna, NewsAPI/GNews/HN/Dev.to/Reddit/GitHub/Lobsters/K8s/Cloudflare, LeetCode/StackExchange/Kaggle/LinkedIn) + AIProviderManager (Gemini → OpenAI → Groq → Anthropic → xAI)
                    └─ HTTP Response (`Cache-Control`, optional `ETag`) ─▶ Service updates local cache / invalidates `FrontendCacheInvalidationService` ─▶ UI signals / state
```

### 1.1 Browser Storage & Asset Caching (`No PWA / No Service Worker / No sessionStorage`)
- **Service Workers / CDN**: None configured in the repository (`frontend/angular.json` has no `serviceWorker` or `ngswConfigPath`; `frontend/package.json` has no `@angular/service-worker`; production builds enable `"outputHashing": "all"`).
- **`sessionStorage`**: **Not used anywhere** in `frontend/src/app`.
- **`localStorage`**: Used for auth tokens (`token`, `user`, `loginExpiry`), UI preferences (`devinsight_theme`, `landing-theme`, `sa_nav_collapsed`, `devinsight_tenant_context`), career context (`devinsight_career_profile`), onboarding dismissal (`devinsight_resume_prompt_*`), cross-tab portfolio revision fallback (`devinsight_portfolio_revision`), `ProfileService` 5m cache (`devinsight_profile_cache`), and `FrontendAnalysisCacheService` keys (`frontend_analysis_cache:*`, `frontend_analysis_cache_index:*`, `frontend_analysis_cache_signal_index:*`, `frontend_analysis_current_signal:*`).

### 1.2 Browser `F5` vs. `Ctrl+Shift+R` (Hard Reload) vs. SPA Navigation
It is critical not to equate browser reloads with fresh source retrieval:

1. **SPA Navigate Away & Return**:
   - Destroys the routed component (`ngOnDestroy`, cancelling component subscriptions/timers), **while root-provided Angular services survive** (`FrontendAnalysisCacheService`, `GithubService`, `RecommendationsService`, `ProfileService`, `JobService`, `NewsService`, `CareerSprintService`, `SupportService`, `NotificationService`, `ApiService`, `RecruiterHubService`).
   - Returning hits in-memory service caches first (if implemented, e.g., `GithubService` 24h, `RecommendationsService` 15m, `JobService` 30s, `NewsService` 5–15s, `SupportService` 60s, `ApiService.organizationsCache$` unbounded, `RecruiterHubService` unbounded) OR `localStorage` (`RecommendationsComponent` 24h, `WeeklyReportService` 10–15m, `ProfileService` 5m).
2. **Normal Browser Reload (`F5`)**:
   - Wipes all JavaScript heap memory (`memoryCache` Maps, `shareReplay(1)` observables, `BehaviorSubject`s, component state), resets Angular injector, and re-runs `AuthService.checkToken()` from `localStorage`.
   - **`localStorage` survives `F5`**. Therefore, `RecommendationsComponent` (`24h` `localStorage`), `WeeklyReportService` (`10–15m` `localStorage`), and `ProfileService` (`5m` `localStorage`) continue serving cached data across `F5` without calling the backend (as long as TTL and `signalHash` checks pass).
   - For modules that *do* call the backend on `F5`, browser HTTP conditional cache (`If-None-Match`) applies ONLY to endpoints that return `ETag` + `Cache-Control: private, no-cache` (specifically `GET /api/dashboard/*` → `304 Not Modified`, and filesystem `/uploads/*` → `max-age=3600, must-revalidate`). Endpoints with `Cache-Control: private, no-store` (`github`, `resume`, `profile`, `public-portfolio`, `jobs`, `news`, `notifications`, `weekly-reports`, etc.) bypass browser HTTP caching.
   - Inside the backend, `F5` still hits L1 backend process memory, L2 Redis, and L3 MongoDB cache collections unless an explicit `forceRefresh`/`refresh=true` parameter was sent (which `F5` never sends!).
3. **Hard Browser Reload (`Ctrl+Shift+R`)**:
   - Forces the browser to bypass its own HTTP disk/memory cache (sending `Cache-Control: no-cache` / omitting `If-None-Match`), turning Dashboard's `304` into `200` and forcing static bundle re-download.
   - **Hard reload does NOT clear `localStorage`**, **does NOT bypass backend in-memory Maps**, **does NOT bypass Redis**, **does NOT bypass MongoDB cache collections (`AnalysisCache`, `GitHubAnalysisCache`, `ResumeAnalysisCache`, `PublicProfileCache`, `JobCache`, `NewsArticle`)**, and **does NOT trigger external APIs or paid AI providers**.

### 1.3 HTTP `Cache-Control`, `ETag` & Media Cookies Summary
- **Dashboard (`backend/src/modules/dashboard/dashboard.routes.js:14-17`)**: `Cache-Control: private, no-cache` + SHA-1 `ETag` (`dashboardcontroller.js:461-473`) returning `304`.
- **`private, no-store` / `no-store`**: Enforced at router/middleware level on `jobs` (`jobRoutes.js`), `news` (`newsRoutes.js`), `integrations` (`integrations.routes.js`), `weekly-reports` (`weeklyReport.routes.js`), `notifications` (`notificationAdmission.js`), `profile` (`profile.routes.js`), `public-portfolio` (`publicProfile.routes.js` & controller), `scenario-simulator` (`scenarioContextService.js`), and B2 `/uploads` (`storedImageMiddleware.js:77-79` + `Vary: Cookie` using 20m `HttpOnly` `devinsight_media` JWT cookie).
- **`public, max-age=3600, must-revalidate`**: Local filesystem fallback `/uploads/(avatars|portfolio-images)/*` (`publicUploadAccess.js:7` + `express.static`).
- **`no-cache`**: `GET /api/resume/guide` (`resumeGuideService.js:522`).
- **All other `/api/*` routes**: Do not set custom `Cache-Control` headers (dynamic JSON defaults).

---

## 2. Final Executive Summary — Explicit Answers to All 15 Questions

*(Strictly separated by **Verified Source Behavior** vs **Runtime-Observed / Inference** vs **NOT MEASURED**.)*

### Q1. Does every module always fetch data from the backend?
- **No** (verified in source):
  - **Completely static / local Angular modules**: All public marketing/legal pages (`LandingPage`, `ApiDocsPage`, `PublicBlogPage`, `ContactPage`, `PrivacyPolicy`, `TermsOfService` in `frontend/src/app/features/public/pages/`) contain hardcoded static data/signals and make zero HTTP requests.
  - **Modules that skip backend HTTP on warm frontend cache hits**:
    - `RecommendationsComponent` (`recommendations.component.ts:281-317`) reads `FrontendAnalysisCacheService` (`localStorage`, `24h`) first; if `currentSignalHash` matches or is unset, it returns immediately with zero HTTP calls (even across `F5`).
    - `WeeklyReportService` (`weekly-report.service.ts:150-295`) reads `FrontendAnalysisCacheService` (`localStorage`, `15m` latest / `10m` history) before firing HTTP.
    - `ProfileService` (`profile.service.ts:135-159`) reads `memoryProfile` + `localStorage['devinsight_profile_cache']` (`5m`) before calling `GET /api/profile/me`.
    - `GithubService` (`github.service.ts:165-286`) serves from in-memory `Map` (`<= 24h` per `expiresAt`) within the same SPA tab.
    - `JobService` (`30s` memory), `NewsService` (`15s` feed / `5s` saved memory), `SupportService` (`60s` memory), `NotificationService` (`15s` memory), `RecommendationsService.savedPreviewCache` (`7m` memory), `CareerSprintService.getHistory` (`12m` memory when not forced), `ApiService.organizationsCache$` (unbounded memory), `RecruiterHubService` `dashboard$`/`analytics$` (unbounded memory), and `AdminConsolePageComponent` `tabStates` (tab lifetime memory) all short-circuit HTTP when warm.
  - **Modules that always hit the backend on component entry**: Dashboard (`forceRefresh = true` hardcoded at `dashboard.component.ts:439,444`), Resume Analyzer (`ResumeService` `localStorage` cache exists but component never calls it), Skill Gap (`SkillGapService.getCachedResult()` always returns `null`), Courses, Career Sprint (`getCurrent()` always hits backend), Interview Prep (`inflight`-only), Scenario Simulator (`inflight`-only), Integrations Marketplace, Public Portfolio, Admin Overview/Developers/ActivityLogs/Jobs/Teams/Recruiters, Super Admin pages, and Recruiter Candidates/Jobs/Matches/Shortlists.

### Q2. Which modules use Redis versus MongoDB directly?
- **Both Redis + MongoDB (`redisCacheService` or direct Redis)**:
  - **Jobs Hub**: Redis L2 (`jobs:v2:public:pool` 5m, refresh lock/gate, rate limits, hidden-access auth/grants) + Mongo `JobCache` (`36h` fresh / `7d` TTL), `UserJobAction`, `JobSourceHealth`.
  - **Tech News**: Redis L2 (`news:v3:public:pool`, `news:v1:{discovery}:topic:*`, `news:catalog:query:*`, `news:adaptive:*`, `news:v3:request:*`, `news:v3:lease:*`) + Mongo `NewsArticle` (`1–35d` TTL), `NewsCache`, `NewsTopicCache`, `NewsSavedItem`.
  - **Interview Prep**: Redis revisioned keys (`interview:questions:*`, `interview:search:*`, `interview:custom:*` + `interview:revision:*` version keys) + Mongo `InterviewQuestionBank`, `InterviewPrepSession`, `InterviewJobLease`, `InterviewCoordination` (rate-limiting & `runAI` slots/leases use Mongo, not Redis!).
  - **Public Portfolio**: Redis L2 (`public-portfolio:v3:<id>:<rev>` 1h + `:lock` 10s) + Mongo `PublicProfile`, `PublicProfileCache` (1h TTL), `PublicPortfolioVisit`.
  - **GitHub Analyzer**: Redis `github:analysis:github-v2:<user>` (24h) + `github-save:*` lock (`30s`, Redis first with Mongo `GitHubSaveLock` fallback) + `lock:github_swr:*` (20m) + Mongo `GitHubAnalysisCache`, `Analysis`, `Repository`.
  - **Resume Analyzer**: Redis `resume:analysis:<ver>:<userId>:<fileId>:<hash>` (30d, 150ms race) + Redis `rate_limit:parse_resume:<ip>` + Mongo `ResumeFile`, `ResumeAnalysis`, `ResumeAnalysisCache` (30d), `IntegrationGovernanceState` (admission).
  - **Skill Gap**: Redis (`aiService`: `skill_gap:result` 15m, `preview` 30m, `ai:deterministic` 10m, `ai:response` 24h) + Mongo `AnalysisCache` (7d), `IntegrationGovernanceState`.
  - **Recommendations**: Redis (`aiService`: `recommendations:result` 15m, `preview` 30m, enrichment lock 60s, `ai:response` 24h) + Mongo `AnalysisCache` (7d), `Recommendation`, `SavedPreview`, `IntegrationGovernanceState`.
  - **Courses / Learning Hub**: Redis (`aiService`: `courses:result` 15m) + Mongo `AnalysisCache` (6h logical / 7d TTL), `shared_course_catalog`, `course_catalog_discovery`, `course_catalog_coverage`, `UserCourseProgress`, `IntegrationGovernanceState`.
  - **Career Sprint**: Redis (`aiService`: `career_sprint:overview-v4` 2m, `career_sprint:plan` 2m, `ai:response` 24h) + Mongo `CareerSprint`, `SprintSchedule`, `SprintPreference`, `IntegrationGovernanceState`.
  - **Scenario Simulator**: Redis Lua rate-limit (`scenario:quota:*` 60s window; fails closed 503 in prod if down); data/history/evaluation read Mongo directly (no Redis data cache).
- **MongoDB-Directly (no Redis data/coordination dependency)**:
  - **Dashboard** (multi-collection live Mongo reads + `ETag`)
  - **Integrations** (`IntegrationConnection`, `IntegrationInsight`, `IntegrationSyncLog`, `IntegrationPublicSnapshot` 5m, `IntegrationGovernanceState`)
  - **Weekly Reports** (`WeeklyReport`, `WeeklyReportRevision`, `WeeklyReportCoordination`; only optional downstream AI narrative calls `aiService`'s Redis `ai:response`)
  - **Notifications** (`Notification`, `NotificationState`, `NotificationReceipt`, `IntegrationGovernanceState` + Mongo Change Stream for SSE)
  - **Support** (`SupportTicket`, `SupportTicketDedupe`, `SupportTicketQuota`)
  - **Auth**, **Profile**, **Workflows** (`WorkflowRun`; `/api/analysis/portfolio-score` reads `AnalysisCache` in Mongo directly + `aiService` AI cache), **Recruiter**, **Admin** (only `performanceCache` in memory + Mongo), and **Super Admin** (only `settingsCache` in memory + Mongo).

### Q3. Which modules use frontend or in-memory caches?
- **Frontend `localStorage` Caches**: `RecommendationsComponent` (`24h`), `WeeklyReportService` (`15m`/`10m`), `ProfileService` (`5m`), `CareerProfileService` (session snapshot), `ResumeService` (`30d` helper exists, **unused** by component), `AuthService`, `TenantContextService`, `ThemeService`/`LandingThemeService`, `SaShellComponent` (`sa_nav_collapsed`), `FrontendAnalysisCacheService` writes by `DashboardComponent` (`60s` written, **never read** due to `forceRefresh = true`) and `SkillGapService` (writes `currentSignalHash` only).
- **Frontend In-Memory Caches**: `GithubService` (`<= 24h`), `RecommendationsService` (`15m` + `7m` previews), `CareerSprintService` (`12m` history only), `JobService` (`30s`), `NewsService` (`15s`/`5s`), `NotificationService` (`15s`), `SupportService` (`60s`), `ApiService.organizationsCache$` (unbounded), `RecruiterHubService` `dashboard$`/`analytics$` (unbounded), `AdminConsolePageComponent` `tabStates` (component lifetime), `Navbar.cachedRepos` (per handle, component lifetime). (`CourseService`, `InterviewPrepService`, `PublicProfileService`, `SkillGapService`, `ApiService` scenario reads only coalesce *in-flight* requests.)
- **Backend Process In-Memory Caches**: `redisCacheService.memoryCache` (`2000` entries, up to `3600s`; `30s` interview), `AIService.memoryCache` (`256` entries Redis fallback), `aiTaskService.planResultCache` (`300` entries, `120s`), `githubservice.memoryAnalysisCache` (**unbounded**, `24h`), `resumeservice.memoryResumeCache` (`128` entries, `30d`), `skillGapMemoryCache` (`200` entries, `60s`), `recommendationMemoryCache` (**unbounded**, `60s`), `recommendationGithubSources` (`500` entries, `60s`), `courseMemoryCache` (`80` / `32MB`, `60s` or `15s`), `sharedCourseCatalogService` (`memory`/`curatedMemory`/`revisionMemory`, `5–30s`), `courseCatalogSearchService.cache` (`32` / `16MB`, `30s`), `courseDiscoveryStatusService.memory` (`64`, `5s`), `courseService.youtubeCache` (`40`, `6h`/`10m`), `sprintOverviewCacheService.cache` (`500`, `60s`), `newsService.signalCache` (`250`, `15s`), `newsCatalogService.memory` (`128`, `5s`), `newsPoolService.memory` (`5s`), `newsDiscoveryService.memory` (`128`, `5s`), `jobPoolCacheService.memory` (`15s`), `jobController.coursePoolCache` (`64`, `15m`), `publicPortfolioCacheService.cache` (`200`, `5m` fresh / `1h` stale), `adminConsoleService.performanceCache` (**unbounded**, `5m`), `platformSettingsService.settingsCache` (`1` global object, `60s` for async; **no expiry check on `*Sync()`**), `securityMiddleware.loginAttemptStore` (**unbounded**, `30m` cleanup) & `express-rate-limit` `MemoryStore`.

### Q4. Which pages fetch fresh data on every navigation?
- **Always hit backend on every route entry**: `Dashboard`, `Resume Analyzer`, `Skill Gap` (except skips AI/compute if backend `signalHash` cache matches), `Learning Hub / Courses`, `Career Sprint` (`/current`), `Interview Prep`, `Scenario Simulator`, `Integrations Marketplace`, `Public Portfolio`, `AdminDashboard` / `AdminDevelopers` / `AdminActivityLogs` / `AdminJobs` / `AdminTeams` / `AdminRecruiters`, `SuperAdminDashboard` / `Analytics` / `Users` / `Orgs` / `Admins` / `Recruiters` / `Developers` / `Settings` / `AI Versions` / `ActivityLogs`, `RecruiterCandidates` / `Jobs` / `Matches` / `Shortlists` / `Profile` / `ActivityLogs`.
- *(Note: "fetching from backend" still returns cached backend data in Skill Gap, Courses, Interview Prep, Career Sprint `/current`, Public Portfolio, and Admin Performance unless bypassed.)*

### Q5. Which pages reuse cached results?
- **Client-side bypass of backend calls**: `Recommendations` (`24h` `localStorage` + `15m` memory), `Weekly Reports` (`15m`/`10m` `localStorage`), `Profile` (`5m` memory+`localStorage`), `GitHub Analyzer` (`24h` memory within SPA session), `Jobs` (`30s` memory), `Tech News` (`15s` feed / `5s` saved memory), `Notifications` (`15s` memory), `Support` (`60s` memory), `RecruiterDashboard` & `RecruiterAnalytics` (unbounded `shareReplay(1)` within module lifetime), `AdminConsole` tabs (tab state retained within page), `Navbar` org list (`organizationsCache$`).
- **Backend cached hits**: `GitHub` (24h SWR), `Resume` (30d), `Skill Gap` (60s mem / 15m Redis / 7d Mongo), `Recommendations` (60s mem / 15m Redis / 24h Mongo), `Courses` (30s catalog mem / 60s pool mem / 15m Redis / 6h Mongo), `Career Sprint` (60s mem / 2m Redis), `Interview Prep` (30s mem / 1–24h Redis), `Jobs Hub` (15s mem / 5m Redis / 36h Mongo), `Tech News` (5s mem / 20–30m Redis / 1–35d Mongo), `Integrations` manual profiles (5m Mongo `IntegrationPublicSnapshot`), `Public Portfolio` (5m fresh / 1h stale mem+Redis+Mongo), `Portfolio Score` (`AnalysisCache` Mongo up to 7d), `Admin Console Performance` (5m process memory), `Platform Settings` (60s async / stale-until-reloaded sync memory).

### Q6. What exactly happens on F5 and hard reload?
- **F5**: Clears JS memory; keeps `localStorage`. `Recommendations`, `Weekly Reports`, and `Profile` immediately render from `localStorage` without calling backend (until TTL expires or `signalHash` mismatches). Other authenticated pages call backend (`Dashboard` may receive HTTP `304` via `ETag`), which serves from backend process memory / Redis / Mongo cache.
- **Ctrl+Shift+R**: Same as `F5` for JS memory and `localStorage` (`Recommendations` / `Weekly Reports` / `Profile` still stay cached locally!), except browser bypasses its own HTTP `ETag` (`If-None-Match`), forcing HTTP `200` on `Dashboard` and re-fetching static assets. Still **never** bypasses backend Redis/memory/Mongo caches or calls GitHub/AI.

### Q7. Which modules have manual refresh buttons?
- **Have manual refresh**: `Dashboard` (`reanalyze`), `GitHub Analyzer` (`refreshAnalysis`), `Resume Analyzer` (`analyzeSelectedResume(true)`), `Skill Gap` (`refreshAnalysis`), `Recommendations` (`analyze(true)`), `Courses` (`refreshCourses` with 800ms cooldown), `Career Sprint` (`loadData(true)`), `Jobs Hub` & `Job Details` (Redis rate-limited 2/15m), `Tech News` (Redis rate-limited 3/1m), `Weekly Reports` (`refreshCurrentReport` / `generate(true)`), `Notifications`, `Integrations Marketplace` (`syncNow` per integration), `AdminDashboard`, `AdminPerformance`, `AdminConsole`, `AdminActivityLogs`, `SuperAdminSettings` (`reload`). *(Also `InterviewPrep` `loadCatalog` re-fetches backend cache without bypass flag, and `ScenarioSimulator` reloads context on profile change with `forceRefresh=true`.)*
- **Lack dedicated manual refresh buttons**: `RecruiterDashboardComponent`, `RecruiterAnalyticsComponent`, `SuperAdminDashboardComponent`, `SaAnalyticsComponent`, `Support`, `ProfileComponent` (relies on initial load / reload).

### Q8. Which modules refresh automatically?
- **Server-side background automatic refresh**: `Jobs Hub` (`jobSourceSyncService` every 4h), `Tech News` (`newsService` 1m tick + 5s `newsDiscoveryService` worker + 1h adaptive prewarm check), `Courses` (`courseCatalogMaintenanceService` hourly `:17` + every-minute discovery/official sync), `Integrations` (`integrationSyncService` 5m tick for 30m-due connections), `Interview Prep` (`6h` scraper ingestion + `4h` `:30` pool maintenance), `Weekly Reports` (`node-cron` Monday `08:00` + standalone 60s worker), `Notifications` (hourly retention if 3 opt-in flags set; SSE push via Mongo Change Stream + 15s keep-alive/reconcile), `Core Email Queue` (30s retry sweep for invitations, support & weekly report emails).
- **Frontend automatic refresh / revalidation**:
  - `Notifications`: Live SSE push (`1s` coalescing `auditTime(1000)`) + `60s` polling fallback (`5m` safety net when SSE connected).
  - `Tech News`: Bounded `setTimeout` catalog polling (`max 4` checks when `discovery` in-flight) + `focus`/`visibility`/`online` if stale >30s.
  - `Courses`: Exponential backoff `setTimeout` discovery polling (`5s`..`30s`, max `6` / `120s`) when `discovery.status === 'pending'`.
  - `Jobs Hub`: Revalidates on `focus` (>30s stale) & `online`.
  - `Career Sprint`: Revalidates on `window:focus`.
  - `Integrations`: Revalidates on `pageshow` (`persisted`).
  - `Public Portfolio`: Revalidates on `focus`/`visibilitychange` (>250ms throttle) and `BroadcastChannel` (`devinsight-portfolio`).
  - `Profile` / `CareerProfile` / `Auth`: Cross-tab `localStorage` `storage` event listeners + session expiry timer (`exp - 60s`).

### Q9. What are the exact configured TTLs and scheduler intervals?
*(Full table in `REDIS-AND-CACHE-INVENTORY.md` and `SCHEDULERS-AND-BACKGROUND-JOBS.md`.)*
- **Key Backend TTLs**: AI response `86400s` (24h); AI deterministic `600s` (10m); GitHub `86400s` (24h SWR); Resume `2592000s` (30d); Skill Gap `60s` mem / `900s` Redis / `7d` Mongo; Recommendations `60s` mem / `900s` Redis / `24h` fresh (`7d` schema); Courses `30s` catalog mem / `60s` pool mem / `900s` Redis / `6h` Mongo (`7d` TTL), YouTube catalog `6h` fresh / `7d` stale; Career Sprint `60s` mem / `120s` Redis (plan `120s`); Interview Prep `30s` mem / `43200s` (12h top) / `10800s` (3h all/mix) / `3600s` (1h search) / `86400s` (24h custom); Jobs `15s` mem / `300s` Redis / `36h` fresh (`7d` retention); News `5s` mem / `1200s` pool (`1800s` topic, `5s` query) Redis / `1–35d` Mongo (`15s` signal cache); Integrations public snapshot `300s` (5m); Public Portfolio `300s` fresh / `3600s` stale; Admin Console Performance `300s` (5m mem); Super Admin Settings `60s` async mem.
- **Key Schedulers**: News tick `60s` (discovery worker `5s`, prewarm eval `1h`); Email retry `30s`; Integrations sync `5m` (default `30m` per connection); Weekly Reports standalone worker `60s` + cron `0 8 * * 1` (`Asia/Karachi`/host tz); Courses hourly `17 * * * *` + every minute `* * * * *`; Notifications retention `60m` (opt-in) + SSE keep-alive `15s`; Jobs sync `4h`; Interview maintenance `30 */4 * * *` & ingestion `0 */6 * * *`.

### Q10. Which modules generate new results only on demand?
- `Resume Analyzer` (PDF extraction + scoring + AI focus areas only on upload / analyze)
- `GitHub Analyzer` (live API + AI insights on demand or SWR refresh when stale)
- `Skill Gap`, `Recommendations` (AI enrichment only on `forceRefresh: true`), `Courses` personalization pool (on-demand read; catalog via scheduler)
- `Career Sprint` plan generation (`POST /generate-plan`, `POST /generate-ai-plan`), `Interview Prep` custom Q&A & session generation (`/generate`, `/ask-question`, `/`), `Scenario Simulator` (`what-if`, `save`, `create-sprint`), `Workflows` (`/api/workflows`, `/api/analysis/portfolio-score`, `/api/preview/resume/parse-text`)
- `Recruiter Matching` & `AI Candidate Ranking`, `Admin AI Rank`, `Public Portfolio` cache build (on view miss).

### Q11. Which modules can show stale data?
- **Frontend `localStorage` surviving F5/hard reload**: `Recommendations` (`24h` if `currentSignalHash` matches or is absent), `Weekly Reports` (`10–15m` across tabs if generated elsewhere), `Profile` (`5m` in another tab if updated on server without triggering cross-tab `storage`).
- **Frontend unbounded memory**: `ApiService.organizationsCache$` (not cleared on logout/role switch!), `RecruiterHubService` `dashboard$`/`analytics$` (no TTL, not cleared on logout), `AdminConsolePageComponent` `tabStates`, `SupportService` after `409` error (`SaSupportDetailComponent` re-reads 60s cached ticket).
- **Admin Lists staying stale after mutation**: `AdminJobsPageComponent` & `AdminTeamsPageComponent` (`distinctUntilChanged` + `patchQuery` early-return drops `refreshCurrentPage()` on same page).
- **Backend stale / multi-worker**:
  - `Super Admin PlatformSettings`: `getSettingsSnapshotSync()` **ignores `expiresAt`**; other workers never see `PUT /settings` updates until `GET /settings` hits them; `--api-only` skips startup warmup.
  - `Admin Console Performance`: `5m` single-process Map with no write invalidation.
  - `Portfolio Score` (`analysiscontroller.js:71-100`): `AnalysisCache` `portfolio-score-v1` key omits GitHub timestamp/hash, so updated GitHub scores don't invalidate cached portfolio scores for up to `7d`.
  - `GitHub` (`24h` intentional SWR), `Courses` (`redisCacheService` 3600s memory promotion extends `900s` Redis TTL if `catalogRevision`/`evidenceFingerprint` unchanged; cross-worker 30s catalog memory), `Jobs` (`36h` fresh / up to `7d`), `News` (`20–30m` fresh / up to `24h` stale pool).

### Q12. Which caches invalidate automatically after writes?
- **Verified working backend invalidations**: `CareerSprint` (`overviewCache.invalidate(userId)` + `invalidateNewsSignalCache` on task/sprint writes), `Resume` (`invalidateResumeDependents` clears `skill_gap:result:<userId>:` prefix in Redis/AI cache), `Profile` (`invalidateNewsSignalCache` when `profileHash` changes), `Integrations` (`ownerFence` + `invalidateCareerSprintCache` + `portfolioIntegrationRevision` key bump), `Interview Prep` (`invalidateInterviewPrepCache` rotates global/topic revision UUID + `deleteCacheKey` on custom session delete), `Courses` (`shared`/`search` clear memory on local worker + bump `catalogRevision` in Mongo), `Public Portfolio` (content-addressed key hash naturally busts stale revisions across all workers).
- **Hash/Revision self-invalidating (no explicit delete needed when upstream timestamps/hashes change)**: `Skill Gap v9` (`signalHash`), `Recommendations v7` (`sourceFingerprint`/`signalHash`), `Career Sprint overview v4` (`revision`), `Dashboard` (reads Mongo live on every request).
- **No-op or broken backend invalidations**: `invalidateDashboardSummaryCache` (no-op everywhere — harmless because Dashboard reads live Mongo), `invalidateContextCache` (no-op — harmless because Scenario context is uncached), `githubservice.js:39,2153` (`invalidateSkillGapCachesForGitHub` deletes `analysisVersion: 'v6-skill-intelligence'` instead of `'v9-skill-evidence-governance'`), `adminConsoleService.performanceCache` (no invalidation on admin writes), `platformSettingsService.settingsCache` (single-process only).
- **Frontend invalidations**: `FrontendCacheInvalidationService.clearDeveloperSignalCaches()` is wired cleanly to GitHub/Resume/CareerProfile/Integrations/SkillGap/Recommendations/CareerSprint/WeeklyReport writes, while `JobActionsService`, `SupportService`, `RecruiterHubService` clear only their own cache. Missing: `ApiService.organizationsCache$` and `RecruiterHubService` on logout; `AcceptInvitationComponent` skips `storeSession()`/`clearAllUserCaches()`.

### Q13. Which background jobs depend on external APIs or AI?
- **`jobSourceSyncService`** (every 4h): External Jobs APIs (`Remotive`, `Arbeitnow`, `RemoteOK`, and conditionally `JSearch`, `Jooble`, `Adzuna`); **no AI**.
- **`newsService` + `newsDiscoveryService`** (1m tick / 5s queue / 1h prewarm eval): External news/developer APIs (`NewsAPI`, `GNews`, `Hacker News`, `Dev.to`, `Reddit`, `GitHub Releases/Advisories`, `Lobsters`, `Kubernetes Blog`, `Cloudflare Changelog`); **no AI**.
- **`courseCatalogMaintenanceService` / `Acquisition` / `Discovery`** (`17 * * * *`, `* * * * *`): Headless `HEAD` URL checks, GitHub raw JSON (`freeCodeCamp`), YouTube Data API v3 (`YOUTUBE_API_KEY`); **no AI**.
- **`integrationSyncService`** (5m tick): GitHub OAuth/REST, LinkedIn OAuth/UserInfo, LeetCode GraphQL, Stack Exchange API, Dev.to API, Kaggle API, user portfolio URLs; **no AI**.
- **`interviewQuestionIngestionService`** (`0 */6 * * *`): Dev.to API + GitHub Issues Search; **no AI**.
- **`interviewQuestionMaintenanceService`** (`30 */4 * * *`): Local verified seeds only by default (`allowAI: false`); **no external API or AI** under default config.
- **`weeklyReportService` scheduler / worker** (`0 8 * * 1`, 60s poll): Calls **`aiService.runAIAnalysis` (paid AI)** with deterministic fallback + SendGrid/SMTP email; **triggers AI on scheduled batch runs**.
- **`emailRetryQueueService`** (30s): SMTP / SendGrid email only.
- **`notificationRetentionService`** (60m opt-in): MongoDB only.

### Q14. Which areas are inefficient or incorrectly implemented?
1. **`platformSettingsService.getSettingsSnapshotSync()` (`platformSettingsService.js:359`)** ignores `expiresAt` (`CACHE_TTL_MS = 60s`), never reloads from Mongo, and `updateSettings()` updates only the current worker — breaking multi-worker consistency for `maintenanceMode`, rate limits, AI settings, and OTP/JWT config.
2. **`redisCacheService.getCacheJsonWithMeta()` (`redisCacheService.js:216`)** promotes non-interview Redis hits into `memoryCache` with `CACHE_TTL_SECONDS = 3600s` instead of reading remaining Redis `PTTL`, extending shorter TTLs (e.g., 120s Career Sprint / 900s Courses / 1800s Preview) up to 1 hour in process memory.
3. **Unlocked / multi-instance redundant workers**:
   - `interviewQuestionMaintenanceService.js` (`30 */4 * * *`) lacks `runInterviewJob` leasing, running simultaneously on all instances.
   - `redisCacheService.js:173` resets shared `interview:revision:global` whenever *any* single instance reconnects to Redis, busting cluster-wide interview caches.
4. **Stale / missing invalidations & bugs**:
   - `AdminJobsPageComponent` & `AdminTeamsPageComponent` drop list refreshes after same-page mutations due to `distinctUntilChanged` + `patchQuery` guard.
   - `AdminDashboardComponent.refreshAll()` / `Dashboard` (`adminConsoleService.performanceCache` 5m) lack write invalidation.
   - `ApiService.organizationsCache$` & `RecruiterHubService` `dashboard$`/`analytics$` have no TTL and are skipped by `clearAllUserCaches()` on logout/role switch.
   - `SaSupportDetailComponent` `onStatusChange()` `409` handler re-fetches 60s cached ticket without `clearCache()`.
   - `matchingService.js:719` & `admin/jobController.js:145` omit `organizationId` in `listCandidates`, returning `[]` when `candidateVisibility === 'organization'`.
   - `analysiscontroller.js:71-100` `portfolio-score-v1` `AnalysisCache` key omits GitHub analysis hash/timestamp (up to 7d staleness).
   - `githubservice.js:39` `invalidateSkillGapCachesForGitHub` targets legacy `'v6-skill-intelligence'` instead of `'v9-skill-evidence-governance'`.
   - Dead/unwired code: `Dashboard`'s `Stats` model & `invalidateDashboardSummaryCache` no-op; `ResumeService` 30d `localStorage` cache unused by component; `PlatformSettings.analytics.refreshIntervalMinutes`/`dashboardCacheMinutes` unwired; `ApiService.getScenarioSimulationHistory(forceRefresh)` drops `forceRefresh`.
5. **Unbounded process memory Maps**: `githubservice.memoryAnalysisCache`, `recommendationMemoryCache`, `adminConsoleService.performanceCache`, `securityMiddleware.loginAttemptStore` (entry count unbounded), `express-rate-limit` default `MemoryStore` (global/auth limits not shared across instances).

### Q15. What changes, if any, should be recommended?
*(Recommendations only — NOT applied in this read-only audit.)*
1. **High Priority (Correctness / Security / Multi-Worker)**:
   - Wire `Redis` pub/sub or periodic async refresh + `expiresAt` check for `platformSettingsService` so `maintenanceMode` and security settings propagate across all workers.
   - Use Redis `PTTL` (or Lua `GET`+`PTTL`) for all keys in `redisCacheService.getCacheJsonWithMeta()` so process memory never outlives Redis TTL.
   - Fix `matchingService.js:719` & `admin/jobController.js:145` (`organizationId` propagation) and `AdminJobsPageComponent`/`AdminTeamsPageComponent` forced refresh trigger (`refreshCounter$`).
   - Register `ApiService.organizationsCache$` & `RecruiterHubService` with `FrontendCacheInvalidationService.clearAllUserCaches()`, fix `AcceptInvitationComponent` to use `storeSession()`, and clear `SupportService` cache on `409` in `SaSupportDetailComponent`.
   - Wrap `interviewQuestionMaintenanceService` in `runInterviewJob` distributed lease and include GitHub revision/timestamp in `portfolio-score-v1` `AnalysisCache` key.
2. **Medium Priority (Performance & Cleanup)**:
   - Bound `githubservice.memoryAnalysisCache`, `recommendationMemoryCache`, and `adminConsoleService.performanceCache` (and invalidate `performanceCache` on Admin writes or migrate to Redis).
   - Remove/align dead `v6-skill-intelligence` delete filter in `githubservice.js`, dead `ResumeService` `localStorage` helper (or wire carefully with hash checks), unwired `PlatformSettings.analytics` cache/refresh UI fields, and forward `forceRefresh` in `getScenarioSimulationHistory`.
   - Move `emailRetryQueueService`, `integrationSyncService`, `jobSourceSyncService`, `weeklyReportService`, and `interviewQuestion*` stop hooks into `backend/index.js` `shutdown()` for clean restarts.


## Implementation addendum — 2026-11-17

GitHub page entry now submits savedOnly:true to the existing authenticated POST /api/github/analyze-save route. It reads the owner accepted revision without invoking GitHub or AI. Explicit Sync GitHub retains the existing analysis/save workflow. Dashboard receives scoped invalidation events and remains a read-only aggregator.

The original audit above is historical source evidence. Current implementation and acceptance limits are recorded in [DEVELOPER-DATA-FRESHNESS-FINAL.md](DEVELOPER-DATA-FRESHNESS-FINAL.md) and [DEVELOPER-MODULE-REFRESH-TEST-MATRIX.md](DEVELOPER-MODULE-REFRESH-TEST-MATRIX.md).
