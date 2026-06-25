# Jobs

Implementation-driven guide for job search, job details, and source health.

## Current Behavior
Jobs searches real/cached job sources, normalizes listings, and supports detail views. Background sync and provider health live in backend services.

## Files To Modify
| Change | Files |
|---|---|
| UI | `frontend/src/app/pages/jobs/*`, `frontend/src/app/pages/job-details/*` |
| Frontend service | `frontend/src/app/shared/services/job.service.ts` |
| Backend route/controller | `backend/src/routes/jobRoutes.js`, `backend/src/controllers/jobController.js` |
| Backend services | `backend/src/services/jobService.js`, `backend/src/services/jobSourceSyncService.js` |
| Models | `backend/src/models/Job.js`, `backend/src/models/jobCache.js`, `backend/src/models/jobSourceHealth.js` |

## Dependencies
- External providers: JSearch/RapidAPI, Jooble, Adzuna when configured.
- Job cache and source health collections.
- Profile and detected skills can influence matching/enrichment.

## Request Flow
List: `/app/jobs` -> `JobService.getJobs()` -> `GET /api/jobs` -> `jobController` -> `jobService` -> live or cached jobs.

Details: `/app/jobs/:id` -> `GET /api/jobs/:id`.

## Change Impact
- Provider changes affect source health and fallback behavior.
- Cache changes affect search freshness and API usage.

## Testing Files
- `frontend/src/app/shared/services/job.service.spec.ts`
- `node --check backend/src/controllers/jobController.js`
- `node --check backend/src/services/jobService.js`

## Common Pitfalls
- Do not assume every provider is configured.
- Keep cached fallback behavior when live providers fail.
- Preserve normalized job IDs used by detail pages.
