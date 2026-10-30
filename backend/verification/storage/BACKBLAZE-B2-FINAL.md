# Backblaze B2 — final implementation and acceptance

Date: 29 October 2026 (Asia/Karachi). Branch: `task/profile`; PR/integration target: not applicable.

**Implementation complete; focused local acceptance passes. External B2/deployment configuration remains a release gate.** No commit, merge, push, deployment, production migration, bucket/policy mutation or secret change was performed.

## Scope and baseline

Read `AGENTS.md`, the solution architecture charter, the Profile final acceptance report and its storage/retention gates, existing avatar/portfolio/resume upload and download paths, storage configuration, and account-deletion cleanup. The checkout already contained staged Profile changes and unstaged UI/screenshot work. Those were preserved; this task adds backend storage changes in the same branch. The original index was not reset or restaged. Frontend files were not edited by this task. Concurrent updates to the pre-existing Profile HTML/SCSS and screenshots were observed and left untouched.

The implementation retains the Angular/Express/Mongoose monolith, canonical developer identity, all scoring rules, analysis/history records, existing API paths and JSON response shapes. The only dependency addition is the official `@aws-sdk/client-s3`, pinned to `3.1159.0` with its locked transitive dependencies. An unrelated optional lockfile entry pruned by npm was retained from the baseline.

## Implementation

### Two private buckets and S3 adapter

- `images` and `resumes` are internal aliases for the two operator-supplied private bucket names; no production bucket names or credentials were invented.
- Each alias has its own endpoint, region and explicit application-key credentials. Configuration rejects missing/partial settings, non-B2/non-HTTPS endpoints, identical buckets, and reused credential pairs. There is no ambient AWS credential-provider fallback.
- New object keys are generated: `v1/<kind>/<owner ObjectId>/<random UUID>.<validated extension>`. Original names, email addresses and user-supplied paths never become object keys.
- Uploads request SSE-B2 (`AES256`), fixed content length/type, Content-MD5 and SHA-256 metadata. The SDK uses path-style addressing and `WHEN_REQUIRED` checksum behavior for S3-compatible service compatibility. PUT has one attempt; blindly retrying an uncertain PUT can create another B2 version.
- Each SDK operation has a 15-second total deadline, 3-second connection timeout and 10-second request timeout. Per-process admission is capped at eight active operations with immediate 503 on saturation. Images remain limited to 2 MiB and PDFs to 10 MiB.
- Downloads are backend-proxied, version-pinned and bounded. Length and SHA-256 are verified against the persisted receipt before returning bytes. Provider content headers are not trusted as the application content type. No B2 credentials, bucket URLs, signed provider URLs or raw SDK failures enter API payloads.
- B2 failures return sanitized failures; new B2 writes never silently fall back to filesystem storage.

Backblaze requires a non-master application key for S3 compatibility and supports bucket-scoped capabilities. The application uses separate clients and fixed bucket aliases; actual key scopes/private ACLs must still be checked by the operator. [B2 S3 introduction](https://www.backblaze.com/apidocs/introduction-to-the-s3-compatible-api), [B2 application-key capabilities](https://www.backblaze.com/docs/cloud-storage-s3-compatible-app-keys).

### Durable references and cleanup

`StoredAsset` is a small persistence ledger for storage receipts, not a second profile/identity store. It records the owner, generated reference/key, bucket alias/name, exact provider version, byte length/hash/type and lifecycle state. Credentials are never persisted there.

Lifecycle:

1. Reserve `uploading` in an owner-fenced Mongo transaction before the provider operation.
2. After PUT, persist the returned version and move to `staged` in a fresh owner-fenced transaction.
3. Commit domain references and `ready` together: avatar exchange, portfolio references or resume metadata plus active selection.
4. Replaced/removed managed references and account deletion mark objects `deleting` durably. Provider operations occur outside Mongo transactions.
5. Cleanup checks current references inside the same owner fence used by mutations/deletion. It cannot restore an object to `ready` after deletion or delete an object that a winning transaction still references.

Uncommitted upload reservations become cleanup candidates after two minutes; unattached staged objects after 24 hours. Ready historical resumes do not expire. There is no Mongo TTL that could discard a pending cleanup receipt. Failed cleanup backs off for one minute, increments a counter, and continues processing other candidates; one failure does not terminate the batch. Provider batches contain at most 50 receipts; the CLI then attempts at most 50 account-receipt finalizations without launching another provider batch per account.

B2 buckets are versioned. Cleanup lists versions only for the exact generated key and deletes concrete version IDs, including matching hidden/delete-marker entries, never prefix neighbors. Listing is paginated and bounded. This matters because unversioned deletion can leave old private bytes behind. [B2 version deletion](https://www.backblaze.com/apidocs/s3-delete-object).

For an uncertain PUT with no recorded version, an empty listing is not considered proof that the operation never committed. Its receipt is retained for another retry or explicit operator verification. A later provider commit remains discoverable. If a worker dies after deleting an unrecorded version but before finalizing its receipt, verification/acknowledgement of that now-empty receipt is an operational step; this task does not silently drop uncertain evidence.

Managed replacement APIs defer provider deletion to the bounded worker; successful reference swaps do not wait on remote delete timeouts. Account deletion also avoids provider I/O on its response path, marks all managed assets in the existing deletion transaction and retains the existing cleanup receipt until remote and legacy cleanup finish. Local legacy cleanup proceeds even when B2 cleanup fails. Existing organization ownership safeguards and shared-record retention remain intact.

### Existing APIs and privacy

| Existing surface                                 | B2 behavior / compatibility                                                                                                                                                                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/profile/avatar`                       | Same response fields and app `/uploads/avatars/...` URL shape. Actual image bytes determine extension. Owner-fenced atomic exchange schedules old managed objects for cleanup after commit.                                                                               |
| `POST /api/public-profiles/me/project-image`     | Same `imageUrl`, `mimeType`, `size` response. An uploaded object remains staged until an owned portfolio references it. Cross-user managed references are rejected.                                                                                                       |
| `/uploads/avatars/...`                           | Managed bytes are proxied from the private images bucket. Current avatars keep their established public-by-app-URL semantics; missing/inactive/deleted owners are denied. No private bucket is made public.                                                               |
| `/uploads/portfolio-images/...`                  | Anonymous reads require current publication, enabled platform visibility, a current reference and a visible section. Owner previews use a purpose-bound media credential. Unpublication/hidden sections cannot reuse a cached managed response.                           |
| `POST /api/resume/upload`                        | Same JSON response. B2 mode parses a bounded in-memory PDF, persists the private object, then atomically commits file metadata and active selection. No persistent local staging file is needed for this path. Filesystem mode keeps its established path-based behavior. |
| Resume analysis                                  | The existing parser/scoring pipeline reads the selected owned B2 object bytes. Existing owner checks occur before object retrieval; no scoring or cache-identity formula changes.                                                                                         |
| Existing owner/public portfolio resume endpoints | Same PDF download behavior, filename and content type. Owner JWT or current publication/CTA checks run first. B2 reads are version-pinned; private PDFs are never exposed through the static uploads route.                                                               |

New managed responses use `private, no-store`; owner-specific image responses vary by Cookie. Ordinary legacy static URLs retain their established filesystem behavior and cache policy. Historical filesystem images are not silently reclassified or deleted when B2 is enabled.

Native image elements do not carry the API Authorization header. Existing authenticated Profile/portfolio APIs therefore issue a backend-signed, HttpOnly, SameSite=Lax, `/uploads`-scoped media cookie, Secure in production. Its audience differs from API JWTs, lifetime is 20 minutes, and every private read checks the current owner/account/session revision. Password change renews the current media credential alongside the API token. API JWTs cannot substitute for it; a different user's cookie cannot read private assets. No frontend changes are required.

Media credentials are bounded bearer capabilities. The existing frontend's local-only logout does not server-revoke previously issued JWTs or clear this HttpOnly credential; it expires or is invalidated by credential revision/account changes. If policy requires immediate server-side logout revocation, an explicit backend logout/frontend hook is a separate decision, not claimed complete here.

The existing shared strict avatar/image limiter is unchanged. B2 resume uploads also use it and fail closed when the shared limiter is unavailable. Filesystem resumes retain their pre-existing admission behavior; B2 never uses that path as an outage fallback. Existing PDF previews retain their separate temporary-file workflow.

## Environment and deployment configuration

Use `.env.example` as the documented interface; do not place real secrets in reports or version control.

| Variable                               | Meaning                                                                                                                                                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STORAGE_DRIVER`                       | `filesystem` by default, or explicitly `b2` for new managed uploads. Unknown values fail startup validation.                                                                                                                              |
| `B2_IMAGES_BUCKET`                     | Existing private media bucket name.                                                                                                                                                                                                       |
| `B2_IMAGES_REGION`                     | Region shown by B2, e.g. the regional token used in its endpoint; configure the actual region, not an invented value.                                                                                                                     |
| `B2_IMAGES_ENDPOINT`                   | Exact `https://s3.<region>.backblazeb2.com`, without trailing slash.                                                                                                                                                                      |
| `B2_IMAGES_KEY_ID`                     | Application-key ID restricted to the images bucket.                                                                                                                                                                                       |
| `B2_IMAGES_APPLICATION_KEY`            | Its application-key secret, supplied through the approved secret mechanism.                                                                                                                                                               |
| `B2_RESUMES_BUCKET`                    | Separate existing private resume bucket name.                                                                                                                                                                                             |
| `B2_RESUMES_REGION`                    | Its actual B2 region.                                                                                                                                                                                                                     |
| `B2_RESUMES_ENDPOINT`                  | Its matching exact HTTPS regional endpoint.                                                                                                                                                                                               |
| `B2_RESUMES_KEY_ID`                    | Different application-key ID restricted to the resume bucket.                                                                                                                                                                             |
| `B2_RESUMES_APPLICATION_KEY`           | Its separate secret.                                                                                                                                                                                                                      |
| `PUBLIC_IMAGE_STORAGE_ROOT`            | Existing absolute legacy image root. Required for production filesystem writes; optional for new B2-only deployments, but existing legacy assets still require their original readable volume. Development defaults to `backend/uploads`. |
| `PUBLIC_API_ORIGIN` / `API_BASE_URL`   | Existing app-origin configuration used by portfolio links. Continue routing app `/uploads` URLs to this backend.                                                                                                                          |
| `JWT_SECRET`, issuer/audience settings | Existing auth configuration; no new secret required. The media credential derives its signing authority from the existing backend secret with a separate audience.                                                                        |
| `MONGODB_URI` or `MONGO_URI`           | Existing transaction-capable Mongo connection; explicit configuration is required for the cleanup CLI.                                                                                                                                    |
| Existing Redis configuration           | Required for strict B2 upload admission. No Redis credentials or existing cache configuration were changed.                                                                                                                               |
| `B2_ACCEPTANCE_MONGO`                  | Test-only disposable loopback URI; not a production storage setting.                                                                                                                                                                      |

All workers must share the same Mongo ledger, bucket aliases/names, regions, credentials and JWT signing configuration. Provision the `storedassets` collection before rollout under the deployment's normal policy, with unique `reference`, owner and `(state,retryAfter,expiresAt)` indexes. No destructive migration is needed. Retain the existing account-deletion receipt collection. Mongo transactions are required; there is no standalone/local-transaction downgrade.

Keep both buckets private and provision separate non-master keys with only the required read/write/list/delete-file capabilities. Prefix restrictions must include generated keys: images use `v1/avatars/` and `v1/portfolio-images/`; resumes use `v1/resumes/`. The application never calls ListBuckets or grants public ACLs. Verify SSE-B2 support, Object Lock/retention constraints, exact-version deletion permissions and lifecycle rules. Do not configure lifecycle expiration that deletes ready historical resumes behind Mongo's references.

Use a same-origin HTTPS deployment/reverse proxy for `/api` and `/uploads`, forwarding Set-Cookie normally and honoring `private, no-store`. Existing frontend URL normalization already expects app `/uploads` paths. A separate API origin without appropriate proxy/cookie delivery will not support private native-image previews without further frontend work. Do not cache private managed responses at a CDN or turn either B2 bucket public to work around cookie/proxy issues. Provider CORS/public download endpoints are not required because bytes are proxied.

Run cleanup through the existing deployment supervisor:

```powershell
# Supply the approved Mongo and B2 environment configuration to the process.
node backend/src/scripts/retryStorageCleanup.js
```

The CLI does not load a local `.env` or infer a production connection. Run it periodically, sized for the bounded batches, and alert on persistent uploading/deleting receipts, retry counters, oldest receipt age and unknown-version empty listings. Repeated failures exit nonzero and keep receipts; failures on one account do not suppress attempts for other candidates/accounts. No scheduler or infrastructure was installed by this task.

The pinned SDK and this task were exercised on Node `v24.19.0`. Validate the deployment runtime with the lockfile and SDK engine requirements before release.

## Backward-compatible reading and non-destructive migration plan

No production migration was run. Enabling B2 affects new uploads only. Existing filesystem paths and `/uploads` images remain readable from their original configured roots. B2 references also remain readable when writes are rolled back to filesystem, provided the full B2 reader configuration is retained; they are never interpreted as local paths. Avatar replacement during that rollback still atomically retires the old managed object.

1. Inventory owned avatar, portfolio-image and resume references read-only. Record source path, owner, database identity/revision, byte length and SHA-256 in a protected migration manifest. Resolve symlinks and reject unsafe paths. Reconcile missing files/duplicate ownership separately; do not guess replacements.
2. Back up the source volumes and metadata. Ensure all workers can still serve legacy roots throughout migration. Do not repoint an existing volume to an empty directory.
3. Copy each selected asset to a **new generated** B2 key/ledger reservation using the correct bucket and owner. Keep the original file and reference unchanged. Do not overwrite an existing key.
4. Read that exact object version back through the backend adapter and verify byte length/SHA-256 against the source. Failed verification leaves the source authoritative and a retryable receipt. Finish each asset within its staging window; expired unattached attempts can be retried from the preserved source.
5. In a short owner-fenced transaction, activate the verified managed asset and compare-and-set only the matching original database reference/revision. Preserve resumes' IDs, histories, scores and active/default selections. If another edit won, abort the reference switch; do not replace it with a stale migration value.
6. Verify the same existing owner/public APIs, privacy revocation and a worker restart for that asset. Retain the manifest, old path and rollback mapping. Rolling back changes the reference through the same ownership/CAS discipline and leaves B2 reader configuration in place for already migrated assets.
7. **Do not delete historical filesystem files as part of this rollout.** Any later retirement requires verified migration, an explicit retention decision and separate authorization. This task's replacement path deliberately preserves legacy files when B2 is selected. Explicit user account deletion retains its established owned-data semantics and durable cleanup receipt.

The plan is documented operator work, not an unreviewed migration command. No bucket-wide scan/delete, destructive data migration or automatic historical-file sweep was added. Cleanup is confined to new generated managed objects and existing explicit account-deletion work.

## Focused verification

Final result: **53 tests passed, zero failures and zero skips**. Retained transcript: `focused-tests.tap`.

```powershell
$env:B2_ACCEPTANCE_MONGO = 'mongodb://127.0.0.1:27140/?replicaSet=storageAcceptance'
node --test backend/src/tests/b2Storage.test.js backend/src/tests/resumePipelineFinalization.test.js backend/src/tests/publicPortfolioHardening.test.js backend/src/tests/developerContextService.test.js
```

The B2 integration fixture refuses another host/port, creates a random `b2_storage_test_*` database and checks its exact name before dropping it. Temporary fixture files are isolated and cleaned. Provider calls use a versioned in-memory S3 fixture; the real SDK constructor/configuration is exercised without network access. A fresh child process reads the persisted Mongo reference/version with a fixture-provider snapshot. This is restart evidence, not a claim of live B2 access.

| Acceptance area           | Evidence                                                                                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload / retrieval        | Existing HTTP avatar, portfolio and resume uploads; valid PNG and real text PDF; byte-exact image/PDF retrieval and real PDF extraction; unchanged resume JSON fields.                                                                                              |
| Validation / bounds       | Existing MIME/signature/PDF parser checks; oversized image rejected before S3; adapter size/path/bucket drift and corrupt-byte rejection; eight-call admission and stalled-call deadline.                                                                           |
| Credentials / versions    | Separate client credentials/buckets; explicit encryption/checksum/content length; version-pinned GET; exact-key version deletion and prefix-neighbor preservation.                                                                                                  |
| Ownership                 | Foreign portfolio references rejected; wrong owner cookie denied; foreign resume analysis rejected before S3; remote and legacy resume helper ownership enforced.                                                                                                   |
| Privacy                   | Unpublished/hidden portfolio media denied anonymously, owner preview allowed, current publication rechecked with no-store responses; public resume denied after revocation; API JWT rejected as media credential; credential revision revokes media access.         |
| Replacement / outage      | Failed PUT preserves old avatar; failed old-version deletion retains receipt; referenced objects survive cleanup; filesystem rollback retires old B2 reference atomically.                                                                                          |
| Durable cleanup / restart | Unknown empty listing retains receipt; simulated delayed provider commit is found later; fresh process reads persisted data; upload/account-deletion and cleanup/deletion races; cleanup retries finish after fixture storage recovery and retry-clock advancement. |
| Legacy / local mode       | Existing filesystem PDFs and static images work; B2 replacement does not delete legacy files; filesystem driver still writes usable local images; unsafe paths denied.                                                                                              |
| Strict admission          | Existing portfolio limiter outage tests plus B2 resume HTTP admission returning 503 before any S3 call when shared admission is absent.                                                                                                                             |
| Existing behavior         | Resume scoring/parity, history/source timestamps, selected resume identity and public portfolio privacy hardening suites pass. No live AI/mail/provider traffic.                                                                                                    |

Explicit-path Prettier write/check and changed JavaScript `node --check` pass. Git working-tree and task-scoped staged whitespace checks pass. The full-index check reports existing whitespace/extra EOF lines in staged Profile evidence logs (`backend/verification/profile/frontend-build.txt`, `frontend-focused-tests.txt`, `frontend-tests.txt`); those unrelated staged files were left untouched. No frontend files changed; no frontend build or broad suite was needed for this backend-only task. Previous Profile acceptance evidence was read but is not represented as a fresh build result here.

## Exact task-owned changed files

- `backend/.env.example`
- `backend/index.js`
- `backend/package-lock.json`
- `backend/package.json`
- `backend/src/controllers/profilecontroller.js`
- `backend/src/controllers/publicProfileController.js`
- `backend/src/controllers/resumecontoller.js`
- `backend/src/middleware/storedImageMiddleware.js`
- `backend/src/middleware/uploadmiddleware.js`
- `backend/src/models/storedAsset.js`
- `backend/src/routes/profile.routes.js`
- `backend/src/routes/publicProfile.routes.js`
- `backend/src/routes/resume.routes.js`
- `backend/src/scripts/retryStorageCleanup.js`
- `backend/src/services/accountDeletionService.js`
- `backend/src/services/b2ObjectStorageService.js`
- `backend/src/services/publicImageStorageService.js`
- `backend/src/services/publicProfileService.js`
- `backend/src/services/resumeStorageService.js`
- `backend/src/services/resumeservice.js`
- `backend/src/services/storedAssetService.js`
- `backend/src/tests/b2Storage.test.js`
- `backend/src/tests/fixtures/b2Fixture.js`
- `backend/src/tests/fixtures/b2StorageWorker.js`
- `backend/verification/storage/BACKBLAZE-B2-FINAL.md`
- `backend/verification/storage/focused-tests.tap`
- `backend/verification/storage/formatting.txt`
- `backend/verification/storage/validation.json`

No existing source file was moved or deleted. The pre-existing Profile staged changes and newer frontend/screenshot edits remain in place. Baseline-preservation and finalization details are retained in `validation.json`. The task-owned Mongo process is stopped after acceptance; disposable test databases were dropped. Essential tests/fixtures/evidence are retained.

## Remaining external configuration gates

1. Supply the two real private bucket names/endpoints and distinct bucket-scoped application keys through the deployment secret mechanism. Verify private ACLs, cross-bucket denial, exact-version listing/deletion, SSE-B2 and retention/Object Lock policy in an approved staging environment. No real credential or bucket policy was tested or changed here.
2. Provision the ledger collection/indexes on the transaction-capable Mongo deployment, deploy compatible workers together, retain B2 reader configuration during rollback and schedule/monitor bounded cleanup. Verify uncertain empty receipts rather than silently discarding them.
3. Validate same-origin HTTPS proxy/cookie/no-store delivery, current JWT policy and strict shared Redis upload admission across workers. Any policy requiring immediate local-logout capability revocation needs the explicit logout-hook decision described above.
4. Mount and inventory legacy files wherever their references must remain readable; perform only the reviewed copy/verify/CAS migration steps. Historical source-file retirement remains separately authorized work.
5. Run deployment-equivalent B2 connectivity, failure/restart and capacity checks using approved disposable staging assets. The local mocked provider tests do not certify real credentials, provider behavior, storage billing/lifecycle or production capacity.

**Verdict:** B2 ADAPTER: IMPLEMENTED | PRIVATE BUCKET SEPARATION: IMPLEMENTED / EXTERNAL POLICY VERIFICATION OPEN | EXISTING APIs: PRESERVED | VALIDATION / OWNERSHIP / PUBLICATION PRIVACY: LOCAL PASS | ATOMIC REFERENCES / DURABLE CLEANUP / RESTART: LOCAL PASS | FILESYSTEM / LEGACY: LOCAL PASS | MIGRATION: PLAN ONLY, NON-DESTRUCTIVE | FOCUSED TESTS: 53 PASS | PRODUCTION CONFIGURATION: OPEN | COMMIT / MERGE / DEPLOY: NOT PERFORMED.
