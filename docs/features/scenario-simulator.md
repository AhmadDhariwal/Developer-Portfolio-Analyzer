# Scenario Simulator

Implementation-driven guide for deterministic what-if simulations.

## Current Behavior

Scenario Simulator builds cached context from existing developer signals and runs deterministic simulations. It does not use AI generation for what-if results.

## Files To Modify

| Change             | Files                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| UI/context refresh | `frontend/src/app/pages/scenario-simulator/*`                                                              |
| API/cache wrapper  | `frontend/src/app/shared/services/api.service.ts`                                                          |
| Backend controller | `backend/src/controllers/scenarioSimulatorController.js`, `backend/src/routes/scenarioSimulator.routes.js` |
| Core logic/cache   | `backend/src/services/scenarioSimulatorService.js`                                                         |
| Model              | `backend/src/models/scenarioSimulation.js`                                                                 |

## Dependencies

- `developerSignalService` and `signalHash`.
- Profile active fields and profile hash/signature.
- GitHub, resume, skill-gap, recommendations, sprint, portfolio, jobs, and integration signals.
- Career Sprint handoff for `/create-sprint`.

## Request Flow

Context: `/app/scenario-simulator` -> `getScenarioSimulatorContext(forceRefresh)` -> `GET /api/simulator/context` -> `getScenarioContext()` -> cached context by signal/profile key.

Simulation: user edits inputs -> `POST /api/simulator/what-if` -> deterministic outcome.

Persistence: `POST /api/simulator/save`, `GET /api/simulator/history`, `DELETE /api/simulator/:id`.

Sprint handoff: `POST /api/simulator/create-sprint`.

## Change Impact

- Context key changes affect stale profile/signal behavior.
- Simulation formula changes affect saved scenarios and sprint handoff expectations.
- Profile changes should invalidate context only and reload once when mounted.

## Testing Files

- `node --check backend/src/controllers/scenarioSimulatorController.js`
- `node --check backend/src/services/scenarioSimulatorService.js`
- `npx -y ng build --configuration development`

## Common Pitfalls

- Do not add AI calls to deterministic simulation.
- Use `activeGithubUsername || githubUsername` when profile context needs username.
- Do not invalidate saved scenarios on profile changes.

## Component ownership after local acceptance

The Scenario page keeps API orchestration and immutable V2 evaluation/draft identity. Standalone OnPush context, inputs, results, and history/comparison children under `pages/scenario-simulator/components/` each have a named folder (`scenario-context`, `scenario-inputs`, `scenario-results`, `scenario-history`) containing the component `.ts`, `.html`, `.scss` and `.spec.ts` files. They own their actual templates/styles and typed presentation events. Shared pure presentation helpers live in `utils/scenario-presentation.ts`. Existing Template Configurator is reused. Named Sass primitives live in `styles/_scenario-shared.scss`; there is no global style escape or budget increase. See frontend/verification/scenario-simulator/decomposition/REPORT.md for sizes and focused visual/test evidence.
