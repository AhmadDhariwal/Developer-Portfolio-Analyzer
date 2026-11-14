# Calendar settings correction

Source/current branch: fix/dashboard-ui; target: not applicable. Baseline clean.

Existing authenticated contracts: GET preferences returns timeZone; PUT preferences accepts only timeZone and applies only to new windows. PUT :id/dates returns the updated Sprint and retains server duration, overlap, reservation and legacy policies. Current and bounded history reads supply owner-scoped records; no API addition is required. Loaded history is explicitly bounded and server overlap validation remains authoritative.

Current component shares date drafts with the dashboard Sprint and resets them on every refresh. Preferences have a saved value and draft but lack cancel. The panel closes without confirmation. Date mutation uses the current Sprint exclusively. Shared searchable-select supports search and keyboard tab/activation through native controls.

Plan: reuse searchable-select; add independent calendar selection and persisted snapshot, draft reset/discard protection, section feedback, duration/overlap/task warnings; preserve server validation and task dates. Modify the Career Sprint component/template/styles and focused tests. Finish with explicit Prettier write/check, frontend tests, typecheck/build, browser evidence where runtime permits, cleanup and whitespace/status review.

## Implementation and acceptance limits

Implemented two settings cards, independent Calendar Sprint selection/drafts, section feedback, Cancel and confirmed Close, duration/loaded-overlap warnings, conservative task completeness warnings and saved timezone selection. Date success uses the server-returned Sprint, updates current dashboard calculations and planning records where identities match, resets task filters and refreshes history. Shared searchable selector now supports arrow keys/Escape and an accessible trigger label. Existing bounded history is displayed honestly as current/recent; older records outside that response are not selectable. Backend contracts and task records were not changed.

Validation: Prettier write and check on the six source files; whitespace validation passed. Initial TypeScript compilation passed. Production build generated successfully (4.09 MB initial bundle warning, plus pre-existing Landing/Jobs/Public Portfolio stylesheet warnings). Focused Angular invocation failed before tests with sandbox EACCES on tooling loopback. Two escalated test invocations timed out in automatic permission review before starting. No test pass claimed. Browser bridge failed to initialize with missing kernel-assets path; no screenshots, responsive matrix or live accessibility pass claimed. New tests cover independent selection/cancel, invalid timezone and close confirmation; the overlap regression assertion now checks the section error. Additional runtime acceptance remains necessary.

Exact changed files:
- frontend/src/app/pages/career-sprint/career-sprint.component.ts
- frontend/src/app/pages/career-sprint/career-sprint.component.html
- frontend/src/app/pages/career-sprint/career-sprint.component.scss
- frontend/src/app/pages/career-sprint/career-sprint.component.spec.ts
- frontend/src/app/shared/components/searchable-select/searchable-select.component.ts
- frontend/src/app/shared/components/searchable-select/searchable-select.component.html
- backend/verification/career-sprint/calendar-settings-design.md

No files moved or deleted. No task temporary scripts, logs or screenshots were created; inline editing commands created only the retained source/report files. Existing caches/build output retained. No commits, pushes or deployments.

## Dropdown and responsive UI follow-up

The timezone popup previously clipped options because its panel hid overflow without a scrolling child. Added a dedicated option scroller with visible scrollbar, bounded popup height (360px / 60dvh), fixed search field and non-shrinking option rows. Sprint selection now reuses this dropdown with searchable name/status/date metadata. Calendar cards use page tokens, selected/hover/focus states, tablet stacking and full-width phone actions. Shared selector scoping preserves the default appearance for other consumers. Additional changed file: frontend/src/app/shared/components/searchable-select/searchable-select.component.scss.

Follow-up TypeScript check passed. Full Angular test command stopped before execution with tooling loopback EACCES at 127.0.0.1:63380. Responsive CSS and keyboard controls were inspected in source; live viewport/theme screenshots remain unverified because the browser runtime is unavailable. No new temporary files, moves or deletions.

Follow-up production build: PASS (4.09 MB initial bundle warning; existing stylesheet budget warnings). Prettier check and working/staged whitespace checks: PASS. No browser screenshot claim.
