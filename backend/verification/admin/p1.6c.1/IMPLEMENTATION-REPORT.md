# P1.6C.1 implementation and verification

Implemented on `admin/ui`, as explicitly authorized instead of `fix/admin`.
Initial and final source HEAD: `229c7cfb`. PR target: not applicable. Initial
worktree/index were clean. No staging, commits, pushes, merges, production changes,
deployment, dependency upgrades or migrations were performed.

## Delivered behavior

- One versioned Organization configuration source with eight enforced boolean
  restrictions; absent policies retain the accepted enabled behavior.
- Validated organization metadata, immutable settings identifiers and slug,
  read-only platform limits/current usage, and exact configuration authority.
- Current and compatibility Recruiter enforcement for job creation/publication,
  existing job/evaluation sharing, manager evaluation management and matching.
- Invitation creation/resend/pending acceptance restrictions across all accepted
  routes, plus subordinate organization-manager team administration.
- Atomic configuration/audit transactions and mandatory expected versions, including
  the existing preference editor. Audit failure rolls back configuration.
- Authorized deduplicated internal-member and invitation lifecycle directories;
  safe effective-capability APIs; shared frontend types/API client and preference
  version propagation. The visual Control Center remains P1.6C.2.
- Accepted application ownership, retained private evidence, Developer withdrawal,
  consent, support authority and historical records remain intact.

The complete current-state field inventory, data-model decision, authority matrix,
supported policy catalog, endpoint matrix, transition/revocation rules, API contracts,
frontend requirements, compatibility implications and deferred decisions are in
[GOVERNANCE-ARCHITECTURE.md](GOVERNANCE-ARCHITECTURE.md).

## Verification results

| Verification                                                                                                                                              | Result                                                                                                                                                                                                                                                                                                                 | Retained evidence                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Existing focused Admin scope/analytics, Recruiter HTTP, team sharing/evaluations, audit serialization, support authority and compatibility ranking checks | 53 passed. Two other suites failed only during sandbox Mongo startup and were successfully rerun below. No assertion failure in these 53 checks.                                                                                                                                                                       | `focused-regressions-sandbox.tap`                                        |
| Final governance, Admin security closure and tenant audit                                                                                                 | **32 passed, zero failed/skipped**. Includes 21 governance checks covering isolation/defaults, exact authority, schema/input validation, optimistic concurrency, audit failure rollback, both policy/mutation orderings, legacy/current enforcement, revocation, transactional capacity and retained private evidence. | `governance-final.tap`, `raw-audit-inspection.json`                      |
| Private application concurrency, identity integrity, shortlists and withdrawal/status workflow                                                            | **25 passed, zero failed/skipped**.                                                                                                                                                                                                                                                                                    | `application-regressions.tap`, generated application evidence JSON files |
| Governance repeated after cleanup and final formatting                                                                                                    | **21 passed, zero failed/skipped**.                                                                                                                                                                                                                                                                                    | `governance-post-cleanup.tap`                                            |
| Full Angular command: `npm test -- --watch=false`                                                                                                         | 848 tests: 844 passed initially; three Developer tests timed out and one concurrent-navbar test reported an expression-change error. Every initial failure passed in the focused reruns below. A second full suite was deliberately not repeated.                                                                      | `frontend-tests.log`                                                     |
| Focused Developer retry                                                                                                                                   | **64 passed** across Career Sprint, GitHub Analyzer and Resume Analyzer; no source modifications in these modules.                                                                                                                                                                                                     | `frontend-developer-retry.log`                                           |
| Final Admin preference and current navbar tests                                                                                                           | **20 passed**, including version forwarding. Concurrent navbar edits were preserved; this task did not fix or rewrite them.                                                                                                                                                                                            | `frontend-admin-final.log`                                               |
| App TypeScript compiler                                                                                                                                   | **Passed**, repeated after cleanup: `node frontend/node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.app.json`.                                                                                                                                                                                            | `static-checks.json`                                                     |
| Production build                                                                                                                                          | **Passed**, repeated after cleanup with a task-specific temporary output directory. Three budget warnings remain below.                                                                                                                                                                                                | `frontend-build-final.log`                                               |
| Formatting                                                                                                                                                | Installed Prettier ran in write mode, then check mode, on all **32 task source files** using the same per-group options. Documentation/evidence JSON also formatted and checked. User navbar files excluded.                                                                                                           | `formatting.json`                                                        |
| JavaScript syntax                                                                                                                                         | **27 files passed** `node --check`.                                                                                                                                                                                                                                                                                    | `static-checks.json`                                                     |
| Git whitespace/index                                                                                                                                      | `git diff --check` and `git diff --cached --check` passed. No staged files.                                                                                                                                                                                                                                            | `static-checks.json`                                                     |

The first Mongo failures were diagnosed as sandbox-denied loopback connections
(`connect EACCES 127.0.0.1`), rather than application assertions. Final database
runs were automatically approved outside that sandbox and used isolated disposable
replica sets exclusively. The populated local `aianalyzer` database was not used.
The fixture now provides bounded startup diagnostics and an optional readiness
window, retaining its default. No external email/provider delivery was invoked.

The 53 existing checks, 32 final governance/Admin/tenant checks and 25 application
checks represent 110 passing backend checks across the focused runs. The additional
post-cleanup 21-check run repeats governance coverage and is not added to that total.
Angular results are reported as the full run plus focused retries, not as a claimed
single fresh 848/848 run.

## Finalization and exact file inventory

All changed source files follow existing module folders and have been formatted.
No source file was moved or deleted. No new configuration collection, arbitrary
role/grant model, quota schema or application-evidence ownership path was added.

The exact absolute paths, modification/new-file classification and excluded
concurrent user files are in [file-inventory.json](file-inventory.json). There are
32 task source files: 26 modified and six new. Verification artifacts are listed
separately in that inventory.

Cleanup removed 28 files from the interrupted task-owned disposable Mongo fixture,
after verifying its process had exited and its database lock was free. It also
removed two redundant task receipts (an empty typecheck log and a build-path receipt).
Two task evidence files were renamed to accurately identify sandbox-failed runs.
Exact deleted and renamed paths are retained in `interrupted-fixture-cleanup.json`
and `cleanup.json`; no recursive directory deletion or destructive Git cleanup was
used. Final screenshots, source assets, licenses and user files were not deleted.
Build outputs used temporary sandbox directories; final logs are retained.

The application test wrapper saved this run's evidence separately and restored
three historical reports byte-for-byte; SHA-256 verification is retained in
`historical-evidence-preservation.json`. The earlier Admin test's historical report
also has no final diff. No historical audit database records were modified.

The four concurrent navbar files were confirmed as user work and remain outside
the governance change inventory. No abandoned task scripts, duplicate screenshots,
traces or unneeded repository test databases remain. Final relevant tests,
typecheck, build, formatting and whitespace checks were run after cleanup.

## Remaining issues and deferred scope

The build succeeds with three warning-budget overruns:

- Initial bundle: 4.19 MB against a 4.00 MB warning budget (186.81 kB over).
- Developer Jobs stylesheet: 54.40 kB against 48.00 kB (6.40 kB over).
- Public portfolio stylesheet: 49.97 kB against 48.00 kB (1.97 kB over).

No unresolved test failure remains among the full run's failed tests after focused
retries. No database tests were skipped. No new dependency, migration or external
provider prerequisite was introduced; the existing transaction-capable MongoDB
deployment remains required. Deployment and any production initialization remain
outside authorization.

Policies deliberately do not recall already-authorized/queued email deliveries,
retroactively unpublish jobs, erase stored sharing intent, delete history, transfer
private applications or automatically deactivate memberships. Per-organization
commercial quotas, approval workflows, custom roles, advanced branding, directory
pagination and the visual P1.6C.2 Control Center remain deferred and are not exposed
as operational settings.
