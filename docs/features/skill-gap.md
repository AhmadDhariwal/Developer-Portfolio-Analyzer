# Skill Gap

Implementation-driven guide for skill-gap analysis.

## Current Behavior
Skill Gap compares GitHub, resume, profile, sprint, recommendations, and demand signals against the active career profile. Results are cached by signal hash and career profile.

Displayed skill names are normalized through the shared industry skill catalog before they reach the response. Aliases such as `reactjs`, `node js`, and `Dockerfile` are canonicalized, while malformed tokens or non-skill text are filtered out. Current, missing, weak, and high-demand skills should include source and evidence text so the UI can explain why the skill is present, why it matters, and how it was detected.

The current analysis version is `v6-skill-intelligence`. It uses the existing cache-key strategy but intentionally avoids reusing older `v5` cached payloads so stale malformed skill names do not bypass the stricter validation. Missing-skill objects may include additive metadata such as `businessImpact`, `learningEffort`, `recommendedResources`, `suggestedProject`, `whyExists`, and `whyItMatters`; existing consumers should continue using the original fields.

## Files To Modify
| Change | Files |
|---|---|
| UI/cache | `frontend/src/app/pages/skill-gap/*` |
| Frontend service | `frontend/src/app/shared/services/skill-gap.service.ts` |
| Backend analysis | `backend/src/controllers/skillgapcontroller.js`, `backend/src/routes/skillgap.routes.js` |
| Skill graph | `backend/src/services/skillGraphService.js`, `backend/src/models/skillGraph.js` |
| Shared cache | `frontend/src/app/shared/services/frontend-analysis-cache.service.ts` |

## Dependencies
- Active profile fields from `CareerProfileService`.
- `Analysis`, `ResumeAnalysis`, `AnalysisCache`, `WeeklyReport`, `CareerSprint`, `Recommendation`.
- GitHub fallback analysis can run inside backend skill-gap analysis.

## Request Flow
`/app/skill-gap` -> active username/profile -> frontend cache check -> `POST /api/skillgap/skill-gap` -> `skillgapcontroller.analyzeSkillGap()` -> signal aggregation -> result + cache metadata.

## Change Impact
- Signal key changes affect Recommendations, Dashboard, Weekly Reports, and Scenario context.
- Profile changes should refresh mounted Skill Gap once and avoid recursive requests.

## Testing Files
- `node --check backend/src/controllers/skillgapcontroller.js`
- `npx -y ng build --configuration development`

## Common Pitfalls
- Route is `POST /api/skillgap/skill-gap`, not `/api/skillgap/analyze`.
- Keep frontend cache validation tied to current `signalHash`.
- Avoid duplicate init calls; service inflight dedupe should collapse identical requests.
