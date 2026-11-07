# Career Sprint frontend finalization

**STATUS: VERIFIED — Career Sprint frontend. Ready for Career Sprint Final E2E Verification.** Scope is Career Sprint frontend only. Existing staged backend changes are preserved; production data and locked backend logic are untouched.

## Dashboard and presentation

Career Sprint now follows the approved Developer workspace standard: inherited self-hosted Manrope, Light default, existing Dark/System themes, indigo actions, semantic status colors, neutral surfaces and responsive full-width layouts. The page has a progress overview, Sprint XP and level, current/best streak, a seven-day activity chart, remaining/overdue task summaries, productivity and consistency. It keeps backend-provided progress, scores, level and XP authoritative. The within-level XP bar and chart bars are visual representations of supplied data.

Tasks, Sprint studio and history form separate workspaces. The shell retains ownership of outer padding, navigation, themes and typography. Task editing, planning, calendar/date formatting and shared feature controls live in separate feature components, utilities and styles. Existing shared theme and other module implementations are unchanged.

Recorded handoff identifiers stay in a source disclosure instead of dominating task descriptions. The editor preserves their exact source suffix when the title or user-facing description changes, retaining the existing Learning Hub duplicate markers in the request. Course-linked titles remain fixed because the existing handoff also uses that title for duplicate protection. Source display accepts the backend’s established whitespace normalization. Historical source text remains inspectable and no record is rewritten by presentation helpers.

## Task management

Create and edit support title, description, points, category, priority and optional start/end scheduling. Completion and reopening use the existing completion endpoint; edit and delete remain unavailable until a completed task is reopened. Delete actions require inline confirmation. Mutations are server-confirmed, guarded against duplicate submits and preserve the last valid data on failure.

Search, status, priority, category, any-date, Sprint-window, today, calendar week, overdue, unscheduled and custom-range filters are supported. Calendar filters use the Sprint's IANA timezone. Absolute overdue comparisons remain available for historical records. Task source labels distinguish manual, planned, Recommendation, Learning Hub and Scenario work; source limitations remain inspectable.

## Planning and integrations

Signal-based deterministic planning and explicit AI planning keep previews separate from saved work. AI fallback is labeled accurately; generation failure preserves the prior preview. Users can inspect plan context, backend planning estimates, limitations, signals, task dates and points before naming and saving a draft.

Saved drafts support inspection, deletion, individual selection, select-all/bulk import and clear-selection. Imports use the backend's single selective-import endpoint with original task indexes. They preserve provenance and dates rather than copying suggestions through sequential manual-task requests. Backend duplicate protection remains authoritative. Draft deletion leaves already imported tasks intact.

Different-context and unknown-context drafts require explicit review of recorded context and the exact current fingerprint. A refreshed fingerprint invalidates an earlier acknowledgement. HTTP 409 responses preserve the plan and selection, explain the conflict and offer a context refresh.

Owned Scenario Simulator history supplies selectable scenarios; importing creates a reviewable draft. Recommendations, Learning Hub and Scenario links retain their supported routes. Existing Recommendations/Learning Hub handoff services are unchanged. Contract tests exercise their actual frontend service methods, including already-added responses, and verify Sprint cache invalidation. Current Sprint navigation always revalidates against the backend, shares only pending reads and prevents late invalidated responses from repopulating caches. Mutation-dependent cache invalidation is preserved.

## Calendar, restoration and legacy records

Calendar settings read and update validated IANA timezone preferences through the verified endpoints. Preferences apply prospectively; current Sprint calendars and dates stay pinned. New non-overlapping Sprints can be created with explicit dates, including while viewing a read-only legacy Sprint. Future records are visible in history while current selection remains backend-controlled. Existing date-window editing remains supported for writable records.

The UI consumes `restoreMeta.policy`, `expiresAt` and server `canRestore`. New-policy restoration is disabled at exact expiry, including while the page stays open. It displays the absolute deadline, an elapsed-time countdown and the once-per-interval/no-activity/no-XP rule. It does not infer a recovery window from remaining calendar days. Backend eligibility remains the final authority.

`legacyAccess` controls read-only presentation and mutation guards. Legacy notices explain preservation and unresolved calendar provenance. Task/date/draft/scenario/restoration mutations are disabled; prospective preferences and creating a separate Sprint remain available. A missing old compatibility object fails closed when no calendar can be established. Unavailable consistency, active-window and recent-activity analytics display **Unavailable**, never synthetic zero. Real zeros remain zero. Original tasks, XP, levels, streaks and exact historical date instants stay visible. Unknown-zone dates are displayed as explicit UTC timestamps, not converted into an assumed original calendar.

History preserves every returned record by ID, including both overlapping legacy Sprints, with native keyboard-accessible disclosures and task detail inspection. The existing backend limit of 12 recent records is respected. Failed history loads preserve previously loaded records and expose retry. Failed current refreshes retain the last loaded Sprint, mark it stale and disable mutation until a successful retry.

## Validation and evidence

Final results: **23/23 focused tests** across 5 files; **248/248 full frontend tests** across 50 files; zero failures/skips. TypeScript and production build pass. All **24 responsive/theme combinations**, **three theme interaction flows** and **eight additional states** pass. The 10 retained screenshots were inspected. Prettier write/check, script syntax, scope preservation and staged/unstaged whitespace checks pass.

The reusable browser verifier serves the production bundle locally and intercepts HTTP with synthetic fixtures. No live account, production API, provider or database writes occur. This is frontend contract and browser verification; production-integrated backend E2E remains the next task.

The 24-combination matrix covers Light, Dark and System at 320, 375, 425, 768, 1024, 1280, 1440 and 1600px. It checks horizontal overflow, Manrope, title sizing, zero extra page padding, resolved theme and visible text contrast. System follows simulated OS Light/Dark changes. Interaction flows run in all three themes and include task CRUD, complete/reopen, filters, conflict preservation, failed-refresh retry, deterministic/AI fallback, saved drafts, selective/bulk imports, duplicates, fingerprint acknowledgement, Scenario import/delete, prospective timezone changes, future Sprint creation, overlapping history, mobile forms/search, keyboard focus/disclosures and theme switching.

Eight extra states cover legacy read-only records, empty tasks, initial failure/retry, loading, unavailable history/retry, eligible restoration, expired restoration and exact expiry while open. See `browser-results.json` for measured outcomes and retained screenshot names. Desktop/mobile Light/Dark dashboard, task, planner, history and legacy captures are retained and visually inspected. Finite shell transitions are allowed to finish before measuring layouts; screenshots use normal viewport captures to avoid sticky-header artifacts in oversized element captures.

Focused/full Angular test results, TypeScript, production build, formatter and whitespace results are recorded in `validation.json`. Frontend source tests cover calendar/DST/UTC-boundary handling, exact expiry, legacy preservation/guards, backend-authoritative metrics, stale-data behavior, pending requests, HTTP contracts, cache invalidation, task editing and context-aware draft ingestion.

## Reproduction

From `frontend`:

```powershell
npm test -- --watch=false --include=src/app/pages/career-sprint/**/*.spec.ts --include=src/app/shared/services/career-sprint.service.spec.ts
npm test -- --watch=false
npm run build
```

From the repository root:

```powershell
node frontend/node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.app.json
node frontend/scripts/verify-career-sprint-ui.cjs
```

The browser command requires an available Playwright Node package (or `NODE_PATH` pointing to the bundled runtime) and Chromium. `PLAYWRIGHT_MODULE` can select a package path and `SPRINT_CHROMIUM_PATH` can select an installed browser. The verifier uses loopback port 4326 and closes its server/browser afterward. Vitest and Chromium required sandbox escalation in this environment; the first sandboxed Vitest attempt failed during temporary-file renaming before any tests ran.

## Finalization and remaining issues

Exact changed/added files, source moves/deletions, preserved staged work and task-owned cleanup appear in `file-inventory.json`. Explicit changed paths use the installed repository Prettier with `frontend/.prettierrc`, write mode followed by the same check paths. No repository-wide formatting, dependency/package changes, backend edits or unrelated refactoring were performed. Obsolete task diagnostic screenshots are removed after their results are incorporated; essential screenshots, tests, fixtures and structured evidence are retained.

The production build retains an existing unrelated Landing Page stylesheet warning: 55.89 kB against its 48 kB warning budget. The 64 kB error budget is not exceeded. No locked or unrelated stylesheet was changed to suppress it.

Production legacy migration remains separately unapproved and was not run. The 15 original timezone findings remain unresolved, handled by the verified read-only contract. **Next: Career Sprint Final E2E Verification** against an authorized isolated backend environment; this frontend task does not claim that live integrated verification.
