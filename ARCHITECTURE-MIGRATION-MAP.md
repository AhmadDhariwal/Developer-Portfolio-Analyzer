# Architecture Migration Map

This document records the exact file and directory migrations completed during the Developer Portfolio Analyzer (DPA) architecture restructuring on branch `fix/bug-01`. All behavior, API contracts, database schemas, routes, and UI designs were preserved.

## Frontend Migrations (`frontend/src/app`)

### 1. Core Infrastructure
| Previous Path | New Path | Notes |
| --- | --- | --- |
| `guards/*` | `core/guards/*` | Auth, role, and permission route guards |
| `interceptors/*` | `core/interceptors/*` | HTTP auth/error/CSRF interceptors |
| `layout/main-layout/*` | `core/layouts/main-layout/*` | Authenticated shell layout |

### 2. Authentication Feature
| Previous Path | New Path | Notes |
| --- | --- | --- |
| `auth/login/*` | `features/auth/pages/login/*` | Email/password + OAuth login page |
| `auth/signup/*` | `features/auth/pages/signup/*` | Registration + OTP verification page |

### 3. Public Feature
| Previous Path | New Path | Notes |
| --- | --- | --- |
| `pages/landing-page/*` | `features/public/pages/landing-page/*` | Public landing page |
| `pages/privacy-policy/*` | `features/public/pages/privacy-policy/*` | Privacy policy |
| `pages/terms-of-service/*` | `features/public/pages/terms-of-service/*` | Terms of service |
| `pages/api-docs-page/*` | `features/public/pages/api-docs-page/*` | Public API docs |
| `pages/public-blog-page/*` | `features/public/pages/public-blog-page/*` | Public blog |
| `pages/contact-page/*` | `features/public/pages/contact-page/*` | Contact page |
| `pages/public-portfolio/*` | `features/public/pages/public-portfolio/*` | Public developer portfolio view |
| `pages/accept-invitation/*` | `features/public/pages/accept-invitation/*` | Team/org invitation acceptance |

### 4. Developer Feature (`features/developer/pages/*`)
All 19 developer workspace page modules moved from `pages/*` to `features/developer/pages/*`:
- `pages/dashboard/*` → `features/developer/pages/dashboard/*`
- `pages/github-analyzer/*` → `features/developer/pages/github-analyzer/*`
- `pages/resume-analyzer/*` → `features/developer/pages/resume-analyzer/*`
- `pages/skill-gap/*` → `features/developer/pages/skill-gap/*`
- `pages/recommendations/*` → `features/developer/pages/recommendations/*`
- `pages/courses/*` → `features/developer/pages/courses/*`
- `pages/jobs/*` → `features/developer/pages/jobs/*`
- `pages/job-details/*` → `features/developer/pages/job-details/*`
- `pages/integrations-marketplace/*` → `features/developer/pages/integrations-marketplace/*`
- `pages/scenario-simulator/*` → `features/developer/pages/scenario-simulator/*`
- `pages/profile/*` → `features/developer/pages/profile/*`
- `pages/support/*` → `features/developer/pages/support/*`
- `pages/portfolio-settings/*` → `features/developer/pages/portfolio-settings/*`
- `pages/weekly-reports/*` → `features/developer/pages/weekly-reports/*`
- `pages/interview-prep/*` → `features/developer/pages/interview-prep/*`
- `pages/career-sprint/*` → `features/developer/pages/career-sprint/*`
- `pages/interviews-reports/*` → `features/developer/pages/interviews-reports/*`
- `pages/news/*` → `features/developer/pages/news/*`
- `pages/notifications/*` → `features/developer/pages/notifications/*`

### 5. Component Decomposition
| Parent Component | Extracted Child Component | Purpose |
| --- | --- | --- |
| `features/developer/pages/interview-prep/interview-prep.component.*` | `features/developer/pages/interview-prep/components/interview-saved-sessions/interview-saved-sessions.component.{ts,html,scss}` | Isolates Tab 3 Saved Sessions & History workspace (selector list, session header, TOC, stacked question cards) from `InterviewPrepComponent` |

### 6. Recruiter, Admin & Super-Admin Features
| Previous Path | New Path | Notes |
| --- | --- | --- |
| `features/recruiter-hub/*` | `features/recruiter/*` | Consolidated recruiter hub (pages, components, services, models, module) |
| `admin/*` | `features/admin/*` | Admin console, teams, recruiters, developers, jobs, performance, activity logs; removed dead `RecruiterSharedModule` import from `admin.module.ts` |
| `super-admin/*` | `features/super-admin/*` | Super-admin dashboard, admins, organizations, recruiters, developers, analytics, support, user-details, shared components |
| `settings/*` | `features/super-admin/pages/platform-settings/*` | Platform settings screen |
| `pages/ai-versions/*` | `features/super-admin/pages/ai-versions/*` | AI version management |
| `pages/team-management/*` | `features/super-admin/pages/team-management/*` | Organization team management |
| `pages/activity-logs/*` | `features/super-admin/pages/activity-logs/*` | System activity logs |

## Backend Cycle-Breaking Extractions (`backend/src`)

All 20 circular `require()` dependencies were eliminated without changing public module exports:

| Domain | New / Extracted Module | Cycle Broken |
| --- | --- | --- |
| News Config | `backend/src/config/newsProviderKeys.js` | `newsConfig.js <-> newsEnvCatalog.js` |
| Notifications | `backend/src/services/notificationTransactionService.js` | `notificationPersistenceService.js <-> notificationService.js` |
| Weekly Reports | Registration hook `registerSendReportEmail` in `weeklyReportDeliveryService.js` | `weeklyReportDeliveryService.js <-> weeklyReportService.js` |
| News Discovery | Registration hook `registerBroadRefresh` in `newsDiscoveryService.js` | `newsService.js <-> newsDiscoveryService.js` |
| Career Sprint | Registration hook `registerSprintCreator` in `scenarioSprintExportService.js` | `careerSprintService.js <-> scenarioSprintExportService.js` |
| Course Catalog | `backend/src/services/courseCatalogConstants.js` + `registerCourseNormalizer` / `registerCoverageDependencies` / `registerCourseServiceHelpers` + `KNOWN_TOPICS` in `courseCatalogTaxonomy.js` | 6-file cycle across `courseService.js`, `sharedCourseCatalogService.js`, `courseCatalogSearchService.js`, `courseCatalogTaxonomy.js`, `courseCatalogCoverageService.js`, `courseDiscoveryStatusService.js` |

### Backend Test Path Updates
Updated hardcoded frontend file path assertions in:
- `backend/src/tests/careerSprintHardening.test.js`
- `backend/src/tests/coursesHardening.test.js`
- `backend/src/tests/skillgapHardening.test.js`

## Candidate Obsolete Files (Retained Pending Explicit User Authorization)
Per repository safety rules, no legacy files were deleted without authorization:
- Frontend: `pages/admin-console/`, `pages/recruiter-dashboard/`, `supervisors/`, empty `auth/{auth-module.ts,auth-routing-module.ts}`, empty `layout/{layout-module.ts,layout-routing-module.ts}`, empty `shared/{shared-module.ts,shared-routing-module.ts}`.
- Backend: `backend/src/services/test_two.js`, `backend/src/routes/adminRoutes.js`, `backend/src/routes/recruiterRoutes.js`.

