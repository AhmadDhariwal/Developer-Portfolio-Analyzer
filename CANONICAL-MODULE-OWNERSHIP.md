# Canonical Module Ownership (Phase 2)

This document establishes single authoritative ownership across the frontend and backend and defines the incremental backend domain-modularization roadmap.

## Frontend Canonical Ownership

| Responsibility | Canonical Owner | Consumers | Notes |
| --- | --- | --- | --- |
| Authenticated shell (`MainLayout`, `Navbar`, `Sidebar`, `Footer`) | `frontend/src/app/core/layouts/main-layout/` | `app.routes.ts` | Single navigation implementation for all authenticated roles |
| Auth & role route guards / HTTP interceptor | `frontend/src/app/core/guards/`, `core/interceptors/` | `app.routes.ts`, `app.config.ts` | Centralized access control (`authGuard`, `superAdminGuard`, `recruiterRoleGuard`, `adminSettingsGuard`, `noAdminTabsGuard`) |
| Cross-role Confirmation Dialog (`<app-confirm-dialog>`) | `frontend/src/app/shared/components/confirm-dialog/` | Developer (`support.ts`), Admin (`admin-recruiters`), Recruiter (`jobs`, `shortlists`) | Standalone component; no cross-role `supervisors/` coupling |
| Shared Empty State / Loader / Message | `frontend/src/app/shared/components/{empty-state,loader,message}/` | Developer & Admin pages | Recruiter hub retains `app-recruiter-empty-state` & `app-recruiter-loader` locally inside `RecruiterHubSharedModule` |
| Activity Logs (Org Admin vs Super Admin) | Role pages in `features/admin/pages/activity-logs/` & `features/super-admin/pages/activity-logs/`; shared CSS in `shared/styles/_activity-logs-shared.scss` | `/app/admin/activity-logs` vs `/app/settings/activity-logs` | Strict role isolation for data fetching & redaction; shared styling via `shared/styles/` |
| Job Card (Developer Jobs vs Recruiter Hiring) | `shared/components/job-card/` (`app-job-card`) vs `features/recruiter/components/job-card/` (`app-recruiter-job-card`) | `features/developer/pages/jobs/` vs `features/recruiter/pages/jobs/` | Disambiguated selectors matching distinct contracts |
| Recruiter Lazy Feature Module | `frontend/src/app/features/recruiter/recruiter.module.ts` | `app.routes.ts` (`/app/recruiter`) | Single NgModule uniting `RecruiterHubRoutingModule` and `RecruiterHubSharedModule` |
| Super Admin Workspace vs `/app/settings` | `features/super-admin/` (`/super-admin/*`) & `features/super-admin/pages/` (`/app/settings/*`) | `superAdminGuard` | Both routes remain supported under distinct layout shells (`SaShellComponent` vs `MainLayout`) |

## Backend Canonical Ownership

| Domain / Responsibility | Authoritative Owner(s) | Consumers |
| --- | --- | --- |
| Recruiter Candidate Matching & AI Ranking Engine | `backend/src/services/recruiter/{matchingService,aiRankingService}.js` + `backend/src/utils/recruiter/*` | `/api/recruiter`, `/api/recruiter-hub`, `/api/admin` (`controllers/admin/jobController.js`) |
| Recruiter Hub Workflows (Candidates, Jobs, Matches, Shortlists, Comparison, Analytics, Activity, Profile) | `backend/src/routes/recruiter-hub/*`, `controllers/recruiter-hub/*`, `services/recruiter-hub/*`, `utils/recruiter-hub/*` | `/api/recruiter-hub` (Angular `features/recruiter/`) |
| News Runtime & Provider Keys | `backend/src/config/{newsProviderKeys,newsConfig,newsEnvCatalog}.js`, `services/newsService.js`, `services/newsDiscoveryService.js` | Acyclic (`0` circular dependencies); `newsDiscoveryService` uses `registerBroadRefresh` hook |
| Course Catalog & Discovery | `backend/src/services/{courseCatalogConstants,courseCatalogTaxonomy,sharedCourseCatalogService,courseCatalogCoverageService,courseCatalogSearchService,courseDiscoveryStatusService,courseService}.js` | Acyclic via explicit helper registration hooks |
| Notification Transactions & Delivery | `backend/src/services/{notificationTransactionService,notificationPersistenceService,notificationService}.js` | Shared atomic MongoDB transactions across all domains |
| Interview Prep Question Bank & AI Providers | `backend/src/services/{interviewPrepService,interviewAnswerCoverage,interviewQuestionQualityService,interviewQuestionSeedCatalog,interviewProjectContext}.js` + `providers/interviewAIProvider.js` | `/api/interview-prep`, background ingestion & maintenance schedulers |

## Backend Domain Modularization Assessment (Section 6)

**Current State:** Backend uses layer-based top-level folders (`controllers/`, `services/`, `repositories/`, `models/`, `routes/`, `utils/`, `prompts/`) with sub-namespace folders already established for `controllers/recruiter/`, `controllers/recruiter-hub/`, `controllers/admin/`, `services/recruiter/`, `services/recruiter-hub/`, and `routes/recruiter-hub/`. All 20 circular `require()` dependencies identified in Phase 1 have now been resolved cleanly (`0` cycles remaining).

**Recommendation for Incremental Migration:**
Because 150+ unit and hardening suites in `backend/src/tests/` use relative `require('../services/...')` and source-inspection assertions (`fs.readFileSync('backend/src/controllers/...')`), moving flat files across directories in a single big-bang commit carries high churn with low functional upside unless done domain-by-domain with updated test fixtures. When future feature work modifies any priority domain:
1. Co-locate new submodules under `backend/src/modules/<domain>/` (`interview-prep`, `recruiter`, `career-sprint`, `github-analysis`, `resume-analysis`, `portfolio`, `admin`, `super-admin`) with thin facade re-exports at legacy paths until tests migrate.
2. Centralize duplicated cross-cutting helpers (`escapeRegex`, `isValidObjectId`) into `backend/src/utils/validation.js` domain-by-domain as controllers are decomposed (`skillgapcontroller.js` 3,133 lines, `adminConsoleController.js` 1,611 lines, `superAdminController.js` 1,591 lines).

