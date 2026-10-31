# Notification integration handoff

Branch: `task/notifications`, based on `release1` at `2254f090c6f1c8563ad2d7149ab081eeec09fc4c`. No commit/push/merge/deployment is included. See [production finalization](NOTIFICATIONS-PRODUCTION-FINAL.md), [requirements](../../../.kiro/specs/notifications-finalization/requirements.md) and [exact files](file-inventory.json).

## Producer contract

Use `notificationPersistenceService.commit(userId, mutation, notification, sessionRevision)` for a source mutation and required notification. `mutation(session)` must perform bounded database work only. The notification may be a payload or a function of the mutation result. Existing transactions call `createNotification({ ...payload, session })` before commit. Never call providers, send email, emit process-local events or swallow required persistence errors inside that boundary.

Provide a stable `eventId` from the authoritative source ID/revision, or an explicitly justified sliding `dedupeKey`/`dedupeWindowHours`. Stable receipts, including preference-suppressed events and dismissed notifications, survive retries. Send only a recipient-authorized preview and allowlisted metadata/internal target. Optional `organizationId`/`teamId` are explicit top-level scope fields and require current recipient membership. `security: true` is reserved for trusted mandatory account-security events; do not expose it as a client-controlled creation API.

## HTTP/client contract

Existing list/read/delete paths remain, with recipient privacy enforced. List responses add `revision`, `filteredUnreadCount` and `nextCursor`. Scoped fields cannot select a colleague's private inbox. Mark-all returns `remaining` and processes at most 500; selected bulk delete accepts 1–100 IDs. Honor 429/Retry-After and 503 separately.

Fetch `/api/notifications/stream` with an Authorization Bearer header. Old `?token=` EventSource clients are deliberately rejected. SSE contains only invalidation revisions. Re-fetch through the shared Angular service; reconnect does not require replaying side effects. The existing navbar and page share that state. Eight bounded reconnect retries fall back to periodic inbox reconciliation, and logout/session switching clears all notification state.

## Help and email boundary

Available ticket creation and status transitions are integrated atomically, with generic previews. Quota/dedupe retains Mongo authority. The existing email retry worker processes durable support/weekly intent batches; do not add a competing email send in controllers. Safe pre-delivery failures back off, and ambiguous/crashed sends remain `uncertain` for provider reconciliation. A deterministic Message-ID is not an exactly-once guarantee.

`task/help` was not present locally or in advertised remote heads during preflight. Recover the other laptop's code before claiming compatibility with its final contracts. Its reply/assignment/staff workflows must persist notification intent with their source transaction and use authorized recipient identities. Compare the modified Help files carefully; do not overwrite either implementation or run duplicate pipelines.

## Operator handoff

Run the default audit-only `migrateNotificationIndexes.js` with an explicitly selected `NOTIFICATION_MIGRATION_URI`; `--apply` needs environment approval. Drain old producer/email workers before coordinated frontend/backend rollout. Retain records/indexes on rollback. Validate real topology, Change Stream permissions, proxies, load/soak and email receipts; approve activity/security/audit retention separately. The full report records local evidence and remaining release gates.
