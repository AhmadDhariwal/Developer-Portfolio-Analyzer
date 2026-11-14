# Career Sprint verification and overlap/planning fix — 2026-10-16

**Reported overlap/planning UI issue: fixed. Overall release verification: BLOCKED. READY TO LOCK CAREER SPRINT: NO.** Production migration and deployment authorization are separate decisions; neither was executed by this verification.

## Why the reported error occurred

The backend prevents overlapping Sprint windows, including the current Sprint that the dashboard can create automatically. Creating a second Sprint for those dates must remain rejected. AI planning creates a preview for an existing Sprint; it does not require creating another overlapping Sprint.

The frontend incorrectly gave every HTTP 409 the same draft-context refresh advice. A rejected date edit also marked an otherwise valid current Sprint stale, disabling its planner. New-Sprint creation itself did not set that stale flag. Other valid reasons for disabled planning are legacy read-only access, a failed refresh, an active refresh, or an in-flight mutation. The actual account's access state was not inferred from the error message alone.

The fix checks loaded current/history windows before creation, offers the next available seven-day window, explains the overlap, and offers **Plan current Sprint** where appropriate. Date comparisons use the new Sprint's saved IANA calendar and the original historical instants; they never assign an original timezone to legacy records. This is a convenience check against loaded history, not a replacement for the backend's complete atomic overlap checks. Dates remain editable and unknown conflicts still fail safely on the server.

The user's follow-up screenshot confirmed an actual read-only legacy Sprint. A second workflow gap is now fixed: Sprint studio has a **Create writable Sprint** action and a **Writable Sprint** selector. Creation opens the new record directly for planning, including a future record, while the dashboard's backend-selected current Sprint remains unchanged. An owned writable record can also be selected from the loaded history. Refreshes revalidate the planning target; a missing/failed history refresh disables its mutations. Saving/importing updates the selected planning record rather than replacing the legacy dashboard. An empty scenario selector now says **No saved scenarios yet**.

To use AI from that screen: **Create writable Sprint → choose available dates → Create Sprint → enter Focus technology → Try AI planning → Save as draft → Select all tasks → Add selected to Sprint**. Alternatively choose an existing writable record from the selector. Historical record controls remain locked intentionally.

Rejected overlapping date edits no longer invalidate the current snapshot or disable its planning. Other 409 conflicts still fail closed. Planning now displays the specific legacy/stale/refresh/saving reason and a refresh action. Legacy records remain read-only, and future Sprint creation does not override the backend's current-Sprint selection.

## Current frontend validation

- Focused: **28/28**, five files, zero skips.
- Full: **253/253**, 50 files, zero skips.
- TypeScript: `--noEmit -p frontend/tsconfig.app.json` passes.
- Production build: passes, follow-up fix bundle `main-Q77TBNOZ.js` (61.457 seconds). Existing unrelated Landing Page SCSS warning remains: 55.89 kB versus its 48 kB warning budget. Thresholds were not changed.
- Explicit Prettier write then check: passes for changed feature sources and verifier. Git staged/unstaged whitespace checks pass.
- Added tests cover known-overlap rejection without a request, available-date suggestions, rejected date-edit recovery, disabled-state explanations, DST adjacency and preservation of unresolved legacy instants. Follow-up tests verify that creating/selecting a writable planning record enables its inputs while the legacy dashboard remains immutable, and that failed target refreshes block planning.
- Windows sandbox test execution initially failed before running tests with an EPERM temporary-file rename. The approved normal runner subsequently passed all focused/full tests.

The final browser results are in `overlap-fix/browser-results.json`. All 24 Light/Dark/System combinations are exercised at 320, 375, 425, 768, 1024, 1280, 1440 and 1600px. New overlap controls are checked before the remaining accessibility assertions. Eight additional legacy/empty/loading/error/history/restoration states are exercised. Essential final screenshots live in `overlap-fix/`; the overlap notice and suggested dates have dedicated captures.

The existing style revision changed outside this verification introduced remaining accessibility failures: eight Light layouts fail the existing contrast check, and the three theme interaction flows fail the visible-outline assertion after keyboard navigation to the Status filter. The checker does not resolve gradient backgrounds, so reported primary-button ratios are not reliable measurements of the gradient. Solid-color labels also fail, including medium-priority text around 2.95:1; those findings require correction/review. Inputs have a focus shadow but their `:focus` rule overrides the explicit outline. Do not equate these assertions with every earlier CRUD/planning interaction failing. No thresholds were lowered or bypassed.

Desktop/mobile Light/Dark dashboard, planner and legacy screenshots were inspected directly. The original presentation was organized and readable; the subsequent style revision adds glows, gradients and shadows that differ from the neutral Developer UI standard. This fix preserves those unrelated style changes and does not claim full design/accessibility approval.

## Backend and integrated evidence

The retained backend evidence is under `backend/verification/career-sprint/final-e2e/`. `integrated-results.json` now records six passing groups, including real MongoDB/JWT operations, independent math, Learning Hub replay after editing, and all 15 actual legacy records copied only into isolated MongoDB. Later staged backend fixes were made outside this frontend repair and are preserved. The initial verification reproduced a Learning Hub marker-normalization replay bug; the updated retained integrated result reports that replay passing after those separate fixes.

| Scenario                                                  | Independent XP | Level |        Weighted progress | Reversal |
| --------------------------------------------------------- | -------------: | ----: | -----------------------: | -------: |
| High-priority 10-point task complete out of 10+5+1 points |     15+10 = 25 |     1 | round(10/16 × 100) = 63% |     0 XP |
| Four of five high-priority 10-point tasks complete        |   4 × 25 = 100 |     2 |        40/50 × 100 = 80% |    75 XP |
| Low/1, medium/4 and high/8 all complete                   |   6+14+23 = 43 |     1 |       13/13 × 100 = 100% |    37 XP |

Each math scenario exercises five concurrent completion replays, reversal, re-completion and persisted Mongo values. Existing real JWT/Mongo suites cover CRUD, ownership, concurrent creation/imports, exact restoration, drafts, context acknowledgements and Simulator integration. Provider-success/malformed-output cases are controlled at the provider boundary; the real HTTP verifier injects provider unavailability and checks deterministic fallback without paid AI calls.

The live browser's four groups passed against real isolated Express/JWT/Mongo routes: planning/selective/bulk imports, Recommendations handoff with fresh context replay, task CRUD/reopen/reload persistence, and Dashboard/Weekly Reports freshness. The captured Dashboard Interview Readiness changed 5 → 10; Weekly Report completed tasks changed 1 → 2 of seven, with its existing completion metric changing 14% → 29%. These consumer metrics retain their own approved calculations. The harness does not mount unrelated notification/tenant shell endpoints; their 404s are documented in the retained live result. Its API origin is explicitly pinned to the isolated server, overriding the development index's localhost:5000 configuration.

Earlier full backend run: **373/375**, zero skips; focused Career Sprint run: **48/49**, zero skips. At that snapshot, one failure was an obsolete assertion against the old frontend source structure; the other full-suite failure was Recommendations memory p95 (140.72 ms versus unchanged <50 ms). A standalone performance retry measured 56.31 ms and still failed. Later retained staged Recommendations evidence reports **36/36** passing, and the obsolete assertion has separately been updated. These later changes do not constitute a fresh full-backend run by this frontend repair. A final full backend regression against the final combined staged work remains necessary before locking.

Real two-process MongoDB/Redis checks passed after an initial Redis availability failure: fresh revisions, late stale writes, worker restart, Redis fallback, concurrent windows and database fail-closed behavior. Career Sprint performance checks passed in the focused run. Post-cleanup calendar/legacy policy units passed **9/9**. Existing policy tests cover IANA validation, New York spring/fall DST, UTC/Karachi midnight boundaries and restoration at expiry−1 ms versus exact exclusive 48-hour expiry, with no invented XP/activity.

## Legacy and deployment safety

All 15 original IANA zones remain unresolved. The 19:00Z start and 18:59:59.999Z end pattern is consistent with UTC+05:00, but proves neither Asia/Karachi nor UTC. No timezone was invented. The overlapping historical pair remains separate with its tasks, XP, streaks and exact dates.

The read-only production dry-run with the reviewed exception manifest reports **safe**, 15 records, one grandfathered overlap and zero problems. Native remote operations read records/indexes only. Full-document hashes before/after verify remote preservation; isolated copies preserve the complete documents after HTTP 409 mutation rejections. All 15 expose read-only `legacyAccess`; the real serializer returns null consistency/day-dependent analytics and an empty activity array. Inactive historical records belong in history; `/current` can legitimately select/create a different current-week Sprint. Index/idempotent migration/overlap reservation coverage is retained in the isolated legacy integration suite. Production apply remains unauthorized and was never run.

## Files, cleanup and remaining work

The overlap repair changes only:

1. `frontend/src/app/pages/career-sprint/career-sprint.component.ts`
2. `frontend/src/app/pages/career-sprint/career-sprint.component.html`
3. `frontend/src/app/pages/career-sprint/career-sprint.component.spec.ts`
4. `frontend/src/app/pages/career-sprint/components/sprint-planner.component.ts`
5. `frontend/src/app/pages/career-sprint/components/sprint-planner.component.html`
6. `frontend/src/app/pages/career-sprint/utils/sprint-presentation.ts`
7. `frontend/src/app/pages/career-sprint/utils/sprint-presentation.spec.ts`
8. `frontend/scripts/verify-career-sprint-ui.cjs`

Reusable verification scripts from the earlier verification are `backend/src/scripts/verifyCareerSprintFinalE2E.js` and `frontend/scripts/verify-career-sprint-live.cjs`. Existing staged backend work, staged frontend changes and unrelated modules were preserved. No application source file was moved or deleted. Final JSON evidence, regression tests and essential screenshots are retained. Exact earlier artifact removals/moves are recorded in backend `cleanup.json` and `moves.json`; temporary session credentials and redundant preliminary diagnostics were removed. The disposable local MongoDB was confirmed stopped and its runtime path is now absent. No destructive Git reset/clean was used.

Automatic approval review rejected an attempted verifier minimum-task assertion reduction; it was restored to **at least six** and rerun with a fresh isolated fixture. No approved threshold was lowered. A subsequent cleanup approval was temporarily unavailable because of review-service usage limits; the temporary database was already stopped, and its runtime path was later confirmed absent. Test approval recovered and the final focused/full frontend tests passed.

Remaining release work is accessibility/design resolution, a full backend rerun against the final combined staged changes, and separate operator authorization for production migration/deployment. The reported overlap/planning frontend repair does not depend on approving that migration. No other module was begun.
