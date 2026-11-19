# UI/UX Consistency Report

Visual and computed-style inspection was conducted using headless Chromium (Playwright) against the production build (`frontend/dist/frontend/browser`) across Desktop (`1440×900`), Tablet (`768×1024`), and Mobile (`390×844`) viewports in both `light` and `dark` themes (`ThemeService` `data-theme`).

## 1. Cross-Role Playwright Inspection Matrix

| Route / Role | Theme & Viewport | `bodyBg` | `h1Color` | `h1Font` | Horizontal Overflow | Classification & Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `/` (`public-landing`) | Light `1440×900` | — | — | — | `0px` | **1. Correct and finalized** — zero page errors, full render |
| `/auth/login` | Light `1440×900` | — | — | — | `0px` | **1. Correct and finalized** — zero page errors, centered auth shell |
| `/app/dashboard` (`developer`) | Light `1440×900` | `rgb(246, 248, 251)` | — | — | `0px` | **1. Correct and finalized** — clean light cards, crisp `--text-primary` text |
| `/app/dashboard` (`developer`) | Dark `1440×900` | `rgb(11, 15, 23)` | — | — | `0px` | **1. Correct and finalized** — clean obsidian cards, WCAG-compliant dark tokens |
| `/app/interview-prep` (`developer`) | Light `768×1024` & `390×844` | `rgb(246, 248, 251)` | `rgb(15, 23, 42)` | `Manrope, "Segoe UI", sans-serif` | `0px` | **1. Correct and finalized** layout & contrast (`<app-interview-saved-sessions>` clean); **2. Improvement recommended** font-family variance (`Manrope` vs `Inter`) |
| `/app/support` (`developer`) | Light `1440×900` | `rgb(246, 248, 251)` | Dark ink | `Manrope` / `Inter` | `0px` | **1. Correct and finalized** — shared `<app-confirm-dialog>` wired cleanly |
| `/app/recruiter/dashboard` | Light `1440×900` | `rgb(246, 248, 251)` | `rgb(248, 250, 252)` | `Inter` | `0px` | **3. Actual defect (Pre-existing)** — section headers (`Hero Metrics`, `Pipeline Snapshot`) render `#f8fafc` near-white text on `#f6f8fb` light canvas; cards stay dark |
| `/app/recruiter/dashboard` | Dark `1440×900` | `rgb(11, 15, 23)` | `rgb(248, 250, 252)` | `Inter` | `0px` | **1. Correct and finalized** in Dark theme |
| `/app/recruiter/jobs` | Dark `390×844` & Light `1440×900` | `rgb(11, 15, 23)` / `rgb(246, 248, 251)` | `rgb(248, 250, 252)` | `Inter` | `0px` | **3. Actual defect (Pre-existing)** in Light mode (`h1` `#f8fafc` on `#f6f8fb` background); `app-recruiter-job-card` stacks cleanly on mobile |
| `/app/admin/dashboard` | Light `1440×900` | `rgb(246, 248, 251)` | `rgb(248, 251, 255)` | `Inter` | `0px` | **2. Improvement recommended** — wraps content in a dark outer container (`0px` contrast error inside container, but ignores Light theme selection) |
| `/app/admin/activity-logs` | Dark `1440×900` vs Light `1440×900` | `rgb(11, 15, 23)` vs `rgb(246, 248, 251)` | `rgb(241, 245, 249)` | `Inter` | `0px` | **3. Actual defect (Pre-existing)** — `_activity-logs-shared.scss` hardcodes `#f1f5f9` heading color on `MainLayout` light canvas (`shot-admin-activity-logs.png`) |
| `/super-admin/dashboard` | Light vs Dark `1440×900` | `rgb(246, 248, 251)` vs `rgb(11, 15, 23)` | `rgb(15, 23, 42)` vs `rgb(248, 250, 252)` | `Inter` | `0px` | **2. Improvement recommended** — `SaShellComponent` and `<h1>` adapt cleanly to Light/Dark, while metric/chart cards remain hardcoded dark slate in Light mode |

## 2. Specific Consistency Findings

1. **Theme Support (`Light`, `Dark`, `System`) — `3. Actual defect requiring correction` (Pre-existing, outside zero-redesign restructuring scope):**
   - `frontend/src/styles.scss` defines a full dual-theme CSS variable system (`--bg-main`, `--bg-card`, `--text-primary`, `--text-secondary`, `--border-color`), which `ThemeService` toggles via `data-theme="light" | "dark"`.
   - **Developer pages** consume these variables consistently.
   - **Recruiter Hub (`features/recruiter/pages/*`)** and **Activity Logs (`shared/styles/_activity-logs-shared.scss`)** were authored with hardcoded dark-mode hex values (`#f8fafc`, `#f1f5f9`, `#0f172a`, `#172033`). Because `MainLayout` defaults to Light mode (`--bg-main: #f6f8fb`), unboxed headings directly over `--bg-main` (`Jobs`, `Hero Metrics`, `Activity Logs`) become illegible near-white text on near-white backgrounds in Light/System-Light mode.
2. **Typography & Font Consistency — `2. Improvement recommended`:**
   - `--font-sans` in `styles.scss` specifies `'Inter', ...`, used by Navbar, Sidebar, Recruiter, Admin, and Super Admin. Developer pages load `_developer-ui.scss` (`fonts.scss`) which overrides headings to `'Manrope', ...`. Harmonizing heading font tokens across roles is recommended when polishing design tokens.
3. **Card, Button, Input & Responsive Layouts — `1. Correct and finalized` (zero overflow regressions):**
   - All inspected views returned `overflowX: 0` across Desktop (`1440px`), Tablet (`768px`), and Mobile (`390px`).
   - Extracted `<app-interview-saved-sessions>` and shared `<app-confirm-dialog>` preserve existing padding, focus/hover affordances, and responsive breakpoints without visual regressions.

