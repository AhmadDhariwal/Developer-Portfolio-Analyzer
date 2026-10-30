# Avatar response and delivery security review

Branch: task/profile. Reviewed revision: ab1949aa9195a3ca8bba060fdb470720f8bfac8e plus the three source/test changes listed below.
No commits, deployment, schema/index change, live B2 call, historical migration or file deletion.
Only generated local test data was removed by the disposable fixture teardown.

## Verified findings

The previous managed avatar URL included the Mongo user ObjectId, the b2 marker and an object UUID.
This exposed account linkage and storage implementation details. Those identifiers are not credentials,
and no storage secret, bucket, endpoint, internal key, checksum or object version was returned by the
upload response. The response remains exactly message plus avatar URL. Internal ledger metadata stays
inside backend storage operations.

New B2 avatar URLs are now /uploads/avatars/<64 random hexadecimal characters>.<extension>.
The 256-bit random public identifier is independent of the internal object UUID. MongoDB's existing
unique reference index resolves the URL to the owner, bucket/key and exact object version. Keys and
B2 provider behavior are unchanged. No new collection, index, selector or fallback was introduced.

Existing owner-b2-UUID managed references still parse and deliver. New portfolio and résumé
references retain their existing formats. Historical filesystem filenames remain unchanged; the
filesystem write path still uses its established owner-prefixed filenames because replacing their
ownership/cleanup scheme would require a separate durable mapping design. Opacity is applied to new
managed B2 avatars, which is the selected avatar path being hardened here.

## Intended visibility and authorization

- Current ready managed avatars are public by unguessable URL for active accounts. This applies
  regardless of talent-pool consent or portfolio publication; an avatar is not a private portfolio.
- A staged avatar is owner-only with a valid media cookie. A superseded/deleting avatar is not public.
- Delivery resolves the ledger first, then loads the current account and checks active/deleted state,
  current avatar or portfolio publication/section visibility, and media cookie session revision.
  Account deletion/inactivation revokes managed reads even if B2 cleanup is delayed.
- Private managed images require a signed media-audience cookie matching the current owner/revision.
  API bearer tokens cannot be substituted for media cookies. Existing password/session revision
  revocation and publication checks are preserved.
- Upload/activation/read operations continue to filter by the explicit Mongo owner. Opaque URLs do
  not carry an owner, so a URL match alone never grants private ownership or allows attaching another
  account's asset. Missing owner arguments fail closed. Public delivery's internal ledger lookup is
  followed by the same account/visibility checks before any provider bytes are read.
- GET/HEAD responses retain ledger MIME, Content-Length, X-Content-Type-Options: nosniff,
  Cache-Control: private, no-store and Vary: Cookie. HEAD has no body. Other methods are 405.
  Unknown opaque references return 404 and do not fall through to static file serving.
- B2 reads remain version-pinned and integrity/size-checked. Browser URLs expose application paths,
  not provider URLs, storage keys or signed provider capabilities.

## Legacy limitations

Legacy filesystem images are still public by URL and statically cached for up to one hour with
must-revalidate. They do not provide the managed B2 path's immediate Mongo-account revocation.
Existing cleanup removes owned legacy files after deletion, but previously cached/downloaded bytes
cannot be revoked. Their ObjectId-containing URLs are retained for compatibility. Tightening that
historical access policy or replacing filesystem identity/cleanup would be a separate change.
No historical records/files were migrated or deleted in this review.

Managed public avatars also cannot retract copies already downloaded by another person. Opaque
identifiers reduce metadata disclosure; they do not replace authorization for private media.

## Changes

- backend/src/services/storedAssetService.js: generate opaque managed avatar references, parse both
  formats, resolve public image metadata internally, and retain owner-filtered get/activation/cleanup.
- backend/src/middleware/storedImageMiddleware.js: obtain owner identity from the ledger rather than
  extracting it from the public URL; retain current account, cookie, visibility and header checks.
- backend/src/tests/b2Storage.test.js: extend disposable HTTP acceptance to assert response minimization,
  opaque format, no internal metadata, owner isolation, staged privacy, current/inactive avatar access,
  legacy managed compatibility, unknown-reference denial, method restrictions and HEAD headers/body.

## Focused verification

Command: node --test --test-concurrency=1 src/tests/b2Storage.test.js, through a temporary runner
that provisions only a task-owned loopback replica set and fixture S3 adapter.
Result: 6 passed, 0 failed, 0 skipped. Test log: avatar-security-tests.txt in the user-facing outputs.

The suite covers actual HTTP/JWT uploads, processed image read-back, opaque and old managed references,
foreign-owner get/activation denial, anonymous staged denial/owner-cookie acceptance, inactive-account
denial, replacement and deletion revocation, private portfolio authorization and cross-user isolation,
password/media session revision, MIME/nosniff/no-store headers, legacy filesystem reads, version-pinned
storage and cleanup/restart behavior. No credentials or production data are used by the runner.

Changed JavaScript receives explicit Prettier write/check, syntax checks and Git whitespace checks.
Existing API response shape and the initial index are preserved. This is local code verification,
not a live B2 or deployed proxy/CDN acceptance claim.
