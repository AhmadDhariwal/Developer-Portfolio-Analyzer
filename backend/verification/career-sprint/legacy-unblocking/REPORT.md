# Career Sprint legacy data unblocking — 2026-10-16

**Backend implementation: VERIFIED. Frontend development can proceed independently of production migration approval.** Production migration: not applied; explicit deployment authorization remains required. Frontend implementation was not started.

## Timezone findings

Fresh read-only inspection confirms 15 records, all without `calendarPolicy`, `timeZone` or `migrationCalendarTimeZone`. Per-record IDs, owners, exact dates and creation/update timestamps are retained in `timezone-findings.json`. All windows start at 19:00Z and end at 18:59:59.999Z. These boundaries are consistent with local midnight at UTC+05:00, but they do not identify an IANA zone or prove the deployment environment. Neither UTC nor Asia/Karachi has been assigned.

Historical commits `b3a8e14f` (March baseline), `8d52cc23` (July custom windows) and `cfe95782` (August date utilities) use host-local `getDay`, `setDate` and `setHours`. No retained deployment timezone pin or record-to-deployment provenance was found. Current machine timezone, Git author offsets and current UTC defaults cannot establish historical server calendars. All 15 original IANA timezone findings remain **unresolved**.

`legacy-exceptions.json` binds each exception to its ID, owner and exact original start/end, with an explicit unresolved-provenance explanation. It records an exception decision, not an inferred timezone mapping. The earlier UTC-assumption audit remains preserved in the historical verification directory and is not treated as provenance.

## Overlap resolution and preservation

Both original records for owner `69e9efd85a0084c767771781` are retained:

| ID                         | Original start             | Original end               |
| -------------------------- | -------------------------- | -------------------------- |
| `6a4e4ff719b693d01b6dc086` | `2026-07-05T19:00:00.000Z` | `2026-07-12T18:59:59.999Z` |
| `6a5482ee19b693d01b6dc300` | `2026-07-10T19:00:00.000Z` | `2026-07-22T18:59:59.999Z` |

Only explicitly identified original legacy windows can be grandfathered. Both participants must have valid exceptions; a partial manifest, mismatched owner/dates, invalid interval, new pinned-policy record or existing occupied-day tokens fails preflight. No deletion, date truncation, task merge, XP redistribution or streak recalculation occurs.

The exception migration writes only `legacyException`, `reservationPolicy: legacy-read-only-exception-v1` and an incremented `__v`, with timestamps disabled. It leaves original dates/aliases, IDs, tasks, drafts, XP, level, streak fields and timestamps unchanged. Exception records receive no invented calendar-day tokens. Their exact original intervals are seeded into the existing per-owner schedule document, including both overlapping intervals. Existing unique occupied-day and creation-key indexes remain unchanged. New requests still use atomic interval reservations across all historical windows, including different calendars.

## Runtime and frontend contract

Unresolved legacy records are read-only immediately on deployment of the code, independently of migration approval. Every Sprint task/date/draft/scenario/restoration mutation rejects with HTTP 409; Recommendations and Learning Hub handoffs also reject and include atomic database predicates against exception records. Current reads skip inactivity persistence for read-only records. The original stored data remains visible in history and current responses.

Responses add `legacyAccess: {readOnly, calendarStatus, reason, timeZone}`. Unresolved calendars expose `timeZone: null`, `calendarStatus: provenance-unresolved`, unavailable day-dependent analytics as `null`, `dailyActivity: []`, and `restoreMeta.canRestore: false`. Absolute-date overdue checks, tasks, XP, progress and stored streaks remain available. Frontend work should render read-only history and unavailable calendar analytics explicitly. New pinned-policy Sprint behavior is unchanged.

Current selection retains the existing latest-`updatedAt` rule and adds descending `_id` as a stable tie-breaker; migration does not change `updatedAt`. History retains both records within its existing requested limit (maximum 12), with deterministic date/ID ordering. Preference changes remain prospective. Known per-record timezone mapping, including Karachi and New York DST fixtures, remains supported by the existing migration without assigning those fixture zones to production records.

## Migration operation and evidence

Read-only commands against the configured database:

```powershell
node backend/src/scripts/migrateCareerSprintReservations.js
node backend/src/scripts/migrateCareerSprintReservations.js --legacy-exceptions-file backend/verification/career-sprint/legacy-unblocking/legacy-exceptions.json
node backend/src/scripts/auditCareerSprintData.js
```

The strict baseline continues to report missing original zones and the historical overlap. The explicit-exception dry-run is safe: 15 metadata-only proposals, one grandfathered pair, no unresolved problems, no pending/orphaned reservations and no mismatched existing reservations. See `live-baseline-dry-run.json`, `live-exceptions-dry-run.json` and `data-audit.json`. Both actual unique partial index definitions were inspected read-only and match the required definitions. Missing owner schedule documents are reported for safe initialization during an approved apply; dry-run does not create them.

Apply still requires `--apply --deployment-authorized` and must receive the reviewed exceptions file. That production command was **not executed**. Apply checks original dates and document version, stops on compare-and-swap failure, re-inspects reservations before writes and verifies remaining work afterward. Retry resumes partial progress. Existing malformed/missing/duplicated schedule reservations and conservative pending tokens stop the run rather than being erased.

The isolated integration test accepts only an explicitly provided loopback URI with a `career_sprint_legacy_test_` database name. Test applications use generated owners on a dedicated MongoDB 8.2.6 instance at port 27186. Full backend tests override both Mongo URI variables to another isolated local database. Configured production MongoDB is used only for read-only inspection. Redis worker checks use their existing generated-owner fixture namespace.

## Validation and finalization

Final focused regression: **49/49 passed**, zero skips, 44.38 seconds. Post-cleanup policy/calendar unit checks: **16/16 passed**. Final full backend regression: **375/375 passed**, zero skips, 206.93 seconds. Final validation results and exact file inventory are recorded in `validation.json` and `file-inventory.json`. Focused/full suites, migration resumability, index idempotency/uniqueness, preservation of complete historical documents, current/history compatibility, mixed calendars, malformed manifests and read-only mutation guards are covered.

Preliminary results retained here: the first focused run was 45/47, with two source assertions expecting the old sort shape; these now require the deterministic ID tie-breaker. The first full run was 373/375: the new race fixture assumed Mongo insertion order, corrected to use the inspected proposal order, and the unchanged Learning Hub memory test exceeded its existing performance threshold. Thresholds and unrelated Learning Hub implementation were not changed. Sandbox-local networking initially failed; approved network access allowed fresh read-only audits and isolated tests. No automatic approval rejection occurred.

Changed JavaScript uses the installed frontend Prettier executable with explicit paths only. Sprint files retain single quotes, no trailing commas and width 120; existing handoff/Recommendations files retain single quotes, trailing commas and width 100. Write mode is followed by matching check mode, JavaScript syntax checks and Git whitespace checks. No frontend files, source assets, licenses or historical evidence are removed or reformatted. No source file is moved or deleted. Initial Git status was clean. Empty/redundant task-owned preliminary outputs and the disposable local MongoDB runtime are removed; exact deleted paths are recorded in the inventory. Historical verification evidence remains untouched.

## Deployment decision

The supported implementation path preserves all 15 records as read-only legacy exceptions. Production apply authorization is separate from backend implementation and frontend development. Establishing original IANA provenance or later making these records writable requires additional deployment evidence and an explicit follow-up policy; it is not silently performed by this migration. Frontend development can proceed against these contracts once final backend validation passes, independently of production migration approval. Production release/deployment remains subject to operator review and authorization.
