# P1.6C.1 organization governance

## Pre-implementation inventory and decision

Prepared before schema or permission edits. Source: `admin/ui` (explicitly authorized
instead of the request's `fix/admin`); initial HEAD `229c7cfb`; clean index and worktree.
PR target: not applicable. No staging, commit, push, deployment, or production migration.

The authoritative `MASTER-PRODUCT-ROADMAP.md` places workspace consolidation in P2.5,
collaboration in P1.2, legacy retirement in P1.5, and commercial entitlements in P3.2.
Its implementation descriptions predate accepted P1.6B.1; current code and retained
acceptance reports establish the operational baseline. This task prepares governance,
retains compatibility APIs, and does not begin billing, approval workflows, Super
Admin implementation, or the P1.6C.2 visual redesign.

| Scope                     | Existing source of truth                                                    | Controls and boundaries                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Platform                  | `super-admin/models/platformSettings.js`, settings service and middleware   | Organization creation, team limit (10 default), active Recruiter seats (5), Admin invitation approval; Recruiter access and candidate visibility; public Developer visibility; AI, authentication/security, integrations, notification and analytics settings. Secrets stay platform-owned. Existing multi-worker synchronization remains. |
| Organization              | `admin/models/organization.js`                                              | Name (2–80), unique immutable settings slug, description (500), owner/creator identifiers, suspension, timestamps. No recruitment policy document exists.                                                                                                                                                                                  |
| Organization presentation | `Organization.dashboardConfig`, Admin Console preferences                   | Date range, default team and six visibility flags. Despite the preferences label, these are organization-shared dashboard configuration, not personal permissions. Existing UI edits name/description here.                                                                                                                                |
| Organization affiliation  | `User.organizationId`, direct `Membership`                                  | Account role differs from organization membership role. Existing legacy Recruiter affiliation is supported without fabricating team authority. Disabled direct membership revokes Recruiter job access.                                                                                                                                    |
| Team                      | `Team`, team `Membership`                                                   | Organization-unique slug, active state; member/manager/admin membership. An organization manager is distinct from a team manager. Membership rows can repeat a user across teams.                                                                                                                                                          |
| Resource                  | `Job`, Recruiter Match/Shortlist, job access services                       | Job creator owns private applications. Explicit `teamShared` and `evaluationShared` opt-ins, active team grants, manager mutation, owner-only matching/private evidence, resource versions and transactional security fences. Current and legacy job/matching APIs coexist.                                                                |
| Developer consent         | `User.isPublic`, public profile sections, application service               | Candidate visibility/consent is independent of team grants. Submitted evidence and application shortlists remain creator-only; withdrawal and retained evidence follow the accepted application contract.                                                                                                                                  |
| Invitation                | `Invitation`, acceptance service, tenant/Admin/auth compatibility endpoints | Pending/accepted/expired/revoked, expiry, permitted membership roles vs Recruiter account onboarding; verified existing-account authentication, inviter revalidation, cross-org protection and transactionally serialized seat checks. List APIs currently emphasize pending invitations.                                                  |
| Personal                  | User profile/notification settings, sessions                                | Account role, verification, active state and session revision are re-read at authorization boundaries. Dashboard preferences do not become personal security configuration.                                                                                                                                                                |
| Audit/notification        | `AuditLog`, audit middleware, notification module                           | Historical append-only evidence; request audit failure logs after response and does not roll back existing operations. Recruiter handlers have specific audit events. Invitation delivery reports actual delivery and tests stub providers.                                                                                                |

Inspected models, tenant/Admin controllers and routes, invitation acceptance, capacity
service, organization/RBAC/auth middleware, Recruiter job/evaluation access services,
current/compatibility job/match/shortlist/comparison flows, application ownership,
frontend Console preferences and Admin/Recruiter contracts, and isolated Mongo fixtures.

## Proposed architecture (before implementation)

Extend `Organization` with a single versioned `governance` subdocument and justified
display metadata (industry, website, timezone, branding logo URL). No new collection,
custom roles, arbitrary grants, secrets, slug editing, or per-org quotas. Existing
platform limits and usage are exposed read-only; no actual product contract justifies
duplicating commercial entitlements with organization limits.

All policies default to enabled for existing organizations, restrict existing grants,
and never grant new access. Proposed supported booleans: `recruiterJobCreation`,
`recruiterJobPublication`, `teamSharedJobs`, `sharedPublicEvaluations`,
`teamManagerEvaluationManagement`, `candidateMatching`, `invitationCreation`, and
`managerTeamAdministration`. Publication governs future publishing/reopening of a
published job, not retroactive unpublishing. Matching governs new scoring/generation,
not historical owner access. Invitation disabling blocks creation, resending and
pending acceptance; revocation stays available. Manager administration restricts
existing organization-manager team creation and membership-role operations; it does
not invent authority for team managers or disable Admin recovery actions.

Use the organization document as the common transaction write shared with accepted
capacity serialization and Recruiter security fences. Re-read policies, actors and
membership authority within each transaction; no cross-request grant caching.
Configuration updates require an explicit expected version and atomically append
redacted audit events. Audit failure blocks these new configuration mutations; the
existing request-audit failure contract remains unchanged. Legacy preference updates
must join this same version/authority boundary to avoid a second metadata writer.

Provide Admin governance GET/PATCH, scoped member and invitation directories, and
informational effective capabilities for Admin and both Recruiter route families.
Resource capabilities remain independently constrained by ownership and consent.
Frontend work in this phase consists of typed contracts and existing preference
version propagation; complete workspace UI is P1.6C.2.

Final supported catalog, enforcement matrix, transitions, API contracts, deferred
decisions, verification and exact changed files are recorded below after validation.

## Final model and authority matrix

Field-level setting inventory (the names below refer to existing model paths;
grouping a family does not introduce a new configuration source):

| Existing paths                                                                                                                                                                                | Scope                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `PlatformSettings.general.platformName`, `logoUrl`, `maintenanceMode`, `defaultTimezone`, `defaultLanguage`                                                                                   | Platform-wide                                                                                                                         |
| `PlatformSettings.ai.enabled`, `provider`, `model`, `usageLimitPerDay`, `recommendationLimit`, `promptTemplate`, `providerApiKey`                                                             | Platform-wide; key is secret                                                                                                          |
| `PlatformSettings.organization.allowOrgCreation`, `maxTeamsPerOrganization`, `recruiterLimitPerOrg`, `adminInvitesRequireApproval`                                                            | Platform-wide constraints applied per organization                                                                                    |
| `PlatformSettings.recruiter.enableRecruiterAccess`, `candidateVisibility`, `activityThresholdDays`                                                                                            | Platform-wide                                                                                                                         |
| `PlatformSettings.developer.publicPortfolioVisibility`, `githubRequirement`, `profileCompletionRequirement`                                                                                   | Platform-wide                                                                                                                         |
| `PlatformSettings.security.jwtExpiresIn`, `otpExpiryMinutes`, `otpMaxAttempts`, `passwordMinLength`, `requireStrongPassword`, `loginMaxFailures`, `loginLockoutMinutes`, `globalRateLimitMax` | Platform-wide                                                                                                                         |
| `PlatformSettings.analytics.refreshIntervalMinutes`, `dashboardCacheMinutes`, `enableStructuredLogging`                                                                                       | Platform-wide                                                                                                                         |
| `PlatformSettings.notifications.emailNotifications`, `systemAlerts`, `recruiterAlerts`, `adminAlerts`                                                                                         | Platform-wide                                                                                                                         |
| `PlatformSettings.integrations.github/news/jobs.enabled`, corresponding `apiKey` fields                                                                                                       | Platform-wide; keys are secret                                                                                                        |
| `Organization.name`, `slug`, `description`, `ownerId`, `createdBy`, `isSuspended`                                                                                                             | Organization-wide; identifiers/ownership and platform-controlled suspension are excluded from generic settings editing                |
| `Organization.dashboardConfig.preferredDateRangeDays`, `defaultTeamId`, `showKpiCards`, `showTeamAnalytics`, `showRecruiterPerformance`, `showJobTrends`, `showActivityFeed`                  | Organization-wide presentation                                                                                                        |
| `Team.organizationId`, `name`, `slug`, `description`, `isActive`; team `Membership.role/status`                                                                                               | Team-scoped; organization association is immutable through settings                                                                   |
| Direct `Membership.role/status`, `User.organizationId`                                                                                                                                        | Organization affiliation/authority; not personal preferences                                                                          |
| `User.role`, `isActive`, `isVerified`, `sessionRevision`, authentication providers                                                                                                            | Account authorization/security, under existing platform or scoped account-management authority; not freely editable personal settings |
| `User.notifications.weeklyScoreReport`, `skillTrendAlerts`, `newRecommendations`, `jobMatchAlerts`                                                                                            | Personal delivery preferences, subordinate to platform notification switches                                                          |
| `User.recruiterPreferences.preferredStacks`, `preferredLocations`, `preferredJobTypes`, `noteTemplate`, `activityDigest`                                                                      | Personal Recruiter preferences, not organization security policies                                                                    |
| User profile/career fields, active/default GitHub and resume selections, career stack and experience level, career goal/timeline/learning preference                                          | Personal context; no shared policy authority                                                                                          |
| `User.isPublic`, public portfolio visibility and section visibility                                                                                                                           | Personal Developer consent, constrained by platform visibility                                                                        |
| `Job.published/status/archivedAt`, `teamId/teamShared/evaluationShared`, resource versions; match/shortlist status and notes                                                                  | Resource-scoped intent/lifecycle, constrained by owner/team authority and consent                                                     |
| `Invitation.role/teamId/status/expiresAt/invitedBy/acceptedBy`, invitation token                                                                                                              | Invitation resource-scoped lifecycle; token is secret and omitted from the new directory                                              |
| Application submitted consent, retained resume/portfolio evidence, status/history                                                                                                             | Resource-scoped Developer consent and immutable ownership contract                                                                    |

The existing Admin preferences endpoint is an organization presentation editor.
No personal Admin-security preference model was found or created.

The proposed single-document approach was implemented. `Organization.governance`
contains `version` (initially zero) and the eight fixed booleans below. Display
metadata uses the existing Organization document, alongside its existing name and
description. New fields are industry (100 characters), website (500), timezone
(100), and `branding.logoUrl` (500). Empty strings clear optional values; timezone
must be accepted by the runtime's IANA timezone implementation. Website and logo
URLs must use HTTPS and have no credentials, query strings or fragments. The API
does not fetch remote URLs or accept branding uploads, CSS, secrets or arbitrary
branding fields. Name remains 2–80 characters; description remains at most 500.

| Authority                                                                  | Platform controls                      | Organization configuration                                                                                             | Recruiter resources / membership                                                                                                                       |
| -------------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Platform Super Admin                                                       | Existing platform APIs only; unchanged | No bypass of the new Admin API                                                                                         | Existing platform support and exact organization ownership contracts stay unchanged; no new support grants                                             |
| Admin account + exact organization owner or active direct Admin membership | Read only safe limit/usage summary     | May read/edit versioned organization configuration; suspended organization or disabled direct membership denies access | Existing organization Admin management and recovery remain                                                                                             |
| Admin account with affiliation only                                        | No new authority                       | Denied new governance/directory APIs                                                                                   | Existing Admin Console resource operations retain accepted authority; no new role escalation                                                           |
| Organization owner without Admin account role                              | No new authority                       | Denied by account-role boundary                                                                                        | Existing tenant ownership semantics remain; ownership is not a platform/account role                                                                   |
| Direct organization manager                                                | None                                   | No editing                                                                                                             | Existing tenant team creation and membership assignment remain subject to `managerTeamAdministration`; only assign roles allowed by existing hierarchy |
| Team manager / team membership Admin                                       | None                                   | No editing                                                                                                             | Only existing active exact-team grants; restrictions may remove metadata/evaluation access or management                                               |
| Team member                                                                | None                                   | No editing                                                                                                             | Read only existing explicitly shared resources, subject to policies and live consent                                                                   |
| Recruiter creator                                                          | None                                   | Informational capabilities only                                                                                        | Own jobs/evaluations, allowed mutations and matching subject to policies; private application evidence stays creator-only                              |
| Developer                                                                  | None                                   | None                                                                                                                   | Existing consent, discovery visibility, applications and withdrawal; team policies never convert private evidence into public consent                  |

No account roles, ownership fields, suspension flags, identifiers, slug, integration
secrets, platform fields, limits or arbitrary grants can be updated through either
configuration endpoint. Unknown top-level and nested fields are rejected. The
existing unique slug index is preserved. New directory access uses the same exact
Admin authority as configuration, rather than the legacy public Developer directory.

## Supported policy catalog and enforcement matrix

Every entry has type **boolean**, supported values **true/false**, default **true**,
and the same authorized editor: an active Admin account with exact ownership or
active direct Admin membership. Every update requires `expectedVersion`. A policy
can remove an existing grant; `true` never grants a missing role, ownership, active
membership, team state or Developer consent. Platform Recruiter access is checked
again from Mongo inside protected Recruiter transactions. Candidate visibility
also constrains matching and existing candidate consent checks continue unchanged.

| Stable identifier                 | Applicable authority and effect                                                                                                                                                                | Backend boundaries / HTTP endpoints                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `recruiterJobCreation`            | Recruiter accounts, including Recruiter team managers: deny new jobs; retain existing owner work                                                                                               | Hub `POST /api/recruiter-hub/jobs` / `createRecruiterJob`; compatibility `POST /api/recruiter/job` / `createJob`. Compatibility service uses the same Recruiter access transaction. Existing Admin job creation is separate Admin authority.                                                                                                                                                                                                           |
| `recruiterJobPublication`         | Any Recruiter with existing management permission: deny setting `published=true` on a previously unpublished job, creating a published job, or reopening an already published closed/draft job | Hub create/PATCH job service; compatibility `PUT /api/recruiter/job/:id` cannot reopen an existing published job. The old compatibility API still cannot set the publication flag at all. Ordinary editing, closing, archiving and unpublishing remain available.                                                                                                                                                                                      |
| `teamSharedJobs`                  | Creator cannot explicitly enable sharing while disabled; all non-owner team grants are masked on existing jobs                                                                                 | Job service create/PATCH; `recruiterJobAccess.permissions`; Hub job list/detail/PATCH/archive/delete authorization; dependent match and shortlist job resolution. `GET /api/recruiter-hub/jobs/:id` gives non-owners 404 after withdrawal.                                                                                                                                                                                                             |
| `sharedPublicEvaluations`         | Creator cannot explicitly enable evaluation sharing; non-owners cannot access already shared public evaluations                                                                                | Job create/PATCH; `recruiterEvaluationAccess.jobs/authorize`; all Hub match list/detail/generation/status and public shortlist create/list/PATCH/DELETE operations, including direct IDs. Metadata can remain shared separately.                                                                                                                                                                                                                       |
| `teamManagerEvaluationManagement` | Existing non-owner Recruiter team managers and membership Admins become read-only for shared evaluations                                                                                       | `recruiterJobAccess.permissions.evaluationManage` and `recruiterEvaluationAccess.authorize` cover shared match generation/status and shortlist create/update/delete. Creator management remains available.                                                                                                                                                                                                                                             |
| `candidateMatching`               | Recruiter creator and already-authorized shared-evaluation managers cannot generate new scores/rankings; historical access remains                                                             | Hub `POST /matches/generate` / `generateRecruiterMatches`; compatibility `POST /match` / `matchCandidatesToJob`; compatibility `POST /ai-rank` including inline jobs/candidates / `rankRecruiterCandidates`; Hub `POST /comparison` with a job / `compareCandidates`. Non-job comparison and ordinary discovery remain available. This is deterministic ranking, not a new provider/AI entitlement. Existing Admin ranking authority remains separate. |
| `invitationCreation`              | Existing authorized inviters cannot create or resend invitations; any pending recipient cannot accept while disabled                                                                           | Admin `POST /invite-recruiter` and `/recruiter`; tenant organization invitation POST; Admin resend; shared `claimInvitation` covers authenticated acceptance by ID/token, public tenant onboarding, and `/api/auth/accept-invite`. Revocation/expiry remain available. Direct Admin account provisioning is an existing separate management operation, not invitation creation.                                                                        |
| `managerTeamAdministration`       | Existing direct organization managers cannot create teams or assign membership roles; team-manager status alone grants neither operation                                                       | Tenant organization team POST inside capacity transaction; tenant membership-role PATCH inside the shared organization transaction. Existing Admin Console team operations and exact organization Admin tenant recovery remain available.                                                                                                                                                                                                              |

Admin and Recruiter route families expose capabilities, and job responses retain
the existing resource-specific `access` booleans, now reduced by effective policies.
Policy errors carry a stable capability and `organization_policy` reason; platform
denials carry `platform_policy`. Resource access can still deliberately return
404 to avoid disclosing a non-owner's resource. The capability endpoint plus job
access flags lets the frontend distinguish policy constraints from missing role
or ownership without exposing another user's resource existence.

Organization-level and team analytics retain their accepted aggregate reporting
contracts. They return metrics, not shared job/evaluation records or private
applicant evidence. These policies do not redefine reporting visibility. Public
Developer discovery and independently published Developer-facing job discovery
also remain independent of Recruiter collaboration policy.

## Transitions, revocation and concurrency

| Existing state                               | Restriction transition                                                                                                                                                                                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Published jobs                               | Remain published and discoverable under the existing Developer job contract. Future publication/reopening by Recruiters is blocked; closing/unpublishing is still possible. No approval workflow is promised.                                                                                     |
| Draft jobs                                   | Retained and editable by existing authorized actors; new creation and future publication follow separate flags.                                                                                                                                                                                   |
| Team-shared jobs                             | Stored sharing intent remains. Effective non-owner grants disappear immediately on subsequent authorization; owner access remains. Re-enabling the policy restores only still-valid stored sharing intent and live team grants.                                                                   |
| Shared public evaluations / existing matches | Retained. Sharing withdrawal hides them from non-owners across list and direct-ID paths. Manager-management withdrawal makes existing team management read-only. Matching withdrawal blocks generation/ranking rather than historical owner review.                                               |
| Historical shortlists                        | Retained with existing notes/status. Public shared shortlists follow live evaluation grants and consent; jobless personal rows remain personal. Application-origin rows keep their accepted independent creator-only contract.                                                                    |
| Submitted applications                       | No transfer, deletion, ownership or consent change. Immutable submitted evidence remains retained and creator-only; Developer withdrawal remains governed by the existing application service.                                                                                                    |
| Pending invitations                          | Retained; creation/resend and all acceptance routes check the effective flag. Re-enabling permits acceptance only if still pending/unexpired, inviter authorized and capacity available. Explicit revoke retains a revoked lifecycle record on the tenant revoke endpoint instead of deleting it. |
| Active memberships / sessions                | No automatic deactivation, role change or token rewrite on policy changes. Live checks remove prohibited operations; existing membership status and session revision checks continue to deny revoked access.                                                                                      |
| Existing utilization above platform limits   | No account deactivation or team deletion. Existing capacity services reject additional creation/activation/acceptance. There is no organization quota-update API.                                                                                                                                 |

Configuration, capacity and protected Recruiter operations write the same
Organization document in transactions. A restriction committed before a protected
operation acquires its fence is observed on its transaction retry. An operation
that holds the fence can complete before a rival restriction commits; subsequent
operations then fail. Responses already authorized and delivered cannot be recalled.
Database reads for grants are transaction/request-local; no organization-policy
permission cache or process-local grant cache was introduced.

Policy/general/preference edits increment one shared `governance.version`.
Missing/invalid expected versions return 400; mismatched versions return 409. Rival
updates cannot silently merge or overwrite stale forms. Internal security fence
writes and ordinary capacity timestamps do not increment this public version.
The preference compatibility endpoint updates only explicitly supplied dashboard
fields, retains its existing response contract, and returns `governanceVersion`.

Platform limits now get authoritative transaction-local reads within team capacity,
Recruiter invitation/provisioning/activation and invitation acceptance. The existing
capacity serialization is reused; no counters, lower quotas, seat reservations or
deactivation semantics were added. Pending invitations still do not reserve seats.

External delivery is outside database transactions. A resend is authorized at its
transaction boundary, before provider invocation. Previously authorized in-flight
or queued deliveries may finish after a restriction; their invitations still cannot
be accepted while restricted. This flag does not promise recalling an email or
canceling already-authorized delivery jobs. No external provider is used in tests.

## API contracts for the Admin Control Center

All routes require authenticated active accounts and existing organization context.
Clients never choose a target organization through the configuration request body.

| Route                                                                    | Contract                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin-console/governance`                                      | Exact Admin authority; `{ organization: { _id, name, slug, description, industry, website, timezone, branding: { logoUrl } }, version, policies, resources: { limits: { activeRecruiters, teams }, usage: { activeRecruiters, teams, activeTeams }, editable: false }, catalog, defaultTimezone }`. No platform secrets or private application details.                                                             |
| `PATCH /api/admin-console/governance`                                    | `{ expectedVersion, general?: { name?, description?, industry?, website?, timezone?, branding?: { logoUrl } }, policies?: { <supportedId>: boolean } }`; nonempty patch. Returns `{ organization, version, policies }`. 400 invalid fields/types; 403 authority/policy; 409 stale configuration; 500 failed persistence/audit.                                                                                      |
| `GET /api/admin-console/preferences`                                     | Existing organization/dashboard shape plus `organization.governanceVersion`.                                                                                                                                                                                                                                                                                                                                        |
| `PATCH /api/admin-console/preferences`                                   | Existing `{ name, description, dashboardConfig? }` plus mandatory `expectedVersion`. Same shared authority/version/audit semantics; old clients must refresh and send the version. No generic organization update.                                                                                                                                                                                                  |
| `GET /api/admin-console/members`                                         | Exact Admin authority; `{ members, total, publicDevelopersIncluded: false }`. One user per ID, with accountRole, active flag, owner flag, direct organization membership or null, and separate team membership roles/status/active state. Includes internal disabled members and Admin/Recruiter affiliations; excludes public Developer talent without internal membership. No account-role mutation API is added. |
| `GET /api/admin-console/invitations?status=…`                            | Exact Admin authority; pending/accepted/expired/revoked, role, team association, inviter/recipient references and timestamps. Token omitted. Expired pending rows are represented as expired without mutating history. Existing accepted lifecycle mutation routes are reused.                                                                                                                                      |
| `GET /api/admin-console/capabilities`                                    | Informational current actor capabilities and version. Does not grant governance authority.                                                                                                                                                                                                                                                                                                                          |
| `GET /api/recruiter-hub/capabilities`, `GET /api/recruiter/capabilities` | Informational `{ version, capabilities: { <id>: { allowed, reason: null                                                                                                                                                                                                                                                                                                                                             | 'organization_policy' | 'platform_policy' | 'role_or_ownership', resourceChecksRequired } } }`. Available to an otherwise authorized Recruiter even when the platform Recruiter kill-switch is off, so the frontend can explain the restriction. |

Capabilities describe action prerequisites for the current actor, not a promise of
access to every resource. `resourceChecksRequired=true` means existing job access,
team membership, ownership and consent checks still apply. For a specific loaded
job, combine these prerequisites with the returned `access` flags. A false resource
access flag with an otherwise allowed policy means the role/ownership grant is
missing; a record that cannot safely be disclosed still returns 404. Backend
authorization independently runs on every protected operation, including stale UI
requests and direct HTTP calls. Clients must handle both 403 and 404 without
inferring resource existence.

## Audit, notifications and compatibility

One `ORGANIZATION_CONFIGURATION_UPDATED` audit event is appended atomically with
each successful general/policy/preference mutation. It contains actor, exact
organization, fixed route/method, timestamp, old/new version, and old/new boolean
policy values keyed by stable identity. Changed general/dashboard fields are
identified but values are `[REDACTED]` to keep arbitrary free text and URLs out of
security evidence. No passwords, tokens, evidence snapshots or integration secrets
are stored. Audit persistence failure aborts the configuration mutation. Failed
configuration changes never produce a successful configuration audit.

The existing asynchronous request audit contract remains best effort and does not
roll back unrelated operations. Successful configuration handlers mark their
transactional audit as recorded; middleware omits raw governance/preference payloads
for failures too, avoiding duplicate or unredacted free-form configuration audits.
Historical audit records are never rewritten. No policy-change notification was
added: the next authorized operation and capability refresh explain the change,
and there is no justified recipient/navigation workflow in this backend phase.

Existing organizations need no migration: absent subdocuments/flags read as enabled
and version zero. New documents receive validated defaults. Mongo updates target
only requested paths and the version. No production or populated local database
was used for mutations or test fixtures. No dependencies or public application
ownership schemas were changed.

## Frontend work and P1.6C.2 requirements

Implemented shared typed models and an injectable governance API client under
`frontend/src/app/shared/models` and `shared/services`. Existing Admin preference
forms now submit the loaded governance version; the service contract carries it.
An Angular regression asserts version forwarding. Existing Recruiter job `access`
flags automatically reflect server restrictions. No new visual settings workspace
or redesign was implemented in P1.6C.1.

P1.6C.2 must:

1. Build modules for General, Recruitment Policies, Resource Usage, Members and
   Invitations using the existing API client and exact authority checks.
2. Load versions with forms, send `expectedVersion`, and on 409 reload the current
   configuration and require review rather than silently retrying a stale patch.
3. Display read-only platform limits and both total/active team usage; never offer
   unsupported quota editing, ownership transfer, suspension, custom roles or
   application sharing.
4. Distinguish account roles, direct organization roles, owner identity, team roles,
   account activity, membership status and pending invitations in the directories.
5. Refresh Recruiter capabilities on entry/account or organization change and after
   policy/permission failures. Use both action prerequisites and per-job access
   flags; avoid storing grants across sessions. Labels must explain platform versus
   organization versus role/ownership constraints.
6. Show transition explanations before submitting a restriction: existing published
   jobs stay published; shared access is withdrawn; history is retained; pending
   invitations cannot be accepted. Re-enabling sharing may restore existing intent.
7. Wire invitation workspace actions to accepted create/resend/revoke/expire routes,
   expose actual delivery results, and never request or retain invitation tokens
   merely to display the directory.
8. Cover stale forms, authority changes, loading/error states, keyboard access,
   responsive layouts and cross-role browser acceptance without changing Developer
   consent or private application ownership.

Deferred decisions: job approval workflows, custom platform roles/grants, per-org
commercial quotas, automatic bulk unpublishing or membership deactivation, permanent
erasure of stored sharing intent, notification/email recall, brand uploads and
advanced branding, directory pagination/search at scale, and the P1.6C.2 visual
workspace. None is exposed as a working toggle in this phase.

## Verification and finalization

Final command results, concurrency/failure-injection evidence, limitations, cleanup
and exact changed/moved/deleted paths are retained in `IMPLEMENTATION-REPORT.md`,
`file-inventory.json`, `formatting.json` and the final test outputs in this folder.
The user confirmed concurrent navbar changes; they are preserved and excluded from
the governance source inventory. No Git integration or production operation is part
of this task.
