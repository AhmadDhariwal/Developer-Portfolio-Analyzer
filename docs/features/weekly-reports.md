# Weekly Reports

Implementation-driven guide for weekly report reads and generation.

## Current Behavior
Weekly Reports reads saved reports cache-first. Report generation is explicit through `POST /api/weekly-reports/generate` or scheduler paths and may use AI-enhanced narrative with deterministic fallback.

## Files To Modify
| Change | Files |
|---|---|
| UI/cache | `frontend/src/app/pages/weekly-reports/*` |
| Frontend service | `frontend/src/app/shared/services/weekly-report.service.ts` |
| API wrapper | `frontend/src/app/shared/services/api.service.ts` |
| Backend controller | `backend/src/controllers/weeklyReportController.js`, `backend/src/routes/weeklyReport.routes.js` |
| Generation service | `backend/src/services/weeklyReportService.js` |
| Model | `backend/src/models/weeklyReport.js` |
| Prompt | `backend/src/prompts/weeklyReportPrompt.js` |

## Dependencies
- `developerSignalService` and `signalHash`.
- GitHub analysis, default resume analysis, Skill Gap, Recommendations, Career Sprint, Public Portfolio, integrations.
- Email notification settings on User.

## Request Flow
Read dashboard: `/app/weekly-reports` -> `WeeklyReportService.getDashboard(6)` -> `GET /api/weekly-reports/latest` + `GET /api/weekly-reports/history` -> frontend dashboard cache.

Generate: button -> `WeeklyReportService.generateReport(true)` -> `POST /api/weekly-reports/generate?forceRefresh=true` -> saved report upsert -> optional email status update -> cache latest/history.

## Change Impact
- Read endpoint changes affect saved-report-first behavior.
- Generation changes can trigger AI and email side effects.
- `meta.signalHash` is the skip gate for redundant AI generation.

## Testing Files
- `node --check backend/src/controllers/weeklyReportController.js`
- `node --check backend/src/services/weeklyReportService.js`
- `npx -y ng build --configuration development`

## Common Pitfalls
- Do not call generation from read-only load paths.
- Do not invalidate saved reports on profile changes; invalidate only frontend read caches.
- Keep `$set` update payloads free of duplicate Mongo paths.
