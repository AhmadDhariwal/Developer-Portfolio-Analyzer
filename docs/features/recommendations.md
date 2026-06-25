# Recommendations

Implementation-driven guide for career recommendations.

## Current Behavior
Recommendations aggregate GitHub, resume, skill-gap, profile, sprint, and market signals. Authenticated recommendations are cached by signal hash; temporary generation is allowed through the `/generate` path.

## Files To Modify
| Change | Files |
|---|---|
| UI/cache | `frontend/src/app/pages/recommendations/*` |
| Frontend service | `frontend/src/app/shared/services/recommendations.service.ts` |
| API wrappers | `frontend/src/app/shared/services/api.service.ts` |
| Backend controller | `backend/src/controllers/recommendationscontroller.js`, `backend/src/routes/recommendations.routes.js` |
| Model | `backend/src/models/recommendation.js` |

## Dependencies
- Profile active fields and profile signature.
- `Analysis`, `ResumeAnalysis`, `AnalysisCache`, `CareerSprint`, `WeeklyReport`.
- `FrontendAnalysisCacheService` current signal hash.

## Request Flow
`/app/recommendations` -> active username/profile -> frontend cache check -> `POST /api/recommendations` -> controller builds recommendations -> response cached by `signalHash`.

Temporary flow: `POST /api/recommendations/generate` with `isTemporary=true`.

## Change Impact
- Recommendation result shape affects Dashboard cards, Career Sprint action handoff, Weekly Reports, and Scenario context.
- Cache key changes must preserve current signal hash behavior.

## Testing Files
- `node --check backend/src/controllers/recommendationscontroller.js`
- `npx -y ng build --configuration development`

## Common Pitfalls
- Route is POST, not GET.
- Do not treat temporary analysis as saved profile analysis.
- Keep `actionToSprint` behavior aligned with Career Sprint APIs.
