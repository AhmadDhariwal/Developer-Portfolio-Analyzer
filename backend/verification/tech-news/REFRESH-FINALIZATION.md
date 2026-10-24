# Tech News configuration, governance and refresh finalization

STATUS: VERIFIED (implementation and isolated acceptance)

TECH NEWS CONFIGURATION COMPLETE: YES

TECH NEWS SEARCH & REFRESH VERIFIED: YES

READY FOR PRODUCTION DEPLOYMENT: NO — hosted write-path acceptance and deployment remain external gates.

## Delivered behavior

- Consolidated the local environment and example into one ordered, commented 81-key Tech News block. The organizer verified that all 156 pre-existing local values and all 158 pre-existing example values were preserved. Six missing local defaults were added; no credentials were exposed or replaced. Shared infrastructure stays global. Every setting explains purpose, units/default, effect and restart behavior. Unknown arXiv flags are not offered as active controls.
- Read-only provider eligibility and atomic reservation share the same Lua decision logic and original counter keys. Denials report the governing reason and exact eligible timestamp. The longest applicable provider blocker wins; query admission uses the earliest eligible provider. Day/month resets use UTC boundaries. Shared upstream constraints, source approval, circuit/cooldown and reserved HN/DEV search headroom remain enforced. No budget was raised to make tests pass.
- Ordinary fresh-cache reads make no provider requests. Insufficient or expired eligible queries can enqueue bounded background work. Manual `refresh=true` can revalidate a fresh positive/negative query after the minimum interval, while active jobs are reused across accounts. A successful manual check with no new URLs returns `no_newer`, a real successful-check timestamp and its next eligibility. Older states containing `lastAttemptAt` remain compatible.
- The button reads **Check for New Articles**. The UI distinguishes checking cache, source eligibility, queued/searching, saving, ready/no newer, quota/cooldown and unavailable infrastructure. It disables repeated checks while active or ineligible, preserves visible results during work and stops automatic polling after four checks. The same filters, six views, ranking, saved ownership and server pagination remain in place.
- Query freshness is independent from unrelated general-pool freshness. Validated MongoDB persistence precedes atomic Redis state/topic/version publication, guarded by the worker lease and attempt ordering. Other workers compare shared versions before serving local memory. Empty-result TTL, source retention, publication dates, bounded caches and account-private ranking remain separate. Reads/clicks do not extend source retention or successful-check timestamps.
- Added strict refresh/prewarm/retention validation, sanitized read-only runtime diagnostics, safe index inspection and an explicit create-only migration path. The application database already had all required news topic indexes; no production index writes were needed.

## EC2 diagnosis and limits

The original historical EC2 JSON/Redis state was not supplied, so its exact historical denial cannot be proven. The code previously reduced provider details to a generic quota status and generic `provider_admission` reason. Refresh also required the normal freshness window to expire, so it could not request a new check of a fresh query.

The controlled reproduction searched `generative ai` through both governed adapters, then immediately requested `EC2`. Both adapters were inside their 60-second interval, producing `waiting` with source-specific interval reasons and next eligible timestamps. EC2 admitted **zero new jobs** and consumed **zero additional provider calls**. The response no longer presents this as a successful empty query or leaves the page spinning. Other possible blockers are listed in the operator guide and remain distinguishable.

The read-only application inspection at 2026-10-23 11:12 UTC found HN search usage 3/day and 3/month, DEV search 3/day and 4/month, both admitted at that moment and no stored EC2 Redis query snapshot/state. It is a point-in-time observation, not a reconstruction of the historical response. A later live preflight correctly blocked during a shared ingestion interval; after that interval elapsed, the two bounded live attempts succeeded. No application counters, intervals or cooldowns were reset.

## Verification retained

| Check                                                            | Result                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused backend unit/contract/ranking/pagination/config suites   | 38 passed; no skips.                                                                                                                                                                                                                                 |
| Final isolated Redis/Mongo regression and new refresh suites     | 6 passed; exact owned Redis keys removed and unique Mongo databases dropped.                                                                                                                                                                         |
| Actual authenticated HTTP API + Angular Chromium                 | 1 passed, desktop Light and mobile System Dark; manual refresh, no-newer acknowledgment, retained cards, eligibility disable, dates, server pagination and saved ownership. Controlled provider fixtures; not a deployed production browser session. |
| Governed live metadata verification                              | 1 passed; exactly two provider attempts: HN stored/read one matching article, DEV stored/read a successful empty result. Application Redis read-only; writes restricted to disposable Redis/Mongo.                                                   |
| Affected Angular component/service suites                        | 45 passed.                                                                                                                                                                                                                                           |
| Application TypeScript                                           | `--noEmit -p frontend/tsconfig.app.json` passed.                                                                                                                                                                                                     |
| Production Angular build                                         | Passed once; existing unrelated landing-page SCSS exceeded its 48 kB warning budget by 7.89 kB.                                                                                                                                                      |
| Configured formatting, changed JavaScript syntax, Git whitespace | Final write/check and syntax/whitespace checks passed; exact files in the manifest.                                                                                                                                                                  |
| Read-only application index inspection                           | Unique cache key, absolute TTL and compound topic/expiry indexes all present.                                                                                                                                                                        |

Commands used the installed repository dependencies. No repository-wide test suite or formatter was run. Existing staged work and earlier screenshots/reports were retained. Source files were formatted in write mode, then checked with the same options. Temporary databases/processes/downloads were removed only after checking their task ownership; final results are retained without logs containing secrets.

Evidence:

- `refresh-configuration-inventory.json`: all 81 keys, safe effective values/defaults and credential-presence booleans.
- `refresh-runtime-readonly.json`, `refresh-index-readonly.json`: sanitized application read-only observations.
- `refresh-live-results.json`: real provider outcomes, source diagnostics, persistence and query check/version metadata.
- `refresh-finalization.json`: exact modified/added/deleted files, commands, counts and cleanup ownership.
- `refresh-cleanup.json`: exact 44 owned runtime file paths removed and the two stopped database processes.
- `frontend/verification/tech-news/refresh-service-e2e.png` and `refresh-service-e2e-mobile-dark.png`: retained browser evidence. Earlier `search-service-e2e*` evidence remains untouched.

## Operator handoff and remaining gates

Follow [PRODUCTION-SETUP.md](PRODUCTION-SETUP.md) for the step-by-step upgrade/setup procedure, each configuration group's values and credentials, provider locations, exact quota/reset semantics, diagnostics and recovery. The example is `backend/.env.example`; preserve the existing `backend/.env` on upgrades.

Production readiness is **not asserted** by local tests: verify Lua reservation, queue writes, lease fencing, atomic publication and cross-process invalidation against an explicitly disposable hosted Redis staging database, then deploy/restart through the existing hosting workflow and perform live provider → worker → MongoDB → Redis → signed-in Angular acceptance there. Application Upstash was deliberately inspected read-only, so its production write path and a deployed refresh were not exercised. The required MongoDB indexes are already present. Restricted providers and Cloudflare remain unapproved/disabled; arXiv remains unimplemented. No infrastructure credentials, external deployment target or approval were invented.

There are no source file moves or source deletions in this task. The exact inventory and removal of the owned disposable runtime are recorded in `refresh-finalization.json`. No unrelated or untracked user work was removed.
