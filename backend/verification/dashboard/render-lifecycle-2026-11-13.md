# Dashboard chart rendering follow-up — 2026-11-13

Branch: fix/dashboard-chart-evidence. PR target: not applicable. Existing staged work from the earlier corrections was preserved; this follow-up changes only the four frontend files listed below. No commits, deployments, dependencies, backend calculations, schemas or account records changed.

## Root-cause evidence and limits

The supplied screenshot shows JavaScript 57% / TypeScript 43% and blank canvases. It proves that language values reached the legend-building path. It does not expose canvas dimensions, actual HTTP payloads, Chart.js registry state or browser errors. The authenticated session is inaccessible (Chrome access denied, no accessible authenticated Dashboard tab or URL supplied). Therefore the exact live-browser rendering exception or sizing condition remains BLOCKED, not asserted as proven.

Confirmed source defects: response handlers constructed charts directly before final view updates, while a separate fixed 50ms AfterViewInit callback could construct them again; no attachment/visibility/size gate existed. Language legend values were published before successful construction, so the legend could claim success when drawing failed. All-null Radar inputs still produced a canvas with no evidence-unavailable message. The earlier automated pixel assertion only covered activity and could accept axes as rendering proof.

Contribution: the prior source audit found repository totals, not date-bearing monthly commit records. This follow-up preserves the earlier unavailable/identity protections and never derives month buckets from totals. The screenshot's 306 total is not accepted as verified dated evidence. Language: positive normalized values are chartable; composition is preserved. Radar: existing nullable numeric dimensions and measured zero are preserved; all-null evidence now has an explicit unavailable state. Partial evidence plots only measured dimensions, without inventing missing scores.

## Changes

- frontend/src/app/pages/dashboard/dashboard.component.ts: one dirty/coalesced requestAnimationFrame pass scheduled after Angular view checks; attached/visible/nonzero canvas gate; ResizeObserver reattempts deferred renders and resizes existing charts; no timer or direct response-handler construction. Context preflight avoids partially registered Chart.js objects. Each chart failure is isolated and surfaced, successful refresh retries, missing data destroys old instances, queued work and observers are cancelled on destruction. Animations are disabled so dataset painting does not depend on a second animation loop. Language legend publication follows successful construction.
- frontend/src/app/pages/dashboard/dashboard.component.html: per-chart rendering errors, explicit Radar evidence-unavailable state, no premature language-empty message while loading.
- frontend/src/app/pages/dashboard/dashboard-request-lifecycle.spec.ts: coalescing, asynchronous size readiness, destruction/cancellation, render exceptions, legend cleanup and nullable versus measured-zero Radar inputs, alongside existing refresh/profile/fallback/error regressions.
- frontend/scripts/audit-dashboard-responsive.cjs: local-only synthetic response matrix with matching 57/43 language composition; dataset-colored activity strokes/zero points, both doughnut segment colors plus transparent hole, Radar polygon fill/zero center point. Gray axes, backgrounds and legends do not qualify. Includes canvas-context denial, legend removal and refresh recovery. Mobile390/desktop1440; Light/Dark/System-light/System-dark resolved CSS colors. No provider or database requests.

## Verification

PASS: final targeted frontend run: 20/20 tests across 3 files; TypeScript noEmit, production build, formatter write/check and JavaScript syntax. One intervening test run failed before execution when Vitest workers timed out; the rerun after the competing build completed passed. PASS: final built-source browser matrix: 96 dataset shape assertions and 64 state/failure-recovery checks; zero unhandled browser errors. Computed card colors were asserted as Light #ffffff and Dark #151d2a, including both resolved System preferences. Console capture: 8 HTTP500 resource messages correspond to the intentional API-failure scenarios; 53 HTTP403 resource messages also occurred. Their resource URLs were not captured, so their origin is unverified. They did not prevent any dataset assertion. Console cleanliness is not claimed. Browser results are recorded in the companion machine-readable JSON. Targeted command: npm test -- --watch=false --include=src/app/pages/dashboard/\*_/_.spec.ts. Build: npm run build. Typecheck: installed tsc --noEmit -p frontend/tsconfig.app.json. Formatter: repository Prettier with frontend/.prettierrc, write followed by check on the four explicit paths. Changed audit JavaScript syntax and staged/working whitespace checked.

Build warnings remain: initial bundle approximately 4.05 MB over the 4 MB warning threshold, plus existing Landing/Jobs/Public Portfolio stylesheet warnings. These are not failures and were outside scope.

Browser runs use synthetic local fixtures, never evidence of real-account acceptance. A first strict pixel run exposed a test assumption: one zero activity sample is a small clipped point rather than a line segment. The assertion now checks its actual indigo point pixels while retaining stronger positive-data shape checks. All retained screenshots are essential verification evidence; no temporary scripts/logs or repository-file moves/deletions were made. Earlier staged reports and images were preserved.

## Evidence

- Before (actual user-supplied screenshot): frontend/verification/dashboard/render-lifecycle-2026-11-13/before-user.png
- After (local synthetic, not the user's live account): frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/plotted-{390,1440}-{dark,light,system,system-dark}.png
- Machine results: frontend/verification/dashboard/responsive-audit/audit-results-chart-states-render-lifecycle-2026-11-13.json

Account-specific API payload, identity, actual Radar values and live-account after screenshots: BLOCKED. No live acceptance claim is made.

## Exact retained evidence inventory

- `backend/verification/dashboard/render-lifecycle-2026-11-13.md`
- `frontend/verification/dashboard/render-lifecycle-2026-11-13/before-user.png`
- `frontend/verification/dashboard/responsive-audit/audit-results-chart-states-render-lifecycle-2026-11-13.json`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/charts-empty-1440-light.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/charts-empty-390-dark.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/charts-error-1440-light.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/charts-error-390-dark.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/charts-loading-1440-light.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/charts-loading-390-dark.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/charts-populated-1440-light.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/charts-populated-390-dark.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/charts-stale-1440-light.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/charts-stale-390-dark.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/charts-zero-1440-light.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/charts-zero-390-dark.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/details-expanded-1440.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/details-expanded-375.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/details-expanded-768.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/plotted-1440-dark.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/plotted-1440-light.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/plotted-1440-system-dark.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/plotted-1440-system.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/plotted-390-dark.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/plotted-390-light.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/plotted-390-system-dark.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/plotted-390-system.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/stale-degraded-1440.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-render-lifecycle-2026-11-13/stale-degraded-375.png`
