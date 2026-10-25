# Scenario template implementation and verification

Date: 25 October 2026. Scope: Scenario Simulator templates; no scoring rule, endpoint, collection or locked-module changes.

## Before and after

Before: Apply immediately replaced draft inputs, required loaded context and used generic suggested inputs. Portfolio Push had no V2 project suggestions. Editing a draft blocked save/export but left old calculations displayed.

After: Apply opens one reusable standalone configurator, centered on desktop and full-screen on mobile. Suggestions and editable planning assumptions remain local until Apply to Scenario or Evaluate Scenario. Cancel/Escape discard configurator edits. Replacing a changed draft requires explicit consent. Evaluation requires confirmed baselines and uses the existing authenticated `/what-if` route. Editing calculation inputs removes the obsolete result; late responses for different inputs are discarded. Save and Sprint export remain separate existing actions.

Focused Upskill selects two or three distinct missing skills from available compatible Skill Gap evidence. Portfolio Push selects one planned, uncompleted portfolio milestone. Balanced Plan selects two missing skills and a planned project sharing a selected skill. Missing, stale, incompatible or mismatched target evidence leaves editable empty slots. Project impact, complexity, effort and duration remain assumptions editable by the user. Completed titles are excluded before limiting suggestions.

## Architecture and compatibility

- Declarative typed definitions and a pure suggestion builder live in the shared model folder; feature presentation stays under the Scenario page.
- The existing owned context read adds project candidates and completed titles. No reanalysis or new request is required. Suggested projects do not copy completed activity into hypothetical new work.
- No numerical calculation is duplicated. Warnings distinguish timeline conflicts from the engine's calculated overload penalties. Scores and sensitivity bounds are explicitly hypothetical heuristics.
- Immutable evaluation identity, insert-only saves and durable Sprint receipts keep their existing contracts.
- The charter is unchanged: this implements its existing context, evidence, calculation and ownership decisions.
- Existing staged HTML/SCSS work was present before this task. Its primary template cards and visual design are retained. The duplicate template grid and its unreferenced styles were removed; equivalent dark-theme selectors were grouped. The stylesheet hard budget was not raised.

## Verification

**FINAL STATUS: VERIFIED** for the implemented template feature. Final full frontend run: **68 files passed, 391 tests passed, zero failures** with `NODE_OPTIONS=--no-experimental-webstorage` and `npm test -- --watch=false`. Non-fatal jsdom canvas notices came from existing chart tests.

The reusable browser verifier uses a newly started loopback MongoDB, signed fixture accounts, real Express Scenario routes and headless Chromium. It never loads `.env` or connects to the application database.

| Check                                                                                       | Result                                                                                                                                     |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Production `npm run build`                                                                  | PASS; Scenario component style is 63.53 kB, below the unchanged 64 kB hard limit                                                           |
| Development build                                                                           | PASS                                                                                                                                       |
| App TypeScript `--noEmit -p frontend/tsconfig.app.json`                                     | PASS                                                                                                                                       |
| Backend Scenario service/reliability/characterization/legacy parity/planning/context suites | 27 passed; context suite rerun after final projection changes: 5 passed                                                                    |
| Disposable MongoDB snapshots, two-worker persistence/restart, Sprint export/replay suites   | 3 passed; no skips                                                                                                                         |
| Focused frontend Scenario and Career Sprint regression suites                               | 22 passed on the focused run; final full suite including the added target-compatibility test: 391 passed                                   |
| Production browser acceptance                                                               | PASS: 6 real HTTP calculations, 3 empty-fallback flows, both supported dark selectors, save/export/foreign-owner checks; no browser errors |
| Formatting                                                                                  | Explicit-path Prettier write then check passed for all 13 changed/new source/test/script files                                             |
| JavaScript syntax and Git whitespace                                                        | `node --check` on all 3 backend files and both unstaged/staged `git diff --check` passed                                                   |

Browser calculations matched the JSON representation of the unchanged V2 engine exactly, including breakdowns, limits, identities and assumptions. Screenshots were visually inspected for desktop centering, visible actions, mobile layout and dark fallback. These are synthetic fixture plans, not personal predictions. Full browser details are in [results.json](results.json).

The original sandboxed tests could not execute because of filesystem restrictions. With native access, an initial full frontend run hit Node 24's experimental web storage, then another had one Career Sprint timeout. That file passed all 11 tests on the focused rerun. The final full run with the required storage flag passed all 391 tests. The CLI-advertised `dots` reporter was incompatible with installed Vitest; final execution uses the default reporter.

Remaining limits: Scenario (63.53 kB) and the unrelated Landing Page (55.89 kB) still exceed the 48 kB soft stylesheet warning budget. The Scenario hard-budget defect is resolved without raising budgets. Verification uses local fixture data and an isolated MongoDB; the pre-existing deployment-wide shared quota, topology/index and long-duration soak gates in the architecture charter remain separate release requirements. No deployment was performed.

Run from the repository root, with an available Playwright package and Chromium:

```powershell
$env:PLAYWRIGHT_MODULE = '<installed Playwright package path>'
$env:SCENARIO_CHROMIUM_PATH = '<installed Chrome or Chromium executable>'
node backend/src/scripts/verifyScenarioTemplates.js
```

On Node 24, Angular tests need `$env:NODE_OPTIONS='--no-experimental-webstorage'` so jsdom provides browser localStorage. The sandbox denied test-runner temporary-file renames and Mongo WiredTiger operations; these tests were rerun with access to their own disposable temporary files.

## Exact file inventory

Modified source/test files:

- `backend/src/services/scenarioContextService.js`
- `backend/src/tests/scenarioSimulatorContext.test.js`
- `frontend/src/app/pages/scenario-simulator/scenario-simulator.component.ts`
- `frontend/src/app/pages/scenario-simulator/scenario-simulator.component.html`
- `frontend/src/app/pages/scenario-simulator/scenario-simulator.component.scss`
- `frontend/src/app/pages/scenario-simulator/scenario-simulator.component.spec.ts`
- `frontend/src/app/shared/models/scenario-simulator.model.ts`

Added source/test/verification files:

- `backend/src/scripts/verifyScenarioTemplates.js`
- `frontend/src/app/shared/models/scenario-template.model.ts`
- `frontend/src/app/pages/scenario-simulator/scenario-template-configurator/scenario-template-configurator.component.ts`
- `frontend/src/app/pages/scenario-simulator/scenario-template-configurator/scenario-template-configurator.component.html`
- `frontend/src/app/pages/scenario-simulator/scenario-template-configurator/scenario-template-configurator.component.scss`
- `frontend/src/app/pages/scenario-simulator/scenario-template-configurator/scenario-template-configurator.component.spec.ts`
- `frontend/verification/scenario-templates/REPORT.md`
- `frontend/verification/scenario-templates/results.json`
- `frontend/verification/scenario-templates/desktop-0.png`
- `frontend/verification/scenario-templates/desktop-1.png`
- `frontend/verification/scenario-templates/desktop-2.png`
- `frontend/verification/scenario-templates/mobile-0.png`
- `frontend/verification/scenario-templates/mobile-1.png`
- `frontend/verification/scenario-templates/mobile-2.png`
- `frontend/verification/scenario-templates/mobile-dark-fallback.png`

Moved/deleted files: none. Removed only obsolete duplicate template markup/styles within the existing files after checking references. Retained screenshots/results are final acceptance evidence. Build output remains in the existing ignored output folder. No temporary scripts or logs were added, no unrelated user work was deleted, and no Git cleanup/reset was used.
