# DevInsight AI — Integrations Production Finalization

Latest decision (26 October 2026): production build, local API flow and focused regression PASS; ready to lock Integrations locally YES; production readiness NO. See the final reconciled-checkout acceptance section below. Earlier failures and verdicts are historical.

Date: 25 October 2026, Asia/Karachi. Authorized checkout: `D:\Developer-Portfolio-Analyzer`, existing branch `task/integrations`; PR/merge target: not applicable. No deployment, commit, push, production migration, application database mutation or quota reset was performed.

## Initial decision — 25 October (superseded by local acceptance below)

Implementation and isolated acceptance are complete within the scope below. **Do not deploy or lock the application yet.** The production Angular build fails on an unchanged Scenario Simulator stylesheet: 83.09 kB exceeds its 64 kB error budget. Its 48 kB warning budget is also exceeded; concurrent Landing Page changes produced a separate 56.17 kB warning. Neither stylesheet nor any Landing Page source was changed by this task. A build failure remains a cross-module acceptance failure even when focused tests pass.

Live provider permission checks, secret provisioning and migration, production transaction/Redis/index validation and deployment-equivalent soak are separate unresolved release gates. A short, synthetic two-worker run is not a production-capacity certification.

## Sources, baseline and preservation

Read `AGENTS.md`, `DEVINSIGHT_AI_SOLUTION_ARCHITECTURE_CHARTER.md`, repository/agent documentation, actual Integrations controllers/routes/models/adapters, frontend API consumers/tests, shared Redis governance/cache code, account-deletion handlers, downstream consumers and adjacent Scenario/Sprint verification reports. The title “Architecture & Technical Handover: Integrations Module” was supplied by the user, but its document body is not present in this chat's available history or repository. Following the user's clarification, absence was recorded rather than treated as an implementation blocker; all findings below were verified against code.

The generated chat workspace initially contained no source checkout. Repository discovery found the existing project at the path above. Git preflight showed a clean tree on `task/integrations`; the user explicitly authorized working on that branch. There was no existing Integrations verification directory. The focused pre-change baseline passed **19/19** tests: sync, lifecycle, adapters/SSRF and integration scoring.

During execution, changes were staged and unrelated Landing Page and authentication UI edits appeared concurrently. Existing/staged work was preserved. This task issued no Git add/reset/clean/checkout/commit commands. Exact task files, retained evidence, and the excluded concurrent frontend files are recorded in [file-inventory.json](file-inventory.json). No source files were moved or deleted. New `docs/features/integrations.md` resides under an ignored documentation directory; include it explicitly in any later commit.

Existing `.env` values were inspected only by variable name and configured/not-configured status. No secret values were emitted, fabricated, replaced or copied into evidence. `.env` was not edited. New settings are documented in `.env.example`.

## Confirmed defects and architecture changes

| Confirmed before                                                                                    | Root cause                                                             | Implemented behavior                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plaintext access/refresh tokens and manual API keys in connection documents                         | Persistence wrote provider strings directly                            | AES-256-GCM envelopes with key IDs, random nonces, authentication tags and user/provider/field-bound authenticated context; runtime rejects legacy plaintext                                                              |
| OAuth state replay and competing callbacks                                                          | Read/check followed by provider exchange and delayed state clearing    | Atomic one-time consumption with required future expiry, exact provider/owner predicates and a separate attempt fence; obsolete attempts cannot finish after reconnect/disconnect                                         |
| Client could override OAuth identity                                                                | Callback preferred request username over provider identity             | Provider-returned stable account ID and handle are required; request handle cannot establish identity; expiry is validated; later adapter reads reject identity changes                                                   |
| Nonstandard webhook secret comparison and arbitrary username targeting                              | Custom header was compared as a string                                 | Exact raw-body HMAC-SHA256, constant-time comparison, durable delivery/payload replay receipts and verified repository-owner account-ID matching; event schedules Mongo work without synchronous ingestion                |
| Duplicate sync and refresh across workers; stale workers could reconnect disconnected accounts      | Process-local Set and unconditional ID-based updates                   | Mongo atomic connection claims, nonce/expiry fences, shared Redis job/request capacity leases and transactional completion; disconnect/reconnect invalidate claims                                                        |
| Concurrent provider updates could lose insight data                                                 | Aggregate read/modify/save lacked shared serialization                 | Owned user-document write fence and snapshot transactions serialize aggregate changes; connection/insight/history commit together; provider calls remain outside transactions                                             |
| Errors removed retry eligibility and could replace good snapshots with empty/partial failures       | Error status excluded by polling; adapters swallowed some failures     | Polling includes eligible error records, transient failure preserves status and prior insight, failed history is sanitized; portfolio/Stack Overflow/blog failure handling no longer promotes failures to success         |
| Provider quotas were uncoordinated                                                                  | No integration admission path around adapter requests                  | Existing shared Redis atomic counter reused; per-account action and per-user/provider request limits, provider-wide request limits, global/provider job and HTTP concurrency, cooldowns and fail-closed outages           |
| Manual handles could enter legacy evidence as verified skills                                       | Observation and account ownership were conflated                       | Additive ownership/evidence provenance; only explicit verified ownership populates verifiedSkills/strongestProof; certifications remain self-reported                                                                     |
| Sprint overviews could stay stale in other workers                                                  | User-local invalidation did not change immutable shared cache identity | Every overview reads Mongo integration revision and includes it in its cache identity; old writers can populate only their old key                                                                                        |
| Account deletion left owned connections/tokens/insights/history behind                              | Deletion touched User and selected unrelated records only              | Self-service and super-admin deletion remove integration records atomically with User deletion; owner fences prevent worker resurrection                                                                                  |
| SSRF validation could be followed by a separate DNS resolution; failures became zero-valued success | DNS validated before transport and scanner swallowed transport errors  | Connect-time lookup validates the addresses actually supplied to the socket; proxies and redirects disabled, private/CGNAT/mapped targets rejected, IPv6 conservatively unavailable, response sizes and deadlines bounded |

MongoDB remains authoritative. Existing modular Express/Mongoose/Redis structure and dependencies are retained. No new packages, services or scoring weights were introduced.

## Synchronization, limits and failure semantics

- A single connection is claimed atomically by owner/provider/status and expired-or-empty lease. Lease duration is total-operation timeout plus 10 seconds. Global/provider Redis job admission bounds concurrent sync work, independently of global/provider outbound HTTP admission.
- Completion transaction checks account existence through a user-document write fence, then checks the exact connection nonce and unexpired lease. Insight replacement and success history are in that transaction. User/provider uniqueness and insight/user uniqueness remain database-enforced. Account deletion conflicts with the same owner fence.
- Rotating refresh credentials are encrypted and persisted under the existing claim before ingestion. A provider failure afterward preserves the new refresh credential and the last good insight. A crash between a provider consuming a rotating refresh token and local persistence may still require reauthentication; no cross-provider/database atomicity is claimed. Old claimants cannot save refreshed credentials after a disconnect/reconnect. Expired claims are recoverable without clearing shared quotas.
- All integration adapter HTTP attempts use the shared controls, including Kaggle fallback and portfolio scanning. Safe GETs allow at most one additional 502/503/504 attempt with 100–399 ms jitter; POST exchanges/refresh/GraphQL and DELETE revocation are never automatically retried. Each transport attempt consumes quota. Redirects, environment proxy forwarding and oversized responses are blocked.
- `Retry-After` seconds/HTTP dates and GitHub quota reset/remaining headers drive shared provider cooldown. Successful Stack Exchange payload backoff/quota signals are respected. Repeated failures open a short shared circuit; expiry permits bounded recovery attempts. Reservations are not refunded as successful quota calls may have reached the provider.
- Redis absence/command failures return 503 before external work. Mutation saturation returns 429/Retry-After; unavailable/busy/stale connection sync returns 409. All mutation routes use shared per-user admission except disconnect, which stays available as a local safety operation during limiter outages. Its optional outbound revocation still requires shared provider admission. Public OAuth callback/webhook action admission is per IP. Existing global API middleware still applies to all endpoints. Ordinary reads do no provider work and do not consume provider quotas.
- History reads are capped at 5,000 records and 30 days. Due batches are capped at 100, default 10. Sync-all is capped at the nine supported providers. Provider responses are capped at 2 MiB and outbound bodies at 100 KiB. Whole provider operations have a cancellation deadline; late adapter work cannot pass the pre-persistence active-operation checks, and stale leases cannot commit.

The default counters are per 60-second window, with provider/account keys isolated under the module's Redis Cluster hash tag. Identifiers in quota keys are hashed. No local limiter fallback establishes correctness. Default limits must be tuned downward for actual provider permissions/quotas; a generic module limit is not a provider entitlement.

## Persistence, index and cache evidence

The disposable fixture uses native MongoDB with a single-node replica set, separate temporary database directory and ephemeral loopback port; local Redis 7.2.11 runs in WSL on another ephemeral port with 64 MiB/noeviction and persistence disabled. Neither test loads `.env` or connects to application Mongo/Redis. It forks two independent Node processes and removes only individually verified fixture-owned files after stopping the services. Final cleanup verified Mongo/Redis stopped and removed 119 fixture files, with zero application database accesses, quota resets or recursive deletions.

[query-plans.json](query-plans.json) retains actual `explain('executionStats')` before/after plans, execution counts and index inventories from 1,200 synthetic connections and 1,200 synthetic history rows plus functional fixtures. Existing user/provider uniqueness serves owner lookups with one key/document. Polling fell from 1,204 examined documents to 7 using `{status,nextSyncAt}` (11 keys); history fell from 1,206 to 106 matching owner rows (106 keys) using `{userId,createdAt:-1}`. OAuth state lookup fell from 1,204 documents to one document/key with its partial index; the no-match verified-webhook lookup fell from 1,204 to zero documents/keys. Retention cutoff inspection fell from 1,206 documents to zero for this fixture with no expired rows. Actual plans and inventories are retained in that JSON; zero-match webhook/retention plans are index-usage evidence, not realistic populated-load measurements. Polling still has a bounded-result SORT due to its OR predicates; production cardinality/active-lease distributions must be checked.

`inspectIntegrationIndexes.js` defaults to read-only explains and index inspection. Explicit `--apply` creates only:

1. `integration_due_v1`: connections `{status:1,nextSyncAt:1}`.
2. `integration_oauth_state_v1`: `{provider:1,oauthState:1}`, partial on nonempty state.
3. `integration_webhook_identity_v1`: `{provider:1,externalAccountId:1}`, partial on verified ownership.
4. `integration_history_v1`: history `{userId:1,createdAt:-1}`.
5. `integration_retention_v1`: history `{expiresAt:1}`, TTL at the explicit expiration instant.

No existing index is dropped, no automatic syncIndexes is called, and production indexes were not changed. New logs receive expiresAt; existing history has no backfill or implicit deletion. Applying TTL requires the operator's retention approval. Webhook replay receipts intentionally remain durable without TTL because GitHub's body signature authenticates no delivery timestamp; expiring receipts would reopen old payload replay. Receipt storage growth must be monitored.

Connections/insights are read directly from owned Mongo records. No in-memory connection/insight cache can establish truth. Dashboard already reads the integration snapshot on requests. Developer Signal hashes include provenance and updatedAt. Sprint cache identity includes the fresh integration timestamp, with existing 60-second memory and 120-second shared TTLs; a cache on a second real worker was exercised before/after mutation. Scenario context uses persisted integration observations only for suggestions; saved scenarios are unchanged. Existing Angular mutation handlers clear developer-signal caches, verified by its focused service tests. Other open tabs refresh through existing navigation/refresh behavior; no live-push guarantee is claimed.

## Downstream impact and compatibility

Integration numerical weights remain 0.38 profile, 0.42 activity and 0.20 confidence. Shared Portfolio, Skill Gap, Sprint, Scenario and other scoring engines were not changed. Existing numerical parity/evidence regressions pass. Historical analyses, reports, Sprint records, simulations and existing integration history were not relabeled or recalculated.

The proven evidence defect required an input-eligibility correction: legacy Skill Gap evidence consumers now use verifiedSkills, not every detected skill from an arbitrary handle. The compatibility detectedSkills field remains for observations; manual observations/self-claims remain distinct. The versioned Skill Gap evidence engine already treats integration summaries as claims, and its regression still passes. Ownership verification is not proof of proficiency or code inspection. A change in provenance changes Developer Signal hashes, invalidating stale derived evidence caches without changing scoring formulas.

Portfolio analysis reads current persisted integration insights when explicitly requested. Dashboard reads the same source. New Weekly Reports use current integration signals; saved reports remain historical. Career Sprint overview cache and Scenario suggestion reads propagate persisted changes. This report does not claim a live browser walkthrough of all six downstream modules: numerical/contract regression, Mongo/worker cache integration and source-path inspection establish only their stated scopes.

Existing route names, primary success fields and GitHub `?success=github` redirect are preserved. Security-required changes are explicit: OAuth request usernames no longer override provider identity; custom-secret webhooks are rejected; ingest omits raw provider payloads while preserving normalized profile/activity/skills; controlled 429/503/409 failures and disconnect revocation status are additive. Token/state/raw metadata never enter connection responses. An old custom webhook sender must migrate to standard GitHub delivery before rollout.

## Provider status and permissions

| Provider       | Local status                                                                                                                                                | Required production verification                                                                                                                                                                                                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub         | OAuth identity/state, encrypted rotation, two-worker refresh, signature/replay, account-ID matching and local disconnect covered with controlled boundaries | Existing requested `read:user user:email repo` scopes are retained for compatibility; review whether private repo/email access is actually required. Test real OAuth, redirect registration, refresh support and DELETE app-token revocation with this app's permissions. Org-owned repositories do not match a user's account ID automatically. |
| LinkedIn       | OAuth state/encryption/shared transport and stable `sub` identity checks implemented; no live call                                                          | `openid profile email`, registered redirect and userinfo access; verify refresh entitlement for the actual LinkedIn product. No automated revoke contract is assumed; provider-side revocation remains manual.                                                                                                                                   |
| LeetCode       | Public GraphQL adapter uses shared controls, bounded attempts; synthetic ingestion/worker tests pass                                                        | Verify current public schema, access terms and actual provider quota. Handle ownership remains unverified.                                                                                                                                                                                                                                       |
| Kaggle         | Public profile and HTML fallback share admission/timeouts                                                                                                   | Verify endpoint availability, permitted use and returned profile shape. A public handle is not OAuth ownership.                                                                                                                                                                                                                                  |
| Stack Overflow | Shared HTTP admission plus payload backoff/quota handling; profile failures fail ingestion                                                                  | Verify current API permissions/quota; user search does not establish ownership. Partial failures preserve the previous complete snapshot.                                                                                                                                                                                                        |
| HackerRank     | Existing public adapter uses controlled transport/fallback; formulas unchanged                                                                              | Verify public/community endpoints and access policy; handles remain unverified.                                                                                                                                                                                                                                                                  |
| Portfolio      | Rebinding/private-target, redirect/proxy and size/deadline protections exercised locally                                                                    | Real public-host compatibility remains a smoke gate. IPv6 targets are deliberately unavailable pending an audited public-range classifier. No domain-ownership verification is claimed.                                                                                                                                                          |
| Certifications | Local parser, same numerical policy; explicit self-reported provenance                                                                                      | No provider call or certification authenticity assertion.                                                                                                                                                                                                                                                                                        |
| Dev Blogs      | Dev.to/Hashnode calls share controls; upstream failures/GraphQL errors cannot become empty success                                                          | Verify both live contracts and terms. Complete snapshot policy retains good data when either source fails; Medium has no implemented adapter.                                                                                                                                                                                                    |

No live provider permission/contract test consumed real credentials or quotas in this task.

## Configuration, migration, rotation and rollback

Every new setting is documented inline in `.env.example` with purpose, units, allowed range, safe default and effect. Existing credentials/settings were preserved. Required new key settings are `INTEGRATION_TOKEN_KEYS` (JSON key-ID to base64 32-byte key) and `INTEGRATION_TOKEN_ACTIVE_KEY`. Defaults are empty and fail closed; provision cryptographically random keys in the deployment secret manager. Never derive these keys from JWT_SECRET or log them.

Other new controls: `INTEGRATION_ACTIONS_PER_MIN=10`, `INTEGRATION_PROVIDER_REQUESTS_PER_MIN=60`, `INTEGRATION_USER_PROVIDER_REQUESTS_PER_MIN=20`, `INTEGRATION_GLOBAL_CONCURRENCY=8`, `INTEGRATION_PROVIDER_CONCURRENCY=2`, `INTEGRATION_REQUEST_TIMEOUT_MS=10000`, `INTEGRATION_OPERATION_TIMEOUT_MS=60000`, `INTEGRATION_SYNC_LOG_RETENTION_DAYS=90`. Existing sync interval/batch/default scheduling and webhook secret settings remain in place. Restart workers consistently after policy/key-ring changes. Mongo transaction support and existing configured shared Redis are prerequisites; a standalone Mongo node cannot silently emulate transactional safety.

Operator rollout, from backend with configuration supplied through the normal secure process environment:

1. Snapshot/backup the affected collections, inspect production replica-set/transaction support and shared Redis availability, and stop all Integrations mutation traffic/workers for coordinated migration. Do not stop or flush unrelated services/quotas.
2. Provision the same key ring to every worker. Run `node src/scripts/migrateIntegrationTokens.js` for counts/validation only. Resolve invalid envelopes/configuration without printing credentials.
3. With the maintenance window still active, run `node src/scripts/migrateIntegrationTokens.js --apply`. Each document updates only if the original token fields still match. Re-run dry-run; require zero eligible plaintext/conflicts. Conflicts require a controlled rerun, not overwriting a newer token. The migration is restartable and idempotent; it never clears tokens or deletes connections.
4. Run `node src/scripts/inspectIntegrationIndexes.js` and review actual deployment query plans/cardinality. Apply only approved indexes with `--apply`; approve TTL behavior separately before that command. Existing historical expiration backfill is deliberately outside this task.
5. Deploy all compatible readers together, reopen traffic, smoke-test OAuth/webhook/sync/disconnect and all downstream reads. Reconnect legacy OAuth connections to establish provider account IDs/ownership; migrating a token does not establish ownership.

Rotation: add a new independently generated key to all workers while retaining the old key; switch the active ID consistently; run token migration dry-run, then `--apply --rotate` during coordinated mutation quiescence. Verify that all envelopes decrypt and use the intended ID, including refresh credentials. Remove an old key only after all data/backups/rollback versions that need it are accounted for. Tests cover old-key reads, active-key re-encryption and repeat no-ops.

Rollback: stop Integrations writes/workers, retain all relevant keys and compare backups/counts. Revert the active ID to a retained prior key and re-encrypt through the same `--rotate` procedure if required. Roll back only to code that understands the versioned encrypted envelope and existing schema additions; deploying the old plaintext-only reader is not a valid rollback. Prefer a compatible forward fix. Never restore plaintext into active collections as an automatic rollback. Historical records and existing indexes need no destructive reversal; optional additive indexes can remain. Any operator decision to drop an index or restore a backup requires separate review and authorization.

Disconnect commits local credential removal and insight removal first, then attempts bounded GitHub token revocation. Remote failure never reconnects the local account: response marks `manual_revocation_required`. Providers lacking a verified revoke contract return `not_supported`. Account deletion removes integration credentials locally in the same transaction as User deletion; remote grants may still require provider-side revocation. No raw token is retained in a retry queue after deletion.

## Monitoring and recovery

Monitor sanitized sync success/failure history by provider/reason, lastSyncedAt/nextSyncAt lag, expired lease counts, action/provider 429s, control-store 503s, request timeouts/circuit cooldowns, Redis memory/noeviction pressure, transaction abort/write-conflict latency and receipt growth. Never log key-ring JSON, tokens, OAuth codes/states, request authorization headers or raw Axios errors.

On worker loss, leave its claim in place until expiry; another worker can claim due work. Do not clear all leases or reset provider counters. On Redis outage, restore the shared control store and let normal expiry/cooldowns recover; ordinary Mongo reads and local disconnect remain usable. On token-decryption failure, restore the correct retained keys or perform the offline migration; do not enable a plaintext fallback. On provider outage, leave the last good insight in place and use failed history/next schedule for diagnosis. Review manual-revocation-required responses operationally. Confirm replica-set transactions and candidate query plans in the real topology before rollout.

## Verification and remaining gates

Retained [acceptance.tap](acceptance.tap), [regression.tap](regression.tap), [frontend-tests.txt](frontend-tests.txt), [final-checks.json](final-checks.json), [cleanup.json](cleanup.json) and query-plan JSON identify exact results. Commands were run from backend unless noted:

```text
node --test src/tests/integrationSyncService.test.js src/tests/integrationsLifecycle.test.js src/tests/integrationsAdapters.test.js src/tests/integrationInsightService.test.js
node --test src/tests/integrationsProduction.integration.test.js
node --test src/tests/scoringFoundation.test.js src/tests/transparentScoringService.test.js src/tests/skillGapEvidence.test.js src/tests/skillGapScoring.test.js src/tests/scenarioLegacyParity.test.js src/tests/scenarioSimulatorContext.test.js src/tests/careerSprintService.test.js src/tests/careerSprintHardening.test.js src/tests/careerSprintPlanningFinalization.test.js src/tests/careerSprintReleasePolicies.test.js src/tests/weeklyReportScheduler.test.js
node frontend/node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.app.json
npm test -- --watch=false --include=src/app/shared/services/integrations.service.spec.ts
npm run build
node docs/verify-docs.js
node --check <each changed backend JavaScript file>
node frontend/node_modules/prettier/bin/prettier.cjs --write <explicit task file paths and retained style options>
node frontend/node_modules/prettier/bin/prettier.cjs --check <the same explicit paths/options>
git diff --check
git diff --cached --check
```

The TypeScript/formatter/docs commands use repository root; npm commands use frontend. Frontend service contracts passed **2/2**; affected backend regressions passed **87/87**; TypeScript passed. **Final post-format combined backend run: 127/127 passed, zero failures/skips (41.277 seconds).** The Integrations portion is 40 tests including its parent and 19 isolated subtests; 87 are affected downstream regressions. The final `regression.tap` transcript supplies all results, including two-worker duplicate/refresh fencing, encryption/migration, OAuth identity/expiry, webhook/HTTP/replay, shared quotas/outages, real timeouts, SSRF, concurrent updates, ownership isolation, provenance/cache propagation, query plans and deletion. Initial acceptance fixture assertions mistakenly expected 76 for a legacy formula result of 75; those test expectations were corrected without changing the formula. An initial documentation check required the repository's exact section headings; those were added. Formatting discrepancies were corrected and rechecked. No expensive full-suite or soak run was used to imply deployment readiness.

Required deployment gates:

1. Resolve the unrelated production build budget failure and rerun the build in the intended final checkout.
2. Provision/rotate production keys, complete authorized plaintext migration and verify compatible readers on every worker.
3. Verify transaction-capable production Mongo, shared Redis topology/latency/capacity and approved actual query plans/indexes/retention.
4. Run real provider OAuth/permission/revocation/webhook/public-host contract checks, with provider budgets and registered redirects reviewed.
5. Complete a deployment-equivalent multi-instance failure/soak/capacity run, including event-loop delays, Redis command deadlines, worker restart and provider quota/reset behavior. Existing Scenario verification already records shared-control latency under bursts; this task does not override it.
6. Verify the full authenticated browser propagation flow across the six modules and the intended source/index state after concurrent work is reconciled. Locally mocked provider boundaries do not satisfy live provider acceptance.

## Initial verdict — 25 October (historical)

- SECURITY HARDENING: **PASS** — implemented and locally verified; live permission/key rollout gates remain.
- DISTRIBUTED SYNC: **PASS** — real isolated Mongo transactions/leases and two independent workers.
- RATE LIMITING: **PASS** — shared atomic Redis tests; disconnect safety exception documented.
- CACHE AND INDEX VALIDATION: **PASS** — isolated measured plans and cross-worker revision cache checks; production plans remain a release gate.
- CROSS-MODULE REGRESSION: **FAIL** — 87 backend tests, TypeScript and two frontend contract tests pass, but the required production build fails on the unchanged Scenario stylesheet budget.
- MULTI-WORKER ACCEPTANCE: **PASS** — bounded local synthetic acceptance only.
- READY TO LOCK LOCALLY: **NO**.
- READY FOR PRODUCTION: **NO**.

## Final local acceptance — 26 October 2026

The Scenario build blocker is resolved through real component decomposition, coordinated read-only with its owner. The existing parent now owns API orchestration/immutable evaluation state; four standalone OnPush children own context/templates, inputs, results, and history/comparison HTML, scoped styles and presentation logic. Template Configurator, scoring and API contracts remain unchanged. The detailed UI report is `frontend/verification/scenario-simulator/decomposition/REPORT.md`; exact paths/sizes/hashes are in its component-inventory.json. Compiled styles: shell 9,402 bytes; context 11,032; inputs 21,227; results 31,277; history 24,638, versus 85,382 for the old single sheet. Existing 48/64 KiB budgets remain unchanged.

Production build **PASS**; final post-cleanup run 112.893 s, main-USPTMQ7U.js, initial 3.36 MB raw / 526.65 kB estimated transfer. The earlier passing run (77.437 s) is also retained. Unrelated Landing Page warning remains. TypeScript passes. **18/18** focused frontend tests pass; **20/20** page-relative visual comparisons pass; **8/8** actual production-bundle viewport/theme smoke scenes pass without overflow/page errors. No 127-test rerun or expensive soak was performed.

### Authenticated API evidence and confirmed cache correction

The new `backend/src/tests/integrationsLocalAcceptance.test.js` mounts the existing routes with real JWT authentication and disposable Mongo replica-set/Redis fixtures, controlling only external provider/AI boundaries. It performs 22 actual HTTP requests: unauthorized rejection, manual connect with unverified observation provenance, owner isolation, sync, sanitized provider failure/last-good preservation, OAuth state and server-derived identity, one-time state rejection, ingest/serialized encrypted token refresh, Dashboard analytics, Scenario persisted suggestions, Sprint revision cache, Portfolio score, Weekly Report generation with email disabled, and disconnect clearing credentials/providers/cache signals. Skill Gap ownership eligibility is exercised through the shared verified-skills signal and preserved earlier evidence regressions; a full live six-module browser/provider acceptance remains a deployment gate.

A stronger provenance assertion confirmed an additional defect: after disconnect, the Portfolio API cache reused an integration input of **64** rather than unavailable/null. The old cache key depended on profile/resume inputs and ignored the authoritative integration revision. `backend/src/controllers/analysiscontroller.js` now reads the owned integration snapshot before cache reuse and stores/matches `analysisData.portfolioIntegrationRevision`; the same snapshot feeds the unchanged formula on a miss. Old snapshots are not migrated or relabeled. The same API request after disconnect now contains **null** integration evidence. Overall score happens to remain 70 for this fixture; numeric equality alone would have missed the defect. No scoring weights, API envelope or provider request behavior was changed.

The final post-cleanup targeted run passed **28/28**, including the isolated API scenario and all affected scoring/lifecycle checks (zero failures/skips). The earlier scoring/lifecycle group passed **27/27**. The final isolated API test passed separately after the correction, including the exact provenance assertion. An attempted combined 28-test run passed those 27 checks but met a disposable Redis startup failure; its evidence is retained rather than presented as a clean combined run. A bounded readiness probe and bounded fixture-only Redis diagnostics were added to `backend/src/tests/fixtures/integrationsRuntime.js`; the subsequent API run passed. Final API evidence is in `local-acceptance/api-retry.tap` and `local-acceptance/api-results.json`; the proven pre-fix failure is retained in api-before-cache-fix.tap/json. Fixture cleanup verified Mongo/Redis stopped and 118 owned files removed, with zero application database access or quota resets.

### Exact incremental source inventory

- Existing Scenario page .ts/.html/.scss; new `components/scenario-context.component.{ts,html,scss}`, `scenario-inputs.component.{ts,html,scss}`, `scenario-results.component.{ts,html,scss}`, `scenario-history.component.{ts,html,scss}`, `scenario-presentation.ts`, `scenario-components.spec.ts`, and `styles/_scenario-shared.scss`, all beneath `frontend/src/app/pages/scenario-simulator/`.
- `frontend/scripts/verify-scenario-decomposition-ui.cjs`.
- `backend/src/controllers/analysiscontroller.js` (cache revision only), `backend/src/tests/integrationsLocalAcceptance.test.js` (new API fixture suite), `backend/src/tests/fixtures/integrationsRuntime.js` (fixture readiness/diagnostics only).
- Updated Scenario/Integrations feature and cache documentation, this report, retained source inventories, logs, measurements and screenshots. Existing historical evidence, encryption/rate-limit/distributed-sync services, migrations, user environment values and concurrent auth/Landing work were preserved. No source file was moved or deleted.

### Remaining deployment gates

1. Provision and rotate production token keys; perform the separately authorized plaintext migration and verify compatible readers on every deployed worker.
2. Verify deployed Mongo transaction support, Redis topology/latency/capacity, actual production query plans/indexes and approved retention policy.
3. Complete real provider OAuth scopes/redirects/refresh/revocation/webhook/public-host contracts within approved quotas.
4. Complete deployment-equivalent multi-instance failure/soak/capacity acceptance; historical Scenario control-store latency findings remain open at that scope.
5. Complete the live authenticated browser/provider propagation flow across all six downstream modules in the intended deployed topology. Local synthetic boundaries do not establish provider or deployed-infrastructure readiness.
   Local environment note: C: was full during verification; task temporary files were moved to D:. Free space was subsequently measured at approximately 1.97 GB. Tooling completed with the documented process-local workaround; this is not an unresolved application correctness blocker.

### Final local verdict

- PRODUCTION BUILD: **PASS**.
- CROSS-MODULE INTEGRATION: **PASS** — bounded local authenticated API, cache/provenance and focused UI/regression scope above.
- LOCAL MODULE LOCK: **YES** — local implementation/acceptance scope, not deployed/provider acceptance.
- PRODUCTION READINESS: **NO**.
- REMAINING BLOCKERS: the five explicit deployment gates above.

No deployment, production configuration edit, production migration, quota reset, secret replacement, commit or push was performed.

Final post-cleanup acceptance: production build PASS (final-production-build.txt), frontend 18/18 PASS (final-frontend-tests.txt), backend/API 28/28 PASS (local-acceptance/post-cleanup-tests.tap), TypeScript/syntax/formatting/docs/staged and unstaged whitespace PASS, and angular.json budgets unchanged. No source files were moved/deleted; exact task scratch and generated bytecode removals were verified by path/size/hash after an initial broad cleanup request was rejected. Concurrent auth/Landing source was not changed by this task.

## Follow-up: Scenario component folder organization (26 October 2026)

The four extracted frontend components now each have a named folder with .ts, .html, .scss and .spec.ts files. Shared presentation helpers moved to utils/. Only import paths and test placement changed; no Integrations/backend contracts changed. Production build (49.127 s), TypeScript, all 19 affected frontend tests, formatting and Git whitespace checks pass. All four compiled stylesheet sizes remain unchanged. Exact moves and evidence: frontend/verification/scenario-simulator/decomposition/FOLDER-ORGANIZATION-REPORT.md and folder-organization.json. Local lock remains YES; production readiness remains NO, with the existing deployment gates unchanged.

## Final Integrations local acceptance — 26 October 2026, reconciled checkout

This is the current acceptance decision and supersedes the earlier local verdicts. The user-authorized source is task/integrations; PR/merge target is not applicable. AGENTS.md, the architecture charter, historical report, current routes/controllers/services, isolated fixtures and Scenario folder report were reviewed. No production source redesign was needed.

### Fresh authenticated end-to-end evidence

The existing Express APIs ran with real JWT authentication against disposable MongoDB 8.2 replica-set and shared Redis fixtures. Only external provider transport, provider revocation and AI generation boundaries were controlled; email was disabled. All 32 HTTP requests are recorded in [api-results.json](final-local-acceptance/api-results.json).

- Unauthenticated connection reads return 401. Foreign-account reads contain no owned providers; a foreign sync returns the existing 409 contract, and a foreign disconnect does not change the owner's connection.
- Manual Connect persists provider-observed data without ownership verification. Sync and ingest preserve this distinction. OAuth binds server-derived provider identity, rejects reused state with 400 and ignores the untrusted requested handle. Encrypted refresh happens exactly once.
- An intentional provider failure returns 502 and preserves the last good insight. Focused sync regressions also assert sanitized errors, encrypted-credential fail-closed behavior, lease-mediated commit and no provider call for an unclaimed job.
- After the initial successful GitHub observation, a second successful sync changes the authoritative integration score from **64 to 27**, replaces rather than duplicates the GitHub provider snapshot, and replaces verified TypeScript skills with Testing. Manual Algorithms evidence remains unverified.
- Portfolio first reuses the unchanged owned cache (fromCache=true). The changed insight invalidates it (fromCache is not true), its scoring evidence adopts **27**, and the next request reuses that new revision (fromCache=true). The locked formula is unchanged; this asserts provenance rather than relying only on the rounded total.
- Dashboard persisted analytics, Scenario suggestions, Sprint provider/revision adoption, Weekly Report generation without email and the shared verified-skills signal are exercised. Scenario suggestions adopt Testing after the changed sync. Skill Gap eligibility is checked through its shared verified-skills input, rather than claiming a full Skill Gap browser flow.
- Disconnect clears both provider snapshots and encrypted credentials. Sprint drops the provider signal; Portfolio rejects its prior integration cache and returns unavailable/null integration evidence. The fixture's overall Portfolio score is 70 before and after disconnect; score equality does not imply stale evidence.

### Production build and focused checks

| Check                                 | Exact result                                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Stable final Angular production build | PASS, **78.698 s**, main-2BLWOK3K.js, initial **3.37 MB**, estimated transfer **526.99 kB**                             |
| Existing hard budgets                 | PASS: initial 5 MB and component style 64 kB; angular.json unchanged                                                    |
| Remaining warning                     | Concurrent Landing stylesheet **56.67 kB** vs 48 kB warning; below 64 kB hard limit                                     |
| Backend/API focused regression        | **33/33 PASS**, zero failures/skips, 47,175.4457 ms                                                                     |
| Frontend affected regression          | **19/19 PASS**, eight spec files, zero failures                                                                         |
| Application TypeScript                | PASS                                                                                                                    |
| Changed backend test syntax           | PASS                                                                                                                    |
| Documentation verifier                | PASS, 37 Markdown files / 17 feature documents                                                                          |
| Explicit-path formatter write/check   | PASS for changed test and final report/evidence                                                                         |
| Working and staged Git whitespace     | PASS                                                                                                                    |
| Isolated fixture cleanup              | Mongo/Redis stopped; 118 owned files removed; zero application databases, quota resets or recursive directory deletions |

Four build invocations were retained because concurrent Marketplace and auth SCSS edits changed the input snapshot between checks; no full suite or expensive load test was repeated. The final accepted build verified **no frontend source changes during compilation**, recorded in [accepted-build-stability.json](final-local-acceptance/accepted-build-stability.json). Earlier passing builds remain historical evidence, not substituted for the stable final result.

### Reconciliation, exact changes and infrastructure scope

This pass changed only **backend/src/tests/integrationsLocalAcceptance.test.js** and this report, plus retained evidence under **backend/verification/integrations/final-local-acceptance/**. The test now proves changed-insight cache adoption and foreign mutation isolation. Its optional fixture-only INTEGRATION_ACCEPTANCE_OUTPUT_DIR redirects results to a new evidence folder, preserving earlier api-results.json. It is not a deployment configuration variable. No source files were moved or deleted.

Concurrent source changes were preserved, not reset, staged or reformatted:

- `frontend/src/app/auth/login/login.scss`
- `frontend/src/app/auth/signup/signup.scss`
- `frontend/src/app/features/auth/pages/forgot-password/forgot-password.component.scss`
- `frontend/src/app/features/auth/pages/otp-verification/otp-verification.component.scss`
- `frontend/src/app/features/auth/pages/reset-password/reset-password.component.scss`
- `frontend/src/app/pages/integrations-marketplace/integrations-marketplace.component.scss`
- `frontend/src/app/pages/integrations-marketplace/integrations-marketplace.component.ts`
- `frontend/src/app/pages/landing-page/landing-page.component.scss`
- `frontend/src/app/shared/services/landing-theme.service.ts`
- `frontend/src/app/shared/styles/_auth-theme.scss`

[preflight.json](final-local-acceptance/preflight.json), [source-reconciliation.json](final-local-acceptance/source-reconciliation.json) and accepted-build-source-hashes.json retain exact branch/status and source fingerprints. Backend production services/controllers, token storage/migrations, models/index definitions, quotas, scoring and contracts did not change during this acceptance pass. Existing staged work and credentials were preserved. No new runtime variables, dependencies, index changes, credential migration, deployment, commit or push were introduced.

Because these paths are unchanged, the earlier isolated encryption/one-time-state/HMAC/replay/SSRF, shared-quota outage, two-worker fencing/refresh and measured explain-plan evidence remains applicable within its original local scope. Those expensive cases were not rerun or misreported as fresh multi-worker acceptance. Fresh lifecycle/sync regressions cover the affected auth/ownership/persistence boundaries; the API fixture uses real Mongo transactions and Redis without touching production or resetting counters. Existing query-plans.json retains callback integration_oauth_state_v1, webhook integration_webhook_identity_v1, polling integration_due_v1 and retention integration_retention_v1 index evidence. No index was proposed, added or removed, so no new production explain audit was needed. Real deployed query plans remain a deployment gate.

### Reproduction and retained evidence

The fixture process used INTEGRATION_TEST_MONGOD pointing to the installed MongoDB 8.2 binary, process-local TEMP/TMP pointing to the existing task runtime-temp directory, and INTEGRATION_ACCEPTANCE_OUTPUT_DIR pointing to this evidence directory. Ephemeral keys/identities were generated only inside the isolated process; no real provider credentials or quotas were used. The runtime-temp directory contained zero files at finalization. No temporary helper scripts were created. Retained logs are essential evidence, not discarded scratch.

```text
npm run build # frontend; accepted-production-build.txt is the stable final run
node --test --test-concurrency=1 src/tests/integrationsLocalAcceptance.test.js src/tests/integrationsLifecycle.test.js src/tests/integrationSyncService.test.js src/tests/scoringFoundation.test.js src/tests/transparentScoringService.test.js # backend
npm test -- --watch=false --include=src/app/pages/scenario-simulator/**/*.spec.ts --include=src/app/shared/services/scenario-simulator.service.spec.ts --include=src/app/shared/services/integrations.service.spec.ts # frontend
node frontend/node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.app.json
node --check backend/src/tests/integrationsLocalAcceptance.test.js
node docs/verify-docs.js
node frontend/node_modules/prettier/bin/prettier.cjs --single-quote --trailing-comma none --print-width 100 --write backend/src/tests/integrationsLocalAcceptance.test.js
node frontend/node_modules/prettier/bin/prettier.cjs --single-quote --trailing-comma none --print-width 100 --check backend/src/tests/integrationsLocalAcceptance.test.js
git diff --check
git diff --cached --check
```

Fresh evidence: [focused-backend.tap](final-local-acceptance/focused-backend.tap), [frontend-tests.txt](final-local-acceptance/frontend-tests.txt), [accepted-production-build.txt](final-local-acceptance/accepted-production-build.txt), [api-results.json](final-local-acceptance/api-results.json), final-checks.json and file-inventory.json. Formatter report/evidence commands use the installed Prettier with explicit paths and an empty/nonexistent ignore path so Markdown reports are checked; source options remain the retained repository/per-file convention.

### Deployment-only requirements

1. Provision/rotate production token keys and verify compatible readers on every worker; perform any plaintext credential migration only after separate authorization, with the documented backup/rollback steps.
2. Validate deployed Mongo transaction support, shared Redis topology/latency/capacity, actual deployed query plans/indexes and approved retention policy.
3. Complete real provider OAuth scope/registered redirect/identity/refresh/revocation/webhook/public-host contract acceptance within approved quotas.
4. Complete deployment-equivalent multi-instance failure, worker restart, quota/reset, soak and capacity acceptance; retained Scenario control-store latency findings are not closed by these local checks.
5. Complete live authenticated browser/provider propagation across Portfolio Score, Skill Gap, Dashboard, Scenario Simulator, Career Sprint and Weekly Reports in the intended deployed topology.

### Current final verdict

- PRODUCTION BUILD: **PASS**.
- LOCAL END-TO-END FLOW: **PASS** — bounded authenticated API flow with controlled external providers.
- SECURITY & INTEGRATION REGRESSION: **PASS** — fresh focused checks plus unchanged retained security/distributed/index evidence, at their stated scopes.
- READY TO LOCK LOCALLY: **YES** — Integrations local implementation/acceptance scope.
- READY FOR PRODUCTION: **NO**.
- REMAINING DEPLOYMENT GATES: the five numbered requirements above. No unresolved Integrations local correctness blocker was found.

No deployment or credential migration was performed. Any subsequent source edits require checks appropriate to those edits; this verdict identifies the retained accepted snapshot.
