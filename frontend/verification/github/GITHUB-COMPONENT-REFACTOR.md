# GitHub Analyzer component refactor

Date: 1 November 2026. Authorized branch: `fix/github`; PR target not applicable. Existing staged work was preserved.

**Local refactor verification complete; full fresh GitHub live acceptance pending at the user's request.** Captured-source and replay results are retained separately from that open gate.

## Ownership and component tree

GithubAnalyzerComponent retains authentication/profile selection, API calls, saved/preview modes, loading/error state, result ownership, sorting state, drawer orchestration and focus containment. Its standalone presentation children are:

```text
GithubAnalyzerComponent
├── GithubProfileSearchComponent
├── GithubHealthOverviewComponent (executive overview and metrics)
├── GithubScoringBreakdownComponent
├── GithubChartsComponent
├── GithubRepositoryTableComponent
├── GithubTechnologyFingerprintComponent
├── GithubInsightsComponent
└── GithubTechnicalAuditComponent
```

Typed required Inputs carry display data; typed Outputs carry user intent. No child injects GithubService or AuthService or creates HTTP subscriptions. Shared pure display helpers and view models are page-local. Sorting and View All still update parent state.

The charts child alone owns the existing Chart.js pair. Rendering is coalesced after view creation, refreshed for result/theme changes and destroyed on teardown. Unchanged parent change detection does not recreate charts. Lifecycle regressions cover one pair, theme/result replacement and destruction; Chromium verifies actual canvas rendering and text alternatives.

## Styling and preservation

Each child uses emulated encapsulation and a `display: contents` host. Existing native sections, tables, controls, dialogs and their order remain. Each page has one editable theme source under `styles`; `scripts/prepare-component-styles.cjs` emits only the selectors used by each template. This preserves media queries, theme contexts and focus rules without copying the full page CSS into every component or leaking global selectors.

Parent/child styles are formatted after generation. The initial full-stylesheet reuse experiment was replaced before finalization because it increased the initial bundle above its warning budget. Final initial output is about 3.72 MB, below 4 MB; the pre-refactor build was about 3.69 MB.

An isolated copy of the original index-built parents supplied the baseline. Its provenance is retained in `../component-parity/baseline-source.json`; disposable workspace/build copies were removed after capture. The actual baseline has 18px analytical headings and a 46px health score. The old UI verification script's 19px/44px assertions were stale and were corrected to the observed baseline; the UI was not restyled to match old documentation.

The only intended data-display corrections are nullable activity typing and the technical-audit fallback to the actual sampled count instead of a fabricated five. Numeric scoring formulas, service request ownership, routes and layout remain unchanged. The live-data report separately documents backend README/narrative corrections and the extraction-data version change.

## Visual and functional results

The final production bundle was compared at 1440px and 375px, in light and dark themes. Native-element geometry, computed font/color/background, control states and labels match. Inter-element formatting whitespace is ignored in aggregate text comparison. Seven comparisons are pixel-identical; the remaining GitHub dark desktop capture differs by one pixel with one RGB-level difference, with zero pixels exceeding the eight-level rendering-noise threshold. There is no layout drift or horizontal overflow. Webfonts, animations and full-page viewport/sidebar state are stabilized consistently in both builds.

| Theme | Desktop before / after                                                                                                                  | Mobile before / after                                                                                                                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Light | [Before](../component-parity/before-github-analyzer-light-1440.png) / [After](../component-parity/after-github-analyzer-light-1440.png) | [Before](../component-parity/before-github-analyzer-light-375.png) / [After](../component-parity/after-github-analyzer-light-375.png) |
| Dark  | [Before](../component-parity/before-github-analyzer-dark-1440.png) / [After](../component-parity/after-github-analyzer-dark-1440.png)   | [Before](../component-parity/before-github-analyzer-dark-375.png) / [After](../component-parity/after-github-analyzer-dark-375.png)   |

`../component-parity/after.json` retains exact measurements and pixel counts. The retained GitHub browser matrix covers 24 width/theme combinations, real Chart.js rendering, sorting, View All, evidence expansion, Tab/Shift+Tab and Escape in the audit drawer, saved refresh, preview/return, loading, 404, empty, stale/rate-limited, unavailable data, missing AI content and failed refresh preservation. Runtime errors: zero. Browser API responses are fixtures and captured real-source replay, explicitly not live authenticated production writes. Results: `component-refactor/results.json`.

## Validation and remaining gates

The complete frontend suite, application TypeScript check, production build, explicit-path Prettier write/check, syntax checks for verification scripts and staged/unstaged Git whitespace checks are part of finalization. Detailed outputs are retained under `../component-parity`. Existing jsdom canvas messages are covered by separate real Chromium chart checks. The existing unrelated landing-page style warning remains (56.67 kB against 48 kB).

Live source accuracy and production prerequisites are documented in [the backend acceptance report](../../../backend/verification/github/GITHUB-LIVE-DATA-FINAL-ACCEPTANCE.md). Production token replacement, deployment-equivalent Redis/soak and cross-browser verification remain separate gates. No commit, push, merge or deployment was performed.

The cleanup manifest lists exact task-created files removed after evidence capture. No original source files were moved or deleted; template/helper code was extracted into new modular files. Essential before/after screenshots and historical evidence are retained.

## Exact changed-source inventory

See the absolute paths appended below; formatting options and all paths are also retained in `../component-parity/format-manifest.json`.

- [frontend/scripts/prepare-component-styles.cjs](D:/Developer-Portfolio-Analyzer/frontend/scripts/prepare-component-styles.cjs)
- [frontend/scripts/verify-component-parity.cjs](D:/Developer-Portfolio-Analyzer/frontend/scripts/verify-component-parity.cjs)
- [frontend/scripts/verify-github-ui.cjs](D:/Developer-Portfolio-Analyzer/frontend/scripts/verify-github-ui.cjs)
- [frontend/src/app/pages/github-analyzer/components/github-charts/github-charts.component.html](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-charts/github-charts.component.html)
- [frontend/src/app/pages/github-analyzer/components/github-charts/github-charts.component.scss](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-charts/github-charts.component.scss)
- [frontend/src/app/pages/github-analyzer/components/github-charts/github-charts.component.ts](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-charts/github-charts.component.ts)
- [frontend/src/app/pages/github-analyzer/components/github-health-overview/github-health-overview.component.html](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-health-overview/github-health-overview.component.html)
- [frontend/src/app/pages/github-analyzer/components/github-health-overview/github-health-overview.component.scss](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-health-overview/github-health-overview.component.scss)
- [frontend/src/app/pages/github-analyzer/components/github-health-overview/github-health-overview.component.ts](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-health-overview/github-health-overview.component.ts)
- [frontend/src/app/pages/github-analyzer/components/github-insights/github-insights.component.html](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-insights/github-insights.component.html)
- [frontend/src/app/pages/github-analyzer/components/github-insights/github-insights.component.scss](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-insights/github-insights.component.scss)
- [frontend/src/app/pages/github-analyzer/components/github-insights/github-insights.component.ts](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-insights/github-insights.component.ts)
- [frontend/src/app/pages/github-analyzer/components/github-presentation.components.spec.ts](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-presentation.components.spec.ts)
- [frontend/src/app/pages/github-analyzer/components/github-profile-search/github-profile-search.component.html](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-profile-search/github-profile-search.component.html)
- [frontend/src/app/pages/github-analyzer/components/github-profile-search/github-profile-search.component.scss](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-profile-search/github-profile-search.component.scss)
- [frontend/src/app/pages/github-analyzer/components/github-profile-search/github-profile-search.component.ts](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-profile-search/github-profile-search.component.ts)
- [frontend/src/app/pages/github-analyzer/components/github-repository-table/github-repository-table.component.html](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-repository-table/github-repository-table.component.html)
- [frontend/src/app/pages/github-analyzer/components/github-repository-table/github-repository-table.component.scss](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-repository-table/github-repository-table.component.scss)
- [frontend/src/app/pages/github-analyzer/components/github-repository-table/github-repository-table.component.ts](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-repository-table/github-repository-table.component.ts)
- [frontend/src/app/pages/github-analyzer/components/github-scoring-breakdown/github-scoring-breakdown.component.html](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-scoring-breakdown/github-scoring-breakdown.component.html)
- [frontend/src/app/pages/github-analyzer/components/github-scoring-breakdown/github-scoring-breakdown.component.scss](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-scoring-breakdown/github-scoring-breakdown.component.scss)
- [frontend/src/app/pages/github-analyzer/components/github-scoring-breakdown/github-scoring-breakdown.component.ts](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-scoring-breakdown/github-scoring-breakdown.component.ts)
- [frontend/src/app/pages/github-analyzer/components/github-technical-audit/github-technical-audit.component.html](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-technical-audit/github-technical-audit.component.html)
- [frontend/src/app/pages/github-analyzer/components/github-technical-audit/github-technical-audit.component.scss](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-technical-audit/github-technical-audit.component.scss)
- [frontend/src/app/pages/github-analyzer/components/github-technical-audit/github-technical-audit.component.ts](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-technical-audit/github-technical-audit.component.ts)
- [frontend/src/app/pages/github-analyzer/components/github-technology-fingerprint/github-technology-fingerprint.component.html](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-technology-fingerprint/github-technology-fingerprint.component.html)
- [frontend/src/app/pages/github-analyzer/components/github-technology-fingerprint/github-technology-fingerprint.component.scss](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-technology-fingerprint/github-technology-fingerprint.component.scss)
- [frontend/src/app/pages/github-analyzer/components/github-technology-fingerprint/github-technology-fingerprint.component.ts](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/components/github-technology-fingerprint/github-technology-fingerprint.component.ts)
- [frontend/src/app/pages/github-analyzer/github-analyzer.component.html](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/github-analyzer.component.html)
- [frontend/src/app/pages/github-analyzer/github-analyzer.component.scss](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/github-analyzer.component.scss)
- [frontend/src/app/pages/github-analyzer/github-analyzer.component.ts](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/github-analyzer.component.ts)
- [frontend/src/app/pages/github-analyzer/github-presentation.ts](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/github-presentation.ts)
- [frontend/src/app/pages/github-analyzer/github-view.models.ts](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/github-view.models.ts)
- [frontend/src/app/pages/github-analyzer/styles/\_github-analyzer-theme.scss](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/github-analyzer/styles/_github-analyzer-theme.scss)
- [frontend/src/app/shared/services/github.service.ts](D:/Developer-Portfolio-Analyzer/frontend/src/app/shared/services/github.service.ts)

## Final check results

- Backend and downstream/disposable integration checks: **121 passed, zero failed or skipped**.
- Frontend: **488 tests, 85 files passed**.
- Application TypeScript, production build, backend JavaScript syntax, explicit-path Prettier checks, and staged/unstaged Git whitespace checks: **passed**.
- Build: **3.72 MB initial**; only the existing landing-page stylesheet budget warning.
- Cleanup: **816 verified task-owned temporary files removed**, with exact absolute paths retained in the cleanup manifest. No tracked source deletion or file move.
