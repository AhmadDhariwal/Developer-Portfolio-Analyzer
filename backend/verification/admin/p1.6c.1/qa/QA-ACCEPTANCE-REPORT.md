# P1.6C.1 independent acceptance — BLOCKED

Date: 27 November 2026, Asia/Karachi. Branch: `admin/ui`. HEAD:
`229c7cfbefefed4c7c8ba2db63b454e1265e7e67`. PR target: not applicable.

**One independently reproduced security defect blocks acceptance.** A pending
Recruiter invitation remains consumable after its non-owner Admin inviter's direct
organization membership is disabled. Creation and resend correctly deny that
inviter, but all three Recruiter acceptance paths still commit the account-role
grant after `invitationCreation` is re-enabled. No application-source fix was made.
P1.6C.2 was not started.

## Blocking finding F1 — revoked inviter authority survives pending acceptance

Severity: **P1**. Actual HTTP and final MongoDB state were reproduced in multiple
fresh disposable replica sets, including a small reproduction without the larger
acceptance harness's transaction hooks or audit interception.

1. An active Admin account with a direct active Admin membership, but no ownership,
   creates a legitimate Recruiter invitation: HTTP 201.
2. Disable that direct membership while keeping the account active and affiliated.
3. Disable and then re-enable `invitationCreation` through the authorized owner.
   The public governance version advances to 2. Acceptance while disabled returns
   403, as required.
4. The revoked inviter's new creation and resend requests return 403.
5. The recipient consumes the original pending invitation. Expected: 403 with the
   invitation pending and no Recruiter grant. Actual: 200, invitation accepted,
   recipient account role `recruiter` and active organization membership.

| Actual acceptance route                      | Expected |  Actual | Stored recipient role                        |
| -------------------------------------------- | -------: | ------: | -------------------------------------------- |
| `POST /api/tenant/invitations/:id/accept`    |      403 | **200** | recruiter                                    |
| `POST /api/tenant/invitations/accept/:token` |      403 | **200** | recruiter                                    |
| `POST /api/auth/accept-invite`               |      403 | **200** | recruiter, including newly onboarded account |

The account role and affiliation check at
`backend/src/modules/admin/services/invitationAcceptanceService.js:63` makes
`affiliatedAdmin` true without checking the explicitly disabled direct membership.
The shared `claimInvitation` path consequently permits the commit. By comparison,
creation/resend use `actorInSession`, whose disabled-membership guard is at
`backend/src/modules/admin/services/organizationGovernanceService.js:77`.

This is an inviter-revocation failure, not a claim that the disabled policy itself
is bypassable: `invitationCreation=false` consistently blocks acceptance. Re-enable
must restore only still-valid authority, as required by the transition contract.
The reproduction uses a non-owner inviter, so legitimate organization ownership or
Super Admin ownership exceptions do not explain the grant. This QA does not
establish which earlier phase introduced the omission.

Required remediation, outside this QA's authorization: revalidate explicit direct
membership revocation inside the existing acceptance transaction, consistently with
creation/resend. Preserve the accepted account-role, exact ownership, verified
recipient, capacity and cross-organization contracts. Do not solve this by widening
roles or hiding frontend controls. Rerun the three failing paths, ownership
compatibility and the complete relevant acceptance suite before accepting P1.6C.1.

Evidence: `revoked-inviter-reproduction.json`,
`revoked-inviter-multiple-paths.tap`, `revoked-inviter-reproduction.tap`,
`revoked-inviter-first-reproduction.json`, and the failing subtest in
`independent-verified.tap` / `independent-metrics.json`.

## Individual acceptance verdicts

| Area                                 | Verdict                                  | Independently observed evidence                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Governance persistence            | PASS                                     | One Organization subdocument; false values and version persisted across requests, disconnect/reconnect and a separate Node process. No new collection/migration.                                                                                                                                                                       |
| 2. Legacy defaults                   | PASS                                     | Missing governance/version reads as enabled/version zero; partial policies preserve false and default missing flags. First update and competing first updates preserve other organization fields.                                                                                                                                      |
| 3. Configuration authority           | PASS with legacy-read qualification      | Owner Admin and direct active Admin member can edit. Affiliation-only Admin, disabled membership, organization/team manager, team Admin, Recruiter, Developer and Super Admin cannot mutate configuration. Suspended org/stale token deny access. Spoofed context and protected fields do not redirect writes. See legacy reads below. |
| 4. Eight policies                    | Seven PASS; invitation lifecycle FAIL    | Detailed matrix below. The invitation flag enforces its disabled state; F1 fails live inviter authority after re-enable.                                                                                                                                                                                                               |
| 5. Current/compatibility enforcement | FAIL for invitation acceptance authority | Current/compatibility policy gates pass; three acceptance paths reproduce F1. No job/matching bypass was reproduced.                                                                                                                                                                                                                   |
| 6. Effective permission reporting    | PASS with interpretation limits          | Correct version, allowed/reason/resourceChecksRequired, organization/platform/role reasons, no resource IDs or secret settings. Resource flags remain separately required.                                                                                                                                                             |
| 7. Platform precedence               | PASS                                     | Enabled org flags cannot override Recruiter kill-switch or private candidate visibility. Both initialized PlatformSettings-document race orderings verified.                                                                                                                                                                           |
| 8. Configuration concurrency         | PASS                                     | Same-version contenders, general/policy, governance/preferences and first legacy updates give one commit/one 409 and one successful configuration audit. Invalid versions give controlled 400.                                                                                                                                         |
| 9. Policy/protected-operation races  | PASS                                     | Twelve organization-policy orderings plus two platform-document orderings; final committed state verified. F1 is a separate deterministic inviter-membership revocation failure.                                                                                                                                                       |
| 10. Audit atomicity                  | PASS                                     | Exactly one successful configuration event with real middleware; correct actor/org/versions and old/new booleans. Injected audit outage rolls back configuration and version. Existing best-effort audit contract retained.                                                                                                            |
| 11. Sensitive-data protection        | PASS                                     | Synthetic raw audits contain redacted metadata and no synthetic secret canary; invitation directories omit tokens; capability output discloses no private resource IDs. No historical credential values inspected.                                                                                                                     |
| 12. Members directory                | PASS; unpaginated                        | Owners, account roles, direct/team roles, disabled memberships, inactive accounts and multiple teams distinguish correctly; deduplicated totals; public/foreign talent excluded. Measured sizes below.                                                                                                                                 |
| 13. Invitation directory             | PASS                                     | Pending/accepted/expired/revoked filters, team and attribution fields; effective expiry does not change stored pending status. No tokens returned.                                                                                                                                                                                     |
| 14. Capacity preservation            | PASS                                     | Read-only accurate counts, over-capacity population retained, zero-team limit enforced, final seat/team races, reactivation/acceptance and non-reservation covered by fresh regressions. No automatic deletion/deactivation.                                                                                                           |
| 15. Recruiter privacy                | PASS                                     | Submitted bytes/snapshots remain creator-only; sharing transitions neither transfer nor delete evidence. Private application/shortlist/concurrency/integrity regressions pass.                                                                                                                                                         |
| 16. Developer regression             | PASS                                     | Fresh full Angular suite and application workflow/withdrawal/consent/notification regressions pass. Direct withdrawal remains available during restrictive org policies.                                                                                                                                                               |
| 17. Existing frontend compatibility  | PASS within P1.6C.1 scope                | Actual preference methods forward versions, settle loading, use committed responses and preserve edits on 409 without automatic retry. Governance client forwards false/version values. No full Control Center required here.                                                                                                          |

Legacy reads are an explicit qualification: `GET /admin-console/preferences`
returns 200 for an affiliated Admin and for an Admin with disabled direct
membership; its existing response is general/dashboard metadata and version, not
policy editing authority. PATCH returns 403 for both. Informational Admin
capabilities return 200 for affiliation-only Admin, 403 for disabled membership.
New governance/member/invitation reads deny both. The upcoming UI must not equate
legacy preference/capability read access with configuration edit permission.

## Consolidated policy-to-API acceptance matrix

All flags were tested false and true with persisted values, direct HTTP requests,
an unaffected second organization performing the relevant operation, existing
role/ownership constraints, retained history and re-enable behavior.

| Policy                            | Main exercised HTTP boundaries                                                                                       | Off/on and transition result                                                                                                                                                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recruiterJobCreation`            | Hub job POST; legacy job POST; owner PATCH; separate Admin job POST                                                  | PASS. Current and compatibility creation deny Recruiters/managers; existing owner edits and Admin authority remain. Re-enabled creation succeeds.                                                                                                                                |
| `recruiterJobPublication`         | Hub create/publish/PATCH/archive; legacy PUT reopen                                                                  | PASS. New publication and reopening published closed jobs deny; edit/close/archive/unpublish remain; existing published intent retained. Re-enable permits publication.                                                                                                          |
| `teamSharedJobs`                  | Hub job list/detail/PATCH; dependent match detail                                                                    | PASS. Explicit sharing denies; existing non-owner grants/direct-ID mutations disappear. Owner/history/intent remain. Re-enable restores manager access but not a disabled team member.                                                                                           |
| `sharedPublicEvaluations`         | Match list/detail/generate/status; shortlist list/PATCH; job sharing PATCH                                           | PASS. Evaluation grants withdraw while independent metadata remains visible. Private application-origin access remains separate. Re-enable restores only valid team evaluation access.                                                                                           |
| `teamManagerEvaluationManagement` | Match detail/status/generate; shortlist PATCH/DELETE                                                                 | PASS. Manager and team Admin become read-only; members never gain management; owner authority remains. Re-enabled manager mutation succeeds.                                                                                                                                     |
| `candidateMatching`               | Hub generate; legacy match; stored and inline legacy ranking; job-based comparison                                   | PASS. Generation/ranking deny; ordinary discovery, non-job comparison, historical review and separate Admin ranking remain. Adjacent candidate analysis is an available-evidence arithmetic summary, not job matching and does not invoke AI.                                    |
| `invitationCreation`              | Admin aliases; tenant invitation POST; resend; ID/token acceptance; public onboarding; auth compatibility acceptance | **FAIL lifecycle acceptance (F1).** All disabled-state gates pass, revocation/expiry remain, direct Admin provisioning is separate, and re-enable checks expired/revoked/full-capacity/ordinary unauthorized inviters. Disabled direct Admin inviter acceptance is not rejected. |
| `managerTeamAdministration`       | Tenant team POST; membership-role PATCH; Admin Console team boundary                                                 | PASS. Direct org managers deny while disabled; team status alone grants no org-wide authority. Admin recovery and re-enabled manager creation remain valid.                                                                                                                      |

## Exact test results and retained runs

| Run                                  | Result                                                                                                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `existing-regressions.tap`           | **110 passed, 0 failed/skipped**, fresh serial execution of all 14 requested existing test files.                                                                                                                                                |
| `independent-verified.tap`           | **37 acceptance subtests: 36 passed, 1 failed (F1)**. Native TAP includes the failed aggregate parent: **38 tests, 36 passed, 2 failed, 0 skipped**.                                                                                             |
| `revoked-inviter-multiple-paths.tap` | **1 failed security invariant**, independently recording successful grants through all three paths. The failure is intentionally preserved.                                                                                                      |
| `revoked-inviter-reproduction.tap`   | Earlier minimal reproduction in another replica set: the same invariant fails.                                                                                                                                                                   |
| `frontend-full.log`                  | **144 files, 848 tests passed**, one fresh full Angular run with two Vitest workers and normal test timeouts; no exclusions.                                                                                                                     |
| `frontend-preferences.tap`           | **3 passed** executable probes of actual TypeScript method bodies: 409/no retry, successful version/loading behavior, and governance client contracts. Framework view/lifecycle collaborators are mocked; these supplement the full Angular run. |
| `typecheck` / `production-build.log` | TypeScript and production build passed. Three warning-budget overruns remain.                                                                                                                                                                    |
| `static-checks.json`                 | All 32 implementation source files pass configured formatting checks; 27 backend JS files pass syntax; Git working/index whitespace checks pass. No source formatter write was used during QA.                                                   |

All application files and existing tests were left untouched. QA-only harnesses
and evidence are under this `qa` folder. The initial 37-check acceptance pass is
retained in `independent-initial.tap`; the later expanded run exposed F1. A harness
subtest-parent scheduling mistake caused one interrupted diagnostic run; its TAP,
process receipt and exact fixture cleanup are retained separately. A synchronous
child-process restart probe then timed out; replacing that QA mechanism with an
asynchronous, initialized reader resolved it. `independent-final.tap` retains that
earlier harness timeout plus F1; `independent-verified.tap` has only F1. These QA
harness problems are not reported as application defects or silently discarded.

Existing test report writes were redirected before execution into this folder,
including promise-based writes. No historical report was overwritten and restored.
The baseline/final hash comparison covers 1,828 existing source/evidence files,
including all four navbar files. The exact final comparison and QA artifact paths
are in `file-preservation.json` and `qa-file-inventory.json`.

## Transaction, query and operational limits

- Controlled races held real transaction fences, observed the rival write attempt,
  then released the winner. Published-job, evaluation, invitation, matching and
  team/job-creation final MongoDB state was inspected. Operations committing before
  restriction are legitimate; HTTP response order alone was not used as proof.
- The twelve org-policy race observations took approximately 106–708 ms each in
  this run. Observed 3–6 organization-fence calls include retries and logical work;
  they are not a pure transaction-retry counter. No unbounded retry was observed.
  Eight concurrent job creations completed in 2,184 ms; observed p95/max request
  duration was 2,156 ms. This is synthetic local evidence, not a production SLA or
  proof against contention at scale.
- Organization writes serialize policies/capacity/protected operations. Existing
  PlatformSettings documents are also written as transaction fences, so tested
  existing-document platform writes serialize with protected operations. This does
  not promise a single atomic configuration transaction across all platform and
  organization APIs. Absent global settings retain the documented installation
  defaults and have no existing settings document to fence. Legacy platform-cache
  middleware still has its separate availability/propagation contract.
- Read-like governance/capability operations perform internal fence writes. A
  common PlatformSettings fence couples contention across organizations. No
  cross-request permission cache was found; no high-volume multi-tenant latency
  benchmark was performed.
- Member/invitation directories are unpaginated. Synthetic measurements: 10 member
  rows = 3,354 UTF-8 bytes / 125 ms; 210 rows = 60,135 bytes / 233 ms. Four invitation
  rows = 1,302 bytes. Member projection filters membership arrays per user; full
  materialization and sorting are limits at larger populations. No pagination or
  new indexes were implemented during QA.
- Build passes with initial bundle 4.19 MB vs 4.00 MB warning budget, Developer Jobs
  stylesheet 54.40 kB vs 48.00 kB, and public portfolio stylesheet 49.97 kB vs 48.00
  kB. Existing Mongoose `new`-option warnings are also retained. These do not cause
  this blocked verdict.
- Mutations used only disposable replica sets. No populated `aianalyzer`, external
  provider, production system or real invitation delivery was used. Local delivery
  stubs and external-HTTP guards were used. Test fixtures stopped and removed their
  own temporary files; interrupted-fixture cleanup verified exact process/dbpath
  ownership and a free database lock, then removed exact files and empty directories.

## Actual P1.6C.2 requirements

1. Resolve F1 in the backend and repeat acceptance before beginning the UI phase.
2. Treat governance GET authority separately from legacy preferences/capability
   reads. Do not infer edit permission from account role or a visible panel alone.
3. Submit expected versions, preserve edits on conflict, and provide explicit
   reload/review. Never automatically retry a stale patch as an overwrite.
4. Combine actor capabilities with current job/evaluation access flags. Matching
   generation must also check `candidateMatching`; `evaluationManage` remains true
   for allowed historical evaluation edits even when matching is disabled.
   `access.matching` is creator-oriented; it is not a universal substitute for
   shared evaluation generation authority. Use distinct action concepts.
5. Current Recruiter pages generally display backend messages. A revoked shared
   resource may intentionally yield generic 404. Add readable policy labels and
   reason-aware explanations without exposing another user's resource existence;
   refresh capabilities/resources on 403/404/409 and account/org changes.
6. Keep platform limits read-only; distinguish total/active teams, active accounts,
   organization/direct membership status, team roles and account roles. Do not
   introduce role escalation or expose the public talent pool as internal members.
7. Reuse invitation lifecycle routes, derived expiry and actual delivery results.
   List views must never request tokens. Explain pending invitations do not reserve
   seats and that re-enable still requires live inviter authority and capacity.
8. Explain stored sharing intent, immediate grant withdrawal, retained history,
   unchanged published jobs and owner-only private application evidence. Do not
   offer unsupported approval workflows, custom roles, quotas or private evidence
   sharing. Plan for the explicitly unpaginated directory contract.

No source fix, staging, commit, push, deployment, production operation or P1.6C.2
implementation was performed. Acceptance remains **BLOCKED** until F1 is corrected
and the negative acceptance tests pass without broadening authority.
