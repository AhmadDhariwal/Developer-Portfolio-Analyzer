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

## Versioned backend release contract

New windows use `calendarPolicy: sprint-calendar-48h-v1`, a validated pinned IANA
`timeZone`, and runtime timezone-data version metadata. Authenticated
`GET/PUT /api/career-sprints/preferences` reads/sets `{timeZone}`; absent or invalid
stored preferences fall back to UTC. Changes affect new windows only. Legacy
records retain their server-calendar policy and historical dates/activity.

A real completion day followed by one local calendar day without activity produces
a warning. The following local midnight is the deterministic break instant.
Restoration expires **48 elapsed hours** later; equality with expiry is ineligible.
A restored interval cannot be restored again without new real activity. Restoration
adds no completion, XP, credential or skill evidence. XP/levels remain sprint-scoped;
the existing progress, consistency and productivity formulas remain unchanged.

All overview requests validate primary-Mongo current/previous snapshots before
using serialization caches. Immutable revision keys include the snapshots, pinned
calendar day, overdue state and draft context. Database failure never returns an
old cached authoritative overview. Redis failure uses the database path. Plan
caches also require fresh owned profile/evidence/task context before reuse.

Saved drafts include immutable owner/context/fingerprint/origin metadata. Current
and history responses expose `aiPlans[].compatibility`; legacy metadata gaps are
`legacy-context-unknown`. `POST /:id/ai-plans/:planId/tasks` accepts selected
`taskIndexes`. A different or unknown context additionally requires
`acknowledgeContextFingerprint` equal to the current fingerprint returned by the
API. Acknowledgement does not replace the draft's original context. Different
same-name drafts are preserved: use a distinct name or explicitly delete one.

Modern Recommendation actions are revalidated against current owned context and
source references; IDs, snapshot identities and limitations survive saving and
ingestion. Imported/completed actions are excluded from planning across history.
AI is optional sequencing only: output must be a permutation of permitted server
task IDs. Model-authored factual text, score fields, dates and completion state are
rejected and use deterministic fallback.

Exact-interval owner reservations protect new/edited windows even while legacy
occupied-day migration is pending. Crashes retain conservative reservations;
preflight reports pending/orphaned tokens rather than deleting them automatically.
`backend/src/scripts/migrateCareerSprintReservations.js` defaults to read-only
preflight. Original legacy timezones must be explicitly supplied, globally with
`--legacy-time-zone` or by record using `--legacy-policy-file`. Conflicts halt
application. `--apply` additionally requires explicit deployment authorization;
this is an operator deployment step, never an ordinary API side effect.

Safety limits remain 366 days per new window, 500 tasks per sprint, eight drafts,
120-character task titles, and finite points from 1 to 10. Completed tasks must be
reopened before editing/deleting. The frontend must surface context acknowledgement
and legacy/current policy metadata; frontend implementation is a separate task.
