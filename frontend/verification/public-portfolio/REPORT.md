# Public Portfolio frontend finalization

**STATUS: VERIFIED**

**READY FOR PUBLIC PORTFOLIO FINAL E2E: YES**

Verification date: 2026-10-20. Frontend only. Backend changes from the prior stage,
staged documentation, and the user's Jobs stylesheet changes were preserved.

## Implemented experience

- `/p/:slug`: Manrope, indigo Developer tokens, Light/Dark/System appearance,
  responsive identity/hero, skill labels, project cards with native expandable
  details, experience, visible credentials, testimonials, professional links,
  secure resume downloads and optional recruiter enquiries. Missing content stays
  absent. No fabricated proficiency, work history, momentum, scores or achievements.
- `/app/portfolio`: tabbed editor retaining hero/copy, headline/bio, skills,
  projects/upcoming projects, testimonials, experience, courses/credentials,
  contact copy/private email, four supported section controls, slug, publication,
  professional links and SEO. New entries are blank owner-authored drafts.
  Reserved `me` slugs are rejected. The saved server slug/publication determines
  sharing and preview links; unsaved checkboxes do not claim publication succeeded.
- Project covers support PNG/JPEG/WebP, client MIME/size checks (2 MiB), local object
  URL previews, upload progress/error states and server-accepted addresses. Object
  URLs are revoked. Save is disabled during uploads. Backend validation remains
  authoritative. Uploading alone does not publish or save project changes.
- Private email editing does not change the destination for recruiter enquiries:
  delivery uses the owner's account email, managed in existing Profile settings.
  No unsupported public email/phone controls were invented.
- Owner-only activity shows API counts and seven UTC calendar days, zero-height
  bars for zero views, and distinct loading/empty/unavailable states. The misleading
  retention percentage and invented completeness guidance were removed.

## API and privacy integration

- Preserves the verified `/api/public-profiles` routes and shapes; adds frontend
  wrappers for `POST /me/project-image`, `POST /:slug/contact` and authenticated
  `GET /me/resume`. Public PDF downloads use `GET /:slug/resume` without auth;
  private previews use the authenticated owner endpoint. Blob downloads never
  forward a token to arbitrary external URLs.
- Anonymous portfolio reads use the existing interceptor's `X-Skip-Auth` contract.
  Signed-in reads retain the JWT so backend owner-view exclusion can apply.
  Previews, owner actions, uploads and enquiries remain authenticated. The shared
  interceptor and backend were not changed.
- Removed the forced `localhost:5000` app-shell origin. Existing environment
  injection remains supported; otherwise requests use same origin. Development
  already proxies `/api` and `/uploads`; deployments must provide a reverse proxy
  or inject `__DEVINSIGHT_API_ORIGIN__` before bootstrap.
- Client reuse is limited to at most 25 in-flight public requests. Completed public
  results are not cached, persisted, or used as stale fallback. Each preview is a
  separate uncached request. Subscription cancellation, route switching and
  generations reject late responses. 404/503 never resurrect earlier content.
- Mutations clear portfolio reads before requests and after acknowledgement;
  existing Dashboard/Simulator/Weekly Report invalidation hooks are retained.
  Profile visibility acknowledgement also invalidates portfolio state.
- BroadcastChannel (or a timestamp-only storage fallback) notifies other tabs.
  Account changes cancel requests and immediately clear private editor state.
  Cross-tab session changes require a page reload rather than trusting a stale
  account singleton. External changes preserve unsaved drafts but block stale
  saves/previews until the saved version is reloaded. Public views revalidate on
  focus/visibility and do not retain inactive page snapshots.
- Display projection excludes private contacts, analytics, momentum, identifiers,
  hidden collections/courses and hidden resume links, including owner previews.
  Angular interpolation is used; no trusted HTML bypass. Links reject executable
  schemes/userinfo; images do not use automatic third-party screenshot services.
  External links use `noopener noreferrer`; provided remote images omit referrers.
- Public metadata includes title/description, Open Graph, Twitter and canonical
  URL. Loading, errors and owner previews are noindex; preview metadata never
  contains private copy or public sharing tags. Metadata is cleared on navigation.

## Recruiter enquiries

The form is offered to signed-in recruiters, excluding explicitly unverified or
inactive accounts. Established sign-in responses may omit verification flags;
that case can attempt delivery, and the backend decides verification/ownership.
The UI never fabricates a verified flag. Ordinary visitors use owner-supplied
professional links or recruiter sign-in; no private contact fallback is shown.

Messages require 20–4,000 plain-text characters and an empty honeypot. The UI
handles 401/403, validation, 429 with Retry-After, 503/mail unavailability and
`sent: true` acknowledgement. Acceptance is described as mail-server acceptance,
not guaranteed inbox delivery. No real messages were sent.

## Verification evidence

- Controlled browser run: seven interaction groups passed, eight retained theme
  screenshots, no page errors. Verified anonymous rendering, appearance/System
  changes, 404/503 clearing, recruiter 403/429/503/success, upload errors/success,
  saved slug/unpublish propagation, private preview isolation, analytics states,
  self-hosted Manrope and no horizontal overflow at 1440 and 390 pixels.
- A targeted two-desktop follow-up verified final labels and the UTC weekday fix;
  it refreshed only affected screenshots instead of repeating the browser matrix.
- All browser API responses were controlled synthetic fixtures. External requests
  were blocked. Browser contexts used disposable fixture credentials, not real
  authentication or production data. This is not authenticated final E2E.
- [Browser results](browser-results.json), [targeted follow-up](polish-results.json).

Final checks:

- **28 focused tests passed** in five files. The nine owner-state tests were
  rechecked after the final private snapshot cleanup and all passed.
  [Retained test output](focused-tests.log).
- TypeScript app check passed, run once from the repository root:
  `node frontend/node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.app.json`.
- Production `npm run build` passed, run once. Initial bundle: 2.96 MB raw,
  estimated 490.61 kB transfer. [Retained build output](production-build.log).
  One warning concerns the unchanged landing-page stylesheet: 55.89 kB against
  its 48 kB warning budget. No portfolio style budget errors occurred.
- Installed Prettier ran in write/check mode with `frontend/.prettierrc` on all
  21 changed/new source and verifier files, this report and both JSON evidence
  files. No repository-wide formatting or unrelated stylesheet edits.
- The CJS verifier passed `node --check`; Angular templates/TypeScript were
  compiled by focused tests and the production build. Both Git unstaged and
  staged whitespace checks passed.

Focused tests can be repeated from `frontend`:

```powershell
npm test -- --watch=false --include="src/app/shared/**/public-profile*.spec.ts" --include="src/app/pages/public-portfolio/*.spec.ts" --include="src/app/pages/portfolio-settings/*.spec.ts"
```

The reusable browser verifier is `frontend/scripts/verify-public-portfolio.cjs`.
It targets a local preview on port 4220, intercepts every API request and blocks
external hosts. Set `PORTFOLIO_PLAYWRIGHT_MODULE` to an existing Playwright module
if supplied by the desktop runtime; no dependency was added. The optional
`PORTFOLIO_VERIFY_SCOPE=polish` limits follow-up capture to the two desktop views.

## Screenshots

Synthetic fixture content is used in every screenshot.

| Surface  | Light desktop                      | Dark desktop                      | Light mobile                      | Dark mobile                      |
| -------- | ---------------------------------- | --------------------------------- | --------------------------------- | -------------------------------- |
| Public   | [View](public-light-desktop.png)   | [View](public-dark-desktop.png)   | [View](public-light-mobile.png)   | [View](public-dark-mobile.png)   |
| Settings | [View](settings-light-desktop.png) | [View](settings-dark-desktop.png) | [View](settings-light-mobile.png) | [View](settings-dark-mobile.png) |

## Limits and next-stage prerequisites

- Real authenticated backend integration, email delivery, disk persistence and
  deployment are intentionally reserved for final E2E. No backend tests, paid API
  calls, production writes or full repository regression were performed here.
- Social metadata is client-rendered. Crawlers that do not execute JavaScript may
  require existing hosting/server support for per-portfolio previews; no SSR or
  backend rendering was introduced in this frontend stage.
- Remote visitors on another device learn about revocation on their next server
  read/focus revalidation; already-delivered browser content cannot be retroactively
  erased. Same-origin client mutations notify local tabs. Backend authorization
  remains authoritative on every read/action.
- Backend operational dependencies remain as documented: shared persistent upload
  storage across workers, mail configuration, indexes, and best-effort analytics.
  Uploaded image assets are public even before project changes are saved; private
  image storage is not part of the verified backend contract.
  Contact and upload quotas are server-owned; the UI presents server errors and
  does not replace distributed admission with a client-only gate.
- Owner previews show saved data only. Unsuccessful edits remain drafts. No
  per-contact visibility switches or unsupported backend fields were invented.

## Cleanup and exact inventory

No existing files were moved or deleted. Eight final screenshots, browser evidence,
focused tests/fixtures and the reusable browser verifier are retained. Task-owned
preview processes were stopped; no traces, temporary scripts or duplicate reports
were retained. Existing backend evidence and user work were not cleaned up.

Modified files:

- `frontend/src/app/pages/portfolio-settings/portfolio-settings.component.html`
- `frontend/src/app/pages/portfolio-settings/portfolio-settings.component.scss`
- `frontend/src/app/pages/portfolio-settings/portfolio-settings.component.ts`
- `frontend/src/app/pages/public-portfolio/components/project-card/project-card.component.html`
- `frontend/src/app/pages/public-portfolio/components/project-card/project-card.component.scss`
- `frontend/src/app/pages/public-portfolio/components/project-card/project-card.component.ts`
- `frontend/src/app/pages/public-portfolio/public-portfolio.component.html`
- `frontend/src/app/pages/public-portfolio/public-portfolio.component.scss`
- `frontend/src/app/pages/public-portfolio/public-portfolio.component.ts`
- `frontend/src/app/shared/services/api.service.ts`
- `frontend/src/app/shared/services/profile.service.ts`
- `frontend/src/app/shared/services/public-profile.service.ts`
- `frontend/src/index.html`

Added files (including retained verification evidence):

- `frontend/scripts/verify-public-portfolio.cjs`
- `frontend/src/app/pages/portfolio-settings/portfolio-settings.component.spec.ts`
- `frontend/src/app/pages/public-portfolio/public-portfolio.component.spec.ts`
- `frontend/src/app/pages/public-portfolio/testing/portfolio.fixture.ts`
- `frontend/src/app/shared/services/public-profile.api.spec.ts`
- `frontend/src/app/shared/services/public-profile.service.spec.ts`
- `frontend/src/app/shared/utils/public-profile.utils.spec.ts`
- `frontend/src/app/shared/utils/public-profile.utils.ts`
- `frontend/verification/public-portfolio/REPORT.md`
- `frontend/verification/public-portfolio/browser-results.json`
- `frontend/verification/public-portfolio/focused-tests.log`
- `frontend/verification/public-portfolio/polish-results.json`
- `frontend/verification/public-portfolio/production-build.log`
- `frontend/verification/public-portfolio/public-dark-desktop.png`
- `frontend/verification/public-portfolio/public-dark-mobile.png`
- `frontend/verification/public-portfolio/public-light-desktop.png`
- `frontend/verification/public-portfolio/public-light-mobile.png`
- `frontend/verification/public-portfolio/settings-dark-desktop.png`
- `frontend/verification/public-portfolio/settings-dark-mobile.png`
- `frontend/verification/public-portfolio/settings-light-desktop.png`
- `frontend/verification/public-portfolio/settings-light-mobile.png`
