# ARCHITECTURE AUDIT REPORT — Developer Portfolio Analyzer (DPA)

**Branch:** `fix/bug-01`  
**Audit Date:** 2026-11-16  
**Scope:** Complete Frontend (`frontend/src/app`, 909 files) & Backend (`backend/src`, 761 files + `backend/index.js`)

---

## 1. Baseline Status (Pre-Refactoring)

| Check | Result | Notes |
| --- | --- | --- |
| Git branch & working tree | `fix/bug-01` | Preserving all existing staged (`M`/`A`) and untracked (`??`) user work under `interview-prep` & `backend/verification/`. |
| Frontend TypeScript (`tsc --noEmit -p frontend/tsconfig.app.json`) | **PASS** (exit `0`) | Zero compile errors. |
| Frontend unit tests (`npm test -- --watch=false`) | **PASS** (`119` files, `706` tests) | Full Vitest suite passing. |
| Frontend circular TypeScript imports | **`0` cycles** | Clean import DAG at baseline. |
| Backend unit sample (`node --test` on 7 core/interview suites) | **PASS** (`54/54` tests) | Core AI provider, admission, interview coverage, scoring, auth token tests pass offline. |
| Backend circular CommonJS `require()` cycles | **`20` cycles** | Concentrated in `course*`, `news*`, `notification*`, `careerSprint*`/`scenarioSprintExport*`, `weeklyReport*`. |

---

## 2. Current Architecture Inventory

### 2.1 Frontend (`frontend/src/app` — 909 files)

| Folder | Files | Current Responsibility | Architectural Issue |
| --- | --- | --- | --- |
| `(root)` | 6 | `app.ts`, `app.routes.ts`, `app.config.ts`, `app.html/.scss/.spec.ts` | Clean root shell. |
| `auth/` | 10 | `Login`, `Signup`, unused `auth-module.ts` / `auth-routing-module.ts` | Split from `features/auth/`. |
| `features/auth/` | ~24 | `ForgotPassword`, `ResetPassword`, `OtpVerification`, `OAuthCallback`, `auth-shell`, `otp-input`, `country-code-dropdown` | Incomplete auth consolidation (`login`/`signup` live outside). |
| `features/recruiter/` + `features/recruiter-hub/` | ~82 | Active lazy-loaded Recruiter Hub (`RecruiterModule` -> `RecruiterHubModule`, 11 pages, 12 components, services, models) | Redundant wrapper `features/recruiter/recruiter.module.ts` around `features/recruiter-hub/`. |
| `supervisors/` | 50 | Legacy `supervisors/recruiter/` (unreferenced module) + `supervisors/recruiter-shared/` (imported by `AdminModule`) | Cross-role coupling (`Admin` imports `RecruiterSharedModule`) + legacy recruiter pages. |
| `admin/` | 29 | `AdminModule` (dashboard, developers, recruiters, jobs, teams, console, activity-logs, performance) | Mixed NgModule + standalone components; imports `supervisors/recruiter-shared`. |
| `super-admin/` | 43 | `SuperAdminModule` (`sa-shell`, dashboard, admins, developers, recruiters, organizations, analytics, settings, support, user-details) | Separate from `app/settings/` + `pages/ai-versions/`, `pages/team-management/`, `pages/activity-logs/` which are also `superAdminGuard`-protected. |
| `settings/` | 5 | `SettingsPageComponent` (`superAdminGuard`) + unused `settings-module.ts` | Belongs under `features/super-admin/`. |
| `pages/` | 415 | 33 folders mixing Public, Developer, Admin, Recruiter, and Super Admin pages | Flat dumping ground (`landing-page`, `privacy-policy`, `dashboard`, `interview-prep`, `admin-console`, `recruiter-dashboard`, `ai-versions`, `team-management`, `activity-logs`). |
| `guards/` | 7 | 7 functional route guards (`auth`, `public`, `admin-settings`, `admin-console`, `recruiter-role`, `no-admin-tabs`, `super-admin`) | Should live in `core/guards/`. |
| `interceptors/` | 2 | `auth.interceptor.ts` + spec | Should live in `core/interceptors/`. |
| `layout/` | 18 | `MainLayout`, `Navbar` (743 lines), `Sidebar` (707 lines), `Footer`, unused `layout-module.ts` | Belongs in `core/layouts/` with decomposed navigation data/sections where justified. |
| `shared/` | 218 | Reusable UI components, pipes, models, utils, constants, styles, plus 1,198-line `api.service.ts` and feature-owned services | Mixes true cross-app shared infrastructure with feature services (`interview-prep.service.ts`, `career-sprint.service.ts`, etc.). |

### 2.2 Backend (`backend/src` — 761 files + `backend/index.js`)

| Folder | Files | Current Responsibility | Architectural Issue |
| --- | --- | --- | --- |
| `config/` | 6 | DB, env, GitHub OAuth, AI providers, News config | Circular `newsConfig.js <-> newsEnvCatalog.js`. |
| `routes/` | 38 | Flat route files + `routes/recruiter-hub/` | Duplicate/unreferenced `adminRoutes.js`, `recruiterRoutes.js`; split `recruiter.routes.js` vs `recruiter-hub/`. |
| `controllers/` | 50 | Flat controllers + `controllers/admin/`, `controllers/recruiter/`, `controllers/recruiter-hub/` | Oversized controllers with embedded business logic (`skillgapcontroller.js` 3,133 lines, `adminConsoleController.js` 1,611 lines, `superAdminController.js` 1,591 lines, `dashboardcontroller.js` 1,405 lines, `tenantcontroller.js` 1,143 lines, `resumecontoller.js` 937 lines, `profilecontroller.js` 936 lines, `authcontroller.js` 885 lines). |
| `services/` | 199 | Single flat folder for all domain services, AI providers, Redis cache, email, B2 storage, workers, and `test_two.js` (1,340 lines, unreferenced) | No domain boundaries; multiple 1,000–2,400+ line services (`jobService.js` 2,416, `interviewPrepService.js` 2,411, `githubservice.js` 2,183, `weeklyReportService.js` 1,812, `recommendationService.js` 1,758, `resumeservice.js` 1,709). |
| `repositories/` | 1 | Only `interviewQuestionRepository.js` (856 lines) | Most Mongoose queries live directly inside services/controllers. |
| `middleware/` | 23 | Auth, RBAC, rate limiters, admission controls, uploads, audit, request context | Flat folder; mixes core security middleware with domain-specific admission middleware. |
| `models/` | 69 | Mongoose schemas | Flat folder across all domains. |
| `prompts/` | 11 | AI prompt templates | Scattered outside AI integrations / domain modules. |
| `utils/` | 43 | Cross-cutting utils + `utils/ai/`, `utils/recruiter/`, `utils/recruiter-hub/` | Overlaps between `utils/ai/` and `utils/recruiter/`. |
| `workers/` | 1 | `weeklyReports.js` (other workers live in `services/` like `emailRetryQueueService`, `integrationSyncService`, `jobSourceSyncService`) | Worker scheduling split between `workers/` and `services/`. |
| `scripts/` | 111 | One-off migration, seeding, benchmark, and verification scripts | Co-located inside `src/scripts/` (many 600–1,400 lines). |
| `tests/` | 203 | Unit, integration tests + `fixtures/` | Flat 203-file folder. |

---

## 3. Specific Problems Identified

1. **Role & Feature Fragmentation (Frontend):**
   - Authentication is split between `app/auth/` (`login`, `signup`) and `app/features/auth/` (`forgot-password`, `reset-password`, `otp-verification`, `oauth-callback`).
   - Recruiter functionality is split across `features/recruiter/`, `features/recruiter-hub/`, `supervisors/recruiter/`, and `pages/recruiter-dashboard/`.
   - Admin & Super Admin functionality is split across `admin/`, `super-admin/`, `settings/`, and `pages/{admin-console,ai-versions,team-management,activity-logs}/`.
   - Public pages (`landing-page`, `privacy-policy`, `terms-of-service`, `api-docs-page`, `public-blog-page`, `contact-page`, `public-portfolio`, `accept-invitation`) sit inside `pages/` alongside authenticated Developer workspaces.
2. **Cross-Role Coupling:**
   - `AdminModule` imports `RecruiterSharedModule` from `supervisors/recruiter-shared/` for shared UI feedback (`loader`, `empty-state`, `message`) that already have equivalents in `shared/components/`.
3. **Oversized Frontend Components & Services:**
   - `portfolio-settings.component.html` (1,880 lines) / `.ts` (757 lines)
   - `dashboard.component.ts` (1,404 lines) / `.html` (780 lines)
   - `api.service.ts` (1,198 lines — monolithic God HTTP service)
   - `interview-prep.component.html` (1,106 lines) / `.ts` (932 lines)
   - `public-portfolio.component.html` (1,057 lines)
   - `admin-console.component.ts` (1,015 lines) / `.html` (958 lines)
   - `career-sprint.component.html` (957 lines) / `.ts` (797 lines)
   - `courses.component.html` (911 lines) / `.ts` (761 lines)
   - `resume-analyzer.component.ts` (861 lines), `recommendations.component.html` (844), `news.component.ts` (802), `scenario-simulator.component.ts` (771), `github-analyzer.component.ts` (744), `navbar.ts` (743), `sidebar.ts` (707), `profile.component.ts` (724)
4. **Backend Monolithic Layers & Circular Dependencies:**
   - 20 CommonJS circular dependencies across `config/news*`, `course*`, `notification*`, `careerSprint*`/`scenarioSprintExport*`, `weeklyReport*`.
   - `skillgapcontroller.js` (3,133 lines) contains heavy domain logic instead of delegating to a domain service.
   - `services/` has 199 files with no module boundaries.
5. **Candidate Obsolete / Unreferenced Files (Do Not Delete Without Explicit User Sign-off):**
   - Frontend: `pages/admin-console/`, `pages/recruiter-dashboard/`, `supervisors/recruiter/` (`recruiter.module.ts` unreferenced), `auth/auth-module.ts`, `settings/settings-module.ts`, `layout/layout-module.ts`, `shared/shared-module.ts`.
   - Backend: `services/test_two.js` (1,340 lines, 0 refs), `routes/adminRoutes.js` (0 refs), `routes/recruiterRoutes.js` (0 refs).

---

## 4. Target Architecture & Safe Migration Strategy

Rather than risking broken imports or regressions via a big-bang move of all 1,670 files at once, migration is structured in **dependency-ordered batches**, preserving backwards-compatible re-export shims during transition where needed and validating after every batch:

1. **Batch 1 — Core & Shared Foundation (`frontend/src/app/core/`, `shared/`)**:
   - Establish `core/guards/`, `core/interceptors/`, `core/layouts/` while preserving route/import compatibility.
   - Decompose monolithic `api.service.ts` into domain-scoped HTTP facades or clean modular groups without breaking callers.
2. **Batch 2 — Consolidated Auth & Public Features (`features/auth/`, `features/public/`)**:
   - Unify `auth/login` + `auth/signup` into `features/auth/pages/{login,signup}` alongside `otp-verification`, `forgot-password`, `reset-password`, `oauth-callback`.
   - Group public pages (`landing-page`, `privacy-policy`, `terms-of-service`, `api-docs-page`, `public-blog-page`, `contact-page`, `public-portfolio`, `accept-invitation`) into `features/public/`.
3. **Batch 3 — Role Features (`features/developer/`, `features/recruiter/`, `features/admin/`, `features/super-admin/`)**:
   - Consolidate `features/recruiter-hub` cleanly under `features/recruiter` without breaking `/app/recruiter` lazy loading.
   - Remove `AdminModule`'s cross-role dependency on `supervisors/recruiter-shared` by pointing it to `shared/components/`.
   - Consolidate `settings/`, `ai-versions`, `team-management`, `activity-logs` routes cleanly under `features/super-admin/`.
4. **Batch 4 — Frontend Component Decomposition (Phase 3)**:
   - Extract cohesive child components from `interview-prep` (Tab 1 library, Tab 2 generator/custom Q&A, Tab 3 saved sessions), `dashboard`, `portfolio-settings`, `admin-console` where responsibilities are genuinely independent, preserving HTML/CSS/inputs/outputs/subscriptions.
5. **Batch 5 — Backend Modularization & Cycle Breaking (Phase 4 & 5)**:
   - Break the 20 backend circular dependencies (`config/newsConfig <-> newsEnvCatalog`, `notificationPersistence <-> notificationService`, `course*`, `careerSprint <-> scenarioSprintExport`, `newsService <-> newsDiscovery`, `weeklyReport*`).
   - Organize domain modules cleanly (`backend/src/modules/<domain>/`) and core/integrations (`backend/src/core/`, `backend/src/integrations/`) with thin compatibility re-exports or clean `index.js` mounts preserving 100% of API endpoints, middleware order, and existing test imports.
   - Decompose oversized controller logic (starting with `skillgapcontroller.js` extraction into domain service/helpers).

---

## 5. Risk Assessment

| Risk | Mitigation |
| --- | --- |
| Breaking active `fix/bug-01` staged/untracked `interview-prep` work | Keep all staged/untracked files intact; update any moved path imports cleanly and verify `interviewAnswerCoverage.test.js` + `interview-prep` specs after every step. |
| Breaking lazy-loaded routes or guards (`app.routes.ts`) | Keep exact route paths, redirects, and guard arrays unchanged; verify with `tsc --noEmit`, unit tests, and `ng build`. |
| Breaking deep relative `require()` paths in 203 backend tests & 111 scripts | Update imports atomically or provide clean forwarding exports during domain modularization; run `node --check` and `node --test` after each batch. |
| Introducing circular dependencies | Run automated DAG cycle checks on both `frontend/src/app` and `backend/src` after each batch. |

