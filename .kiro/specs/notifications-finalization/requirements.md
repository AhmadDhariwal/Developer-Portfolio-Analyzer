# Notification finalization requirements

Baseline: `release1` at `2254f090c6f1c8563ad2d7149ab081eeec09fc4c`. Authorized implementation branch: `task/notifications`. PR target: not applicable. The remote has no Help/Support branch; the implementation on the other laptop cannot be recovered from this repository's advertised refs. Preserve existing tracked dependency changes.

No Kiro specification tree or separate Notification/Help handoff was present in this checkout. This specification uses the conventional requirements/design/tasks layout and the solution architecture charter, existing feature guides and inspected source as its references.

- R1: When an authoritative producer commits, its notification and durable invalidation revision shall commit in the same bounded Mongo transaction. Optional AI/email calls shall remain outside transactions.
- R2: When a stable event or sliding-window key is retried across workers, Mongo receipts shall prevent a duplicate inbox record, including after the recipient dismisses it.
- R3: When a worker or browser reconnects, a durable revision and authoritative inbox read shall reconcile missed invalidations. Change Streams shall accelerate delivery; Redis shall not establish correctness.
- R4: Streams shall use Authorization headers, persisted session/account checks, credential expiration, shared account/fleet leases, heartbeats, bounded buffering and cleanup.
- R5: Personal notifications shall remain private to their recipient. Explicit organization/team notifications shall require current recipient membership and scope; tenant roles shall not grant access to colleagues' personal inboxes.
- R6: Preferences shall gate corresponding activity at commit time. Mandatory security notices shall bypass optional activity preferences.
- R7: Reads, counts, filters, pagination, mark-read and deletion shall be owned, indexed and bounded. Counts and feed shall share a snapshot. Bulk delete shall accept at most 100 selected IDs with UI confirmation; mark-all shall process at most 500 per request and report remaining work.
- R8: Mongo shall own request windows and stream leases even when Redis is unavailable. Mandatory admission failures shall fail closed; committed events shall remain retrievable.
- R9: The client shall isolate cached/in-flight responses by identity/session, coalesce refresh events, invalidate mutations, bound reconnects with jitter and retain periodic reconciliation when streaming fails.
- R10: Existing Help ticket creation/status changes shall notify atomically without ticket contents in previews. Support email shall have durable leased delivery records and bounded safe retries; uncertain SMTP outcomes shall require reconciliation instead of blind resend. Unavailable reply/assignment features shall not be invented.
- R11: The existing appearance shall remain recognizable with responsive light/dark layouts, keyboard-operable native confirmation dialogs, safe internal navigation and distinct loading/empty/error states.
- R12: Verification shall include real disposable Mongo and separate worker processes, meaningful regressions, complete frontend tests, typecheck/build, synthetic browser acceptance, formatting write/check, exact inventory, cleanup and whitespace checks. Production acceptance additionally requires deployment-equivalent gates and recovered Help contract review.
- R13: No notification/security/audit TTL shall be introduced without an approved policy. Only existing disposable admission state may expire automatically.
