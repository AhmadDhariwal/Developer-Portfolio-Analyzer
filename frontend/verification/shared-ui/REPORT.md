# Shared UI standard and application shell refinement
Date: 13 October 2026

STATUS: VERIFIED using actual Chromium screenshots and synthetic API fixtures. All requested source work is complete. GitHub Analyzer modernization has not begun.

## Shared design system
The approved Skill Gap style is now reusable through Developer-scoped CSS tokens, opt-in utility classes and SCSS mixins. Shared page-header, section-header and card primitives consume these tokens with legacy fallbacks. Color values remain supplied by DevInsight's Light/Dark/System architecture and indigo branding.

Manrope reuses the existing licensed self-hosted font, registered once in shared styles with font-display: swap and weights 400–700. No font packages or extra font downloads were introduced in this stage.

The scope applies to Developer sessions outside administrative route namespaces. Recruiter/Admin keep their existing font and visual defaults. Existing feature-specific styles are not forcibly overridden; future approved page redesigns can consume the new primitives. No feature template, calculation, backend service, route definition or permission filter was changed in this stage.

Reusable primitives cover canvas page headers, unboxed sections, bounded descriptions, divided metric strips, single-surface tables, compact divided lists, dividers and native disclosures. The implementation and examples are documented in frontend/docs/developer-ui.md.

## Typography and layout tokens
| Token family | Final value |
| --- | --- |
| Preferred UI font | Manrope; Segoe UI and sans-serif fallbacks |
| Metadata / table / body | 12 / 13 / 14px |
| Section / page title | 19 / 28px, weight 600 |
| Coverage number | 44px, weight 700; reference page retains 40px at narrow mobile widths |
| Body / heading line height | 1.55 / 1.2 |
| Font weights | 400, 500, 600, 700 |
| Spacing scale | 4, 8, 12, 16, 20, 24px |
| Workspace padding | 24px desktop; 14px at ≤768px |
| Section gap | 20px desktop; 16px mobile |
| Control / surface radius | 6 / 8px |
| Description line length | 85ch |
| Default Developer surface / toolbar shadow | none |
| Sidebar expanded / icon rail | 260 / 72px |
| Navigation targets | 42px Developer primary rows; 44px mobile rows and toolbar controls |

The shell now owns Developer workspace padding. Skill Gap's compensating negative margin and local font-face declaration were removed as extraction work. Its page-title, section-title and metric rules consume shared mixins; page behavior and content hierarchy remain intact.

## Sidebar/navbar improvements
Developer desktop navigation starts expanded with labels and remains collapsible to an icon rail. Subtle parent group treatment, compact typography and a flatter footer preserve the dark branded sidebar and indigo current-page indicator. Navigation scrolls independently. Route links, role-filtered entries and destinations are unchanged.

Group buttons expose expanded state and control associations. Current links expose aria-current, icon-only links keep accessible labels and native titles, and visible focus rings remain available.

The toolbar provides larger Developer touch targets, stable search sizing, accessible account/notification state, and a labeled search combobox. Search supports Arrow keys, Enter and Escape; account and notification disclosures support Escape. Light/Dark/System selectors retain their original preference behavior.

The first-tab skip link explicitly focuses the main workspace without changing the route. Reduced-motion preferences disable shell transitions.

## Mobile defects fixed
- Closed mobile sidebar shadow: removed; visibility and inert state also prevent off-screen focus.
- Incorrect 72px navbar inset: mobile selector covers both sidebar states; measured left edge is 0px.
- Open drawer: semantic dialog, initial Close-button focus, contained Tab/Shift+Tab, inert workspace and body scroll lock.
- Escape, Close button, backdrop and navigation dismiss the drawer and restore focus.
- Breakpoint transitions and component destruction release the scroll lock.
- Backdrop uses a plain overlay without blur/glass effects.
- Search suggestions stay within the narrow viewport.

## Measurements and screenshots
Actual native-resolution above-the-fold captures use a 1000px viewport height. Desktop captures use expanded navigation; collapsed-rail and mobile-drawer captures are stored separately. These are synthetic fixtures, not production scores.

| Viewport | Skill Gap content width | Main padding | Navbar left | Closed mobile shadow |
| --- | --- | --- | --- | --- |
| 320px | 292px | 14px | 0px | none |
| 375px | 347px | 14px | 0px | none |
| 425px | 397px | 14px | 0px | none |
| 768px | 740px | 14px | 0px | none |
| 1024px | 716px | 24px | 260px | Desktop sidebar |
| 1280px | 972px | 24px | 260px | Desktop sidebar |
| 1440px | 1132px | 24px | 260px | Desktop sidebar |
| 1600px | 1292px | 24px | 260px | Desktop sidebar |

| Viewport | Light | Dark | System |
| --- | --- | --- | --- |
| 320px | [Light](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/light-320-fold.png) | [Dark](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/dark-320-fold.png) | [System](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/system-320-fold.png) |
| 375px | [Light](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/light-375-fold.png) | [Dark](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/dark-375-fold.png) | [System](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/system-375-fold.png) |
| 425px | [Light](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/light-425-fold.png) | [Dark](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/dark-425-fold.png) | [System](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/system-425-fold.png) |
| 768px | [Light](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/light-768-fold.png) | [Dark](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/dark-768-fold.png) | [System](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/system-768-fold.png) |
| 1024px | [Light](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/light-1024-fold.png) | [Dark](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/dark-1024-fold.png) | [System](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/system-1024-fold.png) |
| 1280px | [Light](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/light-1280-fold.png) | [Dark](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/dark-1280-fold.png) | [System](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/system-1280-fold.png) |
| 1440px | [Light](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/light-1440-fold.png) | [Dark](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/dark-1440-fold.png) | [System](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/system-1440-fold.png) |
| 1600px | [Light](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/light-1600-fold.png) | [Dark](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/dark-1600-fold.png) | [System](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/system-1600-fold.png) |

Additional screenshots:
- [Light mobile drawer](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/light-375-drawer.png), [Dark mobile drawer](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/dark-375-drawer.png).
- [Light collapsed rail](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/light-1440-collapsed.png), [Dark collapsed rail](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/dark-1440-collapsed.png).
- [Recruiter retained presentation](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/recruiter-1440.png), [Admin retained presentation](C:/Users/ahmad.hassan/Desktop/Developer-Portfolio-Analyzer/frontend/verification/shared-ui/admin-1440.png).
- Dashboard, GitHub Analyzer and Resume Analyzer smoke screenshots are stored alongside the shell screenshots.
- Full-page Skill Gap screenshots at 375 and 1440px are available for all three themes.

Visual inspection confirms a clean closed mobile canvas, readable labeled desktop navigation, a clear current-page indicator, contained drawer presentation, visible keyboard focus and consistent Skill Gap hierarchy.

## Verification
- Frontend full suite: 179 tests passed in 37 suites, including the added drawer focus and search keyboard tests.
- TypeScript: tsc --noEmit -p frontend/tsconfig.app.json passed.
- Production build: passed.
- Prettier: changed source/scripts checked with the project's configuration.
- git diff --check: passed.
- Configured lint: no lint command is present in frontend/package.json.
- Shared-shell browser pass: 24 theme/viewport combinations across 320–1600px; no document overflow.
- Actual keyboard checks: skip-link focus; desktop toggle; group Enter; icon-rail focus; drawer initial focus, Tab wrapping, Escape and focus restoration; search selection; account Escape.
- Actual pointer checks: Close button, backdrop and mobile navigation dismissal; theme preference selection.
- System preference follows live browser scheme changes.
- Nine feature smoke checks cover Dashboard, GitHub Analyzer and Resume Analyzer in Light/Dark/System with no page errors or document overflow.
- Recruiter/Admin browser checks retain Inter and role-specific navigation; mobile navbar inset correction applies to both.
- Skill Gap browser regression: all 24 original combinations and protected interactions passed.
- Skill Gap computed font-family, size, weight and line-height match the approved staged baseline for title, section, body, coverage and skill text: zero differences.
- Browser page errors: zero.

Browser evidence and computed values are saved in results.json and skill-gap-consistency.json.

## Files changed in this stage
- frontend/src/app/shared/styles/_fonts.scss
- frontend/src/app/shared/styles/_developer-ui.scss
- frontend/src/styles.scss
- frontend/src/app/shared/components/ui-page-header/ui-page-header.component.scss
- frontend/src/app/shared/components/ui-section-header/ui-section-header.component.scss
- frontend/src/app/shared/components/ui-card/ui-card.component.scss
- frontend/src/app/layout/main-layout/main-layout.html
- frontend/src/app/layout/main-layout/main-layout.scss
- frontend/src/app/layout/main-layout/main-layout.ts
- frontend/src/app/layout/main-layout/main-layout.spec.ts
- frontend/src/app/layout/main-layout/sidebar/sidebar.html
- frontend/src/app/layout/main-layout/sidebar/sidebar.scss
- frontend/src/app/layout/main-layout/sidebar/sidebar.ts
- frontend/src/app/layout/main-layout/navbar/navbar.html
- frontend/src/app/layout/main-layout/navbar/navbar.scss
- frontend/src/app/layout/main-layout/navbar/navbar.ts
- frontend/src/app/layout/main-layout/navbar/navbar.spec.ts
- frontend/src/app/pages/skill-gap/skill-gap.component.scss
- frontend/scripts/skill-gap-browser-fixture.cjs
- frontend/scripts/verify-shared-ui.cjs
- frontend/scripts/verify-skill-gap-ui.cjs
- frontend/docs/developer-ui.md

Generated verification artifacts are under frontend/verification/shared-ui; refreshed reference measurements and screenshots are under frontend/verification/skill-gap. Existing staged changes from the approved Skill Gap stage were preserved.

## Remaining issues and limits
No blocking shared-shell visual or interaction issue remains in the checked configurations. The existing unrelated landing-page stylesheet budget warning remains: 55.89kB against a 48kB warning budget. Existing jsdom canvas/navigation notices did not fail unit tests.

Feature pages retain their existing page-specific layouts and explicit styling, including legacy nested surfaces; their redesigns are outside this task. Browser feature smoke checks use empty synthetic states and do not replace exhaustive production-account testing. No backend persistence or live account data was used.

The earlier Skill Gap report's mobile shell findings are resolved by this stage. The next stage remains GitHub Analyzer UI modernization after user approval.
