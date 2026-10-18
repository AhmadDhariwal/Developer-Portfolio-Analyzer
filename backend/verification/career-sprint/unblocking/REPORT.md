# Career Sprint backend unblocking release verification

**STATUS: BLOCKED**  
**READY FOR CAREER SPRINT FRONTEND: NO**

The approved backend policies are implemented. The production release gate remains blocked by an unresolved original-calendar dependency and an actual overlap in preserved legacy records. No production write migration was run. Frontend implementation was not started. Existing staged work and historical verification reports were preserved.

## Approved policies implemented

New windows pin `sprint-calendar-48h-v1`, validated IANA timezone and runtime timezone-data metadata. Authenticated preferences apply prospectively; absent/invalid stored preferences default to UTC. Legacy records retain their original policy. Limits remain 366 calendar days, 500 tasks and eight drafts. Completed tasks require reopening before editing/deleting.

## Exact 48-hour streak behavior

After real activity on day D, D+1 is the warning day. The break instant is local midnight on D+2, independently of when the application opens. Eligibility ends exactly 172,800,000 elapsed milliseconds later; equality is rejected. A specific interval can be restored once. Restore creates no activity, tasks, XP or evidence. A separate restoration bridge supports subsequent real activity without changing the actual last activity timestamp. Legacy restoration remains versioned separately.

## Timezone / DST test results

Boundary tests cover UTC, Asia/Karachi and America/New_York spring/fall transitions, local midnight, expiry minus one millisecond and exact expiry. Calendar arithmetic uses pinned `@js-temporal/polyfill@0.5.1`; calendar-day addition and elapsed-hour expiry are deliberately separate. Invalid IANA zones, invalid dates, ambiguous timezone-less datetime input and oversized windows are rejected. References: [Temporal ZonedDateTime](https://tc39.es/proposal-temporal/docs/zoneddatetime.html), [official polyfill](https://github.com/js-temporal/temporal-polyfill).

## XP and level model

Sprint-scoped task XP remains priority base (high 15, medium 10, low 5) plus valid task points. Level remains `max(1, floor(sprintXP / 100) + 1)`. Weighted progress, productivity and consistency math are retained. Completion replay, reopening reversal and completed-task mutation guards remain regression tested. No lifetime ledger or analyzer scoring changes were introduced.

## Legacy reservation / migration safety

The read-only database audit finds 15 legacy records requiring their original server-calendar timezone. A UTC fallback in current code is not proof of their origin. The supplied user clarification conditionally permits UTC for confirmed standard UTC environments; these records' actual origin remains unconfirmed. Both no-timezone preflight and a clearly labeled UTC-assumption candidate are retained. Neither is a write migration.

Actual historical overlap for owner `69e9efd85a0084c767771781`:

| Record                     | Original start             | Original end               |
| -------------------------- | -------------------------- | -------------------------- |
| `6a4e4ff719b693d01b6dc086` | `2026-07-05T19:00:00.000Z` | `2026-07-12T18:59:59.999Z` |
| `6a5482ee19b693d01b6dc300` | `2026-07-10T19:00:00.000Z` | `2026-07-22T18:59:59.999Z` |

Proposed operator resolution: establish each record's original IANA calendar from deployment provenance, using a per-record mapping for mixed origins. Preserve both overlapping records unchanged and explicitly decide how historical overlaps are grandfathered before designing an approved exception migration. Do not delete, truncate or automatically reschedule either record. UTC-assumption token collisions on adjacent windows must also be reviewed against the confirmed calendar.

The reusable migration defaults to read-only, with automatic collection/index creation disabled. Unsafe preflight stops application with zero updates. Apply requires explicit deployment authorization and uses version/date compare-and-swap, preserving IDs, windows, tasks, XP, streaks and timestamps. Fixture-only application is resumable/idempotent and was tested. New/edited windows use an atomic per-owner exact-interval reservation including unmigrated historical windows, so the pending migration cannot bypass overlap protection. Unknown write outcomes retain conservative reservations; pending/orphan tokens require review. Index verification checks actual key/unique/partial definitions and refuses mismatches.

## Distributed cache verification

Every overview read obtains fresh primary-Mongo current and previous snapshots before consulting memory/Redis. Cache keys contain immutable database snapshots, local day, overdue state and fresh draft context. In-flight sharing happens only after fresh snapshot identity is known. Delayed old writers cannot replace newer keys. Redis failure falls back to database-derived state; database failure fails closed instead of returning a cached authoritative overview. Plan cache identity includes fresh owned context and task state.

The retained worker fixture uses two real OS processes, actual MongoDB and Redis. It tests cross-worker completion visibility, delayed stale Redis write, process restart, disconnected Redis fallback, concurrent overlapping creation and Mongo outage after warming cache. Cross-module handoff writes increment database revisions. Snapshot validation intentionally costs two database reads per overview; tests no longer assert the unsafe zero-read contract. Existing latency thresholds were retained.

## Modern Recommendations integration

Planning reads current owned canonical profile, GitHub/Resume source identity and `skill-evidence-coverage-v1` signals. Modern actions must match current supported engine output and context/source/rule metadata; locked ranking/analyzers are unchanged. Tasks preserve recommendation, snapshot, context and limitation metadata. Already imported/completed recommendation identities and task titles are suppressed across history. Ordinary saves revalidate provenance. Insufficient evidence falls back to labeled career guidance; Sprint completion is never proficiency evidence.

## Draft context validation

New drafts capture immutable owner, stack, experience, source/rule fingerprint, origin and timestamps. APIs expose current, different-context and legacy-context-unknown compatibility. Stale/unknown ingestion requires the exact current fingerprint acknowledgement; boolean or outdated acknowledgements fail. Original draft context remains unchanged. Selective/bulk ingestion preserves dates, deduplicates title/source identity and respects limits. Same-name different content is rejected rather than overwriting history.

## AI safeguards

Optional AI only orders permitted deterministic task IDs. A single-field strict schema requires every permitted ID exactly once. Model-authored wording, scores, dates, ownership, source identities or completion state are rejected. Malformed, polluted, failed or timed-out output uses deterministic fallback. AI is outside ordinary reads. Lexical filtering is not claimed to prove factual correctness. Controlled providers verify success/failure paths; no paid live model verification is claimed.

## Files changed / folder organization

See `file-inventory.json` for the exact current-task inventory, including modified, added, moved and deleted paths. New code follows existing controllers/models/services/utils/scripts/tests folders. Reusable migration and performance tooling stays under scripts; the process fixture stays under tests/fixtures; essential evidence stays here. Earlier staged changes are not attributed to this task unless this task also modified them. No source files were moved or deleted.

## Formatting / cleanup

Explicit changed JavaScript files were formatted with the installed Prettier in write mode, then checked with the same options. Existing handoff/test conventions were preserved. Package JSON and this report also passed explicit write/check validation; feature documentation retains its established format. All changed JavaScript receives `node --check`; staged and unstaged whitespace checks are required. No frontend files changed, so frontend build/typecheck/test commands are outside this backend-only scope.

Three task-owned, unreferenced preliminary logs were removed after retaining their relevant outcomes: `backend/verification/career-sprint/unblocking-preliminary.txt`, `backend/verification/career-sprint/unblocking/mongo-preliminary.txt`, and `backend/verification/career-sprint/unblocking/targeted-preliminary.txt`. The initial full-run log was replaced by final-run evidence; its sole failure is documented below. No historical evidence, user work, screenshots, traces, assets or licenses were deleted.

## Focused / full / MongoDB / Redis tests

Final focused run: **46/46 passed**, zero skips, 37.21 seconds. Final full regression run: **372/372 passed**, zero skips, 165.75 seconds. MongoDB/JWT and actual two-process Redis checks passed in both. Commands and retained logs are recorded in `validation.json`. An earlier full serial run had 371/372 passes: the unchanged Recommendations memory performance test measured 58.2 ms against its existing 50 ms threshold. That threshold and locked module were not changed. Final rerun results supersede this preliminary outcome while preserving the diagnosis here.

Performance probe p95 milliseconds: cold 91.97, database-validated memory 32.05, Redis 48.41, deterministic plan 80.53, optional controlled AI 206.31. Five concurrent callers share one signal build after ten fresh snapshot reads. The separate performance JSON retains counters and before/after measurements; the old zero-read memory number is not equivalent to the new correctness contract.

## Remaining release dependencies

1. Confirm original calendar per legacy record; current fallback UTC is insufficient evidence.
2. Approve an explicit historical-overlap resolution preserving both records and review candidate calendar-token conflicts.
3. Re-run read-only preflight with the approved mapping and resolution. Production apply requires separate explicit deployment authorization; none was supplied or inferred.
4. Review any deployment-specific index mismatch or conservative pending reservation surfaced by preflight; never drop guards automatically.

The frontend API contracts are documented and tested, but the requested final release gate remains **BLOCKED / NO** until legacy-data decisions are resolved and deployment checks are authorized.
