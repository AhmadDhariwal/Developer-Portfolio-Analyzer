# Profile, Settings & B2 — final production acceptance

Date: 29 October 2026 (Asia/Karachi). Source branch: `task/profile`. Integration/PR target: not applicable. Baseline HEAD: `96179a7f4372887f06952723e3302c9b566d652e`. Initial working tree/index: clean.

**Final verdict: FAIL / BLOCKED for production acceptance and module freeze.** Focused application regression, UI acceptance and real B2 object behavior pass. Configured Redis rejects Lua operations with a provider quota error, so strict uploads correctly fail closed. Additional deployment/security gates remain below. Passing B2 tests does not override these blockers. **Module freeze is withheld; the module is not marked FROZEN.**

No commit, merge, deployment, secret change, production record mutation, bucket configuration change or migration was performed. Existing user files and object keys were not modified or deleted. Production Mongo access was limited to read-only topology/collection/index metadata. Disposable accounts and transactional mutations used isolated loopback Mongo databases only.

## Scope and evidence boundaries

Read `AGENTS.md`, `DEVINSIGHT_AI_SOLUTION_ARCHITECTURE_CHARTER.md`, `PROFILE-SETTINGS-PRODUCTION-FINAL.md`, `../storage/BACKBLAZE-B2-FINAL.md`, storage/authorization/cleanup implementations and the relevant acceptance harnesses. The architecture, scoring rules, history, credentials and API/UI contracts remain unchanged.

Three complementary layers were exercised:

1. Real B2, the actual S3 SDK/adapter and real transactional storage ledger with disposable local accounts. No production Mongo connection was available to this verifier.
2. Existing HTTP Profile/resume/media APIs with JWT authentication, actual disposable Mongo persistence and versioned fixture S3. These exercise controller contracts, publication privacy, session rotation, races, failure handling and legacy paths.
3. A fresh production Angular build in headless Chrome with explicit fixture HTTP responses and all nonfixture browser requests blocked. Desktop/mobile behavior is verified, but this is not a browser journey against production APIs.

A real complete upload HTTP journey through the configured shared Redis admission cannot pass while the provider quota restriction persists. No bypass/fallback was introduced. Expensive AI/provider analyses, mail/SMS delivery, production account deletion, large-account load, real infrastructure outages and deployment restarts were not performed.

## Real Backblaze B2 acceptance — PASS

Evidence: `profile-b2-final/live-b2-results.json`, `restart-result.json` and `live-fixture-manifest.json`. The manifest contains only generated disposable keys, provider version IDs and hashes; it contains no credentials, existing keys or real account identifiers.

| Gate                            | Result and evidence                                                                                                                                                                                                                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Configuration/authentication    | Both configured keys authenticate through Native API v4. Each authorization response is restricted to exactly its intended bucket and matches the configured regional S3 endpoint. Separate credentials pass adapter validation. Values are never logged.                            |
| Bucket privacy                  | Both buckets report `allPrivate`; three anonymous reads of uploaded fixtures are denied.                                                                                                                                                                                             |
| Key isolation                   | Required read/write/list/delete-file capabilities exist. Each image/PDF sample is denied with the other bucket's credentials. Bucket-management privileges exceed least privilege; see blocking gates.                                                                               |
| Encryption                      | Both bucket defaults report SSE-B2. HEAD on avatar, portfolio and PDF samples confirms `AES256` and the expected SHA-256 metadata.                                                                                                                                                   |
| Upload/retrieval                | Six generated objects: two avatars, two portfolio images and two real parseable résumé PDFs. All six read back through the adapter/owned ledger with byte/hash equality.                                                                                                             |
| Replacement/reference integrity | Actual `commitAvatar`, `commitPortfolio` and `commitResume` transactions run. Avatar/portfolio displacement becomes durable cleanup work. Both résumé history rows remain ready until explicit disposable-fixture teardown; the active selection changes without destroying history. |
| Object versions                 | Seven PUTs create seven versions across six unique generated keys. A second version on the first disposable avatar differs from its recorded original version. A pinned read still retrieves the original.                                                                           |
| Ownership                       | Six cross-owner ledger reads return 404 before object retrieval. Cross-bucket S3 requests return 403.                                                                                                                                                                                |
| Cleanup retry                   | An injected adapter deletion failure leaves two durable deleting receipts with retry counters/backoff. The provider itself was not disrupted. Only fixture retry timestamps are advanced.                                                                                            |
| Restart recovery                | A fresh OS process, supplied only B2 settings and disposable Mongo identifiers, reads four ready objects with verified hashes and recovers both pending cleanup receipts against real B2.                                                                                            |
| Final deletion                  | All seven versions are deleted using exact generated keys/version IDs. Final bounded version listings verify all six keys have no versions or delete markers. No bucket-wide enumeration or deletion occurs.                                                                         |
| Limits/performance              | Images remain bounded to 2 MiB and PDFs to 10 MiB. Existing eight-operation/deadline tests pass. The sequential live run completed in about 29.4 seconds including authorization and final cleanup; this is not a throughput, fleet or soak measurement.                             |

Both buckets currently report zero lifecycle rules. Retention/Object Lock metadata is not visible with the configured keys; successful exact-version deletion proves these disposable versions were deletable, not that every retention setting or historical object is verified.

The live verifier initially failed before any PUT because it passed a pooled Node Buffer to PDF.js. The existing application already uses `Uint8Array.from` for isolation. The verifier now follows that implementation and uses the previously accepted PDF fixture text. No product parser defect or scoring change was found.

Provider references: [Native authorization and key scopes](https://www.backblaze.com/apidocs/b2-authorize-account), [private bucket metadata](https://www.backblaze.com/apidocs/b2-list-buckets), [S3-compatible key capabilities](https://www.backblaze.com/docs/cloud-storage-s3-compatible-app-keys). No provider policy was changed.

## Profile & Settings regression — focused PASS

Fresh backend result: **87 passed, 0 failed, 0 skipped**, approximately 20.5 seconds. Transcript: `profile-b2-final/backend-tests.tap`.

```powershell
$env:PROFILE_ACCEPTANCE_MONGO='mongodb://127.0.0.1:27139/?replicaSet=acceptance27139'
$env:B2_ACCEPTANCE_MONGO='mongodb://127.0.0.1:27140/?replicaSet=acceptance27140'
node --test backend/src/tests/profileAccountSecurity.test.js backend/src/tests/profileSettingsProduction.test.js backend/src/tests/b2Storage.test.js backend/src/tests/resumePipelineFinalization.test.js backend/src/tests/publicPortfolioHardening.test.js backend/src/tests/developerContextService.test.js backend/src/tests/careerSprintPlanningFinalization.test.js backend/src/tests/newsHubHardening.test.js backend/src/tests/newsFlow.test.js
```

| Area                        | Evidence and practical limit                                                                                                                                                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile editing             | OAuth editing, field/link validation, long biography, independent notification writes and real Mongo HTTP persistence pass.                                                                                                                                                |
| Career/base/active context  | Permanent versus active context, selected/default/owned résumé resolution and canonical profile hash pass. Browser displays permanent base separately from active context.                                                                                                 |
| Password/session security   | Password selection/policy, compare-and-set and concurrent updates, opaque recovery envelopes, revision invalidation and renewed API/media credentials pass. Wrong-current-password feedback preserves the session. Recovery delivery remains mocked.                       |
| Notifications               | Independent persisted booleans and form behavior pass/reuse prior producer audit. Job-match preference remains a preference; no new delivery producer is implied. Actual scheduled delivery is not rerun.                                                                  |
| Avatar/portfolio media      | Signature and size validation, strict admission outage, replacement safety, foreign-reference rejection and owned preview pass at HTTP/fixture level. Real bytes, versions and cleanup pass at live adapter/ledger level.                                                  |
| Résumés                     | Upload validation, actual text PDF extraction, corrupt/blank rejection, owned retrieval, active selection, deterministic score parity, cached-source freshness and retained history pass. AI output is mocked and existing scores remain unchanged.                        |
| Public/recruiter visibility | Independent recruiter opt-in/publication, actual Mongo isolation, current publication/section checks, warm-cache revocation, owner-only preview and private résumé denial pass.                                                                                            |
| Account deletion            | Disposable real-Mongo tests verify ownership conflict rollback, owned-record deletion, other-user preservation, durable cleanup failure/retry and upload/deletion races. No real account was deleted.                                                                      |
| Legacy compatibility        | Disposable legacy filesystem images/PDFs remain accessible; unsafe/foreign paths are denied, B2 replacement preserves legacy files, and filesystem write rollback retains B2 reading. Production historical volumes were not migrated or exhaustively read.                |
| UI                          | Fresh build: desktop 1440×1000 and mobile 390×844. Unchanged save emits no write, 500-character biography saves/reloads, password/deletion errors restore controls, native confirmation works, no horizontal overflow or browser exceptions. Screenshot evidence retained. |

Frontend focused result: **19 passed in 4 files**, no failures. The requested optional cache-invalidation spec does not exist; coverage comes from Profile/career service tests and audited invalidation registrations. This is not reported as a fifth passing test file. Transcript: `frontend-focused-tests.txt`.

One necessary production frontend build passed. Existing warning: `landing-page.component.scss` is 56.67 kB against a 48 kB warning budget; no build error. No second build or full frontend rerun was needed because application source was unchanged.

Prior report evidence is reused explicitly: 434 frontend tests in 76 files, prior focused coverage and desktop/mobile acceptance, and earlier linked-profile/recruiter-ranking contracts. These are historical reported results, not fresh executions or proof of live downstream provider behavior. Some older raw logs are absent in this checkout; the reports remain available. The fresh results above are retained independently.

## Cross-module integration matrix

| Consumer              | Verified propagation path                                                                                   | Acceptance boundary                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Dashboard             | Canonical selected owned résumé/context and profile/signal hash; personalization clears dashboard cache     | Fresh shared-consumer tests, frontend tests and source audit                               |
| Skill Gap             | Canonical active career/evidence; developer-signal invalidation clears Skill Gap                            | Fresh context/hash tests plus existing audited consumer contract; no new provider analysis |
| Recommendations       | Current intent/selected evidence hash; recommendations cache invalidated                                    | Fresh canonical hash/frontend invalidation evidence; existing ranking/scoring retained     |
| Career Sprint         | Profile intent in draft fingerprint and acknowledgement; existing task/history data retained                | Fresh planning finalization tests and invalidation audit                                   |
| Scenario Simulator    | Shared active résumé/context and immutable historical snapshots                                             | Fresh shared-consumer tests; no simulation formula change                                  |
| Weekly Reports        | Same owned selected résumé/context and cache invalidation                                                   | Fresh shared-consumer tests; historical reports preserved                                  |
| Interview Preparation | Personalized runtime invalidation includes `interview-prep`; common question-bank caches remain independent | Fresh frontend tests plus audited registration/clear path; no live question generation     |
| News                  | Current canonical hash gates warm signal cache and personalization                                          | Fresh Profile warm-cache regression, News hardening and flow tests                         |
| Recruiter Hub         | Current Mongo consent/account/global discovery policy and owner/organization scope                          | Fresh Mongo discovery regression; prior ranking evidence reused                            |

This establishes focused propagation contracts. It does not claim a new browser/AI end-to-end run of all nine modules. External quotas, generated output quality and full fleet behavior remain outside this bounded acceptance.

## Security, infrastructure and scalability

Evidence: `profile-b2-final/operations-results.json`.

- Configured Mongo connectivity and transaction-capable replica/sharded topology metadata pass. No transaction was written to the configured database. Actual transactions/concurrency were verified on disposable local replica sets.
- The configured database has `storedassets` with unique `reference`, owner, state/expiry and state/retry/expiry indexes, without a cleanup TTL. `users` has the expected identity/discovery indexes. **`accountdeletioncleanups` is absent** and needs explicit deployment provisioning under the approved policy. No collection/index was created in the configured database.
- Redis PING and GET succeed. Real strict upload middleware calls return **503**. A bounded read-only Lua probe also reports the provider quota restriction; increasing the probe deadline does not resolve it. Therefore connectivity is not admission readiness. No timeout, limit, authentication or fallback was weakened.
- The planned three-process shared-quota check stops at the first failing process. Shared 10-per-hour enforcement cannot be certified against this configured Redis service while Lua is quota-blocked. Existing mocked fail-closed and rate-limit tests pass. Generated fixture counters were either removed or verified absent by exact-key GET; no existing counter was reset.
- Managed image privacy checks current Mongo account/publication before bytes, uses purpose-bound HttpOnly media cookies and private/no-store responses. Password revision rotation is tested. Local-only logout does not immediately revoke an issued media cookie/API token; the previously documented expiry/revision limitation remains a policy gate if immediate revocation is required.
- Concurrency, account isolation, durable cleanup, uncertain PUT recovery, failed replacement and restart checks pass in bounded fixtures. Production worker rollout, capacity, abuse controls, trust-proxy correctness and scheduler monitoring remain deployment checks, not load-test claims.

## Exact changes and fixes

No demonstrated application-source defect required correction. The real failures are operational gates, not grounds to bypass the existing protections.

Source/harness files:

- `backend/src/scripts/verifyProfileB2Live.js` — new explicitly invoked, guarded live verifier; loads `.env` without printing values, validates scopes/private buckets, uses only generated disposable B2 keys and local Mongo, verifies exact-key cleanup and child-process recovery.
- `backend/src/scripts/verifyProfileB2Operations.js` — new bounded metadata/shared-admission verifier; configured Mongo metadata reads only, random fixture Redis subjects, sanitized quota classification and exact fixture-counter cleanup/absence checks.
- `backend/src/scripts/verifyProfileSettingsBrowser.js` — optional `PROFILE_ACCEPTANCE_OUTPUT` to retain new evidence separately; unchanged fixture behaviors, plus explicit-file formatting.

New report/evidence files:

- `backend/verification/profile/PROFILE-B2-FINAL-ACCEPTANCE.md`
- `backend/verification/profile/profile-b2-final/live-b2-results.json`
- `backend/verification/profile/profile-b2-final/live-fixture-manifest.json`
- `backend/verification/profile/profile-b2-final/restart-result.json`
- `backend/verification/profile/profile-b2-final/operations-results.json`
- `backend/verification/profile/profile-b2-final/backend-tests.tap`
- `backend/verification/profile/profile-b2-final/frontend-focused-tests.txt`
- `backend/verification/profile/profile-b2-final/frontend-build.txt`
- `backend/verification/profile/profile-b2-final/browser/browser-results.json`
- `backend/verification/profile/profile-b2-final/browser/profile-desktop.png`
- `backend/verification/profile/profile-b2-final/browser/profile-mobile.png`
- `backend/verification/profile/profile-b2-final/validation.json`
- `backend/verification/profile/profile-b2-final/formatting.txt`

No existing source/evidence file was moved or deleted. `.env` and secrets were not changed. No application dependencies, schemas, scoring or API/UI contracts were changed. Existing screenshots/reports were preserved. Generated build/cache files remain tool-managed and are not part of the source changes.

## Reproduction and finalization

The live harness requires an explicitly supplied task-owned local replica set and output folder. It refuses another Mongo URI or a database outside its generated `profile_b2_live_<random>` namespace. It never loads the configured Mongo URI for writes.

```powershell
$env:PROFILE_B2_LIVE_MONGO='mongodb://127.0.0.1:27140/?replicaSet=acceptance27140'
$env:PROFILE_B2_LIVE_OUTPUT='<dedicated acceptance evidence folder>'
node backend/src/scripts/verifyProfileB2Live.js
node backend/src/scripts/verifyProfileB2Operations.js
```

Run only with approved disposable B2 traffic. The live script performs seven tiny PUTs, generated-key-only version cleanup and bounded verification reads. Operations results must be inspected for explicit PASS/FAIL fields; successful script execution alone does not mean infrastructure gates pass. Cleanup permission failure is retained as a failure with its generated-key manifest for operator recovery.

Explicit-path Prettier write/check and `node --check` cover the three changed scripts; Markdown/JSON formatting and Git working-tree/index whitespace checks are included in retained finalization evidence. The single build and fresh tests are recorded above. Task-owned local Mongo processes are stopped after fixture databases are dropped. All six live fixture keys are confirmed absent. No recursive repository cleanup or Git staging/reset is used.

## Remaining external gates and freeze decision

1. **Blocking: Redis Lua quota.** Restore adequate provider command/quota capacity through the authorized operator, then rerun bounded three-process strict admission and an authenticated real upload HTTP journey. Do not enable a local fallback or make either bucket public.
2. **Blocking: credential least privilege.** Both keys are correctly bucket-scoped but also permit bucket configuration writes: encryption, lifecycle, notifications, logging, replication and bucket settings. Replace/restrict through approved secret management to file read/write/list/delete needs, plus only explicitly justified read-only metadata capabilities, then reverify. No key/secret/policy changes are authorized by this acceptance run.
3. **Activation gate:** configured `STORAGE_DRIVER` remains `filesystem`. B2 adapter/reader acceptance passes, but normal new uploads are not switched to B2. Activate `b2` only through the approved deployment/configuration change after the other blockers pass. This report does not change `.env`.
4. Provision the missing account-deletion cleanup collection/indexes, confirm all workers use the new revision/storage code, and schedule/monitor bounded storage/account cleanup with the approved supervisor. Confirm alerts/backups, retry-age monitoring and unknown-version receipt handling.
5. Verify deployed same-origin HTTPS `/api` and `/uploads` proxy routing, Secure cookie delivery, private/no-store/CDN handling, trust proxy, legacy persistent volumes and backup/restore. The local `.env` is development and has no explicit shared legacy root/app origin. Existing production legacy files were not migrated or verified exhaustively.
6. Review retention/Object Lock metadata in the operator console, account/audit retention decisions and immediate-logout policy. These are not certified by disposable object deletion or local cache tests.
7. Reuse prior open release gates for real mail/SMS delivery, full-fleet session rollout, deployment-equivalent restart/capacity/soak and external provider consent/availability. No expensive load or AI suite was run.

A **test-backed candidate code baseline** is recorded at the baseline HEAD plus the exact harness/evidence changes above: Profile/Settings focused regression PASS, real B2 adapter/ledger PASS, privacy/ownership/local failure recovery PASS, UI PASS and cross-module focused contracts PASS. **Production acceptance remains FAIL/BLOCKED, and the conditional module freeze is not established.** After the listed blocking/applicable deployment gates pass and evidence is retained, the intended designation may be applied: **FROZEN — changes only for verified bugs, security fixes or explicitly approved requirements**. That designation is prospective, not the current module status.
