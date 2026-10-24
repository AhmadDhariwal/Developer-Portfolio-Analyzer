# Skill Gap layout and typography refactor

Date: 13 October 2026

STATUS — VERIFIED for the Skill Gap frontend refactor against synthetic API fixtures, with the existing shared-shell mobile defects disclosed below. Verification includes visual inspection of browser screenshots, not only passing automated tests. Production accounts and backend persistence were not used.

## Removed and restructured wrappers

- Career context is an unboxed strip with one bottom divider.
- Four metric-card surfaces are now a divided metric strip within the executive summary. Subgrid aligns labels, numbers and metadata.
- Removed outer panel surfaces from priorities, categories, explorer, projects and roadmap.
- Priority items and their suggested-project blocks have no nested surfaces; three numbered rows retain their descriptions and navigation.
- Category cards are unboxed grid items with counts and 4px progress tracks.
- Explorer heading is on the canvas above one bordered surface. Skills are divided expandable rows; evidence opens inline without another bordered card.
- Proof projects and deliverables are compact divided rows.
- Roadmap phases use a timeline divider, rather than individual cards. Phase deliverables and weekly items use open grids and dividers.
- Acquisition horizons are collapsed inside the learning roadmap. They remain available when horizons exist without phases.
- Source metadata, guidance and methodology share one unboxed evidence section with collapsible content.

## Before and after hierarchy

Before: header → boxed context → summary panel → four metric cards → priorities panel with nested cards → category panel with nested cards → explorer panel → projects panel with nested deliverables → roadmap panel with nested phase cards → horizons panel → sources panel → guidance panel → methodology panel.

After: canvas header/context → one executive summary with metrics → three priority rows → open category grid → canvas explorer heading and one inventory surface → proof-project list → combined expandable learning plan → compact evidence/methodology disclosures.

## Typography

Manrope is self-hosted with font-display: swap, using a variable font range of 400–700. Its SIL Open Font License is retained in public/fonts/manrope/OFL.txt. Page-local font tokens also reach shared buttons. Other pages retain their current fonts.

The supplied Agrivio compact Products convention informed the Manrope page heading. Source Serif 4 was evaluated against the guide and not adopted: Manrope keeps the page aligned with DevInsight's existing identity.

Browser computed values in both themes:

- Page heading: Manrope, 28px / 600, line-height 33.6px, letter-spacing -0.02em.
- Section headings: Manrope, 19px / 600, line-height 25.65px.
- Body: Manrope, 14px / 400, line-height 21.7px for paragraphs.
- Skill names: Manrope, 14px / 600, line-height 21px.
- Table rows: 13px; status/requirement/confidence metadata: 12px.
- Coverage: 44px / 700, line-height 48.4px; 40px / 44px at narrow mobile widths.
- Numeric values use tabular-nums. Font loading passed in Chromium.

## Width and spacing

Removed the 1240px max-width, centered margins and extra page padding. This component compensates for the existing shell inset, producing 24px total desktop workspace padding; mobile uses the shell's 14px horizontal padding. No shared shell styling was changed. Sections use 20px desktop / 16px mobile gaps. Primary surfaces use 8px radii and neutral semantic borders; controls use 6px radii. The page adds no shadows or fixed-height panels.

Measured with the expanded desktop sidebar and closed mobile drawer:

| Viewport | Workspace content width | Total horizontal workspace inset | Coverage size |
| -------- | ----------------------- | -------------------------------- | ------------- |
| 375px    | 347px                   | 14px                             | 40px          |
| 768px    | 740px                   | 14px                             | 44px          |
| 1024px   | 716px                   | 24px                             | 44px          |
| 1440px   | 1132px                  | 24px                             | 44px          |
| 1600px   | 1292px                  | 24px                             | 44px          |

Descriptions have readable line-length limits while section and inventory containers use the full workspace width.

## Functionality

The evidence contract, backend coverage, evidence classifications, requirement status, confidence, freshness, source warnings and AI boundaries retain their existing logic. Component TypeScript changes only remove the unused shared header import. All scores remain backend supplied.

Actual browser actions passed: search; requirement/status/category filters; all four sort selections; keyboard evidence expansion; Show More/Fewer skills and projects; keyboard phase expansion; weekly and horizon disclosures; preview analyze/save/open/delete; course and sprint links with preserved skill query parameters; refresh/error/retry. Saved preview behavior retains summary-only historical results and reanalysis messaging. PDF preview parsing and other service behavior remain unchanged and were not separately exercised with an uploaded PDF in Chromium.

Verified score states: 0, 50, 100, null/unavailable; no core evidence; unsupported historical contract; partial/stale sources; fallback guidance. Light, Dark and System, including live System scheme switching, passed. No browser page errors occurred.

## Screenshots

| Appearance | Desktop (1440px)          | Mobile (375px)          |
| ---------- | ------------------------- | ----------------------- |
| Light      | [Desktop](light-1440.png) | [Mobile](light-375.png) |
| Dark       | [Desktop](dark-1440.png)  | [Mobile](dark-375.png)  |

These native-resolution screenshots were refreshed during cleanup. All viewport, theme and interaction measurements remain in results.json; redundant captures were removed.

## Validation

- Prettier: all five changed source/script files pass the project configuration.
- git diff --check: passes.
- Focused tests: 26 passed across Skill Gap component/service suites.
- Final full frontend tests: 175 passed in 37 suites.
- TypeScript: tsc --noEmit -p frontend/tsconfig.app.json passes.
- Production build: passes. Existing unrelated landing-page SCSS budget warning remains (55.89kB against a 48kB warning budget).
- Browser: 24 theme/viewport combinations, including requested 375, 768, 1024, 1440 and 1600px widths. No document/page overflow. Summary primary and secondary contrast checks pass.
- No lint command is configured in frontend/package.json.
- Existing jsdom canvas/navigation notices occurred in the full suite without test failures.
- Detailed computed measurements and browser results: results.json.
- No backend scoring or unrelated module source files were edited.

## Remaining visual defects and limits

No new blocking visual defect was identified in the Skill Gap content at the checked widths. Two existing shared-shell issues are visible at mobile widths: the hidden sidebar still casts a left-edge shadow, and the navbar's more-specific sidebar-closed rule retains a 72px inset. Their source rules are in sidebar.scss and navbar.scss; they were left outside this page-only scope.

Browser evidence covers synthetic fixtures rather than a live production account. This status confirms the implemented page and recorded checks, not user approval for applying the design to other modules.
