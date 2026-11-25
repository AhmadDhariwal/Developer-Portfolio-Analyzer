# Recruiter Module — Security, Caching, AI & Cross-Module Dependency Audit

**Audit Scope:** Verification of authentication, RBAC, multi-tenancy, input validation, caching/refresh behavior, AI/background processing, and cross-module dependencies.

---

## 1. Security & Multi-Tenancy Audit

### 1.1 Authentication & RBAC

| Control | Implementation | Status | Findings |
| :--- | :--- | :--- | :--- |
| JWT Auth (`protect`) | `authmiddleware.js` (L17–74): HS256, issuer `devinsight-api`, audience `devinsight-web`, `sessionRevision` check, `isActive !== false` check. | **Verified** | Strong baseline; revoking a recruiter (`isActive: false`) immediately blocks API calls. |
| Role Enforcement (`authorizeRoles('recruiter')`) | `authmiddleware.js` (L96–113) applied on both `/api/recruiter` and `/api/recruiter-hub`. | **Defective (Super Admin Edge Case)** | `super_admin` globally bypasses `authorizeRoles('recruiter')` AND `requireOrganizationContext` sets `req.organizationId = null`. Calling `/api/recruiter-hub/*` as `super_admin` passes `organizationId: ""` into `Membership.find(...)` in `recruiterAccess.js`, causing a Mongoose `CastError` (`500`). |
| Platform Kill-Switch (`requireRecruiterAccessEnabled`) | `platformSettingsMiddleware.js` (L5–15) checks `getRecruiterSettingsSync().enableRecruiterAccess`. | **Verified** | Returns `403` across both routers when disabled by Super Admin (subject to 60s settings cache TTL). |
| Frontend Guards | `authGuard` (`AuthService.canAccessUrl`), `noAdminTabsGuard`, `recruiterRoleGuard`. | **Defective** | `AuthService.canAccessUrl()` blocks recruiters from `/app/profile` and `/app/integrations`, conflicting with `SidebarComponent` links and `acceptInvite` onboarding redirect. |

### 1.2 Multi-Tenancy, `organizationId` Scoping & Recruiter Ownership

| Area | Scoping Rule Observed | Status | Vulnerability / Gap |
| :--- | :--- | :--- | :--- |
| **Hub Jobs** (`/api/recruiter-hub/jobs/*`) | `{ recruiterId, organizationId }` + `assertRecruiterTeamAccess` if `teamId` provided. | **Verified** | Properly isolated by both org and recruiter ownership. |
| **Legacy Jobs** (`/api/recruiter/*`) | `matchingService.js` (`listJobs`, `updateJob`, `deleteJob`) filters by `{ _id, organizationId }` **without `recruiterId`**. | **Defective (Horizontal Privilege Escalation within Org)** | Any recruiter in an org can list, modify, or delete jobs owned by other recruiters or admins via `/api/recruiter/jobs`, `PUT /api/recruiter/job/:id`, `DELETE /api/recruiter/job/:id`. |
| **Hub Matches & Shortlists** | `RecruiterMatch` and `RecruiterShortlist` queries filter by `{ recruiterId, organizationId }`. | **Verified** | Isolated per recruiter within org. Unique index on `RecruiterMatch` is `{ recruiterId, jobId, candidateId }` (omits `organizationId`, low risk unless recruiter switches orgs). |
| **Candidate Visibility Scoping** | `matchingService.listPublicDeveloperUserIds({ organizationId })` honors `PlatformSettings.recruiter.candidateVisibility` (`public` vs `organization` vs `private`). | **Defective (Missing `organizationId` in 4 Callers)** | `controllers/matching/dashboardController.js` (L18), `matchingService.matchCandidatesToJob` (L719), `controllers/matching/matchController.js` (L52, L60), and `admin/controllers/jobController.js` (L145) call `listCandidates()` **without** `organizationId`. When `candidateVisibility === 'organization'`, these endpoints silently return `0` candidates. |
| **Candidate Identity (`Candidate._id` vs `User._id`)** | `mergeCandidates` (`matchingService.js` L373) overwrites `id` with `Candidate._id` when a `Candidate` doc exists; `RecruiterMatch`/`RecruiterShortlist` store `candidateId` with `ref: 'User'`. | **Defective** | If legacy `Candidate` docs exist for a user, `CandidatesComponent` and `matchCalculator` submit `Candidate._id` instead of `User._id`, splitting references across collections and breaking `RecruiterMatch`/`RecruiterShortlist` lookups by `User._id`. |
| **Direct Candidate Fetch (`getCandidateById`)** | Checks `listPublicDeveloperUserIds({ organizationId })` before returning `Candidate` or `User`. | **Verified** | Prevents fetching non-public or out-of-org (when org-scoped) developer profiles by ID. |

### 1.3 Input Validation & Injection Risks

1. **Defective — Unescaped Regex in `listCandidates` (`matchingService.js` L453):**
   - `const regex = new RegExp(search, 'i');` constructs a RegExp directly from `req.query.search` without calling `escapeRegex` (even though `escapeRegex` is already imported on L12 and used in `listOrganizationJobsPage` on L670). Regex metacharacters like `[` or `(` cause an unhandled `SyntaxError` (`500`), and crafted patterns risk ReDoS on `User.find()`.
2. **Defective — Missing `ObjectId` Validation (`CastError` -> `500`):**
   - `recruiterJobService.js` (`getRecruiterJobDetails`, `updateRecruiterJob`, `archiveRecruiterJob`, `deleteRecruiterJob`), `matchService.js` (`generateRecruiterMatches`, `getRecruiterMatchDetails`, `updateMatchStatus`), `shortlistService.js` (`addToShortlist`, `updateShortlist`, `removeShortlist`), and `comparisonService.js` (`compareCandidates`) pass `req.params.id` / `req.body.jobId` / `req.body.candidateId` directly to Mongoose `findOne` without `mongoose.Types.ObjectId.isValid()`. Malformed IDs return `500` instead of `400`/`404`.
3. **Defective — `Job.description` Schema vs Service/UI Mismatch:**
   - `Job.js` (L33) defines `description: { type: String, required: true, default: '' }`. Verified via `node -e` Mongoose `validateSync()` that an empty description fails validation (`Job validation failed: description: Path 'description' is required.`), even though `jobs.component.html` labels it Optional and `recruiterJobService.validateJobPayload()` omits a required check.
4. **Partially Verified — `recruiterProfileService.js` Whitelisting:**
   - `updateRecruiterProfile` whitelists updatable fields (ignoring `role`, `organizationId`, `email`, `isActive`), validates lengths for `name`, `jobTitle`, `location`, `website`, `bio`, `education`, `experienceSummary`, and bounds `yearsOfExperience` (`0..50`).
   - **Gap:** `avatar` URL has no `https://` / relative-path protocol check (stored and rendered in `[src]="profile?.avatar"`), and `phoneNumber`, `countryCode`, `githubUsername`, `linkedin` lack length bounds.

---

## 2. Caching & Refresh Audit

| Layer | Mechanism | TTL / Invalidation | Stale-Data & Multi-Instance Risks | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Frontend: `RecruiterHubService`** (`recruiter-hub.service.ts`) | In-memory RxJS `shareReplay(1)` on `dashboard$` and `analytics$` only. | **No TTL.** Cleared only when `clearCache()` or `forceRefresh=true` is called, or on browser hard refresh (`F5`). | **Defective (Cross-Session Leak & Stale Data):**<br>1. Not registered with `FrontendCacheInvalidationService`, so `AuthService.logout()` does **not** clear `dashboard$`/`analytics$`. If another recruiter logs in within the same SPA session without hard reload, cached data from the previous recruiter is served.<br>2. `CandidateDetailsComponent.analyze()` does **not** call `clearCache()`, leaving `candidatesAnalyzed` stale.<br>3. No UI "Refresh" button passes `forceRefresh = true`. | **Verified** |
| **Frontend: Other Recruiter Services** (`CandidateService`, `RecruiterJobService`, `RecruiterMatchService`) | Direct `HttpClient` calls via `ApiService` (no caching). | Always fresh on component load / action. | Low stale risk; list mutations must re-query. | **Verified** |
| **Backend: Recruiter Services & Controllers** | **Zero Redis caching (`redisCacheService.js` unused).** Zero in-memory response caching. | Queries MongoDB directly on every request. | **No multi-instance stale cache risk** for Recruiter data, **but high MongoDB load**: `recruiterDashboardService` triggers duplicate `getRecruiterScope` calls + 6 queries + N+1 `getCandidateById` calls (each querying 7 collections). | **Verified** |
| **Backend: `PlatformSettings` (`platformSettingsService.js`)** | Process-local in-memory `settingsCache` with `CACHE_TTL_MS = 60 * 1000` (60s). | 60s TTL; updated only in the process handling `PATCH /api/super-admin/settings`. | In multi-instance deployments, toggling `enableRecruiterAccess` takes up to 60s to propagate to other API instances. Meanwhile, `matchingService.listPublicDeveloperUserIds` queries `PlatformSettings` directly on every call (bypassing cache). | **Verified** |
| **Backend: `AdminConsoleService` (`adminConsoleService.js`)** | Process-local `Map` cache with `PERFORMANCE_CACHE_TTL_MS = 5 * 60 * 1000` (5 min). | 5-min TTL; no cross-module invalidation when recruiter creates jobs/matches. | Admin Console performance stats lag up to 5 min behind recruiter mutations and differ across API instances. | **Verified** |

---

## 3. AI & Background Processing Audit

| Aspect | Audit Finding | Status |
| :--- | :--- | :--- |
| **LLM / External AI Providers** | **None.** Zero imports or calls to `aiservice.js`, `aiProviderManager.js`, Gemini, OpenAI, or `aiRequestBudget.js` exist in `backend/src/modules/recruiter/`. | **Verified** |
| **AI Cost** | **\$0 / zero external AI token usage.** All features labeled "AI Ranking", "AI Summary", and "AI Insights" execute synchronous deterministic JavaScript math and template strings. | **Verified** |
| **Ranking Engine (`aiRankingService.js` + `utils/matching/*`)** | Min-max batch normalization across candidates + weighted sum (`skillMatch: 0.30`, `projectQuality: 0.20`, `github: 0.15`, `experience: 0.15`, `consistency: 0.10`, `growth: 0.10`) + threshold-based `explanationEngine.js`.<br>**Defective:** `featureExtractor.js` outputs `githubScore`, but `RANKING_FEATURES` reads `github` (so GitHub contributes `0` in `rankCandidates`). `matchCalculator.js` reads non-existent `scoreBreakdown` keys (`skillCoverage`, `requiredSkillAlignment`, `githubSignal`, `projectImpact`, `growthTrajectory`, `experienceAlignment`). | **Defective** |
| **Candidate "AI Summary" (`candidateService.analyzeRecruiterCandidate`)** | Formats static strings from `candidate.aiSummary`, `readinessScore`, `githubScore`, `skills.slice(0,3)`, `skillGaps.slice(0,3)` and logs `RECRUITER_CANDIDATE_ANALYZED` to `AuditLog`. | **Verified** |
| **Schedulers / Workers / Queues** | **None** inside `backend/src/modules/recruiter/`. No `node-cron` jobs, no Redis locks, no background workers. | **Verified** |
| **Email & Retries (Admin Invites)** | `admin/controllers/recruiterController.js` sends recruiter invitations synchronously via `sendRecruiterInvitationEmail()`. Unlike `tenantcontroller.js`, it does **not** enqueue failed emails into `emailRetryQueueService.js` (`EmailDeliveryJob`). | **Verified** |
| **Multi-Instance Behavior** | Safe for writes (MongoDB unique indexes on `RecruiterMatch` and `RecruiterShortlist`), deterministic reads, no local job state. Only `PlatformSettings` 60s cache and `AdminConsoleService` 5-min cache are per-instance. | **Verified** |

---

## 4. Cross-Module Dependency Map

| Interacting Module | Direction & Mechanism | Shared Models / Data | Verified Side Effects & Mismatches |
| :--- | :--- | :--- | :--- |
| **Auth** (`modules/auth/`) | `authcontroller.acceptInvite` creates/promotes `User` (`role: 'recruiter'`), sets `organizationId`, creates `Membership` (`teamId: null`). `accountDeletionService` cleans up `Candidate`, `Recruiter`, `RecruiterMatch`, `RecruiterShortlist`, closes `Job`. | `User`, `Invitation`, `Membership`, `Job`, `Candidate`, `Recruiter`, `RecruiterMatch`, `RecruiterShortlist` | **Defective:** `acceptInvite` omits `invitation.teamId` `Membership` creation and redirects incomplete profiles to `/app/profile?onboarding=recruiter` (blocked by `AuthService.canAccessUrl()`). |
| **Developer Data** (`github`, `resume`, `skill-gap`, `public-portfolio`, `career-sprint`, `weekly-reports`) | **Read-only** aggregation inside `matchingService.hydrateUserCandidates()`. | `User` (`isPublic`), `Analysis`, `ResumeAnalysis`, `PublicProfile`, `CareerSprint`, `WeeklyReport` | Developer must have `User.isPublic === true` (via `PUT /api/profile/visibility`) to appear in Recruiter talent pool; publishing `PublicProfile` alone does NOT opt into Recruiter discovery (**Verified** in `profileSettingsProduction.test.js`). `publicPortfolioContactService` lets verified recruiters email developers from `/p/:slug`. |
| **Developer Jobs Hub** (`modules/jobs/`) | **Zero interaction.** Completely separate from Recruiter `Job` model. | `JobCache`, `JobSourceHealth`, `UserJobAction` | Developer Jobs Hub fetches external jobs (JSearch/Jooble/Adzuna); recruiter-posted `Job` documents are NOT surfaced to developers. |
| **Organizations & Admin** (`modules/admin/`) | Admin manages recruiters (`admin/controllers/recruiterController.js`), org jobs (`admin/controllers/jobController.js`), Admin Console (`adminConsoleService.js`), Team Analytics (`teamAnalyticsService.js`), Org Health (`tenantcontroller.js`). | `Organization`, `Team`, `Membership`, `Invitation`, `Job`, `RecruiterMatch`, `RecruiterShortlist`, `Candidate`, `AuditLog` | **Defective:**<br>1. `adminConsoleService` tracks `aiRankCalls`/`matchCalls` using `/\/api\/recruiter\/(match|ai-rank)/` and `Candidate` creation, missing `/api/recruiter-hub/*` activity.<br>2. `admin/recruiterController.deleteRecruiter` deletes `User` & `Membership` without closing `Job`s or cleaning up `RecruiterMatch`/`RecruiterShortlist`. |
| **Super Admin** (`modules/super-admin/`) | `superAdminController.js`, `superAdminAnalyticsService.js`, `PlatformSettings`. | `User`, `Job`, `Candidate`, `Recruiter`, `PlatformSettings` | **Defective:** `superAdminController.getRecruiters` counts `Candidate.countDocuments({ createdBy: recruiterId })` and `Recommendation.countDocuments({ userId: { $in: candidateIds } })` — neither is produced by Recruiter Hub, so metrics report `0`. `PlatformSettings.recruiter.activityThresholdDays` and `notifications.recruiterAlerts` are unused. |
| **Notifications** (`modules/notifications/`) | Shared UI route `/app/recruiter/notifications` -> `NotificationsComponent`. | `Notification`, `NotificationReceipt`, `NotificationState` | No backend service in `recruiter` or `admin` emits notifications to recruiters. |
| **Audit Logging** (`core/middleware/auditLogMiddleware.js`) | Global middleware auto-logs all `POST/PUT/PATCH/DELETE` under `/api/*`. | `AuditLog` | **Defective:** Hub controllers (`recruiterJobController`, `matchController`, `shortlistController`, `recruiterProfileController`, `candidateService`) ALSO call `AuditLog.create()`, creating duplicate `AuditLog` rows for every mutation. |

