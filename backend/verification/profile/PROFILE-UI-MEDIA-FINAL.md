# Profile UI and media final verification

**Local code checks PASS; production acceptance BLOCKED. No module freeze.**

Work remains on task/profile. The existing index is preserved (see ui-media/source-inventory.json),
with no commit, merge, deployment, key rotation, production record change or existing-object cleanup.

## Before and after structure

The parent previously held roughly 1,700 template lines. It now delegates ten presentation boundaries:
page-header, avatar-uploader, account-telemetry, personal-information, connected-accounts,
career-preferences, notification-settings, appearance-settings, visibility-settings and security-settings.
Matching TypeScript/template/style files live under frontend/src/app/pages/profile/components.
Attribute components retain the existing header/div/section hosts, classes, order and spacing.
Inputs are explicitly typed; outputs carry action intent. Forms edit the passed draft. Children create
no HTTP subscriptions or competing cache/state authorities. The parent retains API orchestration,
shared avatar state, cache invalidation and native deletion/photo dialogs. Owned résumé context and
the existing management link remain in Connected Accounts; no duplicate résumé API was introduced.

## Loading, drafts and navigation

The full-application save overlay, root inert lock and Profile route navigation lock are removed.
Personal/contact/social/notification drafts retain their existing shared Save Changes action; its
busy indicator is local to that action. Avatar displays upload percentage when the transport emits
computable UploadProgress, followed by processing/saving feedback. Fetch transports may not expose
upload progress, in which case no percentage is fabricated. Career, visibility, password and deletion
retain independent busy states. Theme preferences remain immediate local controls. Existing Profile
has no standalone Reset action or résumé upload action to duplicate.

Duplicate save/upload requests are blocked. Discard restores the shared photo draft before submission;
it is disabled during a committed upload because an HTTP abort cannot promise server rollback.
Navigation remains responsive, clears the unsaved local photo preview, and unsubscribes view-owned
profile/avatar observers. A server may already have committed a request before client cancellation.
Existing owner fences and durable cleanup still handle upload/account-deletion races. Password Cancel
cannot reset its form while the request is outstanding.

Career save previously snapshotted unrelated draft values. It now applies career/active-context
fields and updates only the career snapshot. A browser assertion checks that a changed personal name
remains pending across Career save. Photo preview, discard, persisted save and the full-size viewer
continue to work across Profile settings, navbar and sidebar.

## Authoritative media processing

Added pinned sharp 0.35.5, explicitly authorized by the requested image-processing dependency.
PNG, JPEG and WebP source files retain the 2 MiB limit and multipart MIME/signature checks.
A decoder then validates content before any storage call. Corrupt/truncated data is rejected.

- Maximum decoded input: 16 million pixels; single-frame images only.
- Maximum two active transformations per process, with no waiting queue. Saturation returns 503.
  A three-second sharp processing timeout bounds the transformation. These are application controls,
  not OS process isolation; fleet CPU/memory limits still require load evidence.
- Apply EXIF orientation, preserve aspect ratio, fit inside the target and never enlarge.
- Avatar default 512 px; portfolio default 1600 px. Configurable via PROFILE_AVATAR_MAX_DIMENSION
  and PROFILE_PORTFOLIO_MAX_DIMENSION, bounded at 1024 and 2048 respectively.
- WebP quality defaults to 82; PROFILE_IMAGE_WEBP_QUALITY is bounded at 95. Invalid settings use defaults.
- Re-encode as WebP and strip source metadata through sharp's normal output behavior.
  Processed output must remain within 2 MiB. Invalid content is 400; excessive byte size is 413;
  capacity/storage failure remains 503.
- Transform after existing Mongo admission and before publicImageStorageService.put. Both B2 and
  filesystem receive processed bytes and the WebP extension. Existing ledger code calculates
  size, MIME, SHA-256 and provider object version from those bytes. Portfolio response fields are
  unchanged; mimeType and size now describe the processed file. Historical references/readers remain.
- Résumé limit remains 10 MiB. PDF bytes, embedded content and text-analysis behavior are untouched;
  no compression, rasterization or lossy PDF conversion was added.
- Client compression was considered and omitted to avoid a second acceptance/transformation pipeline.
  Shared previews still use the original selected file; server processing is authoritative.

Actual synthetic fixture: **53,970-byte PNG at 2400×1600 → 400-byte WebP at 512×341**.
This is a solid-colour fixture, not a typical-photo compression claim. Exact values are retained in
ui-media/media-comparison.json. Constructor/pixel controls and resizing follow
[sharp constructor documentation](https://sharp.pixelplumbing.com/api-constructor/) and
[resize documentation](https://sharp.pixelplumbing.com/api-resize/).
Component extraction adds encapsulated styles; modularity does not by itself reduce bundle bytes.

## Verification evidence

| Check                                            | Result                                     | Evidence                                                        |
| ------------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------- |
| Full frontend                                    | 435 passed / 77 files                      | ui-media/frontend-tests-final.log                               |
| App/spec TypeScript                              | PASS                                       | installed tsc, noEmit                                           |
| Production build                                 | PASS, existing landing-page SCSS warning   | ui-media/frontend-build-final.log                               |
| Request-flow/Profile/Integrations                | 117 passed, 0 skipped                      | ui-media/request-flow-final.log                                 |
| Focused media/security units                     | 24 passed, 1 external-fixture case skipped | ui-media/backend-focused-final.log                              |
| Separate disposable storage-security integration | 4 passed, 0 skipped                        | ui-media/storage-security.log                                   |
| Production-build desktop/mobile browser          | PASS, loopback fixture APIs                | ui-media/browser-run-final.log and browser/browser-results.json |

Decoder tests cover aspect ratio, EXIF, metadata removal, compressed-source size, corrupt images,
decoded-pixel bomb limits, bounded concurrency and recovery. Existing PNG test byte sequences were
invalid under a real decoder. They were replaced with generated valid PNGs, and avatar read-back now
expects processed WebP bytes. Redundant initial failure logs were removed at the user’s request after the passing rerun; validation
was not relaxed. The full request suite uses real JWT, Mongo admission, parsing, fixture S3 and
ledger transactions, plus ownership, concurrent boundaries and restarts. PDF analysis regressions pass.

Browser checks cover zero uploads on selection, shared preview, discard, failed upload retry, no
global overlay, image preview/Escape, personal-draft survival across Career save, refresh persistence,
password/deletion errors and overflow. External requests are blocked. Desktop 1440×1000 and mobile
390×844 screenshots are at ui-media/browser/profile-desktop.png and profile-mobile.png. Both were
visually inspected; card order, spacing, controls and error feedback remain intact. Browser fixtures
are not live B2 HTTP acceptance.

Changed paths receive explicit Prettier write/check and backend syntax checks. Git/index evidence
and exact source hashes are retained. Existing screenshots and historical acceptance records remain.

## Operator gates and prepared staging HTTP procedure

Prior B2, governance, storage and closure reports remain historical evidence. This task does not
certify configured infrastructure. Production acceptance remains blocked on:

1. Operator-managed least-privilege single-bucket runtime key replacement for both buckets;
   private/encryption/retention/hold and exact-version validation before revoking old keys.
   Do not add audit-only privileges to runtime keys.
2. Explicit authorized disposable staging buckets, identity and Mongo target for real authenticated
   HTTP-to-B2 acceptance. Prepare tiny valid image and text-PDF fixtures; authenticate; POST avatar,
   project image and résumé; read only through owned application routes; verify generated ledger
   MIME/size/SHA/version against processed bytes; test foreign-owner denial; remove only generated
   references/versions and verify absence. Existing guarded live verifier can test the adapter;
   direct adapter success alone is not authenticated HTTP acceptance. No staging identity/target
   was supplied, so no live object operation was performed.
3. Deployment Mongo topology/index/durability/capacity and backup/restore checks; no TTL on unfinished
   cleanup receipts, one bounded cleanup scheduler and alerts, original legacy volumes retained.
4. Redis-to-Mongo all-worker quota handover with no mixed authorities, counter resets or duplicate
   allowances; preserve outstanding windows through rollout and rollback.
5. HTTPS, same-origin cookies, exact proxy/IP trust, JWT worker consistency, protected media caches,
   B2 activation/read rollback, and explicit logout/legacy-media policy.

**Final verdict: PASS for recorded local code checks; BLOCKED for production acceptance/full freeze.**

## Exact source inventory

- backend/package.json
- backend/package-lock.json
- backend/src/services/imageOptimizationService.js
- backend/src/middleware/avatarUploadMiddleware.js
- backend/src/middleware/portfolioImageUpload.js
- backend/src/tests/imageOptimization.test.js
- backend/src/tests/b2Storage.test.js
- backend/src/tests/profileSettingsProduction.test.js
- backend/src/tests/requestFlowGovernance.test.js
- backend/src/scripts/verifyProfileSettingsBrowser.js
- frontend/src/app/app.routes.ts
- frontend/src/app/shared/services/profile.service.ts
- frontend/src/app/pages/profile/profile.component.ts
- frontend/src/app/pages/profile/profile.component.html
- frontend/src/app/pages/profile/profile.component.scss
- frontend/src/app/pages/profile/components/README.md
- frontend/src/app/pages/profile/components/profile-account-telemetry/profile-account-telemetry.component.html
- frontend/src/app/pages/profile/components/profile-account-telemetry/profile-account-telemetry.component.scss
- frontend/src/app/pages/profile/components/profile-account-telemetry/profile-account-telemetry.component.ts
- frontend/src/app/pages/profile/components/profile-appearance-settings/profile-appearance-settings.component.html
- frontend/src/app/pages/profile/components/profile-appearance-settings/profile-appearance-settings.component.scss
- frontend/src/app/pages/profile/components/profile-appearance-settings/profile-appearance-settings.component.ts
- frontend/src/app/pages/profile/components/profile-avatar-uploader/profile-avatar-uploader.component.html
- frontend/src/app/pages/profile/components/profile-avatar-uploader/profile-avatar-uploader.component.scss
- frontend/src/app/pages/profile/components/profile-avatar-uploader/profile-avatar-uploader.component.spec.ts
- frontend/src/app/pages/profile/components/profile-avatar-uploader/profile-avatar-uploader.component.ts
- frontend/src/app/pages/profile/components/profile-career-preferences/profile-career-preferences.component.html
- frontend/src/app/pages/profile/components/profile-career-preferences/profile-career-preferences.component.scss
- frontend/src/app/pages/profile/components/profile-career-preferences/profile-career-preferences.component.ts
- frontend/src/app/pages/profile/components/profile-connected-accounts/profile-connected-accounts.component.html
- frontend/src/app/pages/profile/components/profile-connected-accounts/profile-connected-accounts.component.scss
- frontend/src/app/pages/profile/components/profile-connected-accounts/profile-connected-accounts.component.ts
- frontend/src/app/pages/profile/components/profile-notification-settings/profile-notification-settings.component.html
- frontend/src/app/pages/profile/components/profile-notification-settings/profile-notification-settings.component.scss
- frontend/src/app/pages/profile/components/profile-notification-settings/profile-notification-settings.component.ts
- frontend/src/app/pages/profile/components/profile-page-header/profile-page-header.component.html
- frontend/src/app/pages/profile/components/profile-page-header/profile-page-header.component.scss
- frontend/src/app/pages/profile/components/profile-page-header/profile-page-header.component.ts
- frontend/src/app/pages/profile/components/profile-personal-information/profile-personal-information.component.html
- frontend/src/app/pages/profile/components/profile-personal-information/profile-personal-information.component.scss
- frontend/src/app/pages/profile/components/profile-personal-information/profile-personal-information.component.ts
- frontend/src/app/pages/profile/components/profile-security-settings/profile-security-settings.component.html
- frontend/src/app/pages/profile/components/profile-security-settings/profile-security-settings.component.scss
- frontend/src/app/pages/profile/components/profile-security-settings/profile-security-settings.component.ts
- frontend/src/app/pages/profile/components/profile-visibility-settings/profile-visibility-settings.component.html
- frontend/src/app/pages/profile/components/profile-visibility-settings/profile-visibility-settings.component.scss
- frontend/src/app/pages/profile/components/profile-visibility-settings/profile-visibility-settings.component.ts

## Local API recovery and requested cleanup

The local backend was not listening on port 5000. MongoDB ping and the startup graph passed.
The backend now supports a development-only --api-only launch, bound to localhost, which omits
background worker/scheduler startup. The local API root returns 200 and login through the frontend
proxy returns the expected invalid-credentials response for an empty test request. No real password
was tested. Ten redundant intermediate verification files and the unused Profile navigation guard
were removed; final evidence, screenshots, functional components and meaningful tests are retained.
