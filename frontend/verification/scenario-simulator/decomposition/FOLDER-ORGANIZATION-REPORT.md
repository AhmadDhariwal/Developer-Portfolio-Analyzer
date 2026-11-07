# Scenario component folder organization — PASS

Verified 26 October 2026 on the authorized task/integrations branch. No PR target applies.

Each component now owns one named folder under frontend/src/app/pages/scenario-simulator/components/: scenario-context, scenario-inputs, scenario-results and scenario-history. Each folder contains exactly four matching files: .component.ts, .component.html, .component.scss and .component.spec.ts. SCSS is retained to match the project's existing style convention.

The 12 component source/template/style files were moved without changing their behavior or markup. Only relative TypeScript/Sass imports changed. The shared presentation helper moved from components/scenario-presentation.ts to utils/scenario-presentation.ts, and the parent component imports follow the new locations. Existing three component boundary tests were preserved and separated into their owning component specs; an additional context spec verifies the real template toggle emits intent without mutating parent-owned state. The previous combined spec was relocated/split, not retained as a duplicate. No other source files were deleted.

Exact old/new paths and all new spec paths: [folder-organization.json](folder-organization.json). The earlier component-inventory.json remains historical evidence of the initial decomposition layout. Feature documentation now describes the named folders.

## Verification

- Production build PASS (49.127 seconds); initial 3.36 MB / estimated 526.65 kB transfer, same rounded totals as before organization. Main bundle: main-IMMPL6QL.js. Existing budgets unchanged. Only the unrelated Landing stylesheet warning remains (56.05 kB against 48 kB warning).
- Eight affected spec files: 19/19 tests PASS. Command from frontend: `node node_modules/@angular/cli/bin/ng.js test --watch=false --include=src/app/pages/scenario-simulator/**/*.spec.ts --include=src/app/shared/services/scenario-simulator.service.spec.ts --include=src/app/shared/services/integrations.service.spec.ts`.
- TypeScript PASS: node frontend/node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.app.json.
- Explicit-path Prettier write/check PASS; working and staged Git whitespace checks PASS.
- Four compiled Sass stylesheet sizes remain identical: context 11,032; inputs 21,227; results 31,277; history 24,638 bytes. No markup/layout or presentation behavior changed by this organization. Prior desktop/mobile visual evidence remains retained; a new visual/browser run was unnecessary for file moves.
- No old component imports remain in active frontend sources/scripts. Each component folder has exactly four files. No temporary helper scripts were created. Concurrent changes, staged work, backend/data/scoring/credentials and Angular budgets were preserved.

Logs: folder-organization-tests.txt and folder-organization-build.txt. Deployment gates in the Integrations report remain unchanged; no deployment was performed.
