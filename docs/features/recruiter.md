# Recruiter Hub

Implementation-driven guide for recruiter discovery, matching, shortlist, jobs, and analytics.

## Current Behavior
Recruiter Hub is lazy-loaded at `/app/recruiter` for recruiter users. It uses recruiter-hub routes and services, with legacy recruiter routes still present for older surfaces.

## Files To Modify
| Change | Files |
|---|---|
| Frontend module | `frontend/src/app/features/recruiter/*` |
| Shared recruiter services | `frontend/src/app/shared/services/recruiter-dashboard.service.ts`, `frontend/src/app/shared/services/api.service.ts` |
| Hub routes/controllers | `backend/src/routes/recruiter-hub/*`, `backend/src/controllers/recruiter-hub/*` |
| Hub services | `backend/src/services/recruiter-hub/*` |
| Legacy recruiter | `backend/src/routes/recruiter.routes.js`, `backend/src/controllers/recruiterController.js`, `backend/src/services/recruiterService.js` |
| Models | `backend/src/models/Recruiter*.js`, `backend/src/models/Candidate.js`, `backend/src/models/user.js` |

## Dependencies
- Guards: `recruiterRoleGuard`, `noAdminTabsGuard`.
- `developerSignalService` and public profile visibility.
- Transparent scoring and matching services.

## Request Flow
`/app/recruiter` -> lazy `RecruiterModule` -> recruiter hub service/API methods -> `backend/src/routes/recruiter-hub/*` -> hub controllers/services.

## Change Impact
- Candidate signal changes affect matching, analytics, and shortlist views.
- Public profile visibility and user role changes affect recruiter access.

## Testing Files
- `node --check backend/src/controllers/recruiterController.js`
- `npx -y ng build --configuration development`

## Common Pitfalls
- Do not expose hidden/non-public developer data without checking recruiter access rules.
- Keep legacy recruiter routes separate from recruiter-hub routes.
- Avoid changing role guard semantics casually.
