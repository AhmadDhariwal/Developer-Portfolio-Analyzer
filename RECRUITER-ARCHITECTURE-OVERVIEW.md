# Recruiter Module — Architecture Overview

**Audit Scope:** Strictly read-only architectural and implementation audit of the Recruiter module in Developer Portfolio Analyzer (DPA).  
**Branch / Baseline:** `release2` (no Recruiter/Admin/Super-Admin/Auth diff vs `fix/bug-03`; repository preserved untouched).  
**Status Legend:**
- **Verified:** Directly observed in source files and/or verified by execution during this audit.
- **Partially Verified:** Core structure observed, but runtime/MongoDB/UI execution was not run in this read-only audit.
- **Untested:** Behavior exists in code without automated test coverage.
- **Defective:** Verified mismatch, broken contract, or runtime failure observed in code or read-only checks.

---

## 1. Executive Summary

The Recruiter module has a **dual-generation architecture** on the backend and a **lazy-loaded NgModule architecture** on the frontend:

1. **Active Production Surface (`/api/recruiter-hub/*` + `frontend/src/app/features/recruiter/`):**
   - **Verified:** All 10 Recruiter-specific Angular pages (plus the shared `NotificationsComponent` mounted under `/app/recruiter/notifications`) exclusively consume `/api/recruiter-hub/*` endpoints via `RecruiterHubService`, `CandidateService`, `RecruiterJobService`, and `RecruiterMatchService`, delegating HTTP calls to `ApiService` (`frontend/src/app/shared/services/api.service.ts`).
   - **Verified:** Backend `/api/recruiter-hub/*` (`backend/src/modules/recruiter/routes/hub/recruiterHubRoutes.js`) delegates to 9 `hub` controllers, 9 `hub` services, 4 `hub` utilities, and reuses `matchingService` and `aiRankingService` from `services/matching/`.

2. **Legacy / Parallel Surface (`/api/recruiter/*` + `compatibility/*`):**
   - **Verified:** Backend `/api/recruiter/*` (`backend/src/modules/recruiter/routes/recruiter.routes.js`) is still mounted in `backend/index.js` and backed by `controllers/matching/*` and `services/matching/*`.
   - **Verified:** `ApiService` defines 9 `/api/recruiter/*` methods (`getRecruiterDashboard`, `getRecruiterCandidates`, `getRecruiterCandidateById`, `getRecruiterJobs`, `createRecruiterJob`, `updateRecruiterJob`, `deleteRecruiterJob`, `matchRecruiterCandidates`, `aiRankCandidates`), **none** of which are called anywhere in `frontend/src`.
   - **Verified:** `backend/src/modules/recruiter/compatibility/` provides thin re-export shims pointing to `services/matching/aiRankingService.js` and `utils/matching/*`, covered by `backend/src/tests/recruiter/aiCompatibilityPaths.test.js`.
   - **Partially Verified:** `adminConsoleService.js` still inspects `AuditLog` routes matching `/\/api\/recruiter\/(match|ai-rank)/` rather than `/api/recruiter-hub/*`, creating a telemetry blind spot for Hub usage.

3. **Key Architectural Characteristics vs. Developer Module:**
   - **Verified:** Unlike the Developer module (which uses Redis + `FrontendAnalysisCacheService` + `FrontendCacheInvalidationService` + LLM providers), the Recruiter module uses **zero Redis caching**, **zero LLM/AI provider API calls** (all "AI" ranking and summaries are deterministic rule-based heuristics), and **zero background workers/schedulers**.

---

## 2. Frontend Architecture (`frontend/src/app/features/recruiter/`)

### 2.1 Routing, Guards, and Shell Integration

| Concern | Implementation | File Path | Status |
| :--- | :--- | :--- | :--- |
| Lazy route mount | `/app/recruiter` inside `MainLayout` | `frontend/src/app/app.routes.ts` (L110–115) | **Verified** |
| Legacy redirect | `/app/recruiter-dashboard` -> `/app/recruiter` | `frontend/src/app/app.routes.ts` (L59) | **Verified** |
| Route guards | `authGuard` (parent `/app`), `noAdminTabsGuard`, `recruiterRoleGuard` | `frontend/src/app/core/guards/auth.guard.ts`, `no-admin-tabs.guard.ts`, `recruiter-role.guard.ts` | **Verified** |
| Role access check | `AuthService.canAccessUrl()` restricts `recruiter` strictly to `/app/recruiter*`; `getHomeRoute()` returns `/app/recruiter/dashboard` | `frontend/src/app/shared/services/auth.service.ts` (L553–593) | **Verified** |
| Sidebar navigation | Role-specific menu with 2 groups: `Recruiter Hub` (10 items) and `Workspace` (`/app/integrations`, `/app/profile`) | `frontend/src/app/core/layouts/main-layout/sidebar/sidebar.component.ts` (L440–545) | **Verified** |
| Navbar quick search | `Recruiter Hub` (`/app/recruiter`) exposed only when `sessionRole === 'recruiter'` | `frontend/src/app/core/layouts/main-layout/navbar/navbar.component.ts` (L121–189) | **Verified** |

**Defective Navigation / Guard Coupling Observed:**
- **Defective:** `SidebarComponent` (L527–539) renders `Integrations` (`/app/integrations`) and `My Profile` (`/app/profile`) in the Recruiter's `Workspace` sidebar group, AND `authcontroller.js` (`acceptInvite`, L840) redirects recruiters with incomplete profiles to `/app/profile?onboarding=recruiter`. However, `AuthService.canAccessUrl()` (L582–584) returns `target.startsWith('/app/recruiter')` for `role === 'recruiter'`, which **blocks** `/app/integrations` and `/app/profile` via `authGuard` and redirects the recruiter back to `/app/recruiter/dashboard`.

### 2.2 NgModule & Component Ownership

The frontend Recruiter feature uses a hybrid NgModule + standalone component model:

- **`RecruiterModule`** (`frontend/src/app/features/recruiter/recruiter.module.ts`):
  - **Declarations (11 non-standalone page components):**
    1. `RecruiterDashboardComponent` (`pages/recruiter-dashboard/recruiter-dashboard.component.ts`)
    2. `CandidatesComponent` (`pages/candidates/candidates.component.ts`)
    3. `CandidateDetailsComponent` (`pages/candidate-details/candidate-details.component.ts`)
    4. `JobsComponent` (`pages/jobs/jobs.component.ts`)
    5. `JobDetailsComponent` (`pages/job-details/job-details.component.ts`)
    6. `MatchesComponent` (`pages/matches/matches.component.ts`)
    7. `ShortlistsComponent` (`pages/shortlists/shortlists.component.ts`)
    8. `ComparisonComponent` (`pages/comparison/comparison.component.ts`)
    9. `RecruiterAnalyticsComponent` (`pages/recruiter-analytics/recruiter-analytics.component.ts`)
    10. `RecruiterActivityLogsComponent` (`pages/activity-logs/activity-logs.component.ts`)
    11. `RecruiterProfileComponent` (`pages/recruiter-profile/recruiter-profile.component.ts`)
  - **Module-scoped Providers (4 services):**
    - `RecruiterHubService` (`services/recruiter-hub.service.ts`)
    - `CandidateService` (`services/candidate.service.ts`)
    - `RecruiterJobService` (`services/recruiter-job.service.ts`)
    - `RecruiterMatchService` (`services/recruiter-match.service.ts`)
  - **Imports:** `CommonModule`, `FormsModule`, `ReactiveFormsModule`, `SearchableSelectComponent`, `ConfirmDialogComponent`, `RecruiterHubSharedModule`, `RecruiterHubRoutingModule`.

- **`RecruiterHubSharedModule`** (`frontend/src/app/features/recruiter/recruiter-hub-shared.module.ts`):
  - Imports and re-exports **12 standalone components** under `components/`:
    1. `RecruiterStatCardComponent` (`components/recruiter-stat-card/`)
    2. `CandidateCardComponent` (`components/candidate-card/`)
    3. `CandidateFilterBarComponent` (`components/candidate-filter-bar/`)
    4. `JobCardComponent` (`components/job-card/`)
    5. `MatchCardComponent` (`components/match-card/`)
    6. `ShortlistCardComponent` (`components/shortlist-card/`)
    7. `ComparisonTableComponent` (`components/comparison-table/`)
    8. `RecruiterPerformanceChartComponent` (`components/recruiter-performance-chart/`)
    9. `ActivityTimelineComponent` (`components/activity-timeline/`)
    10. `EmptyStateComponent` (`components/empty-state/`)
    11. `LoaderComponent` (`components/loader/`)
    12. `RecruiterBackButtonComponent` (`components/recruiter-back-button/`)

- **Shared Cross-Module Components & Services Consumed:**
  - `NotificationsComponent` (`frontend/src/app/features/notifications/notifications.component.ts`) — routed at `/app/recruiter/notifications` (`recruiter-hub-routing.module.ts`, L19) — **Verified**.
  - `SearchableSelectComponent` (`frontend/src/app/shared/components/searchable-select/`) — used in `CandidateFilterBarComponent`, `MatchesComponent`, `ComparisonComponent`, `RecruiterActivityLogsComponent` — **Verified**.
  - `ConfirmDialogComponent` (`frontend/src/app/shared/components/confirm-dialog/`) — used in `JobsComponent` and `ShortlistsComponent` — **Verified**.
  - `ApiService`, `AuthService`, `TenantContextService` (`frontend/src/app/shared/services/`).
  - `AcceptInvitationComponent` (`frontend/src/app/features/public/pages/accept-invitation/`) — public onboarding component for recruiter invites — **Verified**.

### 2.3 Frontend Routes Table (`recruiter-hub-routing.module.ts`)

| Child Route | Full Path | Component | Status |
| :--- | :--- | :--- | :--- |
| `''` | `/app/recruiter` | Redirects to `dashboard` | **Verified** |
| `'dashboard'` | `/app/recruiter/dashboard` | `RecruiterDashboardComponent` | **Verified** |
| `'notifications'` | `/app/recruiter/notifications` | `NotificationsComponent` (shared) | **Verified** |
| `'candidates'` | `/app/recruiter/candidates` | `CandidatesComponent` | **Verified** |
| `'candidates/:id'` | `/app/recruiter/candidates/:id` | `CandidateDetailsComponent` | **Verified** |
| `'jobs'` | `/app/recruiter/jobs` | `JobsComponent` | **Verified** |
| `'jobs/:id'` | `/app/recruiter/jobs/:id` | `JobDetailsComponent` | **Verified** |
| `'matches'` | `/app/recruiter/matches` | `MatchesComponent` | **Verified** |
| `'shortlists'` | `/app/recruiter/shortlists` | `ShortlistsComponent` | **Verified** |
| `'comparison'` | `/app/recruiter/comparison` | `ComparisonComponent` | **Verified** |
| `'analytics'` | `/app/recruiter/analytics` | `RecruiterAnalyticsComponent` | **Verified** |
| `'activity-logs'` | `/app/recruiter/activity-logs` | `RecruiterActivityLogsComponent` | **Verified** |
| `'profile'` | `/app/recruiter/profile` | `RecruiterProfileComponent` | **Verified** |

### 2.4 UI Structure, Styling & Responsive Behavior

- **Verified:** All Recruiter pages share a consistent `.hub-page` layout shell with dark glassmorphic cards, CSS grid layouts using `repeat(auto-fit, minmax(..., 1fr))` (`210px`/`220px`/`320px`), `overflow: hidden` containers, and text ellipsis truncation.
- **Verified:** Dedicated responsive `@media` breakpoints are implemented across components and pages:
  - `560px` in `candidate-card`, `job-card`, `match-card` (3-column metric grid collapses to `1fr`).
  - `640px` & `900px` in `recruiter-profile`.
  - `780px` in `loader`, `matches`, `recruiter-analytics`, `recruiter-dashboard`, `shortlists` (grids collapse to `1fr`).
  - `820px` in `candidate-filter-bar`.
  - `920px` in `recruiter-performance-chart`.
  - `comparison-table.component.scss` uses `overflow: auto` for horizontal table scrolling on narrow viewports.
- **Partially Verified:** Visual rendering at mobile/tablet/desktop viewports was inspected via SCSS source only (no browser/Playwright run executed).

---

## 3. Backend Architecture (`backend/src/modules/recruiter/`)

### 3.1 Route Mounting (`backend/index.js`)

- `/api/recruiter` -> `backend/src/modules/recruiter/routes/recruiter.routes.js` (L195) — **Verified**
- `/api/recruiter-hub` -> `backend/src/modules/recruiter/routes/hub/recruiterHubRoutes.js` (L196) — **Verified**

Both routers enforce the identical 4-middleware chain on every route (`router.use(...)`):
1. `protect` (`backend/src/core/middleware/authmiddleware.js`) — JWT verification, user lookup, `sessionRevision` check, `isActive !== false`.
2. `authorizeRoles('recruiter')` (`authmiddleware.js`) — Allows `recruiter` (and globally bypasses for `super_admin`).
3. `requireRecruiterAccessEnabled` (`backend/src/core/middleware/platformSettingsMiddleware.js`) — Blocks with `403` when `PlatformSettings.recruiter.enableRecruiterAccess === false`.
4. `requireOrganizationContext(['recruiter'])` (`backend/src/core/middleware/orgMiddleware.js`) — Resolves `req.organizationId` from `User.organizationId` or active `Membership` (and globally sets `req.organizationId = null` for `super_admin`).

### 3.2 Backend Layer Map

| Layer | Hub Submodule (`hub/`) | Matching / Legacy Submodule (`matching/`) | Compatibility (`compatibility/`) |
| :--- | :--- | :--- | :--- |
| **Routes** | `recruiterHubRoutes.js`, `candidateRoutes.js`, `recruiterJobRoutes.js`, `matchRoutes.js`, `shortlistRoutes.js`, `analyticsRoutes.js`, `activityRoutes.js` | `recruiter.routes.js` | — |
| **Controllers** | `candidateController.js`, `comparisonController.js`, `matchController.js`, `recruiterActivityController.js`, `recruiterAnalyticsController.js`, `recruiterDashboardController.js`, `recruiterJobController.js`, `recruiterProfileController.js`, `shortlistController.js` | `index.js`, `candidateController.js`, `dashboardController.js`, `jobController.js`, `matchController.js` | — |
| **Services** | `candidateService.js`, `comparisonService.js`, `matchService.js`, `recruiterActivityService.js`, `recruiterAnalyticsService.js`, `recruiterDashboardService.js`, `recruiterJobService.js`, `recruiterProfileService.js`, `shortlistService.js` | `matchingService.js`, `aiRankingService.js` | `aiRankingService.js` (re-export) |
| **Utils** | `recruiterAccess.js`, `candidateFormatter.js`, `matchCalculator.js`, `recruiterAnalyticsBuilder.js` | `featureExtractor.js`, `potentialPredictor.js`, `scoringEngine.js`, `explanationEngine.js`, `weightConfig.js` | `utils/*.js` (re-exports) |

### 3.3 Database Models (`backend/src/modules/recruiter/models/`)

| Model | Collection | Key Fields & Indexes | Actual Usage Status |
| :--- | :--- | :--- | :--- |
| `Job` (`Job.js`) | `jobs` | `organizationId` (idx), `recruiterId` (req, idx), `teamId` (idx), `title` (req), `role`, `description` (`required: true, default: ''`), `stack`, `requiredSkills[]`, `preferredSkills[]`, `minExperienceYears`, `location`, `salaryRangeMin/Max`, `employmentType`, `status` (`draft\|open\|closed`, idx), `archivedAt` | **Verified** — Actively used by Hub, Legacy, Admin, Admin Console, Super Admin. **Defective:** `description` `required: true` conflicts with optional UI/service validation. |
| `RecruiterMatch` (`RecruiterMatch.js`) | `recruitermatches` | `recruiterId` (req, idx), `organizationId` (req, idx), `teamId` (idx), `jobId` (req, idx), `candidateId` (req, ref `User`, idx), `matchScore`, `skillMatchPercent`, `experienceMatch`, `githubProjectScore`, `readinessScore`, `confidenceScore`, `recommendation`, `strengths[]`, `weaknesses[]`, `explanation`, `breakdown`, `status` (`generated\|shortlisted\|rejected`, idx). Unique index `{ recruiterId: 1, jobId: 1, candidateId: 1 }`. | **Verified** — Actively used by Hub `matchService`, `shortlistService`, `recruiterAnalyticsService`, Admin `recruiterController`, `tenantcontroller`. |
| `RecruiterShortlist` (`RecruiterShortlist.js`) | `recruitershortlists` | `recruiterId` (req, idx), `organizationId` (req, idx), `teamId` (idx), `candidateId` (req, ref `User`, idx), `jobId` (ref `Job`, idx), `notes`, `status` (`shortlisted\|reviewing\|contacted\|interview\|rejected`, idx). Unique index `{ recruiterId: 1, candidateId: 1, jobId: 1 }`. | **Verified** — Actively used by Hub `shortlistService`, `matchService`, `recruiterAnalyticsService`, Admin `recruiterController`, `tenantcontroller`. |
| `Candidate` (`Candidate.js`) | `candidates` | `userId` (ref `User`, idx), `fullName` (req), `email` (req, idx), `stack`, `yearsOfExperience`, `headline`, `location`, `githubUsername`, `githubScore`, `resumeScore`, `consistencyScore`, `growthPotentialScore`, `skills[]`, `projects[]`, `skillGaps[]`, `githubStats`, `aiInsight`, `isActive` (idx), `createdBy` (ref `User`). Text index `{ fullName, email, skills }`. **No `organizationId`.** | **Verified (Partially Obsolete):** Read/merged by `matchingService.js` (`listCandidates`, `getCandidateById`), **never written** by Recruiter Hub or `/api/recruiter/*` routes. Still queried by `adminConsoleService`, `teamAnalyticsService`, `superAdminController`, `superAdminAnalyticsService` using `createdBy`. |
| `Recruiter` (`Recruiter.js`) | `recruiters` | `userId` (unique, req, idx), `company`, `title`, `hiringPreferences` | **Verified (Dead / Unused):** Never read or written by Recruiter Hub or Legacy matching. Recruiter profile data is stored directly on `User` (`recruiterPreferences`, `recruiterDetails`). Only referenced in `accountDeletionService.js` and imported unused in `superAdminController.js`. |

---

## 4. Architectural Findings Summary

| ID | Finding | Classification |
| :--- | :--- | :--- |
| ARCH-01 | Frontend Recruiter UI uses exclusively `/api/recruiter-hub/*`; `/api/recruiter/*` has 9 unused `ApiService` methods and zero active UI callers | **Verified** |
| ARCH-02 | `Recruiter.js` model is dead code in active recruiter workflows; `User` holds `recruiterPreferences` and `recruiterDetails` | **Verified** |
| ARCH-03 | `Candidate.js` is never created by Recruiter flows; talent pool is synthesized dynamically from `User` (`isPublic: true`) + 5 developer collections, merged with optional `Candidate` docs | **Verified** |
| ARCH-04 | `SidebarComponent` links `/app/integrations` and `/app/profile`, and `acceptInvite` redirects incomplete recruiters to `/app/profile?onboarding=recruiter`, but `AuthService.canAccessUrl()` blocks recruiters from any non-`/app/recruiter` route | **Defective** |
| ARCH-05 | `Job.js` enforces `description: { required: true }`, contradicting `JobsComponent` ("Optional") and `recruiterJobService.validateJobPayload()` | **Defective** |
| ARCH-06 | `frontend/src/app/features/recruiter/` has 0 unit/spec tests; backend has only 5 unit tests covering ranking weights/compatibility | **Verified** |
