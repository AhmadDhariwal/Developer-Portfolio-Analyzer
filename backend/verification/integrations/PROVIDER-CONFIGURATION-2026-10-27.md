# Provider configuration — 27 October 2026

Source and authorized working branch: `task/integrations`. Initial index and working tree were clean. PR/merge target: not applicable. No commit, push, deployment, migration or live-provider acceptance performed.

Read together with the architecture charter and [previous acceptance](REAL-PROVIDER-ACCEPTANCE.md). This report supersedes its configuration-only Hashnode decision; its historical acceptance evidence remains unchanged.

## Configuration and access

All four settings are documented in `backend/.env.example` and appended blank to ignored `backend/.env`. Existing local values were compared in memory and preserved; no values were printed. Restart the backend after supplying configuration.

| Variable                    | Operator action                                                                                    | Runtime use                                                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KAGGLE_API_TOKEN`          | Optional token from [Kaggle API settings](https://www.kaggle.com/settings/api), Generate New Token | Reserved for authorized resource API evaluation. Does not enable profile ingestion.                                                                                 |
| `HACKERRANK_WORK_API_TOKEN` | Optional enterprise personal token from HackerRank for Work, Settings → User → API → New Token     | Application-defined placeholder for a documented Work credential. Not consumed by the public-profile adapter. Do not purchase Work access to unlock this connector. |
| `HASHNODE_PAT`              | Supply a PAT from Hashnode Account Settings → Developer / API tokens                               | Server-side Bearer authentication; `me.username` must match the selected `hashnode@username`.                                                                       |
| `HASHNODE_PUBLICATION_HOST` | Supply the authorized Pro publication hostname, such as `your-publication.hashnode.dev`            | GraphQL variable, hostname only. The endpoint is fixed to `https://gql.hashnode.com`; redirects remain disabled.                                                    |

Kaggle and HackerRank do not require keys for their unavailable Marketplace cards. Their placeholders intentionally have no adapter consumer. No OAuth client secret, invented public-profile token, API enable flag or arbitrary endpoint override was introduced.

## Supported features and limitations

- **Kaggle:** official resource APIs cover datasets, notebooks, competitions and other resources. No supported medal/tier/profile-achievement contract for the existing scoring adapter was established. Profile ingestion stays unavailable and performs no HTTP request. Existing records remain untouched.
- **HackerRank:** the documented Work APIs serve enterprise tests, candidates, interviews, users and teams. They do not provide the public developer badge/certificate contract required here. Profile ingestion remains unavailable, regardless of Work token presence.
- **Hashnode:** implemented through existing `devblogs` registration, using explicit `hashnode@username`. An authenticated `me` read and Pro-gated `publication(host:)` read must both succeed before connection persistence. Only the selected author's posts from the latest 30 publication posts contribute observations. Other team authors are excluded. Article count is the observed sample, not lifetime output. Pagination availability, publication identity and sample bounds remain in normalized activity. Reactions, timestamps and tags come from the provider; unavailable views remain `null`. Empty authored samples, partial GraphQL errors, malformed metrics, mismatched token identity and denied access reject ingestion.
- **Marketplace:** the existing blog card identifies both sources. Its backend description distinguishes missing/invalid Hashnode configuration from configuration present pending connection validation. The shared input retains the Dev.to placeholder and describes explicit Hashnode selection. Hashnode API failures are shown through the existing connection error flow; the card cannot claim an active Hashnode connection before successful validation. Kaggle/HackerRank remain disabled and historical disconnect remains possible.
- **Dev.to:** retains its explicit `devto@username` selection, endpoint, 30-article bound, normalization, raw payload key and scoring. It never calls Hashnode or requires its configuration. Ambiguous legacy combined handles remain blocked; no history conversion occurs.

Hashnode publication owners must enable Pro API access through the publication's Billing page. A PAT does not grant Pro entitlement. Authentication failures, Pro denials and malformed responses fail closed. The PAT has broader account capabilities than these read queries need; it stays server-side and is never included in observations or error text. No mutations are sent.

The new Hashnode reader extends the existing base adapter under the `devblogs` quota. Redis admission, timeouts, response bounds and redirect controls remain centralized. Existing manual connection validation, fenced Mongo persistence, synchronization, caching, historical records and downstream score formulas remain unchanged. Hashnode snapshots still have the existing manual/provider-observed ownership semantics; matching the server PAT does not establish app-user ownership.

## Official references checked

- [Kaggle API documentation](https://www.kaggle.com/docs/api) and [official CLI authentication/resource documentation](https://github.com/Kaggle/kaggle-cli/blob/main/docs/README.md).
- [HackerRank API overview and token generation](https://support.hackerrank.com/articles/2067417637-api-overview).
- [Hashnode Pro API policy, 13 May 2026](https://hashnode.com/changelog/2026-05-13-graphql-api-paid-access), [API introduction](https://docs.hashnode.com/quickstart/introduction), [official authentication reference](https://github.com/Hashnode/gql-skill/blob/main/skills/gql-api/references/auth-and-roles.md), and [official GraphQL schema](https://github.com/Hashnode/gql-skill/blob/main/skills/gql-api/references/schema.graphql).

The Hashnode announcement broadly requires Pro for publication requests; the current schema explicitly gates `publication`. This implementation uses that gate and does not try public user/feed queries as a workaround. Credentials and entitlement were not supplied, so no live Hashnode, Mongo persistence or downstream acceptance is claimed.

## Exact task-owned inventory

Changed:

- `backend/.env` (ignored, four blank settings only)
- `backend/.env.example`
- `backend/src/services/integrations/devBlogsAdapter.js`
- `backend/src/services/integrations/index.js`
- `backend/src/tests/integrationsAdapters.test.js`
- `frontend/src/app/pages/integrations-marketplace/integrations-marketplace.component.ts`
- `frontend/src/app/pages/integrations-marketplace/integrations-marketplace.component.spec.ts`

Added:

- `backend/src/services/integrations/hashnodePublication.js`
- `backend/src/tests/hashnodePublication.test.js`
- `backend/verification/integrations/PROVIDER-CONFIGURATION-2026-10-27.md`

Moved/deleted: none. No task-owned temporary scripts, screenshots, traces or logs were created. Existing verification files and untracked work were not removed. Angular's ignored build cache may be updated by the focused test runner; no cache cleanup was performed.

## Focused verification

- `node --test backend/src/tests/integrationsAdapters.test.js backend/src/tests/hashnodePublication.test.js`: **20/20 passed**. Includes fixture-based request/auth mapping, author attribution, partial/invalid responses, missing configuration, safe errors, quota propagation and existing Dev.to isolation.
- From `frontend`: `npm test -- --watch=false --include=src/app/pages/integrations-marketplace/integrations-marketplace.component.spec.ts --include=src/app/shared/services/integrations.service.spec.ts`: **11/11 passed**. The initial sandbox run compiled successfully but failed before test execution on an `EPERM` temporary-cache rename; the same focused command passed outside the sandbox.
- `node frontend/node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.app.json`: **passed**.
- Installed Prettier ran in **write** mode on all seven changed/added source files and this report, followed by **check** on the same explicit paths. Backend/report options: `--single-quote --print-width 100 --trailing-comma none`; frontend uses `frontend/.prettierrc`. Environment files were edited as configuration, preserving established layout and values. A transient Windows file-open failure on the first frontend formatter attempt cleared on retry.
- `node --check` on the five changed/added backend JavaScript files: **passed**.
- `git diff --check` and `git diff --cached --check`: **passed**; index remains unchanged.
- Final inventory review: no moved/deleted files, stale task-owned temporary artifacts, new dependencies, schema changes or scoring-rule changes. No cleanup deletions were needed.

Full suites, production build, live API traffic and deployment are deliberately excluded by the requested scope. External credential validity and Hashnode Pro entitlement remain unverified until the operator configures them and successfully connects. Kaggle/HackerRank profile ingestion remains blocked by the missing supported developer-data contracts, regardless of credentials.
