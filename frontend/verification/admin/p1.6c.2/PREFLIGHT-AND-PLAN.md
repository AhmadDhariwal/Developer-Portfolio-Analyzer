# P1.6C.2 preflight and implementation plan

Authorized source/current branch: `admin/ui`. HEAD:
`229c7cfbefefed4c7c8ba2db63b454e1265e7e67`. Integration target: not applicable.
No staging, commit, push, merge, or deployment is authorized.

The independent P1.6C.1.1 acceptance report is PASS and its five correction-file
hashes match the current working tree. Original P1.6C.1 reports remain historical
evidence. P1.6B independent acceptance and P1.6B.1 implementation/closure evidence
were inspected; no separate P1.6B.1 independent report exists in this checkout.
The explicit entry gate is the passing independent P1.6C.1.1 security acceptance.

## Existing route and component inventory

| Current route | Current component | Planned treatment |
| --- | --- | --- |
| `/app/admin/dashboard` | AdminDashboardPageComponent | Retain; verify dashboard preferences |
| `/app/admin/console?tab=overview` | AdminConsolePageComponent | Alias to organization overview |
| `/app/admin/console?tab=teams` | AdminConsolePageComponent | Alias to existing Teams module |
| `/app/admin/console?tab=recruiters` | AdminConsolePageComponent | Alias to existing Recruiters module |
| `/app/admin/console?tab=invitations` | AdminConsolePageComponent | Alias to dedicated invitations |
| `/app/admin/console?tab=preferences` | AdminConsolePageComponent | Alias to General Settings |
| `/app/admin/console?tab=activity` | AdminConsolePageComponent | Alias to existing Activity Logs |
| `/app/admin/console/performance-statistics` | AdminPerformanceComponent | Preserve alias; canonical performance route |
| `/app/admin/recruiters` | AdminRecruitersPageComponent | Reuse existing details and mutations |
| `/app/admin/teams` | AdminTeamsPageComponent | Reuse existing team mutations |
| `/app/admin/jobs` | AdminJobsPageComponent | Retain |
| `/app/admin/developers` | AdminDevelopersPageComponent | Retain global talent discovery |
| `/app/admin/activity-logs` | AdminActivityLogsComponent | Extend supported configuration presentation |

The existing Console implementation will be retained as a documented legacy
cleanup candidate. No existing component deletion is planned. The sidebar already
supports accessible collapsible groups and mobile navigation. Navbar changes are
preexisting; additions will be restricted to Admin destination/search metadata.

## Plan including finalization

1. Capture source/index baseline and preserve existing staged changes and prior QA.
2. Implement shared scoped capability/configuration state, policy catalog copy,
   validation, capacity calculations, and unsaved-change protection.
3. Implement Overview, General Settings, Policies, Members, Invitations, and Usage
   pages in existing Admin folders using accepted theme foundations.
4. Update routes/aliases, sidebar, titles/breadcrumbs/search, and quick actions.
5. Integrate action-specific Recruiter and Team policy behavior without changing
   backend authority, resource grants, or private-application semantics.
6. Add permanent rendered regression tests; run focused tests and TypeScript.
7. Run compiled Angular with real Express and disposable MongoDB only, retain
   screenshots and operational/concurrency/security smoke evidence.
8. Format exact changed files in write mode then check mode, remove only verified
   task-owned obsolete temporary files, rerun relevant validation, run the full
   Angular suite once and production build, check both Git diffs for whitespace,
   verify source/index preservation, and retain an exact implementation inventory.

No new dependencies, backend permission semantics, platform settings controls,
private evidence grants, commercial quotas, or external providers are planned.
Stitch is unavailable in the enabled tool inventory; use the accepted design
system directly.
