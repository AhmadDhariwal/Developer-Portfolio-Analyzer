# Developer end-to-end acceptance

Continuation of commit `9c066ce8` on `fix/bug-02`. PR target branch is not applicable. All verification used disposable local MongoDB (`mongod.exe` replica sets) and disposable WSL Redis (`127.0.0.1:16379`, `--save "" --appendonly no`), never production or remote infrastructure.

**Acceptance status: CONDITIONAL / PARTIAL PASS (core freshness & cross-module propagation PASS; 3 pre-existing isolated backend module failures and unmocked live-provider checks remain BLOCKED/FAIL as detailed below).**

## Fixes implemented in this continuation

1. **GitHub TTL renewal persistence on unchanged evidence (`backend/src/modules/github/githubcontroller.js`)**
   - Updated `persistGitHubAnalysis` so that when `Sync GitHub` runs against unchanged evidence (`analyzedAt`/username) with a renewed `data.cache.expiresAt`, it persists `'githubSignals.acceptedResult.cache': data.cache` and `updatedAt` in `Analysis` without duplicating history snapshots or notifications.
2. **Outdated AI recommendations `Refresh Recommended` state without automatic paid AI (`backend/src/modules/recommendations/services/recommendationService.js`, `frontend/src/app/shared/models/recommendations.model.ts`, `frontend/src/app/features/developer/pages/recommendations/recommendations.component.ts`, `recommendations.component.html`, `recommendations.component.spec.ts`)**
   - Updated `runRecommendationPipeline` to inspect `previousRecommendation?.analysisData?.aiUsed || previousRecommendation?.analysisData?.aiRefreshRecommended`, compute deterministic recommendations (`0` automatic AI calls), and attach `aiRefreshRecommended`, `aiStatus: 'Refresh Recommended'`, and matching `cacheMetadata` flags whenever prior AI-enriched recommendations are superseded by newer deterministic source evidence.
   - Surfaced `aiRefreshRecommended` and the `"Refresh Recommended"` notice and `.ai-status` badge on the Recommendations page and covered it with Angular component unit tests, multi-instance integration tests, and Playwright E2E checks.
3. **Superseded pre-v9 Skill Gap historical compatibility (`backend/src/modules/skill-gap/skillgapcontroller.js`)**
   - Updated Skill Gap legacy fallback so unversioned pre-v9 historical analyses are rejected when `resumeAnalysisId` differs from the selected resume or when newer GitHub/Resume evidence timestamps exceed `historical.updatedAt || historical.createdAt`.
4. **Deterministic selected-resume sorting (`backend/src/modules/resume/resumecontoller.js`)**
   - Aligned resume analysis queries to `.sort({ analyzedAt: -1, createdAt: -1, _id: -1 })` and `getResumeFiles` to `.sort({ uploadDate: -1, createdAt: -1, _id: -1 })`, matching `developerContextService.js` tie-breaking.
5. **Email retry worker crash recovery (`backend/src/core/messaging/emailRetryQueueService.js`)**
   - Updated `markJobInProgress` to reclaim stale `'processing'` `EmailRetryJob` records whose `updatedAt` timestamp exceeds `STALE_PROCESSING_MS` (120,000 ms) without adding schema migrations.
6. **Cross-account browser cache cleanup (`frontend/src/app/shared/services/frontend-cache-invalidation.service.ts`)**
   - Updated `clearAllUserCaches` to clear `frontend_analysis_cache:`, `frontend_analysis_cache_index:`, `frontend_analysis_cache_signal_index:`, and `frontend_analysis_current_signal:` entries in `localStorage` on logout/account switch.
7. **Restored Resume PDF test fixtures & added multi-instance E2E integration tests**
   - Generated the 8 required PDF fixtures under `backend/src/tests/fixtures/resume/` via `backend/scripts/generate-resume-fixtures.js`.
   - Added `backend/src/tests/fixtures/developerFreshnessWorker.js` and `backend/src/tests/core/developerEndToEndFreshness.integration.test.js` exercising two concurrent Express worker processes, disposable MongoDB replica set, and disposable Redis.

## Module-by-module acceptance classification

| Module | Freshness / TTL / Triggers / AI Policy Verified | Downstream Impacts | Test Coverage | Status |
| --- | --- | --- | --- | --- |
| **GitHub Analyzer** | Saved-only read (24h cached snapshot, `0` GitHub calls); explicit `Sync GitHub` acquires renewable `GitHubSaveLock`, renews unchanged-evidence TTLs in Mongo, and preserves prior accepted result as stale on provider failure. | Invalidates Dashboard, Skill Gap, Recommendations, Portfolio Score (`github` / `v9` revisions). | `github` suite: 34/34 pass; `githubFreshnessMongo`: pass; 2-worker integration + Playwright E2E pass. | **PASS** |
| **Resume Analyzer** | Selected resume uses deterministic `{ analyzedAt: -1, createdAt: -1, _id: -1 }` and `{ uploadDate: -1, createdAt: -1, _id: -1 }`; 30d hashed analysis; out-of-order list guards preserved. | Invalidates Skill Gap, Recommendations, Portfolio Score, Dashboard (`resume` revisions). | `resume` suite: 44/44 pass (after fixture restore); 2-worker integration sort check pass. | **PASS** |
| **Profile & Preferences / Portfolio Settings** | 5m `devinsight_career_profile` browser cache (owner-bound via `ownerId`); explicit updates propagate stack/level/target role to server context & clear user caches on account switch. | Propagates to Skill Gap, Recommendations, Portfolio Score, Dashboard. | `profile`: 15 pass, 0 fail, 1 skipped; `public-portfolio`: 33/33 pass; Playwright account-switch check pass. | **PASS** |
| **Skill Gap** | 900s Redis / 60s memory cache keyed by owner & v9 revision; rejects superseded pre-v9 historical docs; automatically runs deterministic recompute (`0` AI calls) after source changes. | Updates Dashboard `skillGap.refreshRecommended` / `staleSources` & Portfolio Score coverage matching. | `skill-gap`: 97/97 pass; 2-worker integration + Playwright E2E pass. | **PASS** |
| **Portfolio Score / Readiness** | 7d fingerprinted cache validates current GitHub, selected resume, career context, Skill Gap, and integration revisions before reuse. | Updates Dashboard score summary after source/Skill Gap changes. | `analysiscontroller` + `dashboardPortfolioScope` (dashboard 32/32) + 2-worker integration invalidation check pass. | **PASS** |
| **Recommendations** | 900s Redis / validated 24h browser snapshot; passive reads & post-sync deterministic refreshes execute `0` AI calls and flag superseded AI cards with `aiRefreshRecommended: true` / `"Refresh Recommended"`; failed refreshes keep stale cards labeled stale. | Updates Dashboard `recommendationSnapshot.stale` and cross-tab revalidation. | `recommendations`: 44/44 pass; FE spec + 2-worker integration + Playwright E2E pass. | **PASS** |
| **Developer Dashboard** | Read-only persisted aggregator (`ETag` + `30s` FE window + scoped `FrontendCacheInvalidationService` events); cross-tab storage events triggered 8 Tab 2 summary revalidations in Playwright (`0` AI/GitHub calls). | Terminal consumer of GitHub, Resume, Profile, Courses, Sprints, Interview, Weekly Reports, Skill Gap, Recommendations. | `dashboard`: 32/32 pass; Playwright 2-tab, F5, hard-reload & manual refresh pass. | **PASS** |
| **Learning Hub (Courses)** | 900s Redis catalog cache (with bounded memory promotion); progress mutations invalidate Dashboard/reports without clearing shared catalog cache; isolated catalog worker & recovery pass against disposable Mongo (`YOUTUBE_API_KEY=''`). | Course progress updates Dashboard learning metrics cleanly. | `courses`: 157/157 pass across 15 files cleanly under isolated env. | **PASS** |
| **Career Sprint** | 120s Redis plan cache (`CAREER_SPRINT_PLAN_RESULT_CACHE_TTL_MS`); task mutations invalidate Dashboard cleanly. | Updates Dashboard sprint progress cleanly. | `career-sprint`: 67/67 pass across 13 files. | **PASS** |
| **Weekly Reports** | 10m/15m backend caches bypassed on page entry (`latest`/`history` revalidation); upstream source mutations invalidate report views. | Updates Dashboard weekly activity summary. | `weekly-reports`: 18 pass, 0 fail, 2 skipped (2 live/env-gated skips). | **PASS** |
| **Notifications** | 15s cache / SSE stream with durable revision checks and owner isolation. | In-app delivery of sync & report alerts. | `notifications`: 33/33 pass across 3 files. | **PASS** |
| **Scenario Simulator** | In-flight deduplication and quota controls preserved; explicit simulation only. | Reads canonical profile/Skill Gap baseline. | `scenario-simulator`: 35/35 pass across 11 files. | **PASS** |
| **Jobs Hub** | Saved feed reads with bounded provider workers; no unexpected external API calls on passive reads. | Independent feed + career stack alignment. | `jobs`: 47 pass, 0 fail, 2 skipped. | **PASS** |
| **Support** | Owner-scoped reads and explicit ticket submission. | No cross-module invalidation required. | `support`: 18/18 pass across 2 files. | **PASS** |
| **Core & Email Queue** | Redis cache client (`redisCacheService`) with Lua `GET`+`PTTL` monotonic TTL preservation, outage fallback to Mongo/memory, recovery, and 120s `EmailRetryJob` stale-processing reclaim. | Shared infrastructure for all modules. | `core`: 108 pass, 0 fail, 2 skipped; `cacheFreshness`: 2/2 pass against WSL Redis `16379`; `developerEndToEndFreshness`: 1/1 pass. | **PASS** |
| **Integrations** | Mongo governance (leases, quotas, OAuth replay, 503 recovery) passes (10/10 Mongo governance subtests + 103/106 tests). However, `integrationMongoGovernance.test.js` (`Redis availability, exhaustion, timeout...`) **FAILS** because `redisCacheService.getCacheJsonWithMeta` now issues Lua `EVAL` (`GET`+`PTTL`), which `integrationRedisCacheFixture.js` rejects with `-ERR unsupported fixture command`, followed by `closeRedisCache()` hitting the 90s test timeout. | Integration revisions feed GitHub/Portfolio/Skill Gap/Dashboard. | `integrations`: 103 pass, 1 fail, 2 cancelled across 15 files. | **FAIL** |
| **Interview Prep** | 155/157 pass cleanly (leases, trust protection, private custom history). However, `interviewPrepFinalization.integration.test.js` (`explicit custom generation honors the existing 6500ms AI deadline`) **FAILS** (`19033ms` / `19050ms` vs asserted `6400..8000ms`) due to a pre-existing mismatch between `aiProviders.customQAPolicy()` (`INTERVIEW_CUSTOM_TOTAL_TIMEOUT_MS` default `20000`) and the test's `6500ms` assertion (also returns `503` on line 299 if `REDIS_URL` is unset). | Completion invalidates Dashboard/reports. | `interview-prep`: 155 pass, 2 fail across 18 files in matrix. | **FAIL** |
| **Tech News** | 76/78 pass, 1 skipped. `newsConfiguration.test.js` (`every runtime setting has a catalog entry`) **FAILS** (`2 !== 1`) because untracked local `backend/.env` contains both a commented `# # TECH NEWS CONFIGURATION — START` block (lines 189–416) and an active `# TECH NEWS CONFIGURATION — START` block (lines 571–798), whereas tracked `backend/.env.example` passes. | Standalone feed/search with bounded interval config. | `news`: 76 pass, 1 fail, 1 skipped across 23 files. | **FAIL** |

*(Additional non-Developer module run in full backend matrix: `recruiter`: 5/5 pass.)*

## Verified request counts, AI calls, and browser E2E observations

- **Multi-instance HTTP/MongoDB/Redis integration (`developerEndToEndFreshness.integration.test.js`)**:
  - Passive reads across Dashboard / GitHub / Skill Gap / Recommendations triggered **`0` GitHub calls and `0` AI calls**.
  - GitHub Sync on Worker A invalidated Worker B across shared Redis + MongoDB, flagging Dashboard `recommendationSnapshot.stale = true`, `signalMetadata.staleSources`, and `skillGap.refreshRecommended = true`.
  - Skill Gap and Recommendations deterministic recomputations after source changes executed with **`0` automatic AI calls**, preserving `aiRefreshRecommended: true` and `aiStatus: 'Refresh Recommended'`.
  - Re-syncing unchanged GitHub evidence persisted renewed `cache.expiresAt` without duplicating history; failed-provider syncs preserved the last accepted snapshot as stale (`isStale: true`); cross-user reads remained isolated; Redis shutdown failed over cleanly to MongoDB/memory and recovered when reconnected; Resume `uploadDate`/`createdAt` sort ordering and `markJobInProgress` `120s` stale lease reclaim both passed.
- **Playwright real browser verification (`playwright-e2e-freshness.cjs` against built Angular SPA + Worker + disposable MongoDB + disposable Redis `16379`)**:
  - Verified initial load, multi-route navigation, two simultaneous browser tabs (`tab2RevalidationCount: 8` Dashboard summary revalidations after Tab 1 GitHub Sync), explicit Recommendations AI refresh (`aiUsed: true`), subsequent GitHub Sync v2 -> Recommendations F5 reload showing `"Refresh Recommended"` with **`aiCalls: 0` and `githubCalls: 0`**, Dashboard hard reload (`location.reload()`), and account switching (`pwdev` -> `pwdev2`), with `pageErrors: []` across `51` API calls.
- **Real external providers (live GitHub API, live paid LLM endpoints, live remote YouTube/news/OAuth APIs)**:
  - Not called automatically; deterministic local HTTP/AI fixtures were used per prompt safety rules. Live external rate-limit/provider behavior against real remote APIs remains **NOT TESTED** in this run.

## Final test & validation summary

| Suite / Check | Result | Notes |
| --- | --- | --- |
| Frontend Vitest (`cd frontend; npm test -- --watch=false`) | **120 files / 713 tests passed** | Added unit test for `aiRefreshRecommended` notice/status badge. |
| TypeScript (`./node_modules/.bin/tsc --noEmit -p tsconfig.app.json` & `tsconfig.spec.json`) | **Passed (0 errors)** | Checked after final FE edits. |
| Angular production build (`cd frontend; npm run build`) | **Passed** | 3 pre-existing bundle/component SCSS size-budget warnings only. |
| Prettier (`--write` & `--check` on changed FE files) | **Passed** | Checked via `frontend/node_modules/prettier/bin/prettier.cjs`. |
| Backend syntax (`node --check` on all 9 modified/new `.js` files) | **Passed** | Zero syntax errors. |
| Focused Redis & 2-worker E2E (`cacheFreshness.test.js`, `developerEndToEndFreshness.integration.test.js`) | **3 / 3 passed** | Disposable Mongo replica set + disposable WSL Redis `16379`. |
| Full Isolated Backend Matrix (`19` module test dirs, disposable Mongo + WSL Redis `16379`) | **1135 tests: 1121 pass, 4 fail (+2 cancelled), 8 skipped** | All failures isolated to pre-existing `integrations` Lua fixture mismatch, `interview-prep` 6500ms vs 20000ms policy constant, and local untracked `backend/.env` comment block in `news`. |
| Git whitespace (`git diff --check`, `git diff --cached --check`) | **Passed (0 errors)** | Only standard LF/CRLF working-copy warnings. |

## Remaining blockers / open items

1. Align `integrationRedisCacheFixture.js` / `integrationMongoGovernance.test.js` with `redisCacheService.getCacheJsonWithMeta`'s Lua `EVAL` (`GET`+`PTTL`) contract and ensure `closeRedisCache()` bounds `quit()` timeout when a Redis socket is forcibly dropped mid-command.
2. Reconcile `interviewPrepFinalization.integration.test.js`'s `6500ms` custom-QA deadline expectation with `aiProviders.customQAPolicy()` (`INTERVIEW_CUSTOM_TOTAL_TIMEOUT_MS` default `20000`).
3. Clean up the duplicate commented `# # TECH NEWS CONFIGURATION` block in local untracked `backend/.env` if running `newsConfiguration.test.js` locally.
4. Live external provider credentials/quotas (GitHub OAuth/API, paid LLMs, Upstash Redis cloud TLS) remain intentionally unexecuted against production keys.

For dependency and matrix details see [Developer dependency map](DEVELOPER-CROSS-MODULE-DEPENDENCY-MAP.md), [Refresh behavior](DEVELOPER-REFRESH-BEHAVIOR-MATRIX.md), [Module refresh test matrix](DEVELOPER-MODULE-REFRESH-TEST-MATRIX.md), and [Cache invalidation verification](DEVELOPER-CACHE-INVALIDATION-VERIFICATION.md).
