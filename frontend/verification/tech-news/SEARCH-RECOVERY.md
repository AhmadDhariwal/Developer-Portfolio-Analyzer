# Tech News Explore search recovery

Date: 22 October 2026

STATUS: VERIFIED

## Confirmed cause and runtime recovery

The local backend listening on port 5000 started at 17:58, before the Redis command-deadline fix was saved at 18:09. That process retained the old 150 ms deadline. A read-only authenticated TLS probe measured a 156 ms PING round trip. Redis held one overdue DevOps queue job, an active worker lease, no discovery provider reservations and no topic results. Both single-key and multi-key read-only Lua executed successfully. These observations are consistent with the old process timing out uncertain admission/lease operations even though Redis accepted them; no new Redis interface defect was found.

Reloaded only the verified local backend process using its existing backend/index.js entry point and existing configuration. The replacement process successfully bound port 5000. No source activation, environment, credentials, budgets or backend source files changed. Existing scheduler/worker behavior resumed normally; diagnostic commands did not enqueue jobs or call providers.

After reload, read-only inspection confirmed an empty discovery queue and DevOps enrichment `ready / articles_cached`, with **30 actual cached articles**, all matching DevOps and both the default week and month date windows. The normal worker's source-health metadata recorded Kubernetes Blog unavailable and Dev.to success with thirty articles: the approved fallback path worked. This is observed normal application ingestion through the existing budgets, not a synthetic dataset or a remote Redis concurrency/write test. No test keys were written to application Redis and no direct paid-provider call was made.

## Frontend correction

The page previously polled queued/searching jobs only. If its first request encountered a temporary queue admission outage, an open page could stay empty even after the backend recovered.

- Brief `unavailable` admission reasons `quota_store_unavailable` and `queue_full` now participate in the same bounded four-check lifecycle. Revalidation waits at least twenty seconds and respects `nextEligibleAt`; a delay beyond two minutes is not automatically scheduled. Existing page-one, visibility, offline, cancellation, account and Retry-After guards remain in effect.
- Provider quota cooldowns, source failures and persistence failures do not start automatic retry loops. No automatic request uses `refresh=true` or calls external providers.
- Pending/unavailable discovery exposes a **Check cached results** action through the ordinary existing feed GET path. It respects offline/loading/Retry-After state and revalidates local response reuse. Backend admission remains authoritative.
- Empty unavailable results now say there are no cached matches yet, instead of implying that cached articles are being displayed. Loaded matches remain visible during subsequent requests and failures.

This extends the queued/searching-only revalidation description in EXPLORE-DISCOVERY.md. Other contracts, views, saved reading history and ranking remain unchanged.

## Focused verification and finalization

- `npm test -- --watch=false --include=src/app/pages/news/news.component.spec.ts`: **25 passed, zero failed**. Two added tests verify the sixty-second eligibility boundary, adoption of recovered results, no refresh flag, the four-check cap, and no automatic retries for source failures, provider cooldowns or persistence failures. The same affected suite retains account, pagination, filters and saved-contract coverage. Used the known working execution permissions to avoid Windows Vitest sandbox cache errors.
- Application TypeScript (`tsc --noEmit -p frontend/tsconfig.app.json`) passed.
- Explicit-path Prettier write/check and working-tree/staged Git whitespace checks passed. The first formatter attempt hit a transient file-open error while the development server watched the files; the identical retry succeeded.
- No backend test suite, repeated browser matrix or additional production build was necessary. Angular's focused test build compiled the changed component/template. Existing 39-test service/page verification and production/theme evidence remain retained from the preceding task.
- No task-generated temporary files, screenshots or logs were created; none were deleted or moved. All preceding frontend work and staged backend changes were preserved.

## Exact files changed in this follow-up

1. `frontend/src/app/pages/news/news.component.ts` — bounded recovery admission checks and accurate empty-unavailable copy.
2. `frontend/src/app/pages/news/news.component.html` — ordinary cached-results check action.
3. `frontend/src/app/pages/news/news.component.spec.ts` — recovery eligibility, cap and no provider-retry regression checks.
4. `frontend/verification/tech-news/SEARCH-RECOVERY.md` — this report.

Source coverage remains bounded by available articles, supported topics, filters, worker scheduling and quotas. Unsupported queries still search cache only; recovery does not guarantee results for every technology. Kubernetes Blog remained unavailable on the observed attempt, with usable Dev.to fallback. A browser reload picks up the current frontend and discards the old displayed failure. Future backend source/configuration changes require reloading a backend started with plain `node index.js`.

READY FOR TECH NEWS FINAL E2E: YES
