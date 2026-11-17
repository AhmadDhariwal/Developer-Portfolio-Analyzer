# ARCHITECTURE RESTRUCTURING PLAN

**Branch:** `fix/bug-01`  
**Strategy:** Incremental, dependency-ordered refactoring with zero behavior, API, schema, or UI changes.

## Execution Sequence

| Batch | Scope | Verification Gate |
| --- | --- | --- |
| **1. Core & Shared (Frontend)** | Move `guards/`, `interceptors/`, `layout/` under `core/`; introduce `core/authentication/` & `core/services/` boundaries; keep root re-export shims if wide callers exist, or update all callers cleanly. | `tsc --noEmit`, `ng test --watch=false`, cycle check (`0` cycles). |
| **2. Auth & Public Features (Frontend)** | Unify `auth/login` + `auth/signup` into `features/auth/pages/`; organize `features/public/pages/` (`landing-page`, `privacy-policy`, `terms-of-service`, `api-docs-page`, `public-blog-page`, `contact-page`, `public-portfolio`, `accept-invitation`). | `tsc --noEmit`, auth/public unit tests, `ng build`. |
| **3. Role Separation (Frontend)** | Consolidate `features/recruiter/` (removing redundant wrapper while keeping `/app/recruiter` lazy loading); decouple `admin/` from `supervisors/recruiter-shared/`; group `settings/`, `ai-versions`, `team-management`, `activity-logs` under `features/super-admin/`; move Developer pages into `features/developer/pages/`. | `tsc --noEmit`, `ng test --watch=false`, `ng build`. |
| **4. Component Decomposition (Frontend)** | Extract focused child components from oversized Developer/Admin pages (preserving HTML/CSS/inputs/outputs/subscriptions/themes). | Prettier `--write`/`--check`, `tsc --noEmit`, `ng test --watch=false`, `ng build`, Playwright check. |
| **5. Backend Cycle Resolution & Modularization** | Break all 20 CommonJS circular dependencies; organize `backend/src/core/`, `backend/src/integrations/`, and `backend/src/modules/<domain>/` (preserving API URLs, middleware order, and `index.js` mounts); extract business logic out of oversized controllers. | `node --check` across changed JS, `node --test` domain & integration suites, cycle check (`0` cycles). |
| **6. Final Verification & Documentation** | Write `ARCHITECTURE-MIGRATION-MAP.md`, `ARCHITECTURE-STRUCTURE-GUIDE.md`, `ARCHITECTURE-VERIFICATION-REPORT.md`; run full Prettier, `tsc`, `ng test`, `ng build`, backend tests, Playwright visual regression, and `git diff --check`. | All gates green. |

