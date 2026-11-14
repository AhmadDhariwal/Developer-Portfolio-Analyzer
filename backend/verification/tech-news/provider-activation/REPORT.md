# Personal development provider activation

25 October 2026, Asia/Karachi. This is a local development activation, not a production entitlement certificate. The operator explicitly authorized enabling only sources whose current terms support personal non-commercial development. `NODE_ENV=development` was checked before editing.

**STATUS: BLOCKED** — configuration and NewsAPI persistence verified; GNews persistence and the corrected Cloudflare adapter's live acceptance remain unverified until the next normally admitted request.

**PROVIDERS ENABLED: NewsAPI, GNews, Cloudflare Changelog**

**API FETCHING VERIFIED: NO** — NewsAPI and GNews fetched successfully; Cloudflare's first request exceeded its response-size limit.

**ENV CONFIGURATION VERIFIED: YES**

## Provider results

| Provider             | Status                                                         | Actual first request                                                           | Source-attributed NewsArticle records | Remaining action                                                                                                                                         |
| -------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NewsAPI              | ENABLED & WORKING                                              | One governed request; success; 50 normalized articles                          |                                    48 | Keep local/private development scope. Reassess subscription and rights before staging/production.                                                        |
| GNews                | ENABLED BUT BLOCKED — catalog acceptance unverified            | One governed request; success; 10 normalized articles                          |                                     0 | Examine the next normally admitted batch's ages, canonical matches and catalog acceptance. Do not equate normalized count with inserted records.         |
| Cloudflare Changelog | ENABLED BUT BLOCKED — corrected adapter awaits live acceptance | One governed request; response_too_large at the previous 1 MiB transport limit |                                     0 | Allow the next scheduled request with the corrected 8 MiB bounded transport/parser. No claim that the actual response fits that new limit has been made. |
| Lobsters             | DISABLED                                                       | No request                                                                     |                                     0 | Public tag RSS is documented; explicit application catalog storage/reuse permission was not established. Obtain clarification before approval.           |
| Reddit               | DISABLED                                                       | No request                                                                     |                                     0 | Explicit API approval, OAuth credentials, token renewal and deletion handling are still required.                                                        |

The first-fetch results are retained separately in [first-fetch.json](first-fetch.json); subsequent scheduled ticks correctly replace attempted-fetch statuses with interval waiting. [runtime-after.json](runtime-after.json) records effective admission after the final restart. NewsAPI/GNews next eligibility is **25 October 2026, 13:07:23 Pakistan time**; Cloudflare approximately **13:07:27**. These are earliest provider eligibility times, not a guarantee of article arrival; other admission checks still apply.

## Permission evidence and scope

- [NewsAPI terms](https://newsapi.org/terms) permit development/testing in a development environment and downloading for the use case's duration, with third-party rights and restrictions on republication/public disclosure. Its [Developer plan](https://newsapi.org/pricing) documents 100 requests/day and a 24-hour delay. This activation is limited to the user's stated private personal development cache, with attribution and no full bodies. It does not grant publisher image/text rights for public distribution.
- [GNews terms, sections 3 and 7](https://gnews.io/legal/terms-of-service) permit personal/non-commercial API/data use and reasonable performance caching. [Free limits](https://gnews.io/faq) are 100 requests/day, 10 results and a 12-hour delay. This bounded local cache is not approval for redistribution, competing database construction or commercial use. Actual account subscription/payment settings were not accessed or changed.
- [Cloudflare's repository grant](https://github.com/cloudflare/cloudflare-docs/blob/production/README.md#license-and-legal-notices) covers repository documentation/content under CC BY 4.0 except where noted. [Changelog sources](https://github.com/cloudflare/cloudflare-docs/tree/production/src/content/changelog) are within that repository, and the [official feed directory](https://developers.cloudflare.com/fundamentals/new-features/available-rss-feeds/) documents RSS access. Metadata now retains Cloudflare credit and the license link; bodies are discarded. No numeric upstream RSS quota was established; two polls/day is a conservative operator ceiling, not an upstream entitlement claim.
- [Lobsters about page](https://lobste.rs/about) confirms public tag feeds but does not establish the requested catalog storage/reuse grant. No permission was inferred from the source-code license.
- [Reddit's Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy) requires approval. The operator explicitly required Reddit to remain disabled until its credentials and lifecycle are complete.

## Exact environment changes

Only the following 13 assignments in `backend/.env` changed; [environment-changes.json](environment-changes.json) retains each before/after value without credentials.

| Setting suffix   | NEWS_NEWSAPI           | NEWS_GNEWS             | NEWS_CLOUDFLARECHANGELOG |
| ---------------- | ---------------------- | ---------------------- | ------------------------ |
| CONTENT_APPROVED | false → true           | false → true           | false → true             |
| DAILY_BUDGET     | 0 → 2                  | 0 → 2                  | 0 → 2                    |
| MONTHLY_BUDGET   | 0 → 60                 | 0 → 60                 | 0 → 60                   |
| MIN_INTERVAL_MS  | 1,200,000 → 43,200,000 | 1,200,000 → 43,200,000 | 1,200,000 → 43,200,000   |
| RETENTION_HOURS  | 24 → 72                | unchanged: 24          | unchanged: 840           |

NewsAPI's publication-based expiry must exceed its 24-hour Developer delay; 72 hours keeps a small usable window. No claim that providers mandate these exact retention periods is made. Budgets are below documented free-plan daily limits and deliberately constrain scheduled traffic. Other account clients still share upstream allowance.

Every other parsed environment value, all credentials and every existing comment were preserved. `.env.example` remains byte-identical, with safe disabled defaults. Reddit remains false/0/0 with missing token/user-agent; Lobsters remains false with its existing ineffective 6/150 budgets. Runtime governance reports `budget_not_configured` for both because an unapproved source has effective zero budgets; these are policy denials, not adapter faults.

## Runtime and catalog evidence

- Backend restarted with the new environment. An older `node index.js` process coincided with earlier disabled-source policies repeatedly overwriting the shared pool. That older process and the initial restarted backend were stopped, then a backend was started at 01:11:31 Pakistan time with the new settings and Cloudflare correction. Final diagnostics retain new approvals. A second `index.js` process appeared at 01:13:54 from a different PowerShell parent; its repository context was not established, so it was left untouched. PID 26112 owns the verified port-5000 listener; the other process is PID 21384. Single-worker topology is not certified; check the separate launcher's project and environment before deployment. No process-manager/infra files changed.
- One provider reservation was charged for each newly enabled source, with no counter reset or immediate retry. The separate manual refresh verification attempts returned `already_running` and then `skipped` under normal lease/pacing; actual requests came from the scheduled collector. [ingestion.json](ingestion.json) records the final skipped verification attempt, not the successful scheduled batch.
- The global discovery count stayed **2/12**; broad scheduled ingestion did not consume a discovery job. Existing working-provider budgets, shared-family quotas and indexes were preserved. Final worker heartbeat age was about 4.4 seconds.
- [catalog-before.json](catalog-before.json) records durable global version **54** before the new batch; [catalog-after.json](catalog-after.json) records **55** and fresh version-55 queries returning 48 NewsAPI records. This verifies adoption without restarting after insertion. Catalog queries in the verification script make no provider calls and only populate ordinary public query caches.
- All 48 NewsAPI records passed dates, attribution, publication-based retention and recomputed technology/search-term checks. Sixteen have recognized technology classifications; records without a taxonomy match are not assigned invented tags. There are **zero duplicate canonical groups** across the actual catalog, and the existing unique/TTL/search indexes remain present.
- GNews returned ten normalized items but no GNews-attributed catalog row. The old worker subsequently removed the newly enabled sources' pool buckets, so their batch metadata is no longer available for exact age-versus-canonical attribution analysis. The evidence does **not** establish whether the ten items were outside source retention or already owned by another canonical source. No extra upstream request was made to fill that evidence gap, and retention was not loosened speculatively.
- Cloudflare's first real transport failed at the existing 1 MiB cap. Its request/parser cap is now 8 MiB, matching the bounded approach already used by Kubernetes; it still stores at most 40 metadata items, discards bodies, rejects DTD/entities and retains seven-second timeouts/no redirects/no retries. Controlled large-feed tests pass. Actual post-fix live acceptance remains blocked by the unchanged 12-hour interval.

## Changed files and finalization

Changed:

- `backend/.env` — private 13-assignment activation above; ignored by Git.
- `TECH-NEWS-CONFIGURATION.md` — current local scope, terms, exact limits and verification instructions.
- `backend/src/services/newsDiscoveryProviders.js` — Cloudflare attribution/license and bounded RSS transport/parser envelope.
- `backend/src/scripts/auditNewsProviders.js` — optional explicit output directory to preserve historical evidence, and read-only ingestion lease/attempt metadata.
- `backend/src/tests/newsProviders.test.js` — Cloudflare metadata, large-feed acceptance and oversize rejection assertions.

Added:

- `backend/src/scripts/verifyNewsProviderActivation.js` — catalog-only integrity and cache-version verification; never calls a provider or resets quota.
- This `backend/verification/tech-news/provider-activation/` directory: `REPORT.md`, `runtime-before.json`, `first-fetch.json`, `runtime-after.json`, `environment-changes.json`, `ingestion.json`, `catalog-before.json`, `catalog-after.json`, `validation.json`.

No source files moved/deleted, no temporary build/download artifacts created, and no existing user/staged work altered. Essential request and catalog evidence is retained. The final validation results are in [validation.json](validation.json): 21 focused tests pass, four JavaScript syntax checks pass, changed-source/document formatting passes and working-tree whitespace passes. Staged whitespace validation reports existing trailing spaces in the unrelated, previously staged `backend/verification/tech-news/FINAL-END-TO-END-AUDIT.md` lines 3–5; those user changes were preserved. Frontend tests/build were not run because no frontend code changed. Production activation remains outside this authorization.
