# Admin And Super Admin

Implementation-driven guide for organization admin and platform super admin features.

## Current Behavior
Admin routes manage organization-scoped workflows. Super Admin routes manage platform-wide settings, organizations, users, audit logs, and AI versions.

## Files To Modify
| Change | Files |
|---|---|
| Admin frontend | `frontend/src/app/admin/*`, `frontend/src/app/pages/admin-console/*` |
| Super Admin frontend | `frontend/src/app/super-admin/*`, `frontend/src/app/settings/*` |
| Admin backend | `backend/src/routes/admin*.js`, `backend/src/controllers/admin*`, `backend/src/services/admin/*` |
| Super Admin backend | `backend/src/routes/super-admin.routes.js`, `backend/src/controllers/superAdminController.js`, `backend/src/controllers/superAdminSettingsController.js` |
| Shared org/audit | `backend/src/routes/tenant.routes.js`, `backend/src/controllers/tenantcontroller.js`, `backend/src/controllers/auditLogController.js` |
| Models | `backend/src/models/user.js`, `backend/src/models/organization.js`, `backend/src/models/platformSettings.js`, `backend/src/models/auditLog.js` |

## Dependencies
- Guards: `adminSettingsGuard`, `superAdminGuard`, `noAdminTabsGuard`.
- Backend RBAC, org middleware, audit middleware, platform settings middleware.
- `platformSettingsService` for cached settings.

## Request Flow
Admin UI under `/app/admin` and redirects from legacy admin-console paths -> admin services -> org-scoped backend routes.

Super Admin UI under `/super-admin` and `/app/settings` -> super-admin routes -> platform-wide controllers.

## Change Impact
- Role enum changes affect auth, guards, middleware, and route access.
- Platform settings changes affect AI providers, maintenance mode, integrations, and background services.

## Testing Files
- `node --check backend/src/controllers/adminConsoleController.js`
- `node --check backend/src/controllers/superAdminController.js`
- `npx -y ng build --configuration development`

## Common Pitfalls
- Do not mix org admin scope with super admin scope.
- Keep maintenance-mode exceptions intact.
- Update audit logging when adding sensitive mutations.
