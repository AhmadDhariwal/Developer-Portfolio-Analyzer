# Dashboard

Implementation-driven guide for the main developer dashboard.

## Current Behavior
Dashboard is a read/aggregate surface. It uses cached or persisted analysis data and active profile fields. It does not generate new GitHub/resume/AI analysis on normal read endpoints.

## Files To Modify
| Change | Files |
|---|---|
| Dashboard UI/cache | `frontend/src/app/pages/dashboard/*` |
| HTTP methods | `frontend/src/app/shared/services/api.service.ts` |
| Backend aggregation | `backend/src/controllers/dashboardcontroller.js`, `backend/src/routes/dashboard.routes.js` |
| Shared cache | `frontend/src/app/shared/services/frontend-analysis-cache.service.ts` |

## Dependencies
- `Analysis`, `ResumeAnalysis`, `AnalysisCache`, `Recommendation`, `WeeklyReport`, `CareerSprint`, jobs/news signals.
- Profile active fields and `profileHash`/signature.
- `developerSignalService` for aggregate signal freshness.

## Request Flow
`/app/dashboard` -> `DashboardComponent.loadDashboardData()` -> `GET /api/dashboard/summary` -> secondary calls to `/contributions`, `/languages`, `/skills`, `/integration-analytics` -> frontend cache keyed by module and `signalHash`.

## Change Impact
- Summary contract changes affect multiple cards and freshness rows.
- Username logic must use `activeGithubUsername || githubUsername`.
- Cache invalidation changes can cause stale Dashboard data or unnecessary API fan-out.

## Testing Files
- `node --check backend/src/controllers/dashboardcontroller.js`
- `npx -y ng build --configuration development`

## Common Pitfalls
- Do not add hidden generation to Dashboard GET endpoints.
- Keep Summary, Contributions, Languages, and Skills on the same active username source.
- Do not mix team/recruiter dashboards with the main `/app/dashboard` feature.
