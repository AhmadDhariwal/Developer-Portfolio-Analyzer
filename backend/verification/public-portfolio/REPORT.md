# Public Portfolio backend finalization

**STATUS: VERIFIED**

**READY FOR PUBLIC PORTFOLIO FRONTEND: YES**

Verification date: 2026-10-20. Backend implementation only; no frontend changes,
deployment, production migration, live email, AI request, or paid provider call.

## Cache and invalidation

- The public read checks persisted global visibility, indexed slug and account state before any cache.
  Explicit `PublicProfile.isPublic === true`, an existing active account, and the
  platform visibility setting are required. Mongo authorization failure returns 503;
  it cannot expose stale data. Preview requires the authenticated owner and bypasses
  all public caches, including when the profile is already published.
- Memory (200 entries) → configured Upstash Redis → Mongo `PublicProfileCache`.
  Version `public-portfolio:v3`; 5-minute freshness, 1-hour stale retention. Mongo
  retains at most one payload per profile and has a TTL index. Redis revisions and
  locks expire; unreachable revision keys are not scanned or globally deleted.
- Keys hash current persisted profile content and selected account fields. Analytics
  counters/timestamps do not change keys. Profile edits, slugs, contact changes,
  account edits/default resume selection, revocation and account deletion make old
  worker entries unreachable. Account visibility revocation also unpublishes its
  portfolios. Discovery opt-in and portfolio publication remain separate controls.
- Single-flight is bounded in process. Redis uses a token-owned 10-second lease and
  at most 1 second of polling across processes; release is atomic Lua compare/delete.
  Redis outage retains per-process single-flight and Mongo fallback. Same-revision
  stale data may cover rendering-source failures after successful authorization.
- Responses use `private, no-store`; a CDN/browser cannot use stale-if-error to
  resurrect unpublished or preview data. Public links use configured API origin or
  same-origin relative URLs, never the request Host header.

## Privacy, security and compatibility

- Public serialization excludes IDs, contact fields, analytics, weekly-report
  details, hidden courses, hidden section contents and hidden resume links. Owner
  settings retain their private fields. Existing visibility controls clear payload
  collections/copy; profile strength uses visible public inputs on public responses.
- Update validation rejects markup, unsafe URL schemes/userinfo, invalid visibility,
  malformed collections, arrays over 50 entries, and payloads over 64 KiB. Existing
  text is serialized as plain text. Collections retain established output bounds.
- Resume reads bind the default file to its owner, require PDF MIME/extension and a
  regular file, resolve symlinks/junctions, and confine the real path to uploads.
  Public reads require publication, active account and visible CTA. Authenticated
  `GET /api/public-profiles/me/resume` permits the owner's unpublished resume.
  Anonymous static PDFs, including previews, are denied. Public image static paths
  are restricted and sent with `nosniff`.
- Public URLs and existing owner/public endpoint shapes remain. Public analytics
  are intentionally excluded and public momentum is null for privacy. Fabricated
  default work history has been removed; an empty work history remains empty.
- Public rendering uses persisted data, with no live AI/provider enrichment or N+1
  query loops. Saved explicit skills skip fallback skill queries. Analysis fallback
  uses a deterministic newest-row sort. Canonical resume resolution remains intact.
- Developer Context, Dashboard, Recommendations, Simulator, Recruiter discovery and
  scoring modules are unchanged. Owner serialization remains available to portfolio
  signals. Existing Skill Gap evidence treats portfolio skills as CLAIM, not verified
  evidence; its focused existing evidence tests are included in verification.

## Rate limits and outage policy

All counters use the existing Redis client and atomic Lua INCR/expiry, identity
hashes, fixed windows, 429 and Retry-After. IPs come from Express `req.ip`, not raw
forwarded headers; production must configure trust proxy to match its actual proxy.

| Endpoint                       | Limit     | Identity                  | Redis outage                                         |
| ------------------------------ | --------- | ------------------------- | ---------------------------------------------------- |
| Public profile                 | 60/minute | IP                        | Bounded per-process fallback                         |
| Resume                         | 10/minute | IP or authenticated owner | Bounded per-process fallback                         |
| Owner settings/analytics reads | 30/minute | Account                   | Bounded per-process fallback                         |
| Settings mutation              | 20/minute | Account                   | Bounded per-process fallback preserves privacy edits |
| Image upload                   | 10/hour   | Account                   | 503, Retry-After 30                                  |
| Recruiter contact              | 3/hour    | Account                   | 503, Retry-After 30                                  |
| Contact recipient              | 20/day    | Slug                      | 503, Retry-After 30                                  |

Read/mutation fallback maps have a 2,000-identity cap and expire each window. During
Redis outages those limits are per process; aggregate limits can scale with workers.
Optional mail/upload actions fail closed rather than bypassing spam/storage controls.

## Analytics

- Non-blocking, best-effort recording with at most 100 in-flight writes per process.
  HEAD, owner-authenticated views, previews, missing identity/user agent and common
  bot user agents are excluded. This is heuristic filtering, not perfect bot detection.
- HMAC includes profile, UTC date, Express IP and bounded user agent, using
  `PUBLIC_PORTFOLIO_ANALYTICS_SECRET` or the existing JWT secret. Raw addresses and
  user agents are never stored in new events. A unique Mongo index deduplicates
  concurrent workers. Events expire after 90 days. Missing secret disables recording.
- New total/unique increments represent one accepted visitor/profile/UTC-day, rather
  than repeated refreshes. Historical counters/events are preserved. Daily aggregation
  sums legacy view events and new deduplicated events across seven UTC calendar days.
- The unique event is authoritative for daily counts. Event insertion and lifetime
  counter increments are separate writes; process/database failure between them can
  undercount lifetime counters. Background work is not a durable analytics queue.
  Legacy stored IP/agent records are preserved under the no-data-deletion constraint;
  a separately approved retention operation would be needed to remove that history.

## New capabilities and operating dependencies

- `POST /api/public-profiles/:slug/contact`: authenticated, active, verified recruiter;
  20–4,000-character plain-text `message`, empty `website` honeypot, authenticated
  reply-to, publication/recipient checks and per-sender/per-recipient quotas. Existing
  SMTP mail transport must accept the message before `{ sent: true }` is returned.
  Missing/failed mail configuration returns 503. SMTP acceptance does not guarantee
  inbox delivery. Verification mocks mail; no messages were sent.
- `POST /api/public-profiles/me/project-image`: authenticated owner, multipart
  `image`, one file ≤2 MiB, JPEG/PNG/WebP MIME and structural/header/dimension checks,
  generated owner-prefixed names and exclusive writes inside real-path-confined
  `backend/uploads/portfolio-images`. SVG/HTML are rejected. Assets are deliberately
  public; uploading does not publish a portfolio or update project records.
- Local disk is the repository's supported storage. Production workers need a shared
  persistent uploads volume and backup/capacity management; no cloud storage provider
  is configured or invented. Validation is not image re-encoding or malware scanning.
  Authenticated upload quotas bound creation rate; no automatic user-asset deletion.
- Production must retain the new unique/TTL indexes for `PublicProfileCache` and
  `PublicPortfolioVisit`. Tests create indexes only in their disposable database;
  no index operations were run against the application database.
- Persisted account/profile state is required for fail-closed visibility checks, so
  serving during a MongoDB outage intentionally returns unavailable. Redis/AI/mail
  outages do not prevent authorized public reads when Mongo is available.

## Verification and finalization

Final focused run: **63 passed, 0 failed, 0 skipped** (27.24 seconds).

- 16 portfolio unit checks; 11 isolated Mongo/Upstash integration subtests plus
  their parent; 14 existing canonical Developer Context checks; 21 existing Skill
  Gap evidence checks. Separate Node processes verify shared locks and revisions.
- Isolated Mongo uses a generated `portfolio_test_<uuid>` database; Upstash uses a
  generated `portfolio-test:<uuid>:` namespace on the already-configured infrastructure.
  The fixture constrains every Redis key/lock, drops only its owned Mongo database,
  and removes its own temporary PDF/image files and empty image directory.
- `node --check` passed for all 17 changed/new JavaScript files.
- Installed Prettier ran in write mode and check mode on all 20 changed source/doc
  files, using single quotes, no trailing commas, print width 100 and CRLF. Two-space
  indentation is used except the existing four-space backend entry file. The docs
  are explicitly included despite the repository's documentation ignore rule.
- Both `git diff --check` and `git diff --cached --check` passed.
- No frontend tests/build, exhaustive E2E, full repository regression or deployment.
- Retained execution evidence: [final-tests.tap](final-tests.tap). Mail acceptance
  and failure were mocked; no live delivery was attempted. Integration tests use
  the actual authenticated HTTP routes and actual configured Mongo/Upstash storage.

Re-run the focused suite from the repository root:

```powershell
node --test --test-concurrency=1 backend/src/tests/publicPortfolioHardening.test.js backend/src/tests/publicPortfolio.integration.test.js backend/src/tests/skillGapEvidence.test.js backend/src/tests/developerContextService.test.js
```

No files moved. No tracked files deleted. Test-owned temporary PDF/image files and
disposable MongoDB/Redis records are removed by the fixture. The existing user edit
to `frontend/src/app/pages/jobs/jobs.component.scss` is preserved and excluded from
formatting and all frontend validation.

## Exact file inventory

Modified existing files:

- `backend/index.js`
- `backend/src/controllers/profilecontroller.js`
- `backend/src/controllers/publicProfileController.js`
- `backend/src/routes/publicProfile.routes.js`
- `backend/src/services/publicProfileService.js`
- `docs/API_REFERENCE.md`
- `docs/features/profile.md`

Added files:

- `backend/src/middleware/portfolioImageUpload.js`
- `backend/src/middleware/publicPortfolioRateLimit.js`
- `backend/src/middleware/publicUploadAccess.js`
- `backend/src/models/publicPortfolioVisit.js`
- `backend/src/models/publicProfileCache.js`
- `backend/src/services/publicPortfolioCacheService.js`
- `backend/src/services/publicPortfolioContactService.js`
- `backend/src/services/publicPortfolioVisibilityService.js`
- `backend/src/tests/fixtures/publicPortfolioFixture.js`
- `backend/src/tests/fixtures/publicPortfolioWorker.js`
- `backend/src/tests/publicPortfolio.integration.test.js`
- `backend/src/tests/publicPortfolioHardening.test.js`
- `backend/verification/public-portfolio/REPORT.md`
- `backend/verification/public-portfolio/final-tests.tap`
