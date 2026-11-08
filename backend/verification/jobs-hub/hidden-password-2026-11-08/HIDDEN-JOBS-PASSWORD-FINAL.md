# Hidden Jobs — account-password confirmation

## Scope and decision

The user selected **existing account-password confirmation**, replacing the proposed separate alphanumeric MPIN. Existing password rules remain unchanged, including special characters. There is no new credential field, schema, dependency or environment variable.

Authorized branch: `fix/finalize-public-portfolio`; integration target: not applicable. Starting HEAD: `914f812390ba94b324fc78920686d618cc097d94`. No commit, push, merge, deployment, paid provider request or production-data operation was performed.

## Implemented flow and controls

- Hiding a public listing still works without confirmation. Opening Hidden displays the password form and makes no hidden-history request until confirmation succeeds.
- Authenticated `POST /api/jobs/hidden-access/unlock` compares the existing bcrypt password hash. `POST /api/jobs/hidden-access/lock` revokes the current grant. All Jobs routes retain existing JWT protection, owner scoping, validation and no-store headers.
- A random 256-bit grant lasts at most five minutes. The browser keeps it in memory and sends `X-Jobs-Hidden-Token` on action requests. It never writes the password or grant to local/session storage. Redis stores a digest of the grant, bound to owner, exact Bearer token, session revision and current password hash. Password changes and session revocation invalidate previous grants.
- The browser clears the password before waiting for the response. Locking, leaving the view, backgrounding the document, component destruction and account/token changes clear access. A failed server revocation still clears the UI immediately; the server grant retains its original bounded expiry.
- Without a valid grant, Hidden listing requests fail, and ordinary/saved/applied action lists exclude hidden rows. Mutating or unhiding an existing hidden row requires confirmation, including toggle aliases. An atomic Mongo write predicate prevents a concurrent hide from being overwritten by an unconfirmed request. Existing public-row legacy imports carrying `hidden: false` remain compatible. Internal discovery filtering remains intact; hidden detail requests retain their existing 404 behavior.
- Redis Lua supplies a shared per-account ten-request/minute confirmation route limit and a five-attempt/15-minute comparison window. Attempts are reserved before comparison; a successful confirmation resets the attempt counter. The sixth reserved attempt is denied until expiry. Existing action/read limits remain. A per-worker limit of two concurrent bcrypt comparisons bounds local CPU; it is not a global CPU quota.
- Redis or account lookup uncertainty fails closed for private access. Ordinary locked discovery reads retain existing fallback behavior. No automatic password retries occur. Passwordless accounts receive guidance to use the existing account password setup/recovery flow; OAuth identity alone does not unlock this feature.

This is password reauthentication, not a second factor or encryption of public job content. It does not erase information previously viewed or exported. HTTPS, correct JWT lifecycle, working shared Redis and staging verification remain release requirements.

## Changed source inventory

Backend:

1. `backend/src/controllers/jobActionController.js` — grant enforcement, safe errors and Retry-After.
2. `backend/src/routes/jobRoutes.js` — authenticated confirmation/revocation routes and shared strict limiter.
3. `backend/src/services/jobActionService.js` — hidden list/mutation guards and atomic race protection.
4. `backend/src/services/jobsHiddenAccessService.js` — existing-password verification and bounded session grants.
5. `backend/src/tests/jobsHiddenAccess.test.js` — nine focused password, grant, failure and action-guard tests.
6. `backend/src/tests/jobsHubHardening.test.js` — route-boundary fixtures for the additive endpoints.
7. `backend/src/tests/jobsHubHttp.integration.test.js` — real HTTP/JWT/Mongo/Redis security lifecycle.
8. `backend/src/tests/jobsHubUpstash.integration.test.js` — cross-client confirmation route-limit checks.
9. `backend/src/scripts/verifyJobsHubProduction.cjs` — scoped verification mode, isolated temporary paths, secret-free child environment, sequential frontend checks and bounded Redis startup wait.

Frontend:

1. `frontend/src/app/pages/jobs/jobs.component.ts` — gate, cancellation, lock lifecycle and safe feedback.
2. `frontend/src/app/pages/jobs/jobs.component.html` — accessible password form and manual lock.
3. `frontend/src/app/pages/jobs/jobs.component.scss` — responsive gate styling; concurrent user visual edits preserved.
4. `frontend/src/app/pages/jobs/jobs.component.spec.ts` — gated deep links, successful/wrong confirmation.
5. `frontend/src/app/shared/services/job-actions.service.ts` — transient grant headers.
6. `frontend/src/app/shared/services/jobs-hidden-access.service.ts` — memory-only grant lifecycle.
7. `frontend/src/app/shared/services/jobs-hidden-access.service.spec.ts` — six lifecycle/cancellation tests.
8. `frontend/scripts/verify-jobs-ui.cjs` — four viewport/theme gated journeys and storage/privacy assertions.
9. `frontend/scripts/jobs-vitest.config.mjs` — single-worker affected tests; existing assertions/timeouts unchanged.

Task-owned proposal scaffolds were moved/replaced: `backend/src/utils/jobsHiddenCode.js` → `backend/src/services/jobsHiddenAccessService.js`, and `backend/src/tests/jobsHiddenCode.test.js` → `backend/src/tests/jobsHiddenAccess.test.js`. Neither old path remains referenced. No application schema or environment file changed.

Report/evidence: this directory, the additive link in `../production-finalization-2026-11-08/JOBS-HUB-PRODUCTION-FINAL.md`, and browser evidence under `frontend/verification/jobs-hub/production-2026-11-08T16-34-50-576Z`, `production-2026-11-08T16-58-16-932Z`, and the final run's timestamp. JSON inventories retain exact generated paths.

## Preservation of user work

Initially staged Jobs page HTML/SCSS and the three `shared/components/job-filters/job-filters.{html,scss,ts}` files were preserved. The filter files were not edited or formatted by this task. The user subsequently staged early feature work and refined the password panel while implementation continued. Those edits were retained; the agent did not stage, reset or stash files. The initial staged fingerprint was `f1c2196f144058d540784f7509a3a0c5a89e3261`; the subsequent stable user-staged fingerprint was `8db2d26ea4564c06d93b8ff26c707208bc9b75a7`. Tests exercise the final working tree, which includes changes beyond that staged snapshot.

## Verification evidence

Each `run-*/results.json` records exact child commands, cwd, exit codes and wall times; corresponding `.log` files retain raw diagnostics. The reusable runner never inherits application credentials. Native tests use loopback disposable MongoDB/Redis, scoped databases/keys and owned process cleanup. Despite the legacy Upstash test name, these runs use local Redis TCP and do not certify hosted Upstash or TLS. HTTP authentication, persistence and limits are real; ingestion and Learning Hub boundaries are explicit fixtures, with zero provider calls. Browser journeys use fixture APIs and must not be counted as live end-to-end staging acceptance.

| Check                                                              | Result                         | Evidence / timing                                                                                                                                                             |
| ------------------------------------------------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused backend and consumer contracts                             | PASS, 73/73, zero skipped      | `run-2026-11-08T17-02-41-756Z/backend-focused.log`; 39,302 ms child wall                                                                                                      |
| Native Mongo/Redis integrations                                    | PASS, 9/9, zero skipped        | same run, `real-integrations.log`; 145,892 ms child wall                                                                                                                      |
| Final real HTTP security lifecycle                                 | PASS, 1/1, zero skipped        | `run-2026-11-08T17-14-25-491Z`; 23,944 ms child wall; two HTTP servers, 15 concurrent writes, zero provider calls                                                             |
| Final action-guard compatibility recheck                           | PASS, 9/9, zero skipped        | `node --test backend/src/tests/jobsHiddenAccess.test.js`; 21,097.4747 ms test duration; includes public legacy-import compatibility                                           |
| Affected Angular contracts                                         | PASS, 36/36 across seven files | `run-2026-11-08T17-14-10-960Z/angular-focused.log`; 168,625 ms child wall, 24.56 s Vitest duration                                                                            |
| TypeScript application check                                       | PASS                           | same final frontend run; 27,139 ms child wall                                                                                                                                 |
| Production build                                                   | PASS, exit 0                   | `run-2026-11-08T17-14-10-960Z/production-build.log`; 182,257 ms child wall, 157.803 s Angular generation                                                                      |
| Final fixture browser journeys                                     | PASS, 17/17                    | `browser-final.log`, `browser-final-results.json`; ten screenshots and `browser-results.json` in `frontend/verification/jobs-hub/production-hidden-password-final-2026-11-08` |
| Hosted Redis/TLS, deployed proxy headers and real account journeys | BLOCKED: external staging gate | No live service or deployment acceptance claimed                                                                                                                              |

Commands: `node backend/src/scripts/verifyJobsHubProduction.cjs --hidden-password --backend-only`, then `--http-only`, and `--frontend-only`. The JSON files expand the exact focused test include lists. Final formatting uses explicit inventory paths with `node frontend/node_modules/prettier/bin/prettier.cjs --write`, followed by `--check`; backend options are `--single-quote --trailing-comma none --print-width 100`, frontend uses `--config frontend/.prettierrc`. Backend and verification JavaScript use `node --check`. Both `git diff --check` and `git diff --cached --check` are required.

### Historical failures retained

- `run-2026-11-08T16-34-50-576Z`: initial parallel frontend execution hit six Vitest fork startup timeouts; only four utility tests completed. TypeScript/build and 17 browser journeys passed. This is not a passing Angular run.
- `run-2026-11-08T16-58-16-932Z`: single-worker execution passed 35/36; the new gate test exceeded its unchanged five-second limit while first rendering the unrelated Discover page. It now starts from the actual Hidden deep-link route; assertions and timeout remain unchanged. Final 36/36 above passed. This run's typecheck/build and 17 browser journeys also passed.
- `run-2026-11-08T17-06-14-779Z`: fixture startup failed (`Disposable Redis readiness failed`) before executing HTTP tests. Its original stack appeared in command output; no separate raw parent-stderr file was captured. The runner startup wait is now bounded at ten seconds instead of two. The later real HTTP run passed; startup failure is not represented as an application test pass.
- The final frontend run passed Angular/typecheck/build, but its browser child initially failed before launching with `MODULE_NOT_FOUND: playwright`; the raw stack remains in `run-2026-11-08T17-14-10-960Z/browser.log`. Only the browser command was rerun, using the existing Codex bundled runtime through process-local `NODE_PATH`. No dependency or project environment change was needed. That browser rerun passed 17/17.
- Earlier focused and HTTP successes are retained, rather than replacing failed evidence. No repository-wide regression or paid/live provider test was run for this narrow feature.

The earlier Jobs Hub production report's provider licensing, staging load, hosted infrastructure and cross-module gates continue to apply. This feature does not certify those outstanding gates or declare production acceptance.

The production build reports non-blocking component stylesheet warnings: Jobs 52.97 kB against the existing 48 kB warning budget, and landing page 56.67 kB against 48 kB. Thresholds were not changed. The concurrent user styling was preserved; the unrelated landing page was not modified.

## Finalization

`cleanup-results.json` records exact resolved source/destination paths: nine task-generated diagnostic logs were retained outside disposable caches, one owned browser-download temporary file was deleted, and the seven runs' empty temporary/cache folders were removed without recursive deletion. Native fixtures separately retain Mongo/Redis shutdown and namespace cleanup proofs. All screenshots, historical failures, user edits and essential evidence remain.

`finalization-results.json` and `finalization.log` record post-cleanup scoped formatter, syntax, focused password tests, TypeScript and both Git whitespace checks. `file-inventory.json` records exact source/report paths and SHA-256 fingerprints; Git status includes unrelated pre-existing staged filter work, which is not attributed to this task. The successful production build and browser checks above cover the final application source; cleanup changed only owned disposable artifacts.
