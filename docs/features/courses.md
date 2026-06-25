# Courses

Implementation-driven guide for course recommendations.

## Current Behavior
Courses are deterministic, cache-backed recommendations built from career profile, skill-gap signals, and filters. The current backend does not call an AI prompt for Courses.

## Files To Modify
| Change | Files |
|---|---|
| Frontend page/UI | `frontend/src/app/pages/courses/*` |
| Frontend data/cache behavior | `frontend/src/app/shared/services/course.service.ts`, `frontend/src/app/shared/models/course.model.ts` |
| Backend filtering/ranking | `backend/src/controllers/courseController.js`, `backend/src/services/courseService.js` |
| Route contract | `backend/src/routes/courseRoutes.js`, `docs/API_REFERENCE.md` |
| Tests | `frontend/src/app/shared/services/course.service.spec.ts` |

## Dependencies
- `AnalysisCache` stores generated course pools.
- Auth middleware supplies `req.user`.
- Skill gaps come from latest skill-gap cache entries.
- Frontend uses `CourseService` with in-memory `shareReplay` cache.

## Request Flow
`/app/courses` -> `CoursesComponent` -> `CourseService.getCourses()` -> `GET /api/courses` -> `courseController.fetchCourses()` -> `courseService.buildCoursePool()` -> `AnalysisCache` -> response.

## Change Impact
- Filter/query changes affect cache keys in both `CourseService` and `courseController`.
- Ranking changes affect user-visible course order but not saved data.
- Adding AI generation would be a behavior change and must update this doc plus `AI_PIPELINE.md`.

## Testing Files
- `frontend/src/app/shared/services/course.service.spec.ts`
- `node --check backend/src/controllers/courseController.js`
- `node --check backend/src/services/courseService.js`

## Common Pitfalls
- Do not document or implement hidden AI generation on normal course reads.
- Keep `page` and `limit` in frontend cache keys.
- Keep backend pool cache separate from frontend request dedupe.
