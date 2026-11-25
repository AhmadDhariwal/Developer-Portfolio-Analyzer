# Final Backend Architecture

**Overall Status:** **PASS** (Architecture, modularity, cycle elimination, helper deduplication, syntax, and route parity; see [FINAL-REGRESSION-VERIFICATION.md](file:///c:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/FINAL-REGRESSION-VERIFICATION.md) for pre-existing environment-gated suite blockers)

## 1. Domain-Based Modular Architecture

[backend/index.js](file:///c:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/index.js) boots cleanly against organized infrastructure under `backend/src/core/` and `22` self-contained domain modules under `backend/src/modules/`, with domain-grouped tests under `backend/src/tests/<domain>/`. Legacy flat folders (`controllers/`, `routes/`, `services/`, `models/`, `utils/`, `middleware/`, `prompts/`, `repositories/`, `config/`, `data/`, `templates/`, `workers/`) are 100% retired (`0` files remain).

### Core Infrastructure (`backend/src/core/`)

| Directory | Files | Ownership |
|---|---:|---|
| `core/ai/` (+ `models/`, `utils/`) | 8 | Multi-provider LLM orchestration, budgets, admissions, prompts & saved previews |
| `core/cache/` | 1 | Shared Redis client & cache helpers (`redisCacheService.js`) |
| `core/config/` | 4 | Env validation, Mongo connection, AI provider & GitHub OAuth configs |
| `core/developer-context/` | 3 | Canonical active developer identity, signal resolution & scoring bridge |
| `core/messaging/` (+ `models/`) | 6 | Email/SMS delivery, retry queue, invitations & email audit models |
| `core/middleware/` | 11 | JWT `protect`, RBAC, org context, rate limiters, security headers, uploads & platform settings middleware |
| `core/observability/` | 5 | Prometheus metrics, OpenTelemetry tracing, structured logger, admission metrics & safe log paths |
| `core/scoring/` | 12 | Deterministic scoring formulas (`githubHealthScore`, `resumeOverallScore`, `portfolioScore`, `scenarioPlanningScore`, `sprintProgressScore`, etc.) |
| `core/storage/` (+ `models/`, `utils/`) | 7 | Backblaze B2 object storage, public image storage, image optimization & cleanup workers |
| `core/utils/` | 8 | Date utilities, hashes, market demand, role weights, skill detector, task templates & shared `validation.js` (`escapeRegex`, `isValidObjectId`) |

### Business Domain Modules (`backend/src/modules/`)

- **Identity & Account:** `modules/auth/` (13 files), `modules/profile/` (2 files)
- **Developer Workspace Domains:** `modules/dashboard/` (9), `modules/github/` (7), `modules/resume/` (15), `modules/skill-gap/` (19), `modules/recommendations/` (13), `modules/courses/` (25), `modules/jobs/` (15), `modules/news/` (25), `modules/integrations/` (34 including 14 provider adapters), `modules/interview-prep/` (27), `modules/career-sprint/` (21), `modules/scenario-simulator/` (10), `modules/public-portfolio/` (14), `modules/weekly-reports/` (17 including `workers/` and `assets/fonts/Manrope.ttf`), `modules/support/` (7), `modules/workflows/` (7)
- **Shared Cross-Role Domain:** `modules/notifications/` (12 files)
- **Role-Specific Enterprise Domains:**
  - `modules/recruiter/` (52 files across `routes/`, `controllers/hub|matching/`, `services/hub|matching/`, `utils/hub|matching/`, `models/`, and `compatibility/`)
  - `modules/admin/` (18 files across `routes/`, `controllers/`, `services/`, `models/`)
  - `modules/super-admin/` (10 files across `routes/`, `controllers/`, `services/`, `models/`)

### Domain-Owned Test Layout (`backend/src/tests/`)

All `169` test files (`168` `*.test.js` suites + `recommendationsPerfMeasure.js`) live inside `19` domain subdirectories under `backend/src/tests/<domain>/`, sharing harness fixtures in `backend/src/tests/fixtures/` (`31` files). Both [package.json](file:///c:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/package.json) and [backend/package.json](file:///c:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/package.json) (`node --test src/tests/**/*.test.js`) and all verification scripts resolve the domain layout.

## 2. Decoupling, Deduplication & Controller Decomposition

1. **Cycle Elimination (`0` cycles in `audit-repo.mjs`):**
   - Decoupled [scenarioSprintExportService.js](file:///c:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/modules/scenario-simulator/services/scenarioSprintExportService.js) via `registerSprintExportHooks(...)` invoked by `careerSprintService.js` (also fixing a pre-existing `owner is not defined` defect).
   - Decoupled [integrationPersistenceService.js](file:///c:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/modules/integrations/services/integrationPersistenceService.js) via `registerCacheInvalidator(...)` invoked by `dashboardcontroller.js` and `careerSprintService.js`.
   - Restored `applyCourseFilters` inside `registerCourseServiceHelpers(...)` in [courseService.js](file:///c:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/modules/courses/services/courseService.js), resolving a missing helper callback in `courseCatalogSearchService.js`.
2. **Static Dynamic-Model Resolution:**
   - Replaced dynamic ``require(`../models/${name}`)`` calls in [accountDeletionService.js](file:///c:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/modules/auth/services/accountDeletionService.js) (`MODEL_LOADERS` + `resolveOwnedModel`) and [scenarioContextService.js](file:///c:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/modules/scenario-simulator/services/scenarioContextService.js) (`ADAPTER_MODELS`).
3. **Duplication Removal:**
   - Consolidated 7 duplicate copies of `escapeRegex` (`skilldetector.js`, `adminController.js`, `githubservice.js`, `interviewQuestionRepository.js`, `notificationcontroller.js`, `matchingService.js`, `resumeservice.js`) into [validation.js](file:///c:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/core/utils/validation.js).
4. **Justified Controller Decomposition:**
   - [adminConsoleController.js](file:///c:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/modules/admin/controllers/adminConsoleController.js): reduced from `1,611` to `671` lines by extracting team hydration, dashboard config normalization, performance cache, and `getConsolePerformanceData` into [adminConsoleService.js](file:///c:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/modules/admin/services/adminConsoleService.js) (`989` lines).
   - [superAdminController.js](file:///c:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/modules/super-admin/controllers/superAdminController.js): reduced from `1,591` to `855` lines by extracting windowing, time-series aggregation, metric registry snapshots, and `getPlatformAnalyticsData` into [superAdminAnalyticsService.js](file:///c:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/backend/src/modules/super-admin/services/superAdminAnalyticsService.js) (`791` lines).
   - `skillgapcontroller.js` (`3,133` lines) and `dashboardcontroller.js` (`1,408` lines) were inspected and intentionally kept as stable HTTP facades because they are already backed by domain services (`9` under `modules/skill-gap/services/`, `5` under `modules/dashboard/services/`) and `15+` existing hardening/performance tests bind proxy-load stubs and source-regex checks directly to those controller entrypoints.
5. **Dead Code Removal:** Removed `11` verified zero-consumer backend files (Batch B0).
6. **Filesystem & Relative-Root Fixes:** Updated `__dirname`-relative `.env`, `uploads/`, and `assets/fonts/Manrope.ttf` paths after deeper module placement.

