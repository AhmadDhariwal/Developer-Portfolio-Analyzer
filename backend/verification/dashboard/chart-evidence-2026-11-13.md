# Dashboard chart evidence corrections — 2026-11-13

Source: release1 at cdefae00078e22b9a9ecec9aa68eab2513ad96b4. Implementation branch: fix/dashboard-chart-evidence. PR target: not applicable. Baseline worktree was clean. No commits, database writes, deployments, schema/dependency changes or provider requests were made by verification.

## Corrections and lineage

The existing GitHub Analyzer fetches bounded repository contributor totals and language bytes/primary-language fallbacks. Repository update times are not commit timestamps. No verified date-bearing monthly contribution source exists in its response. Consequently, a successful explicit Analyzer save now clears contributionActivity rather than preserving or refreshing an unsupported previous series. This prevents old-profile activity from being certified under the new githubSignals.username. Failed/stale Analyzer responses still follow the existing skip-save path.

Existing saved activity reads remain owner scoped and require the existing active username match. A shared reader rejects missing/null/negative/noninteger counts and missing month labels, retaining measured zero. Summary, contributions and progress use the same sanitized series. Activity availability depends on usable points; language availability depends on positive normalized language entries. Availability is independent of the existing 24-hour freshness guidance. GET routes perform no GitHub analysis.

The frontend validates saved summary/fallback activity and sets activityAvailable on both paths, including resetting it on empty/mismatched snapshots. Its template now explains unavailable monthly evidence explicitly. Measured zero remains visible. Language and Radar source/normalization/scoring formulas were inspected and preserved; Radar null dimensions remain null.

## Validation

- Backend: node --test src/tests/dashboardEndpoints.test.js src/tests/githubAnalyzerHardening.test.js src/tests/dashboardProgress.test.js — 43 passed, zero failures (rerun after final backend formatting).
- Frontend: npm test -- --watch=false — 635 passed across 106 files. Initial sandbox attempt failed before execution with temporary-file rename EPERM; authorized escalation rerun passed.
- TypeScript: installed tsc --noEmit -p frontend/tsconfig.app.json — passed.
- Production build: passed. Warnings: 4.05 MB initial bundle versus 4 MB warning; existing Landing/Public Portfolio/Jobs stylesheet warnings.
- Prettier write then check: explicit changed source paths passed. Backend uses printWidth 100, singleQuote; GitHub controller uses tabWidth 4/trailingComma none, hardening test tabWidth 2/trailingComma none; remaining backend uses trailingComma all. Frontend uses frontend/.prettierrc.
- Changed JavaScript syntax and git diff --check passed; staged whitespace check passed (nothing staged).
- Existing browser audit: 36 viewport/theme runs passed with no horizontal overflow; interactive disclosures and stale/degraded states passed. Desktop dark and mobile light screenshots visually inspected: activity, donut and Radar render. Fixtures are synthetic regression inputs, never persisted account evidence.
- Focused browser state audit: 42 state checks passed. See audit-results-chart-states-2026-11-13.json for final outcomes. Tests cover painted activity canvas, zero, empty, stale, error, loading and in-place profile replacement at 390/1440px in Light/Dark/System modes. System uses the harness's emulated light OS preference.

## Remaining limitations

Account-specific API values, persisted identity/data and live provider checks: BLOCKED, no reachable authorized local Mongo/test account. No live data was generated. Monthly activity remains unavailable after a current Analyzer save until a genuine dated producer is implemented separately. Legacy records are not migrated; historic contamination cannot be inferred or repaired without per-source evidence. Language maps and Radar dimensions can legitimately be absent depending on persisted owned evidence.

No files were moved or deleted. No temporary scripts or logs were created. Screenshots and machine-readable results below are retained verification evidence. Build/cache directories were not deleted because they may predate this task.

## Exact changed/added source and evidence paths

- `backend/src/controllers/dashboardcontroller.js`
- `backend/src/controllers/githubcontroller.js`
- `backend/src/services/dashboardProgressService.js`
- `backend/src/tests/dashboardEndpoints.test.js`
- `backend/src/tests/githubAnalyzerHardening.test.js`
- `backend/src/utils/dashboardActivity.js`
- `backend/verification/dashboard/chart-evidence-2026-11-13.md`
- `frontend/scripts/audit-dashboard-responsive.cjs`
- `frontend/src/app/pages/dashboard/dashboard-request-lifecycle.spec.ts`
- `frontend/src/app/pages/dashboard/dashboard.component.html`
- `frontend/src/app/pages/dashboard/dashboard.component.ts`
- `frontend/verification/dashboard/responsive-audit/audit-results-chart-evidence-2026-11-13.json`
- `frontend/verification/dashboard/responsive-audit/audit-results-chart-states-2026-11-13.json`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/desktop-1440-dark.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/desktop-1440-light.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/desktop-1440-system.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/desktop-1920-dark.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/desktop-1920-light.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/desktop-1920-system.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/details-expanded-1440.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/details-expanded-375.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/details-expanded-768.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/laptop-1280-dark.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/laptop-1280-light.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/laptop-1280-system.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/laptop-1366-dark.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/laptop-1366-light.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/laptop-1366-system.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/large-2560-dark.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/large-2560-light.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/large-2560-system.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/mobile-320-dark.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/mobile-320-light.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/mobile-320-system.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/mobile-375-dark.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/mobile-375-light.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/mobile-375-system.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/mobile-390-dark.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/mobile-390-light.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/mobile-390-system.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/mobile-430-dark.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/mobile-430-light.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/mobile-430-system.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/stale-degraded-1440.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/stale-degraded-375.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/tablet-1024-dark.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/tablet-1024-light.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/tablet-1024-system.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/tablet-768-dark.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/tablet-768-light.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/tablet-768-system.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/tablet-820-dark.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/tablet-820-light.png`
- `frontend/verification/dashboard/responsive-audit/chart-evidence-2026-11-13/tablet-820-system.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-2026-11-13/details-expanded-1440.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-2026-11-13/details-expanded-375.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-2026-11-13/details-expanded-768.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-2026-11-13/stale-degraded-1440.png`
- `frontend/verification/dashboard/responsive-audit/chart-states-2026-11-13/stale-degraded-375.png`
