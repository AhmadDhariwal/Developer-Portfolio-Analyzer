# Profile and Settings operations

These are operator steps, not changes executed against production by this task.

## Public image persistence

`PUBLIC_IMAGE_STORAGE_ROOT` is an absolute filesystem path. Production startup rejects a missing or relative value. Development defaults to `backend/uploads`.

Mount the same durable filesystem at that path on every API worker. Run workers with an identity that can read and write its files; new files use mode `0600`. Keep `avatars/` and `portfolio-images/` directly inside the root. Directory junctions/symlinks that redirect either child outside the configured root are refused on writes and cleanup.

Before switching roots, copy existing avatar and portfolio-image directories to the new volume, verify counts/checksums/readability, and retain the source for rollback. Stored `/uploads/avatars/...` and `/uploads/portfolio-images/...` URLs remain compatible. Mounting an empty volume hides existing assets. No source assets were migrated or deleted by this task.

The static `/uploads` route uses this root and the existing restricted image allowlist. It does not expose PDF/resume files. Resume storage retains its existing backend/uploads confinement and must also be durable in the deployment. Public images remain public assets by URL; publication controls protect profile/resume API access and do not erase previously downloaded images.

## MongoDB

Use a transaction-capable replica set or compatible sharded deployment. Integration admission already requires transactions. Profile initialization, account deletion and atomic analytics now use the same established transaction helper, snapshot reads, majority writes and a bounded commit deadline.

Provision the additive `accountdeletioncleanups` collection under the deployment's collection-creation policy before rollout. Its built-in `_id` index identifies one receipt per deleted account. It deliberately has no TTL: unfinished cleanup must not expire. `User.sessionRevision` defaults to zero; existing documents/tokens remain compatible until a password change increments the revision. No data migration or index deletion was performed.

Audit existing indexes without deleting records: public-profile slug uniqueness; owned resume/history indexes; visit `(profileId,viewerHash)` uniqueness and expiry; public cache `profileId` uniqueness and expiry; integration owner/provider uniqueness. Existing duplicate owner portfolios and very large accounts require a read-only deployment audit, not automatic destructive repair.

Account deletion rolls back if the user still owns an organization. Transfer ownership first. Shared organization jobs are closed and retained; shared organization audit/invitation records are not silently erased. Review their applicable retention policies separately.

## Deferred file cleanup

Deletion atomically writes a cleanup receipt with owned resume URLs, removes owned database records and deletes the account. Immediate filesystem cleanup is attempted after commit. A filesystem failure keeps the receipt for retry; it does not resurrect the account or report the database transaction as failed.

Run the retry entry point under the same explicit Mongo and storage configuration as the API:

```powershell
# Set MONGODB_URI (or MONGO_URI) through the approved secret/configuration mechanism.
node backend/src/scripts/retryAccountDeletionCleanup.js
```

The command does not load a local `.env` or infer a production target. Schedule it through the deployment's existing job supervisor and alert on old/failed receipts. No scheduler or production connection was created here. Cleanup checks surviving resume references, confines local PDFs, and deletes public image filenames only for the exact deleted owner prefix. Shared public provider snapshots/catalogs and other accounts are retained.

Changing the image-root configuration while receipts remain pending requires copying the source files first. Back up the volume and test restoration. Abandoned portfolio-image uploads and legacy assets require an approved inventory/retention procedure; this implementation does not silently sweep old files.

## Redis and abuse controls

Ordinary portfolio rendering caches remain optional: bounded process memory and Mongo fallback preserve availability after current Mongo authorization. Old cache revisions become unreachable after content changes. No Redis scan/flush or broad key deletion was introduced.

Avatar and portfolio-image uploads use the existing strict shared upload limiter (10/account/hour). Public contact retains strict sender and recipient limits. These operations return 503 when the shared limiter is unavailable. Do not substitute process-local production fallbacks. Configure the existing Redis client, TLS and credentials through the approved deployment mechanism and validate its connectivity separately. Trust-proxy configuration must match the actual proxy topology.

Existing general authentication throttles are process-local. Multi-worker production still needs an approved shared/gateway authentication abuse policy; this task does not silently provision one.

## Authentication rollout

Deploy credential-revision checking to every worker together; an old worker cannot enforce a revision it does not inspect. Keep the JWT signing secret consistent across workers. Password changes increment the persisted revision and return a replacement token for the current browser. Password resets increment the revision; old sessions fail authentication. Protected, optional-user and authenticated-preview paths check revisions.

Recovery keeps the existing `userId` response field as a string, now an opaque authenticated encrypted handle. Existing issued ObjectId OTP flows are accepted for compatibility; invalid/absent-user verification failures have the same public response. Workers derive the handle key from the existing JWT secret with domain separation. Secret rotation intentionally invalidates outstanding recovery handles. No new credential is required.

Recovery responses use a fixed 750 ms delivery budget and conditional wording. SMTP can finish afterward; configure mail transport deadlines and monitor delivery. Registration still uses its existing duplicate-email validation contract; approving that disclosure policy remains a product/security release gate.

## Reproduce local acceptance

Start a task-owned MongoDB replica set on loopback port 27139 with disposable storage, then set:

```powershell
$env:PROFILE_ACCEPTANCE_MONGO = 'mongodb://127.0.0.1:27139/?replicaSet=profileAcceptance'
node --test backend/src/tests/profileAccountSecurity.test.js backend/src/tests/profileSettingsProduction.test.js backend/src/tests/developerContextService.test.js backend/src/tests/publicPortfolioHardening.test.js backend/src/tests/integrationLinkedProfiles.test.js backend/src/tests/recruiterRankingEngine.test.js backend/src/tests/newsHubHardening.test.js backend/src/tests/newsFlow.test.js backend/src/tests/careerSprintReleasePolicies.test.js
```

The integration test refuses a different host/port, creates a random `profile_acceptance_*` database, uses fixture files, and drops only that database after checking its name. Without the explicit environment variable, that integration case is skipped; a skipped run is not full acceptance.

Build the frontend, make Playwright available via `PROFILE_ACCEPTANCE_PLAYWRIGHT` (module path) and optionally set `PROFILE_ACCEPTANCE_CHROME` (Chrome executable path), then run:

```powershell
node backend/src/scripts/verifyProfileSettingsBrowser.js
```

The browser harness serves the production frontend with explicitly mocked fixture APIs. All requests outside its loopback server are blocked. Its API mock does not replace the separate real Mongo/HTTP acceptance test. Screenshots include intentional validation/conflict feedback and a 500-character unbroken biography stress case.
