# Notification production finalization

Date: 31 October 2026. Branch: `task/notifications`. Source: `release1` / `2254f090c6f1c8563ad2d7149ab081eeec09fc4c`. PR target: not applicable. No commit, push, merge, deployment, live-provider request or production database migration was performed.

**DEVELOPMENT COMPLETE — STABLE CANDIDATE — PRODUCTION GATES PENDING**

## Baseline and preservation

At preflight, both local refs and GitHub's advertised heads lacked `task/help` or any Help/Support-named branch. Unpushed code on another laptop cannot be fetched from this remote. The available Help APIs are integrated here; reviewing the unavailable final Help implementation is a release gate. There was no separate supplied Notification/Help handoff or existing Kiro tree; requirements, design and tasks are retained under `.kiro/specs/notifications-finalization/`.

The initial index was empty. Existing tracked `backend/node_modules` dependency changes were recorded and preserved. The focused pre-edit baseline passed 15 tests. The architecture charter and Mongo-authoritative admission patterns were followed. Dependencies and scoring formulas are unchanged. See `file-inventory.json` for exact task files, preserved pre-existing files and the moved/deleted inventory.

## Before and after

Previously notifications used an in-process EventEmitter with unlimited listeners and an in-process deduplication Map. Notification writes swallowed errors, most producers ran after source commits, stream authentication used JWT query strings without current account/session checks, and organization roles could expose colleagues' personal inboxes. Parallel counts/feed queries could observe different states. Support and weekly email side effects had no sufficient cross-worker delivery receipt.

Now source writes, notification records, idempotency receipts and a durable recipient revision commit atomically. Managed object-reference transactions include the required notification before committing. External AI, SMTP and object-store I/O remain outside database transactions. A failed required notification write rolls back its associated source write. Derived Dashboard readiness alerts are retried projections of an authorized read, not a fabricated source event.

```mermaid
flowchart LR
  A[Authoritative source mutation] --> T[Bounded Mongo transaction]
  T --> N[Inbox and receipt]
  T --> R[Recipient revision]
  R --> C[Per-worker Change Stream]
  R --> P[Bounded reconciliation]
  C --> S[Authenticated content-free SSE]
  P --> S
  S --> U[Shared Angular invalidation]
  U --> Q[Snapshot inbox and unread query]
  Q --> B[Navbar and notification page]
```

This is at-least-once invalidation awareness with idempotent persistence and authoritative reconciliation. It is not exactly-once network delivery. A cursor represents a committed inbox revision, not an immutable replay log of notification bodies. A reconnect always reconciles the current inbox, including deletions and read changes.

## Complete producer → event → recipient → persistence → delivery → UI matrix

All rows target the authenticated/authoritative record owner. D1 means transactional inbox/receipt/revision persistence followed by cross-worker invalidation and protected inbox retrieval. Optional preferences are checked from persisted User state inside the source transaction; mandatory security notices bypass them.

| Producer and trigger                                                                       | Event/title                              | Recipient and scope       | Persistence / idempotency / preference                                                                          | Delivery                                  | UI target              |
| ------------------------------------------------------------------------------------------ | ---------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------- |
| `profilecontroller.updateProfile`: successful changed settings                             | Profile Updated                          | Profile owner, personal   | User save + D1; request-content digest, short window                                                            | D1                                        | `/app/profile`         |
| `profilecontroller.updatePassword`: successful compare-and-set                             | Password Updated                         | Account owner, personal   | Password/session revision + D1; stable next revision; mandatory security                                        | D1                                        | `/app/profile`         |
| `authcontroller.resetPassword`: verified reset token and successful compare-and-set        | Password Reset                           | Account owner, personal   | Password/session revision + D1; stable next revision; mandatory security                                        | D1                                        | `/app/profile`         |
| `profilecontroller.updateActiveCareerProfile`: successful active stack/level save          | Session Career Filter Changed            | Profile owner, personal   | User save + D1; active-context/window key                                                                       | D1                                        | `/app/career-sprint`   |
| `profilecontroller.uploadAvatar`: successful reference exchange                            | Profile Photo Updated                    | Profile owner, personal   | File/B2 reference transaction + D1                                                                              | D1                                        | `/app/profile`         |
| `profilecontroller.updateProfileVisibility`: successful visibility save                    | Profile Visibility Updated               | Profile owner, personal   | User save + D1; visibility/window key                                                                           | D1                                        | `/app/profile`         |
| `resumecontoller.uploadResume`: successful owned upload/reference commit                   | New Resume Uploaded                      | Resume owner, personal    | ResumeFile + active selection + D1; file ID                                                                     | D1                                        | `/app/resume-analyzer` |
| `resumecontoller.runAnalyzeResumePipeline`: persisted deterministic analysis               | Resume Analysis Completed                | Analysis owner, personal  | ResumeAnalysis + D1; file/content hash/rule version; optional critique cannot suppress deterministic completion | D1                                        | `/app/resume-analyzer` |
| `githubcontroller`: successful non-stale/non-fallback owned analysis save                  | GitHub Profile Updated                   | Analysis owner, personal  | Analysis + active identity + D1; handle/window key; repository failure prevents this commit                     | D1                                        | `/app/github-analyzer` |
| `skillgapcontroller`: persisted non-preview result with at least three gaps                | Major Skill Gaps Identified              | Result owner, personal    | AnalysisCache + D1; signal/window key; `skillTrendAlerts`                                                       | D1                                        | `/app/skill-gap`       |
| `recommendationService`: explicit saved recommendation snapshot                            | Career Recommendations Updated           | Snapshot owner, personal  | Recommendation + D1; rule version/signal hash; `newRecommendations`                                             | D1                                        | `/app/recommendations` |
| `careerSprintService.toggleTaskCompletion`: a real transition to completed                 | Sprint Task Completed                    | Sprint owner, personal    | Sprint save + D1; sprint/task/completion identity; repeated same state is a no-op                               | D1                                        | `/app/career-sprint`   |
| `careerSprintService.restoreStreak`: successful eligible restore                           | Career Streak Restored                   | Sprint owner, personal    | Sprint save + D1; sprint/version identity                                                                       | D1                                        | `/app/career-sprint`   |
| `dashboardcontroller`: authorized readiness projection between 0 and 60                    | Low Readiness Score Alert                | Current user, personal    | D1 only; daily sliding key; failure does not turn a dashboard read into a failed source mutation                | D1                                        | `/app/dashboard`       |
| `weeklyReportService`: committed generated/updated report                                  | Weekly Report Ready                      | Report owner, personal    | WeeklyReport + email intent + D1; report/content hash; `weeklyScoreReport`                                      | D1 plus leased email intent               | `/app/weekly-reports`  |
| `weeklyReportService.updateWeeklyReportEmailStatus`: failed/unconfirmed delivery recorded  | Weekly Report Email Delivery Unconfirmed | Report owner, personal    | Email status + D1; report/content hash; `weeklyScoreReport`; no false successful-email claim                    | D1                                        | `/app/weekly-reports`  |
| `support.service.createTicket`: successful quota/dedupe/ticket transaction                 | Support request received                 | Ticket owner, personal    | Quota + dedupe + ticket + email intent + D1; ticket ID; no subject/body in preview                              | D1 plus leased support inbox email intent | `/app/support`         |
| `support.service.updateTicketStatus`: authorized actual status transition                  | Support request status updated           | Ticket owner, personal    | Status revision + D1; ticket/status revision; repeating the same state is a no-op                               | D1                                        | `/app/support`         |
| `publicProfileService.updatePublicProfile`: successful publication/settings/reference save | Public Portfolio Updated                 | Portfolio owner, personal | Profile/assets + D1; slug/window key                                                                            | D1                                        | `/app/portfolio`       |

Integrations Marketplace currently has no direct notification producer for connect/sync; the GitHub analyzer producer above is separate. No new integration success event, support assignment event, staff reply event or user reply event was invented. The available Help schema/routes do not implement those workflows. News, jobs and other inspected modules without actual producers are not represented as implemented sources.

## Persistence, indexing, scope and retention

`NotificationReceipt._id` hashes recipient, explicit scope and stable event/window key. Receipts survive inbox dismissal; stable suppressed events also retain their preference decision. Sliding keys reuse one document. Per-recipient account write fences serialize competing producers, preference writes and account deletion. A five-second transaction deadline bounds new notification commits; notification-bearing managed asset transactions use the same deadline. Receipt/state cleanup is included in account deletion without sweeping another recipient's records.

Inbox/feed/count/revision reads share a Mongo snapshot and re-check the current account/session. Personal inboxes never widen to another recipient through organization roles. Explicit organization/team records require current membership; revoked scope is hidden in default inboxes too. Scoped mutations use membership write fences. Reconciliation has an eight-second work budget plus the current bounded batch; excess connections close for fallback instead of extending a cycle indefinitely. A 200-membership cap fails closed rather than constructing an unbounded authorization fanout.

Additional indexes are `notification_inbox_cursor`, `notification_unread_cursor`, `notification_type_cursor`, `notification_scope_cursor`, `support_email_due`, `weekly_email_due`, `weekly_email_coalesced` and the recipient receipt index. Existing indexes are retained. Default compatibility offsets are bounded to the first 100 pages; returned keyset cursors continue older history in deterministic date/ID order. Literal search is escaped, limited to 100 characters and query-time bounded; it can still scan a recipient's mailbox. Counts grow with the number of relevant indexed records, and additional indexes increase write/storage cost. These costs require deployment load measurement.

There is no new notification, security-record, audit-record or receipt TTL. Existing disposable governance counters/leases may expire. Proposed retention decisions are separate: ordinary activity may be archived under an approved user-access/export policy; security records require a security/incident retention policy; audit history retains its separate governance. No automatic 90-day deletion is approved or implemented.

## Stream security, rate limits and client state

The stream uses Fetch plus Bearer headers and rejects URL tokens. Issuer/audience/algorithm validation, matching account identity, persisted session revisions, account status and token expiration are enforced. Current persisted sessions are rechecked in bounded reconciliation cycles scheduled 15 seconds apart; overloaded connections close for inbox fallback; no notification contents travel over the stream. Revoked stream authentication logs the client out. Protected inbox/mutation requests independently authorize current persisted state. Native EventSource auto-retry is replaced by bounded exponential backoff/jitter, Retry-After handling, eight reconnect retries and 60-second fallback reconciliation. Cursor order never decreases.

Mongo alone owns 120 inbox requests/minute/account, 60 single mutations/minute, ten bulk requests/minute, 30 connection attempts/minute, six streams/account, 1,000 streams/fleet and 500 streams/worker. Sixty-second stream leases recover crashes. Slow consumers disconnect on failed writes or more than 16 KiB buffering. Heartbeats, explicit cleanup, JWT-expiry timers and proxy buffering headers bound stream state. Redis adds no notification request-path commands and cannot reset quotas. Internal producer events are not silently dropped by a user-facing creation quota.

The Angular service has at most 50 cache entries, a 15-second TTL, one shared in-flight request/query and identity/session epochs that reject late responses. Local mutations and stream updates invalidate the same service; 250 ms coalescing bounds redundant navbar/page refreshes. Logout/account switching abort streams and timers. Cursor-backed page navigation preserves loaded history while receiving updates. There is no backend notification response cache, so a backend cache-hit ratio is not applicable; frontend cache/deduplication behavior is verified through request counts rather than a new telemetry endpoint.

## Email safety and Help integration

The existing email retry worker processes bounded support and weekly intent batches. Mongo claims prevent multiple workers from sending the same work concurrently. Known pre-delivery SMTP failures use bounded backoff and at most five attempts. Timed-out/interrupted/ambiguous attempts become `uncertain`, and automatic resend is blocked until provider reconciliation. Stable Message-ID assists support email investigation but does not guarantee provider idempotency. Weekly report generation remains available while an older send is processing/uncertain. Its durable ordinary-email intent coalesces to the latest report content; unresolved SMTP outcomes hold email retries for operator review, while in-app completion notifications and online reports remain available. Provider outcomes are conditional on the exact sent content hash and cannot mark a newer report as emailed. Repeated identical report content preserves its delivered state. A provider fallback is not attempted after an ambiguous send failure. There is no claim of exactly-once SMTP delivery.

Help email intent is committed with the ticket. Source quota/deduplication uses the existing Mongo collections exclusively, preserving existing windows and limits across Redis changes. Status notifications revalidate the persisted administrative actor and omit ticket text. Future recovered Help reply/assignment APIs must use the same source transaction/event ID boundary rather than duplicate emails or notifications from a second pipeline.

## UI and accessibility

The existing notification container retains orchestration, filters and feed presentation. New standalone typed bulk-action and native confirmation-dialog components isolate their respective controls. Existing navbar and page use one shared service; safe internal navigation rejects external/script/admin URLs. Single delete, bounded selected delete, mark-read, bounded mark-all, unread/type/date/search filters and keyset history are supported. Loading, empty and failure/retry states are distinct. Native dialogs provide focus containment, Escape/cancel and focus return. Light/dark and mobile styles include focus outlines, touch-sized actions and reduced-motion support.

Browser verification uses the built application with real notification routes, a disposable Mongo replica set and synthetic unrelated-module fixtures. It is not a live-provider or production-environment check. Screenshots/results are retained in `frontend/verification/notifications/`.

## Observability and measurements

Prometheus exposes `dpa_notification_operations_total`, `dpa_notification_operation_seconds` (including transaction, inbox, unread-count, admission and reconciliation), `dpa_notification_stream_connections`, `dpa_notification_delivery_lag_seconds` and `dpa_notification_email_backlog`. Labels do not contain user IDs, emails, titles or ticket contents. Delivery lag measures server-write awareness, not a network acknowledgement. Backlog gauges observe shared Mongo state; aggregate with **max across workers**, not sum. Alert on persistence/reconciliation/admission failures, sustained lag, pending growth and any unresolved email state.

The retained disposable acceptance measurements are in `integration-results.json`. The exercised workload is eight simultaneous duplicate producers, two separate worker processes, real reconnect/revocation/restart/recovery, six-account stream admission leases, bounded ordered reads and 25 sequential persistence events. These are measured local samples, not deployed capacity limits. The configured 500/1,000 stream guards are ceilings, not load-tested capacity claims. Suggested deployment acceptance targets are p95 server invalidation awareness below two seconds when Change Streams are healthy, recovery reconciliation within 30 seconds under the agreed connection load, and no sustained pending growth over an agreed soak. Validate these on the actual deployment before accepting them.

## Verification evidence

- `integration-results.json`: disposable Mongo, actual worker processes, source rollback, duplicate/tombstone handling, preferences/security, IDOR, scopes/revocation, stream expiry, Mongo interruption/recovery, worker restart, durable email claims, account deletion and index checks.
- `finalization.json`: final broad run passed 130 tests, skipped two optional cases and encountered a cold worker-startup timeout in the existing Mongo governance suite. The isolated governance retry then passed all 13 governance tests after increasing only its fixture startup allowance from six to 45 seconds. The disposable asset regression run passed all 14 tests, activating both optional integration cases (12 overlap the broad run). Together these runs cover 145 distinct regression tests. The separate notification acceptance suite passed all 15 tests, for 160 distinct backend tests covered. An earlier broad run also passed 143 with two optional skips.
- `governance-regression.json`: separate retained real Mongo governance regression evidence.
- Frontend result in `finalization.json`: all 446 tests in 80 files passed with `npm test -- --watch=false --runner-config=scripts/notifications-vitest.config.ts`. Two workers limit host resource pressure; no assertions or test/hook timeouts were relaxed.
- Build result in `finalization.json`: production build; pre-existing landing-page stylesheet budget warning.
- `frontend/verification/notifications/browser-results.json` and four desktop/mobile light/dark screenshots: final browser acceptance.
- `format-manifest.json`, `finalization.json`, `cleanup.json` and `file-inventory.json`: exact paths, identical formatter write/check options, syntax/type/whitespace results, cleanup and preservation inventory.

Raw command logs were consolidated into `finalization.json` and removed during the requested cleanup. Their counts, outcomes, sizes and hashes are retained; final structured evidence and screenshots remain. No application source changed during this cleanup.

Browser review found and corrected native-dialog Tab containment and light-theme header/count contrast before final acceptance. The final four screenshots were retained and inspected.

Earlier environmental failures are not counted as passes: sandbox temporary-file rename restrictions, insufficient C: disk space for Mongo and Vitest, and an unrelated Career Sprint test timeout under concurrent verification load. Verification was moved to task-owned D: temporary storage without deleting unrelated C: files. Final reruns also encountered a stalled frontend runner and cold Windows worker startup under 100% host CPU usage. A serial frontend retry passed. Only test worker startup allowances were raised (notification fixture 15 to 45 seconds; existing governance fixture six to 45 seconds); product transaction, request, delivery and security deadlines were preserved. Superseded failure logs were removed after retaining these results here and in finalization.json. No production database or external provider was used.

## Migration, rollout and rollback

1. Recover/push the other laptop's Help branch or transfer its patch. Compare its actual final APIs and event contracts before release; do not blindly overwrite or run two Help pipelines.
2. Confirm a transaction-capable Mongo replica set/sharded topology, majority writes, required Change Stream permissions, current backups, proxy timeouts/buffering and browser/proxy Authorization-header support. Redis remains optional.
3. Set `NOTIFICATION_MIGRATION_URI` explicitly to the intended environment and run `node backend/src/scripts/migrateNotificationIndexes.js` for an audit. Review the result. Run the same command with `--apply` only after environment approval. It creates missing collections/indexes, never drops/replaces indexes or rewrites history. Existing uniqueness conflicts fail visibly. No production migration was executed here.
4. Drain legacy notification/Help/email-producing workers and their in-flight SMTP operations before enabling this version. Mixed legacy workers cannot honor the new receipts/claims and may duplicate side effects. Preserve existing Mongo quota/dedupe documents; do not reset counters during rollout.
5. Deploy frontend and backend together: old URL-token EventSource clients are deliberately rejected. Reconnect establishes a fresh inbox revision. Confirm protected read/mutation/SSE, two instances/tabs, lease expiry, a Redis outage and a transient Mongo interruption in staging.
6. Monitor low-cardinality metrics and operational email states. Reconcile `uncertain` sends with provider receipts before any explicit retry. Never clear the state solely because a client timed out.
7. Rollback requires draining current producers/email attempts and coordinated frontend/backend rollback. Retain new records/indexes and all receipts/history; no destructive schema rollback is needed. Legacy code does not understand durable receipts or private-scope changes, so it cannot be treated as an automatically safe mixed-fleet fallback.

## Remaining operator-only release gates

- Recover and review the unavailable final Help implementation, especially reply/assignment/staff-recipient authorization and event IDs.
- Approve and verify the additive index rollout on the real topology; audit existing data/index conflicts and query plans.
- Validate deployment proxy/CORS/buffering/idle-timeout behavior, real multi-instance leases, agreed sustained connection/event load, failover and soak. Local synthetic acceptance is not a production fleet benchmark.
- Verify SMTP/provider credentials and receipt reconciliation; decide the operational process for ambiguous sends. No live email test was authorized or performed.
- Approve separate activity/security/audit retention and archival policies; no TTL may be inferred from this report.
- Approve production rollout separately. This branch is not committed, pushed, merged or deployed by this task.
