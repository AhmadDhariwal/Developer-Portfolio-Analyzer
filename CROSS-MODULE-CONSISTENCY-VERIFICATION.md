# Cross-module consistency verification — 2026-11-17

Overall acceptance: INCOMPLETE. A test passing with provider stubs does not verify remote GitHub or AI behavior.

## Implemented propagation

- GitHub accepts an owned saved payload in the existing Mixed githubSignals field, preserves it after failed syncs, rejects older accepted timestamps, and avoids duplicate owned saves for the same revision. Identical observed evidence reuses the source assessment and skips narrative enrichment/history append.
- GitHub writes invalidate current v9 Skill Gap caches and the exact owner result prefix. Current source hashes continue to separate other dependent cache identities.
- Redis-to-memory promotion retains the source remaining TTL for Sprint (120 seconds), Courses/Skill Gap/Recommendations (900 seconds), and other callers.
- Course progress writes and interview completion clear Dashboard/Weekly Reports browser caches after success.
- Scoped browser revision events clear dependent caches in another tab. Dashboard coalesces those events into saved-data reads; there is no new polling interval.
- Weekly Report navigation reads persisted latest/history. It does not call generate or refresh-report endpoints.
- Portfolio score cache reuse now compares its GitHub/resume/career input fingerprint and integration revision.

## Verified with real isolated MongoDB and HTTP

`backend/src/tests/github/githubFreshnessMongo.integration.test.js` starts the existing disposable replica-set fixture, uses real Express routes, JWT authentication, Mongo persistence and notification transactions. GitHub responses are deterministic provider stubs; Redis is not part of this test.

The focused run passed: no-data saved read, initial accepted save, repeated saved reads with no provider calls, other-owner isolation, cached save deduplication, failed provider request preserving saved data, and a changed accepted revision becoming readable. It also exposed and fixed first-insert transaction retries retaining an incorrect isNew state.

## Outstanding acceptance gates

- A real new remote commit through the authorized GitHub provider, followed by every dependent module and Dashboard.
- Real Redis TTL/lease behavior during restart/outage and two real backend instances. Some existing Windows harnesses emulate RESP; their output must not be described as proof against a real Redis engine.
- Browser F5, hard reload, two-tab/account/organization switches and screenshots with Playwright.
- Full 20-scenario acceptance for each module and all twelve worker loops, including leases exceeding their initial TTL.
- Historical legacy GitHub records whose exact matching shared payload has already been replaced need explicit migration/fallback acceptance; the saved reader reports unavailable rather than substituting another revision.
- All derived consumer paths still need an end-to-end audit against the owned accepted revision; global preview cache data must never be assumed equivalent solely by username.

See the finalization report for the actual regression results and infrastructure limitations.
