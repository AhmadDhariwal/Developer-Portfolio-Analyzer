# Coding Agent Context

Use this file when you need one compact map of the project before editing. It does not replace feature docs; it tells you which file to open next and what each part owns.

## Entry Rule
1. Start with `docs/PROJECT_INDEX.md`.
2. Read this file for the project map.
3. Open the one feature doc under `docs/features/` that matches the task.
4. Edit only the files listed for that feature unless the change impact requires shared files.

## Repository Structure
| Area | Path | Purpose |
|---|---|---|
| Backend app | `backend/index.js` | Express app startup, middleware, route mounting, workers. |
| Backend routes | `backend/src/routes/` | URL definitions and middleware binding. |
| Backend controllers | `backend/src/controllers/` | HTTP request handling and response shaping. |
| Backend services | `backend/src/services/` | Business logic, external APIs, AI orchestration, caches. |
| Backend models | `backend/src/models/` | Mongoose schemas and persisted contracts. |
| Backend prompts | `backend/src/prompts/` | AI prompt templates for explicit generation flows. |
| Frontend routes | `frontend/src/app/app.routes.ts` | Angular route map and lazy modules. |
| Frontend pages | `frontend/src/app/pages/` | Main protected app pages. |
| Frontend shared services | `frontend/src/app/shared/services/` | API wrappers, cache services, feature services. |
| Frontend shared models | `frontend/src/app/shared/models/` | Client-side type and normalization contracts. |
| Feature docs | `docs/features/` | Implementation notes per module. |
| Agent docs | `docs/agent/` | Agent workflow, common tasks, change impact, this context file. |

## Backend Request Flow
`Client -> Express middleware -> route -> controller -> service/model -> response`

Core middleware order lives in `backend/index.js`:
- security headers and CORS
- rate limit and request context
- JSON/body parsing
- maintenance/static uploads/metrics/audit
- per-route `protect` and role guards

Routes should stay thin. Controllers should validate request shape and call services. Services should own reusable business logic. Models define stored data contracts.

## Frontend Request Flow
`Angular route -> page component -> shared service/API service -> backend /api/* -> component state/template`

Protected app pages live under `/app/*` inside `MainLayout`. Most feature pages use:
- a page component in `frontend/src/app/pages/<feature>/`
- a shared service in `frontend/src/app/shared/services/`
- optional localStorage/memory cache
- `ApiService` for broad shared endpoint wrappers

## Core Feature Map
| Feature | Feature Doc | Frontend | Frontend Service | Backend Route | Backend Controller/Service | Models |
|---|---|---|---|---|---|---|
| Dashboard | `docs/features/dashboard.md` | `pages/dashboard/*` | `api.service.ts`, `frontend-analysis-cache.service.ts` | `routes/dashboard.routes.js` | `controllers/dashboardcontroller.js` | `analysis.js`, `resumeAnalysis.js`, `weeklyReport.js`, `careerSprint.js` |
| Profile | `docs/features/profile.md` | `pages/profile/*` | `profile.service.ts`, `career-profile.service.ts` | `routes/profile.routes.js` | `controllers/profilecontroller.js` | `user.js`, `resumeFile.js` |
| GitHub Analyzer | `docs/features/github-analyzer.md` | `pages/github-analyzer/*` | `github.service.ts` | `routes/github.routes.js` | `controllers/githubcontroller.js`, `services/githubservice.js` | `analysis.js`, `repository.js`, `githubAnalysisCache.js` |
| Resume Analyzer | `docs/features/resume-analyzer.md` | `pages/resume-analyzer/*` | `resume.service.ts`, `api.service.ts` | `routes/resume.routes.js` | `controllers/resumecontoller.js`, `services/resumeservice.js` | `resumeFile.js`, `resumeAnalysis.js`, `resumeAnalysisCache.js` |
| Skill Gap | `docs/features/skill-gap.md` | `pages/skill-gap/*` | `skill-gap.service.ts` | `routes/skillgap.routes.js` | `controllers/skillgapcontroller.js` | `analysisCache.js`, `skillGraph.js` |
| Recommendations | `docs/features/recommendations.md` | `pages/recommendations/*` | `recommendations.service.ts` | `routes/recommendations.routes.js` | `controllers/recommendationscontroller.js` | `recommendation.js` |
| Tech News | `docs/features/news.md` | `pages/news/*` | `news.service.ts` | `routes/newsRoutes.js` | `controllers/newsController.js`, `services/newsService.js` | `news.js`, `newsSavedItem.js` |
| Scenario Simulator | `docs/features/scenario-simulator.md` | `pages/scenario-simulator/*` | `api.service.ts` | `routes/scenarioSimulator.routes.js` | `controllers/scenarioSimulatorController.js`, `services/scenarioSimulatorService.js` | `scenarioSimulation.js` |
| Weekly Reports | `docs/features/weekly-reports.md` | `pages/weekly-reports/*` | `weekly-report.service.ts`, `api.service.ts` | `routes/weeklyReport.routes.js` | `controllers/weeklyReportController.js`, `services/weeklyReportService.js` | `weeklyReport.js` |
| Career Sprint | `docs/features/career-sprint.md` | `pages/career-sprint/*` | `career-sprint.service.ts`, `api.service.ts` | `routes/careerSprint.routes.js` | `controllers/careerSprintController.js`, `services/careerSprintService.js`, `services/aiTaskService.js` | `careerSprint.js` |
| Courses | `docs/features/courses.md` | `pages/courses/*` | `course.service.ts` | `routes/courseRoutes.js` | `controllers/courseController.js`, `services/courseService.js` | `analysisCache.js` |
| Jobs | `docs/features/jobs.md` | `pages/jobs/*`, `pages/job-details/*` | `job.service.ts` | `routes/jobRoutes.js` | `controllers/jobController.js`, `services/jobService.js`, `services/jobSourceSyncService.js` | `Job.js`, `jobCache.js`, `jobSourceHealth.js` |
| Interview Prep | `docs/features/interview-prep.md` | `pages/interview-prep/*` | `interview-prep.service.ts` | `routes/interviewPrep.routes.js` | `controllers/interviewPrepController.js`, `services/interviewPrepService.js` | `interviewQuestionBank.js`, `interviewPrepSession.js` |
| Notifications | `docs/features/notifications.md` | `pages/notifications/*` | `notification.service.ts` | `routes/notification.routes.js` | `controllers/notificationcontroller.js`, `services/notificationService.js` | `notification.js`, `user.js` |
| Recruiter Hub | `docs/features/recruiter.md` | `features/recruiter/*` | `api.service.ts`, recruiter services | `routes/recruiter-hub/*` | `controllers/recruiter-hub/*`, `services/recruiter-hub/*` | recruiter/candidate models |
| Admin/Super Admin | `docs/features/admin.md` | `admin/*`, `super-admin/*`, `settings/*` | admin/super-admin services | `routes/admin*.js`, `routes/super-admin.routes.js` | admin/super-admin controllers | `user.js`, `organization.js`, `platformSettings.js`, `auditLog.js` |

## Profile And Personalization Flow
Profile is the source of truth for:
- `activeGithubUsername`
- `activeCareerStack`
- `activeExperienceLevel`
- `careerGoal`
- `targetTimeline`
- `learningPreference`
- `profileHash`

Backend owner:
- `backend/src/controllers/profilecontroller.js`
- `backend/src/models/user.js`

Frontend owner:
- `frontend/src/app/shared/services/profile.service.ts`
- `frontend/src/app/shared/services/career-profile.service.ts`
- `frontend/src/app/shared/models/career-profile.model.ts`

Profile change impact:
- May refresh/invalidate Dashboard, Skill Gap, Recommendations, Tech News, Weekly Reports, and Scenario Simulator context.
- Must not delete GitHub analysis, Resume analysis, saved reports, saved scenarios, or Career Sprint history.
- Modules should use `activeGithubUsername || githubUsername` when a GitHub username is needed.

## Cache And Refresh Flow
| Cache | Owner | Normal Read | Manual Refresh |
|---|---|---|---|
| Profile cache | `profile.service.ts` | memory/localStorage, inflight `shareReplay` | `getProfile(true)` bypasses cache |
| Dashboard frontend cache | `DashboardComponent` + `FrontendAnalysisCacheService` | cache-first by module/signal | `refresh=true` |
| GitHub cache | `github.service.ts`, `githubAnalysisCache.js` | memory/backend cache | `forceRefresh=true` |
| Skill Gap cache | `skill-gap.service.ts` | signal hash cache | force refresh in analyze payload |
| Recommendations cache | `recommendations.service.ts` + frontend cache | signal hash cache | force refresh in payload |
| News cache | `news.service.ts` + backend news cache | cache-first feed/saved paths | `refresh=true` |
| Scenario context | `ApiService` + `scenarioSimulatorService.js` | in-memory/frontend + backend context cache | `forceRefresh=true` |
| Weekly Reports | `weekly-report.service.ts` | frontend latest/history dashboard cache | `generateReport(true)` |
| Career Sprint | `career-sprint.service.ts` | current/history memory cache | mutation invalidates current/history as needed |
| Courses | `course.service.ts` + `AnalysisCache` | `shareReplay` by filters/page and backend pool cache | clear/invalidate service cache |

## Read Vs Generate Rule
Read pages should not trigger hidden AI generation.

Explicit generation/analyze paths include:
- GitHub: `POST /api/github/analyze`, `/analyze-save`
- Resume: `POST /api/resume/analyze`
- Skill Gap: `POST /api/skillgap/skill-gap`
- Recommendations: `POST /api/recommendations`, `/recommendations/generate`
- Weekly Reports: `POST /api/weekly-reports/generate`
- Career Sprint: `/generate-plan`, `/generate-ai-tasks`, `/generate-ai-plan`
- Interview Prep: `/generate`, `/ask-question`

Deterministic/read-first modules:
- Dashboard read endpoints
- Scenario Simulator context/history reads and what-if formula
- Courses normal reads
- Weekly Reports latest/history reads
- News saved reads

## Change Impact Shortcuts
| If You Change | Also Check |
|---|---|
| `User` profile fields | Profile, Dashboard, Skill Gap, Recommendations, News, Scenario, Weekly Reports, Career Sprint |
| `Analysis` result shape | Dashboard, GitHub Analyzer, Skill Gap, Recommendations, Scenario, Weekly Reports |
| Resume analysis shape | Resume Analyzer, Dashboard, Skill Gap, Recommendations, Weekly Reports, Scenario |
| `profileHash` or `signalHash` | `CACHE_SYSTEM.md`, Profile, Dashboard, Skill Gap, Recommendations, News, Scenario, Weekly Reports |
| `ApiService` method | Every page that calls that method |
| Auth/current user shape | Guards, Profile, active username/default profile logic |
| AI provider/service | All explicit generation modules |
| Route path | `API_REFERENCE.md`, feature doc, frontend service |

## Minimal Verification Commands
Use the smallest set that matches the edited files.

Backend syntax:
```powershell
node --check backend\src\controllers\<file>.js
node --check backend\src\services\<file>.js
node --check backend\src\routes\<file>.js
```

Frontend compile:
```powershell
cd frontend
npx -y ng build --configuration development
```

Focused frontend specs when available:
```powershell
cd frontend
npx ng test --include "src/app/shared/services/course.service.spec.ts"
npx ng test --include "src/app/shared/services/job.service.spec.ts"
```

## Common Agent Pitfalls
- Do not start from broad repo scans when a feature doc points to exact files.
- Do not change routes, schemas, or API contracts unless requested.
- Do not conflate main Dashboard with recruiter/admin dashboards.
- Do not add AI calls to read endpoints.
- Do not invalidate persistent saved artifacts from profile-only changes.
- Do not use legacy `githubUsername` when active username exists.
- Do not claim runtime/network behavior without actually running the app or browser.
