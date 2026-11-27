# P1.6C.1.1 independent security re-acceptance — PASS

Date: 27 November 2026, Asia/Karachi. Authorized branch: `admin/ui`.
HEAD: `229c7cfbefefed4c7c8ba2db63b454e1265e7e67`. PR target: not applicable.

**Verdict: PASS. F1 is closed for the tested working-tree snapshot.** All four
invitation acceptance routes reject an explicitly revoked inviter with HTTP 403.
Independent persisted-state checks found no unauthorized account creation,
organization affiliation, membership, Recruiter role, session-revision change,
JWT issuance, returned token, or authentication cookie. Disabling and re-enabling
`invitationCreation` does not restore the revoked authority. All 37 original
governance acceptance subtests and the selected security regressions pass.

This acceptance was performed after implementation, without modifying application
source or existing tests. The existing correction test was reviewed and run as
supporting regression evidence; the verdict also relies on a separately authored
four-route test and freshly executed original independent QA harnesses. This is
P1.6C.1.1 acceptance only. P1.6C.2 was not started.

## Tested revision and preservation boundary

The tested source includes uncommitted changes on the HEAD above; it is not the
clean HEAD tree. `baseline.json` records individual SHA-256 hashes for 19,276
preexisting files, the Git status, and working/index diff hashes. The correction
source and test hashes are also extracted in `acceptance-results.json`.

| Existing corrected file, unchanged by this QA                               | SHA-256                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `backend/src/modules/admin/controllers/recruiterController.js`              | `64932e9720a6206d9e4847fdc98ef6efddf025c2e6ba0231c04dcc418b36a19a` |
| `backend/src/modules/admin/controllers/tenantcontroller.js`                 | `aa3ad4dee387ad97662671684b85350b33d48f3a67679957003c89b1a6fa5924` |
| `backend/src/modules/admin/services/invitationAcceptanceService.js`         | `9f0889d17652e17232483311fd675d698db7d0f3c38309c26ae4b75c22718fa7` |
| `backend/src/modules/admin/services/organizationGovernanceService.js`       | `4e39977667fba667d9b85ca8245d0fdfcd349ffe55a2031cf5a77cd048f24b88` |
| `backend/src/tests/admin/invitationAuthorityRevocation.integration.test.js` | `1d356e08f4173fba0ac321885fb19eb4c863c4a874f8ab78d24284f5cbbd7b0a` |

Initial preflight showed four files with staged and unstaged changes and the
correction regression test as untracked. By the successful hash-baseline capture,
those changes had become staged. This task issued no staging or other Git mutation
commands. Preservation assertions compare against that successful captured
baseline; they do not claim the index stayed unchanged before its capture.
`file-preservation.json` records the final comparison, including all four navbar
files and the original P1.6C.1 QA reports/evidence.

No application source, existing test, historical report, or navbar file was
formatted or edited by this QA. No commit, push, merge, deployment, production
configuration change, demonstration-data mutation, or external email was made.

## Reviewed correction and original finding

Reviewed repository `AGENTS.md`, the original
`backend/verification/admin/p1.6c.1/qa/QA-ACCEPTANCE-REPORT.md`, its F1 reproduction
JSON and executable reproduction, the original 37-subtest acceptance harness,
the existing correction regression, and current source changes in the four files
listed above. The historical BLOCKED report remains intact.

The original defect accepted a pending Recruiter invitation after a non-owner
Admin inviter's direct organization membership had been disabled. Affiliation and
account role still satisfied the old check. Original evidence recorded HTTP 200
and committed grants on three acceptance paths after the policy was re-enabled.

The reviewed correction routes invitation claims through
`assertInviterAuthority` and the shared `actorInSession` contract inside the
acceptance transaction. An explicitly non-active direct membership is rejected
before ownership, affiliation, or team membership can supply a fallback.
Active direct-membership authority is protected by a conditional membership write
fence, with its matched count checked. User, organization, platform, recipient,
capacity, invitation status, and expiry checks remain in the accepted transaction
paths. Creation and resend reuse the Recruiter inviter authority contract.

The correction also returns the created Tenant invitation as a plain object from
the transaction callback. No new permission semantics or frontend restriction was
used by this QA to make F1 disappear.

## Independent four-route F1 evidence

`independent-revocation.test.cjs` mounts real Express route families and the real
auth acceptance handler, using real Mongoose models and a fresh disposable MongoDB
replica set. Target invitation APIs, authorization checks, transactions, and
database writes are not mocked. Email delivery is locally stubbed and external
requests are blocked.

The inviter remains an active Admin account affiliated with the organization.
Its direct Admin membership is disabled while a separate active team Admin
membership remains. Existing recipients are verified Developers with no
organization affiliation; public onboarding recipients have no existing account.

| Actual route                                         | Before policy toggle | Policy disabled | Policy re-enabled |
| ---------------------------------------------------- | -------------------: | --------------: | ----------------: |
| `POST /api/tenant/invitations/:invitationId/accept`  |                  403 |             403 |               403 |
| `POST /api/tenant/invitations/accept/:token`         |                  403 |             403 |               403 |
| `POST /api/auth/accept-invite`                       |                  403 |             403 |               403 |
| `POST /api/tenant/invitations/accept/:token/onboard` |                  403 |             403 |               403 |

The fourth route accepts supported organization membership invitations; its
fixture uses role `member`. The auth onboarding route uses a Recruiter invitation.
The two authenticated routes use Recruiter invitations for existing Developers.

Every denial verifies persisted `pending` status, null `acceptedBy`, no recipient
membership or affiliation, unchanged existing Developer role and session revision,
or absence of the prospective new account. Directory-wide User and Membership
counts remain unchanged through all three policy phases. The public governance
version advances from 0 to 2 through the two successful policy updates.

A spy delegates to the real application JWT signer and counts server issuance.
Synthetic request credentials use the previously captured original signer, so
they do not contaminate that count. Denied calls mint zero JWTs, return no token
field or JWT-shaped value, and set no cookie. Successful auth and Tenant
onboarding controls each invoke the same signer spy once and return their token,
confirming the observation is active.

There are 20 independently checked denials: 12 policy-phase requests, four
revocation-first race results, and four acceptance-first follow-up requests.
Exact observations are in `independent-revocation-evidence.json`.

## Transactional race acceptance

Each route was tested in both orderings with separate actors and invitations.
QA instrumentation pauses real collection calls and delegates their operations
unchanged. Competing writes and transaction conflicts use the real MongoDB server.
Final database state, rather than HTTP response order alone, determines the result.

| Route case                | Revocation commits before membership fence   | Acceptance acquires membership fence first          |
| ------------------------- | -------------------------------------------- | --------------------------------------------------- |
| Authenticated ID          | 403; real write conflict; invitation pending | 200; revocation follows commit; next acceptance 403 |
| Authenticated token       | 403; real write conflict; invitation pending | 200; revocation follows commit; next acceptance 403 |
| Auth Recruiter onboarding | 403; real write conflict; no account         | 200; revocation follows commit; next acceptance 403 |
| Tenant member onboarding  | 403; real write conflict; no account         | 200; revocation follows commit; next acceptance 403 |

For revocation-first cases, the pause occurs after the transaction has read the
active direct membership but before its conditional membership write. A standalone
membership status update commits without touching the organization document.
Each acceptance observes one actual MongoDB code-112 write conflict, retries,
re-reads the disabled membership, and returns 403 with no grant.

For acceptance-first cases, the pause follows the successful membership fence
write. MongoDB command monitoring confirms a real competing revocation update was
sent and remained unsettled when the acceptance was released. Acceptance commits
while authority is valid; the waiting revocation then commits. The final inviter
membership is disabled and a subsequent pending invitation cannot be consumed.
This valid earlier acceptance is not rolled back retroactively by a later
revocation.

The existing correction regression separately passes its race checks, including
the supported Tenant membership-role downgrade API ordering.

## Legitimate workflows and retained boundaries

Independent successful controls verify persisted account affiliation, accepted
invitation attribution, and exactly one active organization membership:

| Workflow                                                 | HTTP result | Persisted result                                  |
| -------------------------------------------------------- | ----------: | ------------------------------------------------- |
| Active direct Admin invites existing Developer           |         200 | Recruiter role and organization membership        |
| Exact Admin organization owner, token acceptance         |         200 | Recruiter role and organization membership        |
| Exact Super Admin organization owner, auth onboarding    |         200 | New Recruiter, membership, and one JWT            |
| Legacy affiliated Admin with no direct membership record |         200 | Recruiter role and organization membership        |
| Legacy supported Tenant member onboarding                |         200 | Developer account, member membership, and one JWT |

The existing correction suite additionally verifies actual creation/resend
compatibility, absence of a non-owner Super Admin bypass, inactive/foreign/demoted
inviters, insufficient direct roles, active team membership with disabled direct
membership, suspended organizations, and expired/revoked invitations.

The original governance suite and broader regressions retain organization
isolation, platform precedence, exact owner authority, recipient eligibility,
capacity serialization, one-time consumption, failed-write rollback, redacted
audits, public evaluation consent, and owner-only private application evidence.
Restrictive policies do not prevent legitimate Developer withdrawal.

## Exact fresh test results

All successful runs below have zero failures, cancellations, skips, and TODOs.
Node native TAP totals include aggregate parent tests; leaf counts are identified
separately so parent tests are not presented as additional independent scenarios.

| Retained run                     | Leaf/contract result                                                           | Native TAP result |  Duration |
| -------------------------------- | ------------------------------------------------------------------------------ | ----------------- | --------: |
| `governance-unsandboxed.tap`     | **37/37 original governance acceptance subtests**                              | 38 passed         |  67.912 s |
| `independent-final.tap`          | **10/10 new independent subtests**, including eight race cases                 | 11 passed         |  24.163 s |
| `implementation-unsandboxed.tap` | **4/4 existing correction subtests**                                           | 5 passed          |  24.616 s |
| `original-f1-reproduction.tap`   | Original unchanged F1 reproduction passes; all three historical routes now 403 | 1 passed          |  16.330 s |
| `security-regressions.tap`       | 14 existing test files                                                         | **120 passed**    | 314.034 s |

The five selected final runs total **175 native TAP passes**, including parents;
they are not 175 distinct security scenarios. `*-result.json` files retain exact
Node executable, arguments, timestamps, exit status, and unrounded summaries.
Both copied historical harnesses are byte-identical to their originals, verified
after formatting. No assertions were relaxed, excluded, or skipped.

The 14-file regression command is retained in
`security-regressions-result.json`. Its exact files, relative to the repository,
are:

1. `backend/src/tests/admin/adminScopeAndAnalytics.integration.test.js`
2. `backend/src/tests/admin/adminRegressionClosure.integration.test.js`
3. `backend/src/tests/admin/organizationGovernance.integration.test.js`
4. `backend/src/tests/core/tenantAudit.integration.test.js`
5. `backend/src/tests/core/platformSettingsSession.integration.test.js`
6. `backend/src/tests/recruiter/recruiterHttp.integration.test.js`
7. `backend/src/tests/recruiter/teamSharedJobs.integration.test.js`
8. `backend/src/tests/recruiter/teamEvaluations.integration.test.js`
9. `backend/src/tests/recruiter/applicationWorkflow.integration.test.js`
10. `backend/src/tests/recruiter/applicationShortlists.integration.test.js`
11. `backend/src/tests/recruiter/applicationIntegrity.integration.test.js`
12. `backend/src/tests/recruiter/applicationConcurrency.integration.test.js`
13. `backend/src/tests/jobs/jobApplications.integration.test.js`
14. `backend/src/tests/core/applicationEvaluationRequestLogging.test.js`

## Environment failures and limitations

- Initial sandbox runs of the governance harness, independent extension, and
  existing correction suite each failed during fixture startup with
  `connect EACCES 127.0.0.1`. They executed no target assertions. Their raw TAP and
  result files remain retained as `governance-rerun.*`,
  `independent-revocation.*`, and `implementation-revocation.*`. Automatically
  approved execution outside the sandbox resolved loopback access. The same
  disposable fixture, external-request guards, and assertions were used.
- An early coordinator attempt preceded the successful baseline and failed to
  locate the not-yet-copied test. `original-governance.*` retains that diagnostic;
  it is not counted as application acceptance. The coordinator buffer limit was
  raised for the large existing staged diff. An initial preservation scan was
  interrupted and replaced with a scan excluding preexisting disposable database
  directories; none of their contents was changed or deleted.
- The broader regression TAP contains one
  `Audit log write error: Operation interrupted because client was closed`
  message near Tenant audit fixture teardown. The Tenant audit test independently
  verifies one persisted scoped/redacted audit and passes. The unchanged fixture
  does not explicitly drain every asynchronous middleware write before disconnect;
  teardown timing is the likely explanation, not an independently proven root
  cause. This warning is retained and is not reported as resolved. The original
  governance acceptance records zero unexpected audit errors and passes
  transactional audit rollback/atomicity checks. No F1 grant or missing required
  configuration audit was observed.
- Expected restriction logs, deliberate fault-injection errors, and existing
  Mongoose `new`-option deprecation warnings remain visible in raw TAP. No paid AI
  or external integration provider was invoked. Provider missing-key logs reflect
  disabled providers, not attempted external work.
- These are local synthetic replica-set tests. They do not establish distributed
  multi-node failover behavior, exhaustive scheduling coverage, or production
  contention guarantees. No production or populated `aianalyzer` data was used.
- No Angular suite, browser acceptance, frontend build, or visual review was
  repeated for this backend security re-acceptance. Historical frontend results
  are not represented as fresh evidence. P1.6C.2/P1.6C.3 UI work and acceptance
  remain outside this task.

## Finalization and retained inventory

Only this new `backend/verification/admin/p1.6c.1.1/qa/` evidence directory was
created by the task. `qa-file-inventory.json` lists every exact absolute created
path. No preexisting file was moved or deleted. Raw failed attempts, successful
TAP, hashes, redirected regression evidence, and executable QA harnesses are
retained because they support this report.

QA scripts were formatted in write mode with the installed
`frontend/node_modules/prettier/bin/prettier.cjs`, followed by checks of the same
explicit paths. Existing correction source/test formatting was checked read-only
with its established single-quote, 100-column, no-trailing-comma options. All five
files pass. `static-checks.json` records 37 successful checks: formatting of the
five QA scripts and five correction files, syntax for 28 changed backend source
JavaScript files and five QA scripts, and working/index Git whitespace checks.
Report and JSON formatting are finalized separately using explicit paths.

`cleanup.json` records **18 started/stopped disposable fixture pairs**, all with
absent database directories after shutdown, and 4,150 task-owned temporary
database files removed by their fixture's bounded exact-path cleanup. The three
sandbox startup failures use the inspected original fixture's awaited stop-on-error
path. No recursive directory deletion or cleanup of preexisting temporary
directories was performed by this QA.

The final source/history hash and Git diff comparisons are retained in
`file-preservation.json`: **19,276 files unchanged, zero added files outside this
QA directory, unchanged index diff, unchanged working diff, unchanged branch and
HEAD** relative to the captured baseline. Successful tests bind to the recorded source snapshot;
later source changes require their own relevant validation. This report supplies
the independent F1 closure evidence requested for P1.6C.1.1 and stops at that
acceptance boundary.
