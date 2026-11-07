# HackerRank final architecture decision — 27 October 2026

Source and authorized working branch: `task/integrations`; PR/merge target: not applicable. The nine staged files from the preceding provider-configuration task were present at preflight and remain staged as before. This follow-up adds unstaged changes without committing, unstaging or overwriting the earlier staged configuration. No credentials, deployments, migrations or historical observations were changed.

Read with the [architecture charter](../../../DEVINSIGHT_AI_SOLUTION_ARCHITECTURE_CHARTER.md), [provider configuration](PROVIDER-CONFIGURATION-2026-10-27.md) and [acceptance report](REAL-PROVIDER-ACCEPTANCE.md).

## Decision and behavior

**Provide a HackerRank Linked Profile reference; keep developer-statistics ingestion unavailable.**

The Marketplace has a separate form accepting a username or HTTPS profile URL on `hackerrank.com` or `www.hackerrank.com`. Both legacy `/<username>` and `/profile/<username>` paths normalize to `https://www.hackerrank.com/profile/<username>`. External hosts, URL credentials, query strings, fragments, custom ports, unsupported schemes and non-profile paths are rejected. The server never visits the URL. Profile existence and ownership remain unchecked; the UI explicitly labels **Ownership unverified**.

Users can save, update, open or remove their own reference. This creates no account connection, statistics, badges, credentials, inferred skills, confidence, sync event or provider insight. It does not change integration scores, historical records, connected counts or downstream contracts. Removing the link does not disconnect or erase an old HackerRank integration. Historical integration disconnect remains separately available through its existing card.

The additive API is `GET`, `POST` and `DELETE /api/integrations/linked-profiles/hackerrank`. POST accepts only the `profile` string from the request body; ownership comes from the authenticated user. Responses contain a `linkedProfile` envelope with canonical identity/link fields and constant `ownershipVerified: false`, `evidenceKind: user-entered-link`, or `null` when absent/removed. No new status is added to the existing integration-connection contract.

References use the dedicated `IntegrationLinkedProfile` Mongo model, uniquely keyed by user/provider, outside connection, insight and sync-log collections. Writes reuse the existing Mongo transaction and owner fence; admission uses the existing Redis mutation limiter. Owner fencing serializes against account deletion; account deletion removes the reference in the same existing transaction. The service performs no outbound requests or scoring/cache invalidation. Mongo transaction support and the existing Redis mutation controls remain runtime prerequisites. There is no data migration or history conversion.

`HACKERRANK_WORK_API_TOKEN` remains documented in `backend/.env.example` as an unused, application-defined placeholder for an enterprise Work token, unrelated to public developer-profile extraction. No token is needed for the linked-profile feature. Neither environment file was edited in this follow-up. Kaggle, Hashnode and Dev.to configuration and adapters are preserved.

## Source audit and limitations

Inspected the community repository's `main` source as retrieved on 27 October 2026. It is an unofficial wrapper, not a HackerRank authorization or supported developer-data contract. No dependency, source copy, hosted-service call or production adapter was added.

The [actual HTTP client](https://github.com/tashifkhan/hackerrank-stats-api/blob/main/services/client.py) uses `httpx` against HackerRank website REST routes, without Work API authentication, and sets a browser-style User-Agent. Its upstream route families are:

- `/rest/contests/master/hackers/{username}/profile`
- `/rest/hackers/{username}/scores_elo`
- `/rest/hackers/{username}/badges`
- `/rest/hackers/{username}/contest_participation`
- `/rest/hackers/{username}/rating_histories_elo`
- `/rest/hackers/{username}/submission_histories`
- `/rest/hackers/{username}/recent_challenges`
- `/rest/contests/master/challenges/{slug}`

These website routes are not documented as supported developer-profile endpoints in the official Work documentation reviewed. Wrapping them in FastAPI does not change that limitation. The client bounds contest retrieval to 50 rows and recent-challenge traversal to 25 pages by default, so completeness cannot be assumed.

The [service orchestrator](https://github.com/tashifkhan/hackerrank-stats-api/blob/main/services/hackerrank_service.py) combines profile, track scores, badges, submission history and recent-challenge reads to build statistics. These dependencies do not independently prove account ownership.

The [community README](https://github.com/tashifkhan/hackerrank-stats-api#readme) distinguishes practice-track score from solved count and best active-track rank from a global profile rank. It warns that submission histories can be empty despite real activity; difficulty breakdown, platform-wide totals and acceptance rate are unavailable. These are source limitations, not verified developer ability. We did not execute the community service or call its upstream website endpoints.

The [official HackerRank API overview](https://support.hackerrank.com/articles/2067417637-api-overview) documents enterprise Work workflows: tests, candidates/results, interviews, questions, organization users and teams. Its personal Work token is not a public community-profile credential. The [official API documentation entry](https://www.hackerrank.com/work/apidocs) was also followed; it did not expose a readable reference body to the browsing tool. No supported community badge/certificate API was established from this documentation.

## Future authorized API integration requirements

Before using the community wrapper or website data extraction in production, obtain explicit permission from HackerRank covering the intended endpoints, data use, storage, redistribution and request rates. Community source availability and an enterprise token do not supply that permission.

A future connector also needs a documented, authorized developer-data contract; supported authentication and ownership/consent proof; approved scopes, rate limits and retention; explicit metric meanings and pagination/completeness behavior; and live error/permission, persistence/concurrency and downstream acceptance. Continue using the established security, Redis, Mongo and sync boundaries. Any scoring or verified-skill policy needs a separately reviewed versioned decision. This implementation grants none of those future capabilities.

## Exact task-owned file inventory

Added:

- `backend/src/models/integrationLinkedProfile.js`
- `backend/src/services/integrationLinkedProfileService.js`
- `backend/src/controllers/integrationLinkedProfilescontroller.js`
- `backend/src/tests/integrationLinkedProfiles.test.js`
- `frontend/src/app/pages/integrations-marketplace/components/hackerrank-linked-profile.component.ts`
- `frontend/src/app/pages/integrations-marketplace/components/hackerrank-linked-profile.component.html`
- `frontend/src/app/pages/integrations-marketplace/components/hackerrank-linked-profile.component.scss`
- `frontend/src/app/pages/integrations-marketplace/components/hackerrank-linked-profile.component.spec.ts`
- `backend/verification/integrations/HACKERRANK-LINKED-PROFILE-DECISION.md`

Changed:

- `backend/src/routes/integrations.routes.js`
- `backend/src/services/integrationPersistenceService.js`
- `backend/src/services/integrations/index.js` (HackerRank description only)
- `frontend/src/app/shared/services/integrations.service.ts`
- `frontend/src/app/shared/services/integrations.service.spec.ts`
- `frontend/src/app/pages/integrations-marketplace/integrations-marketplace.component.ts`
- `frontend/src/app/pages/integrations-marketplace/integrations-marketplace.component.html`
- `frontend/src/app/pages/integrations-marketplace/integrations-marketplace.component.spec.ts`
- `backend/verification/integrations/REAL-PROVIDER-ACCEPTANCE.md`

Moved/deleted: none. No standalone temporary scripts, screenshots, traces or logs were created. Standard ignored compiler/test caches and build outputs are retained; no recursive cleanup or deletion of user work was performed.

## Focused verification

- Backend: `node --test backend/src/tests/integrationLinkedProfiles.test.js backend/src/tests/integrationsLifecycle.test.js backend/src/tests/integrationsAdapters.test.js backend/src/tests/hashnodePublication.test.js` — **35/35 passed**. Covers strict URL normalization, owner scoping/fencing, forged verification/score rejection, isolation from connections/evidence/history/network calls, safe errors, account deletion lifecycle and preservation of existing adapters.
- Frontend: `npm test -- --watch=false --include=src/app/pages/integrations-marketplace/integrations-marketplace.component.spec.ts --include=src/app/pages/integrations-marketplace/components/hackerrank-linked-profile.component.spec.ts --include=src/app/shared/services/integrations.service.spec.ts` from `frontend` — **15/15 passed**. Covers unverified/no-score labels, load/save/remove, failed-save preservation, independent API paths and no developer-signal cache invalidation. The sandbox run compiled but failed before executing tests on an `EPERM` temporary-cache rename; the same focused command passed outside the sandbox.
- `node frontend/node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.app.json` — **passed**.
- `npm run build` from `frontend` — **passed**, with one unrelated warning: unchanged `landing-page.component.scss` is 56.67 kB against its 48 kB warning budget (8.67 kB over).
- Installed Prettier — explicit-path **write and check passed** on all 16 changed/added source files and both reports. Backend/report flags: `--single-quote --print-width 100 --trailing-comma none`; frontend uses `frontend/.prettierrc`.
- `node --check` — **passed** on all seven changed/added backend JavaScript files.
- `git diff --check` and `git diff --cached --check` — **passed**. No staging, commit or cleanup deletion occurred.

No complete backend/frontend test suite, live-provider ingestion, database migration, production-data mutation or deployment was run. Backend persistence/ownership tests use deterministic doubles; no new live Mongo/Redis acceptance is claimed for this follow-up. The new model declares the user/provider unique index; deployment-equivalent transaction/index and authenticated live persistence acceptance remain unverified. The feature is implemented and focused checks pass; statistics extraction remains unsupported and no production-readiness claim is made.
