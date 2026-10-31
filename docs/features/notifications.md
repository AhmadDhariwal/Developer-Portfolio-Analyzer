# Notifications

Implementation guide for recipient-owned in-app notifications. See the retained [production report](../../backend/verification/notifications/NOTIFICATIONS-PRODUCTION-FINAL.md), [design](../../.kiro/specs/notifications-finalization/design.md) and [tasks](../../.kiro/specs/notifications-finalization/tasks.md).

## Data flow

Authoritative producer mutation + inbox + durable receipt + recipient revision commit together in MongoDB. A per-worker Change Stream and bounded reconciliation send content-free invalidation signals. The client re-reads its authorized inbox; missing stream messages never erase persisted notifications. Mongo owns admission and deduplication; Redis is not required on notification paths.

## Main files

| Concern | Files |
|---|---|
| Container and standalone bulk/confirmation UI | `frontend/src/app/pages/notifications/` |
| Cache, authenticated streaming and reconciliation | `frontend/src/app/shared/services/notification.service.ts` |
| Navigation allowlist | `frontend/src/app/shared/utils/notification-navigation.ts` |
| Navbar synchronization | `frontend/src/app/layout/main-layout/navbar/` |
| HTTP ownership, filtering and mutations | `backend/src/controllers/notificationcontroller.js`, `backend/src/routes/notification.routes.js` |
| Persistence, receipts and preferences | `backend/src/services/notificationService.js`, `notificationPersistenceService.js` |
| Cross-worker delivery | `backend/src/services/notificationStreamService.js` |
| Shared admission | `backend/src/middleware/notificationAdmission.js`, `backend/src/services/integrationMongoGovernanceService.js` |
| Mongo records | `backend/src/models/notification.js`, `notificationReceipt.js`, `notificationState.js` |
| Durable email claims | `backend/src/services/supportNotificationDeliveryService.js`, `weeklyReportDeliveryService.js`, existing `emailRetryQueueService.js` |

## HTTP contracts

- `GET /api/notifications`: bounded page/limit compatibility, optional keyset `cursor`, literal search, dates/type/unread and explicit organization/team filters. The response includes snapshot-consistent `unreadCount`, `filteredUnreadCount`, `revision` and `nextCursor`.
- `GET /api/notifications/stream`: authenticated Fetch stream using an Authorization header; no JWT URL parameter. Streams reconcile on connect and support coalesced revision cursors.
- `PUT /api/notifications/:id/read`: mark one owned authorized alert read.
- `PUT /api/notifications/read-all`: mark up to 500 authorized owned alerts; inspect `remaining` and `message` before claiming all work is done.
- `DELETE /api/notifications/:id`: idempotently delete an owned authorized alert.
- `POST /api/notifications/bulk-delete`: body `{ ids: string[] }`, 1–100 IDs. UI confirmation is required by the container.

Personal notifications remain private even to organization managers/admins. Explicit scoped records require current membership, including in the default inbox. Legacy `userId` cannot select another person's inbox; role/includeAllOrgs fields do not widen recipient access. Password update/reset notices are mandatory; existing activity preference flags gate their corresponding producer inside the commit transaction.

## Verification and operations

Use `node --test backend/src/tests/notificationsProduction.test.js` for disposable replica-set/two-process checks. The MongoDB server binary must be installed; test temporary storage defaults to this task's verification folder on D:. Run normal frontend tests, TypeScript checks and production build as described in AGENTS.md. Browser acceptance uses `backend/src/scripts/verifyNotificationsBrowser.js` with `NOTIFICATION_ACCEPTANCE_PLAYWRIGHT` pointing to an installed Playwright package.

`backend/src/scripts/migrateNotificationIndexes.js` audits by default and accepts `--apply` only against an explicitly supplied `NOTIFICATION_MIGRATION_URI`. Never delete notifications or receipts as cache cleanup. The existing email retry worker processes durable notification-related email intents; uncertain SMTP outcomes need provider reconciliation, not blind resends. Recover the other laptop's Help implementation before approving final integration with its unavailable reply/assignment contracts.
