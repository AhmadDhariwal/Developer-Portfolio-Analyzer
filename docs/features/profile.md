# Profile

Implementation-driven guide for user profile and personalization signals.

## Current Behavior
Profile is the source of truth for `activeGithubUsername`, `activeCareerStack`, `activeExperienceLevel`, `careerGoal`, `targetTimeline`, and `learningPreference`. `profileHash` changes only when personalization fields change and drives dependent cache invalidation.

## Files To Modify
| Change | Files |
|---|---|
| Profile UI | `frontend/src/app/pages/profile/*` |
| Profile HTTP/cache | `frontend/src/app/shared/services/profile.service.ts` |
| Career profile state | `frontend/src/app/shared/services/career-profile.service.ts`, `frontend/src/app/shared/models/career-profile.model.ts` |
| Backend profile logic | `backend/src/controllers/profilecontroller.js`, `backend/src/routes/profile.routes.js` |
| User fields | `backend/src/models/user.js` |
| Avatar upload | `backend/src/middleware/avatarUploadMiddleware.js` |

## Dependencies
- `AuthService` stores current user shape used by modules.
- `CareerProfileService` broadcasts active profile changes.
- `FrontendAnalysisCacheService` clears dependent module caches.
- Dashboard, Skill Gap, Recommendations, News, Scenario Simulator, and Weekly Reports depend on profile hash/signature.

## Request Flow
Profile load: `/app/profile` -> `ProfileComponent.loadProfile()` -> `ProfileService.getProfile()` -> `GET /api/profile/me` -> `profilecontroller.getProfile()` -> User/Resume/Analysis reads -> cached frontend profile.

Profile save: `ProfileComponent.saveChanges()` -> `PUT /api/profile/me` -> update User -> recompute `profileHash` -> invalidate dependent runtime caches only if hash changed -> hydrate frontend profile/career state.

Career save: `CareerProfileService.saveCareerProfile()` -> `PUT /api/profile/career` -> update base and active career fields -> return active fields plus `profileHash`.

## Change Impact
- Changing active fields impacts Dashboard, GitHub Analyzer defaults, Skill Gap, Recommendations, News, Scenario Simulator, Weekly Reports, and Career Sprint display defaults.
- Profile changes must not delete GitHub analysis, resume analysis, saved reports, saved scenarios, or sprint history.
- Route changes require updating `ApiService`, `ProfileService`, and `API_REFERENCE.md`.

## Testing Files
- `node --check backend/src/controllers/profilecontroller.js`
- `node --check backend/src/routes/profile.routes.js`
- `npx -y ng build --configuration development` from `frontend`

## Common Pitfalls
- Do not read `githubUsername` directly when `activeGithubUsername` exists.
- Do not invalidate persistent analysis collections on profile-only updates.
- Keep frontend `profileHash` fallback deterministic when backend hash is absent.
- Avoid duplicate `sanitizeText` or duplicated save methods after merge conflict resolution.
