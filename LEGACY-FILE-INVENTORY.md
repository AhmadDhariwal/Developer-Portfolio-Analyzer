# Legacy File Inventory (Phase 2)

Every item listed below was verified across `frontend/src`, `backend/src`, `angular.json`, `tsconfig*.json`, `backend/index.js`, and test suites to have **0 remaining runtime, route, dynamic, or test references** after promoting active shared UI (`ConfirmDialogComponent`) and flattening `RecruiterHubModule` into `RecruiterModule`.

## Removed Verified Legacy & Obsolete Files (77 Files)

### 1. Frontend Superseded Prototype Components & Legacy Pages
| File(s) | Classification | Superseded By / Canonical Owner |
| --- | --- | --- |
| `frontend/src/app/shared/components/navbar/navbar.component.{ts,html,scss}` | Legacy unused prototype | `frontend/src/app/core/layouts/main-layout/navbar/` |
| `frontend/src/app/shared/components/sidebar/sidebar.component.{ts,html,scss}` | Legacy unused prototype | `frontend/src/app/core/layouts/main-layout/sidebar/` |
| `frontend/src/app/pages/admin-console/admin-console.{component.ts,component.html,component.scss,service.ts}` | Legacy unrouted duplicate | `frontend/src/app/features/admin/pages/admin-console/` |
| `frontend/src/app/pages/recruiter-dashboard/recruiter-dashboard.component.{ts,html,scss}` | Legacy unrouted prototype | `frontend/src/app/features/recruiter/pages/recruiter-dashboard/` |
| `frontend/src/app/shared/services/recruiter-dashboard.service.ts` | Legacy service (only used by `pages/recruiter-dashboard`) | `frontend/src/app/features/recruiter/services/recruiter-hub.service.ts` |

### 2. Frontend Legacy `supervisors/` Hierarchy (56 Files)
After migrating the single active component (`ConfirmDialogComponent` / `app-confirm-dialog`) to `frontend/src/app/shared/components/confirm-dialog/`, all remaining files under `supervisors/` had 0 consumers:
- `frontend/src/app/supervisors/recruiter/*` (components: `candidate-card`, `insights-panel`, `job-card`, `match-card`, `score-breakdown`; pages: `candidate-list`, `candidate-profile`, `comparison`, `dashboard`, `job-management`, `match-results`; `recruiter.service.ts`, `recruiter.module.ts`, `recruiter-routing.module.ts`)
- `frontend/src/app/supervisors/recruiter-shared/*` (duplicate `empty-state`, `loader`, `message`, `recruiter-message.service.ts`, `recruiter-shared.module.ts`, original `confirm-dialog` moved to `shared/components/confirm-dialog/`)

### 3. Redundant & Empty NgModule Boilerplate Stubs
| File | Classification | Reason |
| --- | --- | --- |
| `frontend/src/app/features/recruiter/recruiter-hub.module.ts` | Overlapping module wrapper | Folded directly into `RecruiterModule` (`recruiter.module.ts`) |
| `frontend/src/app/auth/{auth-module,auth-routing-module}.ts` | Empty obsolete stub | Standalone auth routes imported directly in `app.routes.ts` |
| `frontend/src/app/layout/{layout-module,layout-routing-module}.ts` | Empty obsolete stub | `MainLayout` imported directly in `app.routes.ts` |
| `frontend/src/app/shared/{shared-module,shared-routing-module}.ts` | Empty obsolete stub | Shared UI consists of standalone components |
| `frontend/src/app/features/super-admin/super-admin-routing.module.ts` | Empty obsolete stub | Replaced by `super-admin.routes.ts` |
| `frontend/src/app/features/super-admin/pages/platform-settings/{settings-module,settings-routing-module}.ts` | Empty obsolete stub | Standalone `SettingsPageComponent` routed in `app.routes.ts` |
| Empty migrated directories under `frontend/src/app/pages/*` | Obsolete empty directories | Cleaned after all files were moved in Phase 1 |

### 4. Backend Verified Obsolete Files
| File | Classification | Superseded By / Reason |
| --- | --- | --- |
| `backend/src/routes/adminRoutes.js` | Legacy 1-line shim (`module.exports = require('./admin.routes')`) | `backend/src/routes/admin.routes.js` (0 callers) |
| `backend/src/routes/recruiterRoutes.js` | Legacy 1-line shim (`module.exports = require('./recruiter.routes')`) | `backend/src/routes/recruiter.routes.js` (0 callers) |
| `backend/src/services/test_two.js` | Unused draft data dump (1,340 lines) | `backend/src/services/interviewQuestionSeedCatalog.js` (0 callers/tests) |

## Retained Verification Artifacts & Active Legacy-Named Modules
- `backend/src/routes/recruiter.routes.js` (`/api/recruiter`), `backend/src/services/recruiter/*`, `backend/src/utils/recruiter/*`: **Retained** — mounted in `backend/index.js`, exposed on `ApiService`, and actively used by `/api/recruiter-hub`, `/api/admin`, and `recruiterRankingEngine.test.js`.
- `backend/src/scripts/careerSprintReleaseVerify.out.json`, `coursesReleaseVerify.out.json`, `combinedIntegrations.proxy.json`: **Retained** — script-owned verification fixtures/outputs referenced by verification scripts in `backend/src/scripts/`.

