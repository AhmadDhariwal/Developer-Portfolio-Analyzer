# Career Sprint

Implementation-driven guide for sprint plans, tasks, streaks, and scenario imports.

## Current Behavior
Career Sprint stores the current sprint and history. Deterministic task generation and optional LLM plan generation are explicit POST actions, not read-page side effects.

## Files To Modify
| Change | Files |
|---|---|
| UI | `frontend/src/app/pages/career-sprint/*` |
| Frontend service/cache | `frontend/src/app/shared/services/career-sprint.service.ts` |
| API wrapper | `frontend/src/app/shared/services/api.service.ts` |
| Backend controller | `backend/src/controllers/careerSprintController.js`, `backend/src/routes/careerSprint.routes.js` |
| Backend service | `backend/src/services/careerSprintService.js`, `backend/src/services/aiTaskService.js` |
| Model | `backend/src/models/careerSprint.js` |

## Dependencies
- Profile and active career fields.
- Scenario Simulator imports.
- Weekly Reports and Dashboard consume sprint progress.
- `ApiService.invalidateScenarioContextCache()` after sprint mutations.

## Request Flow
Read: `/app/career-sprint` -> `CareerSprintService.getCurrent()` and `getHistory()` -> `GET /api/career-sprints/current`, `GET /api/career-sprints/history`.

Mutate: create/task/date/streak/import actions -> corresponding POST/PUT route -> update sprint -> refresh local sprint state.

Generate: `/generate-plan` and `/generate-ai-tasks` are deterministic task generation; `/generate-ai-plan` may call LLM.

## Change Impact
- Task shape changes affect Weekly Reports, Scenario context, and Dashboard progress.
- Cache invalidation should refresh sprint and scenario context only.

## Testing Files
- `node --check backend/src/controllers/careerSprintController.js`
- `node --check backend/src/services/careerSprintService.js`
- `npx -y ng build --configuration development`

## Common Pitfalls
- Do not generate tasks on page load.
- Preserve saved sprint history.
- Keep scenario import dedupe behavior so repeated imports do not duplicate tasks.
