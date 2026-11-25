# Admin And Super Admin

Implementation guide for the organization Admin and platform Super Admin workspaces.

## Current Behavior

Organization Admin pages live under `/app/admin`. The Admin API families are `/api/admin`, `/api/admin-console`, and the organization-scoped portions of `/api/tenant`. Admin and Super Admin account roles are separate. Organization membership roles (`admin`, `manager`, `member`) grant organization capabilities and do not grant platform privileges.

Both `/api/admin` and `/api/admin-console` require the exact organization Admin account role before organization-context resolution. This route-local check prevents the shared `authorizeRoles` Super Admin bypass from granting platform accounts access to organization Admin endpoints.

Organization and team access must reject suspended organizations. Admin-console activity uses the current organization ID, excludes deleted records, returns stable newest-first pages, and omits the audit `before` and `after` payloads. Console analytics aggregate organization jobs in MongoDB and count invitation states across the full organization; `recentInvitations` remains a bounded sample.

Team creation, direct Recruiter creation, Recruiter invitation creation/acceptance, and Recruiter activation share a transactional organization-capacity check. It advances the existing organization `updatedAt` field as the contention write, enforces the current team and Recruiter limits, and aborts rejected mutations without adding a persistence field.

Organization creation still honors `PlatformSettings.organization.allowOrgCreation`. A duplicate slug, including a concurrent unique-index collision, returns the established safe `409` response. Platform-wide support queue routes under `/api/support/admin/tickets` are Super Admin-only. The support ticket schema does not retain organization attribution, so the Admin workspace has no organization-scoped support queue today.

## Files To Modify

| Change | Current locations |
|---|---|
| Admin routing and pages | `frontend/src/app/features/admin/`, `frontend/src/app/app.routes.ts` |
| Admin page and hiring clients | `frontend/src/app/features/admin/pages/`, `frontend/src/app/features/admin/services/admin-hiring.service.ts` |
| Shared tenant and auth clients | `frontend/src/app/shared/services/tenant-context.service.ts`, `auth.service.ts`, `support.service.ts` |
| Admin HTTP routes | `backend/src/modules/admin/routes/admin.routes.js`, `adminConsole.routes.js`, `tenant.routes.js`, `audit.routes.js` |
| Admin controllers and services | `backend/src/modules/admin/controllers/`, `backend/src/modules/admin/services/` |
| Tenant data models | `backend/src/modules/admin/models/organization.js`, `team.js`, `membership.js`, `invitation.js`, `auditLog.js` |
| Authentication and organization enforcement | `backend/src/core/middleware/authmiddleware.js`, `orgMiddleware.js`, `rbacMiddleware.js`, `auditLogMiddleware.js` |
| Platform settings dependency | `backend/src/modules/super-admin/services/platformSettingsService.js` |
| Support API authority | `backend/src/modules/support/support.routes.js`, `support.controller.js`, `services/support.service.js` |

## Dependencies

- Angular `authGuard`, `noAdminTabsGuard`, `adminSettingsGuard`, and `AuthService.canAccessUrl` control navigation. They are not the backend security boundary.
- `protect`, `authorizeRoles`, `requireOrganizationContext`, `requireOrganizationRole`, and `requireTeamRole` enforce API access.
- `tenantService.js` resolves active organization and team membership roles.
- `platformSettingsService` provides organization creation policy.
- `auditLogMiddleware` records API mutations and is independent of controller response handling.

## Request Flow

Admin page under `/app/admin/*` → feature page/service → `/api/admin/*` or `/api/admin-console/*` → authentication and organization context → controller/service → organization-filtered models.

Organization invitations, teams, and membership routes use `/api/tenant/*` and role middleware. Public invitation details and onboarding are separate paths from authenticated acceptance. The real server mounts these route families in `backend/index.js`.

Personal support uses `/api/support/tickets*` and `/api/support/my-tickets`. The platform support console uses `/api/support/admin/tickets*` and is restricted to `super_admin` by the route and status/reply service authorization.

## Change Impact

- `User`, organization, membership, or team authorization changes affect Admin, tenant, and Recruiter access. Verify revocation and shared-job/evaluation behavior.
- Admin-console activity scope and projection changes affect `/api/admin-console/activity` and the Admin activity page.
- Analytics field changes affect the console dashboard and its API consumers; keep exact totals separate from bounded recent samples.
- Support authority changes affect only the platform Super Admin support page unless an explicit organization-scoped support design is approved.
- Do not retire legacy Recruiter routes/models or consolidate Admin and Super Admin shells as part of P1.6A.

## Testing Files

- `backend/src/tests/admin/adminScopeAndAnalytics.integration.test.js`
- `backend/src/tests/support/supportAdminAuthority.test.js`
- `backend/src/tests/support/supportAdmission.test.js`
- `backend/src/tests/core/tenantAudit.integration.test.js`
- `backend/src/tests/core/platformSettingsSession.integration.test.js`
- `backend/src/tests/recruiter/teamSharedJobs.integration.test.js`
- `backend/src/tests/recruiter/teamEvaluations.integration.test.js`
- Frontend full suite: `npm test -- --watch=false` from `frontend`.

## Common Pitfalls

- Account role `admin` and membership role `admin` are different authorities.
- Never trust a client-supplied organization, team, user, or resource ID without a server-side ownership check.
- Suspended organizations must fail closed across both organization-context and membership-based routes.
- A recent invitation list is a sample; it cannot provide exact funnel totals.
- Audit payloads can contain private data. Do not expose `before`/`after` in the Admin activity feed.
- The support schema has no organization ID. Do not imply that the current global support queue is organization-scoped.
- `docs/` is ignored in this checkout; these feature notes remain local unless repository policy changes.
