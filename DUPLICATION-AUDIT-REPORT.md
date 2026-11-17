# Duplication Audit Report (Phase 2)

This report audits every frontend and backend target requested in Phase 2 across implementation TypeScript/JavaScript code, templates, SCSS stylesheets, `@Input`/`@Output` contracts, services, route registrations, permissions, static/dynamic imports, and tests.

## Classification Taxonomy

1. Exact duplicate implementation.
2. Overlapping implementation.
3. Legitimate role-specific implementation.
4. Shared functionality that should be extracted.
5. Legacy file with no verified usage.
6. Empty or obsolete directory / stub.
7. Correctly separated functionality.

---

## 1. Frontend Audit Findings

### 1.1 `core/layouts/main-layout/navbar` vs `shared/components/navbar`
- **Classification:** **5. Legacy file with no verified usage** (`shared/components/navbar`); **7. Correctly separated functionality** (`core/layouts/main-layout/navbar`).
- **Exact Paths:**
  - Canonical: `frontend/src/app/core/layouts/main-layout/navbar/navbar.{ts,html,scss,spec.ts}`
  - Legacy: `frontend/src/app/shared/components/navbar/navbar.component.{ts,html,scss}`
- **Evidence:** Both declare selector `app-navbar`, `@Output() toggleSidebar`, and `logout()`. `shared/components/navbar` is a 122-line older prototype with hardcoded mock notifications (`readonly notifications = 3`) and **0 consumers** in `app.routes.ts`, templates, or specs. `core/layouts/main-layout/navbar` is the 24 KB production header wired into `main-layout.html`, role navigation, search, live notifications, theme toggle, and `navbar.spec.ts`.
- **Canonical Owner:** `frontend/src/app/core/layouts/main-layout/navbar/`.
- **Action / Risk:** Removed `shared/components/navbar/*`. Zero regression risk (0 references across frontend/backend).

### 1.2 `core/layouts/main-layout/sidebar` vs `shared/components/sidebar`
- **Classification:** **5. Legacy file with no verified usage** (`shared/components/sidebar`); **7. Correctly separated functionality** (`core/layouts/main-layout/sidebar`).
- **Exact Paths:**
  - Canonical: `frontend/src/app/core/layouts/main-layout/sidebar/sidebar.{ts,html,scss,spec.ts}`
  - Legacy: `frontend/src/app/shared/components/sidebar/sidebar.component.{ts,html,scss}`
- **Evidence:** `shared/components/sidebar` (77 lines) declares selector `app-sidebar`, links 6 obsolete un-prefixed paths (`/dashboard`, `/github-analyzer`, etc.), has an unimplemented `logout()` stub (`// Implement actual auth logout logic here later if needed`), and has **0 consumers**. `core/layouts/main-layout/sidebar` is the 31 KB production sidebar rendered by `main-layout.html` and tested in `sidebar.spec.ts`.
- **Canonical Owner:** `frontend/src/app/core/layouts/main-layout/sidebar/`.
- **Action / Risk:** Removed `shared/components/sidebar/*`. Zero regression risk.

### 1.3 `features/admin/pages/admin-console` vs `pages/admin-console`
- **Classification:** **5. Legacy file with no verified usage** (`pages/admin-console`); **7. Correctly separated functionality** (`features/admin/pages/admin-console`).
- **Exact Paths:**
  - Canonical: `frontend/src/app/features/admin/pages/admin-console/admin-console.{component.ts,component.html,component.scss,service.ts}`
  - Legacy: `frontend/src/app/pages/admin-console/admin-console.{component.ts,component.html,component.scss,service.ts}`
- **Evidence:** `AdminRoutingModule` routes `/app/admin/console` to `AdminConsolePageComponent` in `features/admin/pages/admin-console/` (1,014 lines, 6 tabs, standalone). `pages/admin-console/` (360 lines, `AdminConsoleComponent`) had **0 consumers** in `app.routes.ts`, `AdminModule`, or tests.
- **Canonical Owner:** `frontend/src/app/features/admin/pages/admin-console/`.
- **Action / Risk:** Removed `pages/admin-console/*`. Zero regression risk.

### 1.4 `features/recruiter/pages/recruiter-dashboard` vs `pages/recruiter-dashboard` (+ `recruiter-dashboard.service.ts`)
- **Classification:** **5. Legacy file with no verified usage** (`pages/recruiter-dashboard` & `shared/services/recruiter-dashboard.service.ts`); **7. Correctly separated functionality** (`features/recruiter/pages/recruiter-dashboard`).
- **Exact Paths:**
  - Canonical: `frontend/src/app/features/recruiter/pages/recruiter-dashboard/recruiter-dashboard.component.{ts,html,scss}`
  - Legacy: `frontend/src/app/pages/recruiter-dashboard/recruiter-dashboard.component.{ts,html,scss}`, `frontend/src/app/shared/services/recruiter-dashboard.service.ts`
- **Evidence:** `RecruiterHubRoutingModule` routes `/app/recruiter/dashboard` to `RecruiterDashboardComponent` in `features/recruiter/pages/recruiter-dashboard/` (230 lines, `RecruiterHubService`). `pages/recruiter-dashboard` (80 lines, `RecruiterDashboardService`) had **0 route or template consumers**, and `recruiter-dashboard.service.ts` was only imported by `pages/recruiter-dashboard`.
- **Canonical Owner:** `frontend/src/app/features/recruiter/pages/recruiter-dashboard/`.
- **Action / Risk:** Removed `pages/recruiter-dashboard/*` and `shared/services/recruiter-dashboard.service.ts`. Zero regression risk.

### 1.5 Admin Activity Logs vs Super Admin Activity Logs
- **Classification:** **3. Legitimate role-specific implementation** + **4. Shared functionality extracted (styles)**.
- **Exact Paths:**
  - Org Admin Page: `frontend/src/app/features/admin/pages/activity-logs/admin-activity-logs.component.{ts,html,scss}` (`/app/admin/activity-logs`)
  - Super Admin Page: `frontend/src/app/features/super-admin/pages/activity-logs/activity-logs.component.{ts,html,scss}` (`/app/settings/activity-logs`)
  - Extracted Shared Stylesheet: `frontend/src/app/shared/styles/_activity-logs-shared.scss`
- **Evidence:** `AdminActivityLogsComponent` enforces organization/team scope via `TenantContextService` and `/admin-console/*` endpoints with sensitive payload redaction; `ActivityLogsComponent` queries platform-wide organizations/teams/actors via `SuperAdminService`. However, `admin-activity-logs.component.ts` previously imported `super-admin/pages/activity-logs/activity-logs.component.scss` directly across role boundaries via `styleUrls`.
- **Canonical Owner:** Each role retains its own page component; shared table/filter/detail panel styles now live in `shared/styles/_activity-logs-shared.scss`.
- **Action / Risk:** Extracted `_activity-logs-shared.scss` and updated both `.scss` files to `@use` it; verified with `ng build`.

### 1.6 `shared/components/job-card` vs `features/recruiter/components/job-card` vs `supervisors/recruiter/components/job-card`
- **Classification:** **3. Legitimate role-specific implementation** (`shared/components/job-card` vs `features/recruiter/components/job-card`); **5. Legacy file with no verified usage** (`supervisors/recruiter/components/job-card`).
- **Exact Paths:**
  - Developer Jobs Board Card: `frontend/src/app/shared/components/job-card/job-card.{ts,html,scss}` (selector: `app-job-card`, consumed by `features/developer/pages/jobs/`)
  - Recruiter Requisition Card: `frontend/src/app/features/recruiter/components/job-card/job-card.component.{ts,html,scss}` (renamed selector: `app-recruiter-job-card`, consumed by `features/recruiter/pages/jobs/`)
  - Legacy Recruiter Card: `frontend/src/app/supervisors/recruiter/components/job-card/*` (0 active route consumers)
- **Evidence:** Developer `JobCardComponent` accepts `Job`, `JobUiState`, `busy`, emitting `(save)`, `(markApplied)`, `(hide)`, `(similar)`. Recruiter `JobCardComponent` accepts recruiter-owned requisition `job` & `hideActions`, emitting `(view)`, `(edit)`, `(archive)`, `(remove)`. Both shared selector `app-job-card`, risking selector collision.
- **Canonical Owner:** Disambiguated Recruiter selector to `app-recruiter-job-card` and updated `features/recruiter/pages/jobs/jobs.component.html`.

### 1.7 `recruiter.module` vs `recruiter-hub.module` vs `recruiter-hub-shared.module` (+ `supervisors/`)
- **Classification:** **2. Overlapping implementation** (`recruiter.module.ts` & `recruiter-hub.module.ts`); **4. Shared functionality extracted** (`ConfirmDialogComponent` from `supervisors/recruiter-shared/` into `shared/components/confirm-dialog/`); **5. Legacy file with no verified usage** (`supervisors/recruiter/*` and remaining `supervisors/recruiter-shared/{empty-state,loader,message}`).
- **Exact Paths:**
  - Consolidated Module: `frontend/src/app/features/recruiter/recruiter.module.ts`
  - Promoted Shared Dialog: `frontend/src/app/shared/components/confirm-dialog/confirm-dialog.component.{ts,html,scss}`
- **Evidence:** `RecruiterModule` was an 8-line wrapper importing `RecruiterHubModule`. Meanwhile `support.ts`, `admin-recruiters.component.ts`, and `features/recruiter` only imported `RecruiterSharedModule` from `supervisors/recruiter-shared/` for `<app-confirm-dialog>` (`admin-teams.component.ts` had an unused import of it; `shared/components/` already owns `ui-empty-state`, `ui-loader`, and `app-shared-message`).
- **Canonical Owner:** `RecruiterModule` directly declares/imports all recruiter pages and shared UI modules; `ConfirmDialogComponent` now lives in `shared/components/confirm-dialog/`. All 56 files under `supervisors/` became 0-consumer legacy files and were removed.

### 1.8 Auth module stubs and empty migrated directories
- **Classification:** **6. Empty or obsolete directory / stub**.
- **Exact Paths:** `frontend/src/app/auth/{auth-module,auth-routing-module}.ts`, `frontend/src/app/layout/{layout-module,layout-routing-module}.ts`, `frontend/src/app/shared/{shared-module,shared-routing-module}.ts`, `frontend/src/app/features/super-admin/super-admin-routing.module.ts`, `frontend/src/app/features/super-admin/pages/platform-settings/{settings-module,settings-routing-module}.ts`, plus empty leftover subdirectories under `frontend/src/app/pages/*`.
- **Evidence:** Verified 0 imports in `app.routes.ts`, specs, `angular.json`, and `backend/src/tests/`. All standalone routes use direct component imports or `loadChildren` to `AdminModule`, `RecruiterModule`, `SuperAdminModule`.
- **Action / Risk:** Removed safely; verified with `tsc --noEmit` and `ng build`.

### 1.9 Super Admin role screens vs `features/super-admin/pages/`
- **Classification:** **7. Correctly separated functionality** (two intentionally distinct route shells protected by `superAdminGuard`).
- **Exact Paths:**
  - Workspace (`SaShellComponent` at `/super-admin/*`): `admins/`, `analytics/`, `dashboard/`, `developers/`, `organizations/`, `recruiters/`, `settings/super-admin-settings.component.ts` (full 9-tab platform configuration form), `support/`, `user-details/`
  - MainLayout Super Admin Settings (`MainLayout` at `/app/settings/*`): `pages/platform-settings/settings-page.component.ts` (3-card hub menu linking to `/app/settings/ai-versions`, `/app/settings/user-management`, `/app/settings/activity-logs`), `pages/ai-versions/`, `pages/team-management/`, `pages/activity-logs/`
- **Evidence:** `SettingsPageComponent` is an overview hub under `/app/settings`; `SuperAdminSettingsComponent` is the tabbed settings editor under `/super-admin/settings`. Zero overlap.

---

## 2. Backend Audit Findings

### 2.1 `services/recruiter` & `utils/recruiter` vs `services/recruiter-hub` & `utils/recruiter-hub` (+ `adminRoutes.js` & `recruiterRoutes.js`)
- **Classification:**
  - `backend/src/services/recruiter/*` & `backend/src/utils/recruiter/*`: **7. Correctly separated functionality** (Shared Candidate Matching & AI Ranking Engine).
  - `backend/src/services/recruiter-hub/*` & `backend/src/utils/recruiter-hub/*`: **7. Correctly separated functionality** (Recruiter Hub CRUD/Workflow layer).
  - `backend/src/routes/adminRoutes.js` & `backend/src/routes/recruiterRoutes.js`: **5. Legacy file with no verified usage** (1-line shims).
- **Evidence:** `backend/index.js` mounts BOTH `/api/recruiter` (`recruiter.routes.js`) and `/api/recruiter-hub` (`recruiter-hub/recruiterHubRoutes.js`). Crucially, active Recruiter Hub `matchService.js` and `utils/recruiter-hub/matchCalculator.js` delegate matching and ranking directly to `services/recruiter/matchingService.js` and `services/recruiter/aiRankingService.js`, which are also used by `controllers/admin/jobController.js`, `recruiterRankingEngine.test.js`, and `profileSettingsProduction.test.js`. Only the 1-line filename shims `adminRoutes.js` and `recruiterRoutes.js` had 0 consumers.
- **Action / Risk:** Retained `recruiter/` + `recruiter-hub/` services/utils/routes cleanly; removed `adminRoutes.js` and `recruiterRoutes.js` shims.

### 2.2 `services/test_two.js`
- **Classification:** **5. Legacy file with no verified usage**.
- **Exact Paths:** `backend/src/services/test_two.js` (1,340 lines).
- **Evidence:** Static unindexed question draft map with **0 `require()` callers** in `backend/` and tests (superseded by `interviewQuestionSeedCatalog.js`). Removed safely.

### 2.3 Oversized Controllers & Duplicate Utilities / Domain Constants
- **Classification:** **2. Overlapping implementation** (`escapeRegex` / `isValidObjectId` repeated across multiple files); **4. Shared functionality to extract in future incremental slices** (`skillgapcontroller.js` 3,133 lines, `adminConsoleController.js` 1,611 lines, `superAdminController.js` 1,591 lines, `dashboardcontroller.js` 1,405 lines).
- **Evidence:**
  - `const escapeRegex = ...` appears identically in 7 backend modules (`adminController.js`, `notificationcontroller.js`, `interviewQuestionRepository.js`, `githubservice.js`, `matchingService.js`, `resumeservice.js`, `skilldetector.js`).
  - `isValidObjectId` / `assertObjectId` validation checks are repeated across `dashboardcontroller.js`, `notificationcontroller.js`, `support.controller.js`, `careerSprintService.js`.
  - Domain-specific utilities (`courseIdentity.js`, `jobRanker.js`, `news*.js`, `scenarioIdentity.js`, `sprintCalendar.js`, `skill*.js`) currently live in `backend/src/utils/` and remain cleanly consumed via relative requires.
- **Risk Assessment:** Hardening/finalization tests in `backend/src/tests/*.test.js` inspect several controller and service source files directly via `fs.readFileSync`. Extracting internal controller helpers without coordinating those test regexes introduces unnecessary churn, so existing service/controller contracts were preserved intact and documented for phased extraction.

### 2.4 Overlapping Workers & Scheduled Jobs
- **Classification:** **7. Correctly separated functionality**.
- **Evidence:** `backend/index.js` starts distinct domain schedulers only when not in `localApiOnly` mode (`notificationRetentionService`, `startEmailRetryWorker`, `startIntegrationSyncWorker`, `startJobSourceSyncWorker`, `startNewsIngestionScheduler`, `courseCatalogMaintenanceService`, `startWeeklyReportScheduler` gated by `WEEKLY_REPORT_PROCESS_ROLE !== 'api'`, `startInterviewQuestionIngestionScheduler` every 6h for topic scraping, `startInterviewQuestionMaintenanceScheduler` every 4h for pool minimums). Separate `backend/src/workers/weeklyReports.js` runs as a dedicated worker process. No duplicate/conflicting crons.

