# Notifications

Implementation-driven guide for in-app notifications.

## Current Behavior
Feature services create notifications through `notificationService`. The notifications page lists unread/read items and marks one or all as read.

## Files To Modify
| Change | Files |
|---|---|
| UI | `frontend/src/app/pages/notifications/*` |
| Frontend service | `frontend/src/app/shared/services/notification.service.ts` |
| Backend route/controller | `backend/src/routes/notification.routes.js`, `backend/src/controllers/notificationcontroller.js` |
| Create/dedupe logic | `backend/src/services/notificationService.js` |
| Model | `backend/src/models/notification.js`, `backend/src/models/user.js` |

## Dependencies
- User notification preferences.
- Feature services call `createNotification()` after successful mutations/generation.
- Auth middleware scopes reads to current user.

## Request Flow
`/app/notifications` -> `NotificationService` -> `GET /api/notifications` -> mark read via `PUT /api/notifications/:id/read` or `PUT /api/notifications/read-all`.

## Change Impact
- Notification type changes must stay aligned with user preferences.
- Dedupe changes can create spam or hide important events.

## Testing Files
- `node --check backend/src/controllers/notificationcontroller.js`
- `node --check backend/src/services/notificationService.js`
- `npx -y ng build --configuration development`

## Common Pitfalls
- Respect notification preferences.
- Use `dedupeKey` for repeated background events.
- Do not expose notifications across users.
