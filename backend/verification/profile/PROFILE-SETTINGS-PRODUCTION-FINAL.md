# Profile & Settings — production final acceptance

Date: 29 October 2026 (Asia/Karachi). Branch: `task/profile` throughout. Source: `task/profile`; integration/PR target: not applicable. Initial checkout/index: clean. No commit, push, merge, branch creation, deployment, production migration, provider traffic or production-data deletion was performed.

**Local implementation and focused acceptance pass. Production release remains conditional on the gates below.**

## 1. Architecture and discovered gaps

Read `AGENTS.md`, `DEVINSIGHT_AI_SOLUTION_ARCHITECTURE_CHARTER.md`, the supplied hardening request, retained portfolio/integration acceptance evidence, and the actual Angular/Express/Mongoose implementation. No separate Profile Module overview file was attached or found by the architecture/profile-file search; this report records the implementation-derived overview rather than pretending to have read a missing document.

The modular monolith remains intact. `User` owns account identity, base/active career fields, resume selections, notification preferences and embedded recruiter details/preferences. `Recruiter` supplies the existing hiring-profile record. `PublicProfile` owns independent portfolio publication, slug and presentation content. `IntegrationLinkedProfile` stores unverified reference links independently of OAuth connections and normalized observations. `ResumeFile` and `ResumeAnalysis` are owner-scoped evidence records. `developerContextService` resolves identity and selected resume context; its pure hash now also supplies the existing developer-signal hash implementation.

Authentication checks persisted account state. Mongo is authoritative for ownership, publication, mutations and revisioned cache inputs; Redis is optional for ordinary rendering caches and required for existing strict upload/contact admission. Angular services retain their existing responsibilities, with account-scoped cache reads and mutation guards rather than a second identity store.

Demonstrated defects corrected:

- OAuth-only accounts were blocked from ordinary profile editing because it unnecessarily required a local password.
- Password change read a schema-excluded password hash; current-password failures also triggered the global frontend logout handler.
- Concurrent password changes/resets could overwrite a winning credential update; previously issued access tokens had no credential-revision revocation.
- Password recovery exposed account presence and delivery failures, and login disclosed disabled-account status before checking credentials.
- A duplicate text-normalization loop truncated a valid long biography and reapplied inconsistent limits.
- Profile hash omitted resume selection and diverged from developer-signal hash serialization.
- Selected resume analyses did not require a surviving owned file, allowing orphan/foreign references to resolve inconsistent evidence.
- Profile caching retained data for 24 hours, bypassed memory expiry and accepted unscoped stored profiles; older requests could hydrate a changed session or overwrite a completed edit.
- Career/resume changes could leave an older full-profile cache, and browser storage events did not invalidate the relevant state. Interview preparation was omitted from general personalization cache clearing.
- Notification objects and full-form payloads could overwrite unrelated concurrent edits.
- Recruiter discovery combined account opt-in with portfolio publication; revoking discovery also unpublished a separate portfolio. Discovery policy used a worker-local settings snapshot.
- News could reuse old personalization for 15 seconds on another worker; Sprint draft fingerprints omitted goal/timeline/learning intent.
- Avatars trusted client MIME and filename extension, lacked the strict shared upload limiter, and deleted the previous file before committing its replacement.
- Public images depended on each worker's local filesystem. Analytics receipt/counter writes could diverge after a crash.
- Account deletion removed only a small subset of owned records and had no durable filesystem-cleanup retry. Portfolio initialization could race deletion.
- The deletion dialog sat behind the sidebar; long unbroken biography text escaped its card. Browser feedback/loading and unchanged-save behavior also needed correction.

## 2. Implemented changes and justification

Existing endpoint paths, successful payload fields, scoring formulas and historical snapshots remain compatible. Additions are the password-error code, replacement session token, credential revision, internal cleanup receipt and opaque recovery handle in the existing string field. No dependency was added.

- Unified hashing at `developerContextService.buildProfileHash`, preserving the pre-existing developer-signal SHA-256 field order and adding its resume selection semantics to Profile responses. Resume resolution verifies an owned existing file before selecting its analysis.
- Restored OAuth profile editing, validated text/ID/link inputs, kept per-field limits, and wrote only supplied changed notification paths. The Angular form submits changed fields rather than a stale full snapshot.
- Password updates use a hash compare-and-set, enforce bcrypt's 72-byte boundary, increment `sessionRevision`, and renew the current browser token. Reset uses compare-and-set and revokes prior sessions. Protected and optional authentication paths validate revisions. Auth/tenant token issuance carries the revision; legacy zero-revision sessions work until credentials change.
- Recovery responses keep matching shapes/statuses with encrypted authenticated expiring handles, generic invalid-OTP results and a fixed 750 ms public delivery budget. Existing issued ObjectId OTP flows remain compatible. Administrative login denial follows password verification. Mail/SMS are mocked in acceptance.
- Bounded full-profile cache validity to five minutes, checked owner/expiry, fenced late reads/mutations, invalidated full-profile state after career/resume switches and propagated storage changes. Cache listener lifecycle cleanup is explicit. Current-password challenge errors remain on the form; actual invalid sessions still log out.
- Kept discovery and publication opt-ins independent. Recruiter queries require an active opted-in developer and current Mongo discovery policy; publication alone cannot grant discovery. Organization-scoped candidate lookup now passes the organization context.
- News compares the current canonical profile hash before reusing its signal entry. Sprint draft context fingerprints include the same hash; changed intent requires review of saved proposals without deleting them.
- Reused the established bounded PNG/JPEG/WebP recognizer for avatars. Actual bytes select the extension. Upload controls fail closed if their shared limiter is unavailable. Atomic avatar exchange cleans only the displaced image after persistence; failed pre-commit writes clean their new file.
- Added a shared persistent-filesystem configuration for public images, preserving local development and stored image URLs. Production rejects a missing/relative root. Writes and cleanup reject redirected child directories; filenames are owner-prefixed random IDs.
- Committed analytics deduplication receipts and counter increments in one existing Mongo transaction, retaining bot filtering, admission bounds, historical counters and legacy records.
- Extended the existing account-deletion transaction to the explicit owned-model inventory, public caches/events, memberships, resume/analysis history and related recruiting references. Organization owners receive a rollback-safe conflict. Shared jobs are closed and retained. A durable cleanup receipt is committed with deletion; storage failures retain it for retry. Streaming directory enumeration avoids materializing the entire image directory. Portfolio initialization uses the same account write fence as deletion.
- Retained the existing page/components/design system. Added accessible feedback/loading states and a real native confirmation dialog with keyboard focus/cancellation. Fixed grid/text overflow. Existing Resume Analyzer navigation is linked from resume context.

## 3. Profile-to-module propagation matrix

| Consumer                | Authoritative inputs and behavior after edits                                                                                       | Evidence/limits                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Dashboard               | Fresh persisted user + canonical identity/resume + developer signal hash; frontend dashboard caches cleared on personalization      | Existing identity-consumer tests and affected frontend suite; no new live GitHub analysis           |
| Skill Gap Analyzer      | Canonical active identity/career/resume; existing evidence/cache contract retained                                                  | Existing resolver tests and frontend cache tests; saved analyses retained                           |
| Career Recommendations  | Existing profile/signal hashes and owner-scoped snapshots; recommendation frontend cache cleared                                    | Shared hash contract test and existing frontend acceptance; no scoring/provider changes             |
| Career Sprint           | Existing Mongo overview revisions; draft fingerprint now includes profile intent; frontend cache cleared                            | Sprint policy checks and new intent/acknowledgement regression; tasks/drafts retained               |
| Scenario Simulator      | Canonical context and existing immutable simulation snapshots; frontend runtime cache cleared                                       | Existing identity tests; calculations/history unchanged                                             |
| Weekly Reports          | Existing signal hash and selected-resume context; frontend latest/history caches cleared                                            | Existing context-consumer tests; saved reports retained                                             |
| Interview Preparation   | Account-independent question-bank caches retained; personalized runtime state now cleared with developer-signal caches              | Frontend suite and unchanged backend question-bank architecture; no bank deletion                   |
| News                    | Current authenticated user's profile hash gates the 15-second signal cache; changed intent/identity/resume cannot hit its old entry | New warm-cache regression plus News hardening/flow tests; other evidence changes retain bounded TTL |
| Recruiter Hub           | Fresh persisted opt-in/active account and Mongo discovery policy; portfolio publication does not substitute consent                 | Real Mongo discovery-isolation regression; ranking formulas unchanged                               |
| Public Portfolio/resume | Current Mongo publication/account/global checks precede revisioned caches; selected/default resume ownership is enforced            | Warm two-worker cache revocation, restart, public serializer/preview/path tests                     |
| Applicable AI prompts   | Existing developer-signal builder supplies current career intent and selected evidence to existing consumers                        | Audited shared signal/hash path; mocked acceptance only, no provider-output or latency claim        |

Active fields remain the existing persisted account context. Permanent career saves set base and active fields; active-only switching leaves the base intact. Local login retains its established reset-to-base behavior. Multiple tabs share account context; this task does not introduce a separate per-tab developer identity.

## 4. Supported settings inventory

| Area / existing UI               | Settings / persistence                                                                                                                                                                                                                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile personal/account details | Name, job title, location, biography, phone number, avatar upload/replacement. Email, role, account age and aggregate stats remain server-owned/read-only. Country code retains its existing registration/recruiter workflow.                                                                         |
| Connected accounts on Profile    | Base GitHub username, website, Twitter handle, LinkedIn link. Active GitHub remains separately resolved. Existing website/LinkedIn shorthand UI inputs remain accepted; unsafe schemes/userinfo are rejected.                                                                                         |
| Career Profile                   | Base stack, experience, goal, target timeline and learning preference; explicit permanent save. Active stack/experience switch remains in the existing context controls.                                                                                                                              |
| Resume Analyzer                  | Owned resume list/upload/analyze, active/default selection and selected analysis. Profile displays current resume context and links to the analyzer.                                                                                                                                                  |
| Notifications                    | Weekly score report, skill trend alerts, new recommendations, job-match-alert preference. Persisted booleans remain independent. Existing weekly/skill/recommendation producers honor their preference keys; persisting job-match preference does not invent a new notification producer.             |
| Appearance                       | Existing Light/Dark/System theme preference remains in the existing theme service/browser storage.                                                                                                                                                                                                    |
| Account security                 | Current/new/confirmation password flow, policy feedback, conditional OAuth-only behavior, recovery/OTP/reset, credential-revision session revocation and current-session renewal.                                                                                                                     |
| Discovery                        | Explicit `User.isPublic` recruiter opt-in. Administrative roles cannot opt into the talent pool.                                                                                                                                                                                                      |
| Public Portfolio                 | Independent publication and slug; headline/summary/SEO; skills/projects/upcoming projects/testimonials; work history/completed courses; social links; section copy/visibility; public image upload; existing resume CTA and owner analytics. Existing portfolio page remains the editor.              |
| Integration marketplace          | Existing provider connections/sync and reference-only linked-profile management remain separate. Linked references do not manufacture observations or scores.                                                                                                                                         |
| Recruiter profile                | Existing company/title/hiring preferences plus embedded education, certifications, experience summary/years, specialties, tools/platforms, languages, preferred stacks/locations/job types, note template and activity digest. Existing owner/organization/role-scoped service remains authoritative. |
| Account deletion                 | Explicit confirmation, duplicate-submit guard, organization-ownership conflict, atomic owned-data deletion and durable file cleanup.                                                                                                                                                                  |

No speculative settings or unrelated features were added. Some settings intentionally live in their existing module pages rather than being duplicated on the Profile form.

## 5. Security, privacy, caching and storage verification

Passing local checks cover OAuth editing, password hash selection/compare-and-set, session revision rejection/renewal, opaque recovery handles/tamper/expiry, matching recovery envelopes, provider-error suppression, credential-before-status login, field/link/ID validation and owner-bound resumes. Backend ownership is taken from authentication, never a submitted user ID.

Public privacy checks occur before cache lookup. Mongo authorization failure, private publication, inactive/deleted owner and unauthorized preview cannot use a warmed payload. Two independent worker processes observe edits/revocation, and a restarted worker reads the persisted revision correctly with Redis unavailable. Preview serialization remains owner-only and uncached; public serialization excludes private contact/analytics/report data. Static PDFs remain inaccessible.

Frontend checks cover owner/TTL guards, shared inflight reads, late session/read/mutation fencing, storage invalidation, resume hash propagation and current-session renewal. Existing logout/account-switch cache clearing is preserved. Profile cache lifetime is five minutes; existing app authentication and some analysis caches still use browser storage, so this is not a claim that the entire application stores no sensitive data locally.

Public images are deliberately public assets by URL. Unpublishing revokes profile and resume endpoints, not previously downloaded copies or independent static image URLs. Account deletion cleans owned assets; additional media-revocation semantics require an explicit product decision and protected asset delivery. Legacy analytics/audit retention also remains a release gate below.

The new storage backend is configurable shared persistent filesystem storage, not an installed cloud bucket. Actual volume mounting, backups, service identity/permissions and deployment restart durability were not silently provisioned. See [OPERATIONS.md](OPERATIONS.md).

## 6. MongoDB, Redis, retention and scaling findings

- Existing slug, owner-history, resume, integration and visit uniqueness/expiry indexes are retained. No index or historical row was destructively migrated. The added cleanup collection needs only its `_id` identity index and deliberately has no TTL. Existing users read a missing session revision as zero.
- Profile initialization, analytics durability and deletion reuse the established transaction helper. Production must support snapshot transactions/majority writes and provision collections/indexes under its approved policy. No claim is made for standalone Mongo transaction support.
- Ordinary public cache failure remains optional. Public cache keys remain content-addressed; old worker/Redis/Mongo revisions cannot override current authorization. No scan, flush, global purge or production local-quota fallback was introduced.
- Avatar/portfolio uploads and public contact retain strict shared admission. General auth throttling remains the pre-existing process-local mechanism and needs a shared/gateway policy for multi-worker production.
- New visitor events retain HMAC visitor identifiers, unique per-profile/day admission, bot heuristics and 90-day TTL. Atomic receipt/counter writes remove crash double-count/lost-count divergence. Historical counters/events remain intact except explicit account deletion; no legacy raw-IP/UA sweep was run.
- Account deletion removes the explicit owner inventory; shared provider/public catalog data remains. Shared organization jobs/audit/invitation records have separate retention ownership. Organization owners must transfer ownership first. Failed file cleanup receipts survive until retry succeeds.
- Bounded checks exercised three concurrent independent settings writes, two simultaneous avatar replacements, two analytics writers, two separate cache workers, restart and three initialization/deletion races. The full affected backend run is about 22 seconds on this workstation; that duration is not a throughput benchmark. Fleet/volume sizing, large-account transaction behavior and deployment-equivalent soak remain external gates.
- Persistent flat image directories retain the established URL layout. Cleanup streams entries, but storage growth and abandoned/legacy upload retention still require deployment inventory and an approved policy; no silent historical cleanup or quota change was added.

## 7. Verification results and retained evidence

| Check                                                                      | Result                                                                                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Affected backend tests, including disposable Mongo/HTTP and two workers    | **77 passed, 0 failed, 0 skipped** — `backend-tests.tap`                                                                        |
| Angular full regression suite                                              | **434 passed across 76 files** — `frontend-tests.txt`                                                                           |
| Focused final profile/career/auth/interceptor/public-profile Angular tests | **32 passed across 5 files** — `frontend-focused-tests.txt`                                                                     |
| TypeScript application `--noEmit`                                          | **PASS**                                                                                                                        |
| Production Angular build                                                   | **PASS** — `frontend-build.txt`; existing unrelated landing-page style budget warning (56.67 kB versus 48 kB warning threshold) |
| Production-build browser harness                                           | **PASS**, desktop 1440×1000 and mobile 390×844, fixture HTTP APIs, external requests blocked — `browser-results.json`           |
| Visual review                                                              | Desktop/mobile screenshots inspected; long unbroken biography wrapping and settled mobile card bounds verified                  |
| Explicit-path Prettier write/check, changed JS syntax, Git whitespace      | **PASS**; finalization evidence retained                                                                                        |

The full Angular suite ran before the final native-dialog/overflow-only corrections; the final focused tests, production build and real-browser acceptance cover those corrections. The final backend run includes the surviving-owned-resume check. No configured production database, live Redis/provider, SMTP/SMS or AI endpoint was used for acceptance.

Browser coverage includes base-versus-active career display, no HTTP write for an unchanged form, a 500-character biography save, refresh persistence, password failure without logout, deletion conflict feedback/loading reset, native dialog interaction, and responsive viewport containment. Backend HTTP tests separately use real Mongoose persistence and JWT authentication; the browser API mock is not presented as database integration evidence.

Previously accepted portfolio privacy, serialization, cache and path contracts were reused via the focused hardening tests and retained `backend/verification/public-portfolio/REPORT.md`. Linked-profile and recruiter ranking regressions also pass. No scoring suite or live-provider suite was needlessly repeated.

### Exact changed files

- `backend/.env.example`
- `backend/index.js`
- `backend/src/controllers/authcontroller.js`
- `backend/src/controllers/profilecontroller.js`
- `backend/src/controllers/recruiter/candidateController.js`
- `backend/src/controllers/tenantcontroller.js`
- `backend/src/middleware/authmiddleware.js`
- `backend/src/middleware/avatarUploadMiddleware.js`
- `backend/src/middleware/portfolioImageUpload.js`
- `backend/src/models/accountDeletionCleanup.js`
- `backend/src/models/user.js`
- `backend/src/routes/profile.routes.js`
- `backend/src/scripts/retryAccountDeletionCleanup.js`
- `backend/src/scripts/verifyProfileSettingsBrowser.js`
- `backend/src/services/accountDeletionService.js`
- `backend/src/services/developerContextService.js`
- `backend/src/services/developerSignalService.js`
- `backend/src/services/newsService.js`
- `backend/src/services/publicImageStorageService.js`
- `backend/src/services/publicPortfolioAnalyticsPersistence.js`
- `backend/src/services/publicProfileService.js`
- `backend/src/services/recruiter/matchingService.js`
- `backend/src/services/sprintDraftContextService.js`
- `backend/src/tests/developerContextService.test.js`
- `backend/src/tests/fixtures/profileSettingsWorker.js`
- `backend/src/tests/profileAccountSecurity.test.js`
- `backend/src/tests/profileSettingsProduction.test.js`
- `backend/src/utils/authSessionToken.js`
- `backend/src/utils/imageType.js`
- `backend/src/utils/passwordPolicy.js`
- `backend/src/utils/passwordResetChallenge.js`
- `backend/verification/profile/OPERATIONS.md`
- `backend/verification/profile/PROFILE-SETTINGS-PRODUCTION-FINAL.md`
- `backend/verification/profile/backend-tests.tap`
- `backend/verification/profile/browser-results.json`
- `backend/verification/profile/finalization.json`
- `backend/verification/profile/formatting.txt`
- `backend/verification/profile/frontend-build.txt`
- `backend/verification/profile/frontend-focused-tests.txt`
- `backend/verification/profile/frontend-tests.txt`
- `backend/verification/profile/profile-desktop.png`
- `backend/verification/profile/profile-mobile.png`
- `frontend/src/app/interceptors/auth.interceptor.spec.ts`
- `frontend/src/app/interceptors/auth.interceptor.ts`
- `frontend/src/app/pages/profile/profile.component.html`
- `frontend/src/app/pages/profile/profile.component.scss`
- `frontend/src/app/pages/profile/profile.component.ts`
- `frontend/src/app/shared/services/auth.service.ts`
- `frontend/src/app/shared/services/career-profile.service.spec.ts`
- `frontend/src/app/shared/services/career-profile.service.ts`
- `frontend/src/app/shared/services/frontend-cache-invalidation.service.ts`
- `frontend/src/app/shared/services/profile.service.spec.ts`
- `frontend/src/app/shared/services/profile.service.ts`
- `frontend/src/app/shared/services/public-profile.api.spec.ts`
- `frontend/src/app/shared/services/resume.service.ts`

No existing repository file was moved or deleted. Task-owned fixture databases/uploads were cleaned after verification. The task-owned local Mongo process is stopped during finalization. Required final evidence, scripts, tests and screenshots are retained.

## 8. Remaining production gates

1. Configure and validate the shared persistent public-image volume on every worker; copy existing assets non-destructively, verify service permissions, backups/restoration and deployment restart behavior. Confirm durable existing resume storage too.
2. Confirm production Mongo transaction topology, collection/index provisioning and large-account deletion behavior. Provision the cleanup collection, schedule the explicit retry entry point with the existing supervisor, and alert on pending receipts.
3. Validate configured Redis/TLS and strict shared upload/contact admission. Confirm trust proxy, multi-worker authentication abuse enforcement and all-worker credential-revision rollout. No old worker may bypass new session checks.
4. Approve the existing signup duplicate-email disclosure policy and retained organization/audit/invitation/legacy analytics/public-asset retention semantics. Recovery enumeration was hardened; this is not a blanket assertion that every signup/disclosure policy is hidden. Strict per-image privacy revocation would require an additional protected-asset design.
5. Validate real mail/SMS delivery and configured timeouts, provider credentials/consent, production cache restart/outage behavior and deployment-equivalent soak. Local acceptance deliberately used disposable data/mocks and cannot certify these external systems.

**Final verdict:** PROFILE: PASS LOCAL | SETTINGS: PASS SUPPORTED WORKFLOWS | IDENTITY: PASS LOCAL | PERSONALIZATION: PASS LOCAL | CROSS-MODULE PROPAGATION: PASS FOCUSED / AUDITED CONTRACTS | SECURITY: HARDENED, RELEASE GATES OPEN | PRIVACY: API REVOCATION PASS, RETENTION/ASSET GATES OPEN | STORAGE: IMPLEMENTED, PERSISTENT VOLUME GATE OPEN | SCALABILITY: BOUNDED LOCAL PASS, FLEET GATE OPEN | UI: PASS DESKTOP/MOBILE | LOCAL ACCEPTANCE: PASS | PRODUCTION GATES: OPEN — NO DEPLOYMENT APPROVAL IMPLIED.
