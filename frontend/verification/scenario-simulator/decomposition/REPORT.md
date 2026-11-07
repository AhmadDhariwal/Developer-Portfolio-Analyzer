# Scenario Simulator component decomposition — PASS

Verified 26 October 2026 (Asia/Karachi), on the user-authorized `task/integrations` checkout. The Scenario owner in the chat **Assess Scenario Simulator** confirmed the existing stylesheet owns 4,554 lines, imports emit no CSS, no active owner edits existed, and the proposed input/result/history boundaries preserve the immutable evaluation contract. All pre-existing staged work and concurrent auth/Landing styles were preserved.

## Changes

The page retains API orchestration, request-generation cancellation, baseline confirmation, draft identity, save/load/export and session/profile coordination. Four standalone OnPush components own actual section markup and scoped styles: context/templates, editable inputs, evaluation results, and saved history/comparison. Typed inputs/outputs communicate draft changes and action intent. Project patches emit new arrays/objects and preserve valid zero values. The existing Template Configurator remains unchanged. Pure formatting/comparison helpers have one shared source; named Sass mixins supply only the primitives and animations each owner uses. No parent component instance is passed into a child.

## Sizes

Compressed Sass output is a measurement of the ordinary build output, not a source compression technique. Exact byte/line counts and hashes are in [component-inventory.json](component-inventory.json).

| Owner                    | TS lines | HTML lines | SCSS lines | Compiled CSS bytes |
| ------------------------ | -------: | ---------: | ---------: | -----------------: |
| Before: single page      |      929 |       2043 |       4554 |             85,382 |
| Page orchestration/shell |      746 |        361 |        518 |               9402 |
| Context/templates        |       30 |        225 |        510 |              11032 |
| History/comparison       |       53 |        432 |       1108 |              24638 |
| Inputs                   |       58 |        400 |        932 |              21227 |
| Results                  |       60 |        718 |       1604 |              31277 |

Every Scenario component is below the unchanged 48 KiB warning / 64 KiB error budgets. Aggregate Sass emission is 97,576 bytes versus 85,382 before: independently encapsulated components emit the shared primitives they need. This tradeoff is explicit; the change improves ownership and per-component size, not total CSS compression. Shared primitives/animations are authored once. No global-style workaround or budget edit was used.

## Verification

- Production build PASS, 112.893 seconds: main-USPTMQ7U.js, initial 3.36 MB raw / estimated 526.65 kB transfer. The historical failed build was 3.26 MB / 523.71 kB; concurrent auth/Landing edits make that an uncontrolled whole-checkout comparison, not a Scenario-only delta. One unrelated Landing style warning remains (56.05 kB vs 48 kB); no Scenario warning/error remains.
- TypeScript PASS. Five affected Angular spec files: **18/18 PASS** (parent immutable state, Template Configurator consent/cancel, child boundary contracts, Scenario service/session contract and Integrations cache invalidation).
- **20/20** desktop/mobile light/dark draft, result, breakdown, roadmap and comparison views match page-relative geometry and computed dimensions/colors/fonts/borders/padding/display. Global scroll offsets were normalized; an earlier comparison exposed shell/scroll timing differences, which were controlled rather than hidden as product changes. Desktop 1440 px and mobile 375 px were exercised.
- Actual production bundle: **8/8** desktop/mobile light/dark draft/result smoke views, no page errors or horizontal overflow. Representative Light desktop and Dark mobile screenshots were inspected. This is targeted UI evidence, not a complete accessibility certification or pixel-perfect screenshot assertion.
- Renaming shared mixins and deduplicating animation definitions was checked against identical compiled CSS bytes before/after.
- The system drive became full during verification. Only task-local temp/browser/npm caches were redirected to D:; no user files were removed to free space.

Reproduce with `npm run build`, `node frontend/node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.app.json` from root, and from frontend `npm test -- --watch=false --include=src/app/pages/scenario-simulator/**/*.spec.ts --include=src/app/shared/services/scenario-simulator.service.spec.ts --include=src/app/shared/services/integrations.service.spec.ts`. The reusable production visual verifier is `frontend/scripts/verify-scenario-decomposition-ui.cjs production`; provide PLAYWRIGHT_MODULE and optional SCENARIO_CHROMIUM_PATH for the installed local browser runtime. It serves only built local files and intercepts all API requests with synthetic data.

See production-build.txt, frontend-tests.txt, visual-comparison.json, production.json and before/after/production screenshots alongside this report. The exact source inventory is in component-inventory.json. No scoring rule, backend API/data contract, provider credential, production configuration, quota or migration was changed by the UI decomposition.

Final post-cleanup build and tests are retained as final-production-build.txt and final-frontend-tests.txt. The current production bundle smoke captures cover all eight viewport/theme draft/result cases. The accompanying Integrations acceptance also passed 28/28 affected backend/API checks, including the proven Portfolio cache revision correction; no scoring formula or response contract was changed. Exact scratch/cache removal manifests are retained; an initial broad cleanup was rejected by automatic review and replaced with verified exact-file/hash checks.

## Follow-up: component folder convention

Each child now owns a named folder with its TypeScript, template, SCSS and colocated spec. Shared helpers live in utils/. Production build, TypeScript and all 19 focused tests pass. See [FOLDER-ORGANIZATION-REPORT.md](FOLDER-ORGANIZATION-REPORT.md) for exact moves and verification; the initial inventory above is historical.
