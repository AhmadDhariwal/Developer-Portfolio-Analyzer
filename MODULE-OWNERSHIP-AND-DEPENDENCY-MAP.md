# Module Ownership and Dependency Map

**Verified Baseline:** `22` backend domain modules under `backend/src/modules/`, `backend/src/core/` (`9` infrastructure subsystems), `68` Mongoose models, `30` Express router mounts (`260+` HTTP endpoints), and `7` Angular feature domains (`core/`, `shared/`, `features/{public,auth,developer,notifications,recruiter,admin,super-admin}`). Static module graphs report `0` circular dependencies on both frontend and backend.

---

## 1. Backend Module Ownership & Data Boundaries

| Domain Module (`backend/src/modules/*`) | Owned Mongoose Models | Owned Routes | Authoritative Services | Cross-Module Reads (Consumes) | Downstream Consumers (Publishes To) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`auth`** | `User`, `Otp`, `PendingRegistration`, `AccountDeletionCleanup` | `/api/auth` | `authcontroller`, `oauthAuthService`, `accountDeletionService` | `Organization`, `Team`, `Membership`, `Invitation` (`admin`); `PlatformSettings` (`super-admin`); `core/messaging` | **All modules** (`User` identity, `sessionRevision`, `organizationId`, `isPublic`, `active*` context) |
| **`profile`** | *(none — mutates `User` & `StoredAsset`)* | `/api/profile` | `profilecontroller` | `User` (`auth`), `StoredAsset` (`core/storage`), `newsService` signal invalidation | `SkillGap`, `Recommendations`, `Dashboard`, `PublicProfile`, `Recruiter` |
| **`dashboard`** | `Stats` *(legacy/unused)* | `/api/dashboard` | `dashboardcontroller`, `dashboard{Metrics,Progress,History,Query}Service` | `User`, `Analysis`, `ResumeAnalysis`, `AnalysisCache`, `Recommendation`, `CareerSprint`, `WeeklyReport`, `IntegrationInsight`, `UserCourseProgress` | Frontend `DashboardComponent` (terminal read-only aggregator) |
| **`github`** | `Analysis`, `Repository`, `GitHubAnalysisCache`, `GitHubSaveLock` | `/api/github` | `githubcontroller`, `githubservice`, `githubLanguagePresentation` | `User`, `core/ai`, `core/cache`, `core/scoring` | `Dashboard`, `SkillGap`, `Recommendations`, `PublicProfile`, `Recruiter` (`Analysis.githubScore`, `missingSkills`) |
| **`resume`** | `ResumeFile`, `ResumeAnalysis`, `ResumeAnalysisCache` | `/api/resume` | `resumecontoller`, `resumeservice`, `resumeGuideService`, `previewResumeCacheService` | `User`, `StoredAsset`, `IntegrationGovernanceState`, `core/ai`, `core/cache` | `Dashboard`, `SkillGap`, `Recommendations`, `PublicProfile`, `Recruiter` (`ResumeAnalysis`), `workflows` (`/api/preview`) |
| **`skill-gap`** | `Analysis`, `AnalysisCache`, `Skill`, `SkillGraph` | `/api/skillgap`, `/api/skill-graph` | `skillgapcontroller`, `9` domain services (`skillGapCacheContract`, etc.) | `User`, `Analysis`, `ResumeAnalysis`, `IntegrationInsight`, `core/ai`, `core/cache` | `Dashboard`, `Recommendations`, `ScenarioSimulator`, `Courses`, `workflows` (`portfolio-score`) |
| **`recommendations`** | `Recommendation` | `/api/recommendations` | `recommendations.controller`, `recommendationService`, `recommendationGenerationService` | `User`, `Analysis`, `ResumeAnalysis`, `AnalysisCache`, `SavedPreview`, `core/ai` | `Dashboard`, `PublicProfile` |
| **`courses`** | `UserCourseProgress` *(+ native shared catalog collections)* | `/api/courses` | `courseController`, `sharedCourseCatalogService`, `courseCatalogMaintenanceService`, `courseRecommendationService` | `User`, `AnalysisCache`, `IntegrationGovernanceState`, `SkillGap` evidence | `Dashboard`, `Jobs` (`coursePoolCache`), `WeeklyReports` |
| **`jobs`** | `JobCache`, `JobSourceHealth`, `UserJobAction` | `/api/jobs` | `jobController`, `jobService`, `jobSourceSyncService`, `jobActionService`, `jobPoolCacheService` | `User`, `CareerProfile`, `Courses` pool, `core/cache` (Redis rate limits/pool) | `Dashboard` (cache freshness only) — **Isolated from `recruiter` `Job`** |
| **`interview-prep`** | `InterviewQuestionBank`, `InterviewPrepSession`, `InterviewJobLease`, `InterviewCoordination` | `/api/interview-prep` | `interviewPrepController`, `interviewPrepService`, `interviewQuestionIngestionService`, `interviewQuestionMaintenanceService` | `User`, `PublicProfile`/`Analysis` project context, `core/ai`, `core/cache` | `Dashboard`, `WeeklyReports` — **Isolated from `recruiter` hiring stages** |
| **`career-sprint`** | `CareerSprint`, `SprintPreference`, `SprintSchedule` | `/api/career-sprints` | `careerSprintController`, `careerSprintService`, `sprintOverviewCacheService` | `User`, `AnalysisCache`, `IntegrationGovernanceState`, `core/ai`, `core/cache` | `Dashboard`, `WeeklyReports`, `Recruiter` (`consistencyScore`, `growthPotentialScore`), `ScenarioSimulator` (export hook) |
| **`scenario-simulator`** | `ScenarioSimulation` | `/api/simulator` | `scenarioSimulatorController`, `scenarioContextService`, `scenarioSprintExportService` | `User`, `AnalysisCache`, `SkillGap`, `ResumeAnalysis` | `CareerSprint` (via `registerSprintExportHooks`) |
| **`integrations`** | `IntegrationConnection`, `IntegrationInsight`, `IntegrationSyncLog`, `IntegrationLinkedProfile`, `IntegrationPublicSnapshot`, `IntegrationGovernanceState` | `/api/integrations` | `integrationsController`, `integrationSyncService`, `integrationPersistenceService`, `14` adapters | `User` | `Dashboard`, `SkillGap`, `CareerSprint` (cache invalidation hook), `PublicProfile`, `workflows` |
| **`news`** | `News`, `NewsArticle`, `NewsSavedItem`, `NewsTopicCache` | `/api/news` | `newsController`, `newsService`, `newsCatalogService`, `newsDiscoveryService`, `newsAdaptiveService` | `User`, `CareerSprint` & `Profile` signal invalidators, `core/cache` | `Dashboard` (freshness metadata) |
| **`public-portfolio`** | `PublicProfile`, `PublicProfileCache`, `PublicPortfolioVisit`, `PublicProfileView` | `/api/public-profiles` | `publicProfile.controller`, `publicPortfolioService`, `publicPortfolioCacheService` | `User`, `Analysis`, `ResumeAnalysis`, `Recommendation`, `IntegrationInsight`, `core/cache` | `Recruiter` (`PublicProfile.skills`, `projects`, `slug`) |
| **`weekly-reports`** | `WeeklyReport`, `WeeklyReportRevision`, `WeeklyReportCoordination` | `/api/weekly-reports` | `weeklyReportController`, `weeklyReportService`, `weeklyReportDeliveryService` | `User`, `Analysis`, `ResumeAnalysis`, `CareerSprint`, `UserCourseProgress`, `Notification`, `core/ai` | `Dashboard`, `Notifications`, `Recruiter` (`consistencyScore`, `growthPotentialScore`) |
| **`notifications`** | `Notification`, `NotificationReceipt`, `NotificationState` | `/api/notifications` | `notificationcontroller`, `notificationService`, `notificationStreamService`, `notificationRetentionService` | `User`, `IntegrationGovernanceState` | **All roles** (Developer & Recruiter UI inbox + SSE push) |
| **`support`** | `SupportTicket`, `SupportTicketDedupe`, `SupportTicketQuota` | `/api/support` | `support.controller`, `support.service` | `User`, `core/messaging` | `SuperAdmin` support queue |
| **`workflows`** | `WorkflowRun` | `/api/workflows`, `/api/analysis`, `/api/preview` | `workflowcontroller`, `analysiscontroller` | `AnalysisCache`, `Analysis`, `ResumeAnalysis`, `IntegrationInsight`, `core/scoring`, `core/ai` | `Dashboard` (`portfolio-score-v1`), `Public` landing resume preview |
| **`recruiter`** | `Job`, `RecruiterMatch`, `RecruiterShortlist`, `Candidate` *(legacy)*, `Recruiter` *(legacy)* | `/api/recruiter-hub/*`, `/api/recruiter/*` *(legacy)* | `hub/*` (`candidateService`, `recruiterJobService`, `matchService`, `shortlistService`, `comparisonService`, `recruiterDashboardService`, `recruiterAnalyticsService`, `recruiterActivityService`, `recruiterReportingService`, `recruiterSummaryCache`, `recruiterProfileService`) + `matching/*` (`matchingService`, `aiRankingService`, `jobLifecycleService`) | `User`, `Organization`, `Team`, `Membership`, `AuditLog`, `PlatformSettings`, `Analysis`, `ResumeAnalysis`, `PublicProfile`, `CareerSprint`, `WeeklyReport`, `core/cache` | `Admin` (`jobController`, `adminConsoleService` via `recruiterReportingService`), `SuperAdmin` analytics |
| **`admin`** | `Organization`, `Team`, `Membership`, `Invitation`, `AuditLog` | `/api/admin`, `/api/admin-console`, `/api/tenant`, `/api/audit-logs` | `adminController`, `adminConsoleController`, `adminConsoleService`, `recruiterController`, `tenantcontroller`, `jobController` | `User`, `Job`, `RecruiterMatch`, `RecruiterShortlist`, `recruiterReportingService`, `core/messaging` | `Recruiter` (org/team membership, invitations, audit stream), `SuperAdmin` (`AuditLog`, `Organization`, `Membership`) |
| **`super-admin`** | `PlatformSettings`, `AIVersion` | `/api/super-admin`, `/api/ai-versions` | `superAdminController`, `superAdminAnalyticsService`, `superAdminSettingsController`, `platformSettingsService` | **All role & tenant collections** (`User`, `Organization`, `Team`, `Membership`, `AuditLog`, `SupportTicket`, `Job`, `RecruiterMatch`) | **All modules** via `PlatformSettings` (`maintenanceMode`, `recruiter.candidateVisibility`, `recruiterAccess`, `developerAccess`, OTP/JWT limits) |

---

## 2. Core Infrastructure Ownership (`backend/src/core/`)

| Subsystem | Key Files | Role |
| :--- | :--- | :--- |
| **`core/ai`** | `aiservice.js`, `aiProviderManager.js`, `aiProviderAdmissionService.js`, `aiTaskService.js`, `models/{aiProviderAdmission,savedPreview}.js` | Multi-provider LLM chain (`Gemini → OpenAI → Groq → Anthropic → xAI`), concurrency/RPM/RPD admission in Mongo, `24h` Redis response cache. |
| **`core/cache`** | `redisCacheService.js` | Shared Redis/Upstash client, atomic `GET+PTTL` Lua snapshot, bounded L1 `memoryCache` (`2000`), atomic Lua lock release, graceful degradation when Redis unavailable. |
| **`core/middleware`** | `authmiddleware.js`, `orgMiddleware.js`, `platformSettingsMiddleware.js`, `securityMiddleware.js`, `auditLogMiddleware.js`, `storedImageMiddleware.js` | JWT `protect` + `sessionRevision` revocation check, RBAC `authorizeRoles`, org membership enforcement, `PlatformSettings` gates, rate limiting, audit logging. |
| **`core/messaging`** | `emailRetryQueueService.js`, `invitationEmailService.js`, `models/emailDeliveryJob.js` | SendGrid + SMTP delivery with `30s` retry worker (`EmailDeliveryJob`). |
| **`core/storage`** | `b2ObjectStorageService.js`, `publicImageStorageService.js`, `storageCleanupWorkerService.js`, `models/storedAsset.js` | Backblaze B2 object storage + local filesystem fallback + signed media cookies. |
| **`core/scoring`** | `githubHealthScore.js`, `resumeOverallScore.js`, `portfolioScore.js`, `sprintProgressScore.js`, `scenarioPlanningScore.js`, etc. | Deterministic scoring formulas shared across modules. |
| **`core/developer-context`** | Canonical active developer identity (`activeGithubUsername`, `activeResumeFileId`, `activeCareerStack`, `activeExperienceLevel`) | Single source of truth preventing stale handle/resume drift across Developer modules. |
| **`core/observability`** | `logger.js`, `metricsService.js`, `tracingService.js`, `requestLogPath.js` | Prometheus `/metrics`, OpenTelemetry tracing, structured JSON logs with PII-safe request paths. |

---

## 3. Frontend Module Ownership & Dependency Boundaries (`frontend/src/app/`)

```text
app.routes.ts
 ├── public (eager: Landing, Legal, Docs, Blog, Contact, PublicPortfolio /p/:slug, AcceptInvitation)
 ├── auth   (eager: Login, Signup, OTP, Forgot/Reset Password, OAuth Callback)
 └── MainLayout (/app, guarded by authGuard)
      ├── developer (eager child routes: /app/dashboard, /app/github-analyzer, /app/resume-analyzer,
      │              /app/skill-gap, /app/recommendations, /app/courses, /app/jobs, /app/jobs/:id,
      │              /app/integrations, /app/scenario-simulator, /app/profile, /app/support,
      │              /app/portfolio, /app/weekly-reports, /app/interview-prep, /app/career-sprint,
      │              /app/interviews-reports, /app/news)
      ├── notifications (role-neutral standalone feature mounted at /app/notifications & /app/recruiter/notifications)
      ├── recruiter (lazy RecruiterModule at /app/recruiter/* — guarded by noAdminTabsGuard + recruiterRoleGuard)
      ├── admin (lazy AdminModule at /app/admin/* — guarded by noAdminTabsGuard + adminSettingsGuard)
      └── super-admin
           ├── /app/settings/* (MainLayout + superAdminGuard: platform-settings, ai-versions, user-management, activity-logs)
           └── /super-admin/* (lazy SuperAdminModule inside SaShellComponent + superAdminGuard)
```

### Shared Frontend Services (`frontend/src/app/shared/services/`)
- **Session & Tenant:** `AuthService` (`adoptSession`, `canAccessUrl`, `getHomeRoute`), `TenantContextService` (`devinsight_tenant_context`).
- **Cache Coordination:** `FrontendAnalysisCacheService` (`localStorage` TTL + `signalHash`), `FrontendCacheInvalidationService` (`clearDeveloperSignalCaches()`, `clearAllUserCaches()`).
- **Domain API Facades:** `ApiService` (central HTTP client — retains both active endpoints and legacy `/recruiter/*` methods), plus dedicated domain services (`GithubService`, `ResumeService`, `SkillGapService`, `RecommendationsService`, `CourseService`, `JobService`, `JobActionsService`, `NewsService`, `NotificationService`, `ProfileService`, `PublicProfileService`, `IntegrationsService`, `InterviewPrepService`, `CareerSprintService`, `ScenarioSimulatorService`, `WeeklyReportService`, `SupportService`, `MaintenanceModeService`, `ThemeService`).

---

## 4. Critical Structural Disconnections & Overlaps

1. **Disconnected Job & Application Domains:** `modules/jobs` (external public feeds + boolean `UserJobAction`) and `modules/recruiter/models/Job` (internal organization requisitions) share zero models, APIs, or UI flows.
2. **Disconnected Interview Domains:** `modules/interview-prep` (Developer self-study Q&A) and `RecruiterShortlist.status = 'interview'` (Recruiter pipeline stage label) have zero shared data or scheduling/feedback integration.
3. **Creator-Only Recruiter Isolation vs Organization Teams:** `Job`, `RecruiterMatch`, and `RecruiterShortlist` reference `teamId` (`Membership` & `Team` exist), yet all Recruiter Hub queries filter by `{ recruiterId, organizationId }`, preventing team-based collaboration.
4. **Dual Admin & Dual Super Admin Surfaces:** Org Admin has overlapping `/app/admin/dashboard` + `/app/admin/teams` alongside `/app/admin/console` + `/app/admin/console/performance-statistics`; Super Admin has both `/super-admin/*` (`SaShellComponent`) and `/app/settings/*` (`MainLayout`).
5. **Legacy Recruiter Compatibility Surface:** `/api/recruiter/*`, `Candidate.js`, `Recruiter.js`, and legacy `ApiService.*Recruiter*` methods remain alongside canonical `/api/recruiter-hub/*` and `User.js`.
6. **Residual Empty Directories:** Empty `backend/src/services/` and `backend/src/jobSources/` folders remain on disk after domain modularization.

