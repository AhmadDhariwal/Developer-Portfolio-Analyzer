# Custom Q&A provider failover correction

Implemented on `fix/bug-01`; integration target not applicable. The four staged frontend component changes were preserved. No public bank/Seed Catalog changes, dependency/schema changes, commit, push or deployment.

**Confirmed source causes**

Ordinary Custom Q&A still used a 6,200 ms coordinator/provider budget and 6,500 ms service deadline, while the prior system-design exception used up to 30 seconds. Both inherited global Gemini-first ordering. `aiProviders.priority()` returns `PRODUCTION_ORDER`, ignoring `AI_PROVIDER_PRIORITY`; Custom Q&A had no independent policy. The shared analyzer capped attempts at three. OpenAI is disabled by process health cooldown or skipped by shared credential/model circuit state. Anthropic insufficient-credit HTTP 400 reached `invalid_request`, aborting the chain. Final errors collapsed these conditions into generic availability feedback.

**Corrected flow**

Verified Mongo lookup → verified catalog → owned private history/cache → existing shared manager with the Custom Q&A policy → independently validated structured answer → unique owned `kind: custom` snapshot. Lookup order, ownership and immutable snapshots remain intact. No independent orchestrator or public-bank insertion was introduced.

The central operation policy defaults to Groq → Gemini → OpenAI → Anthropic → xAI. `INTERVIEW_CUSTOM_PROVIDER_PRIORITY` can reorder supported providers without changing unrelated operations. Missing/incompatible credentials, absent models, local cooldowns and shared open circuits are skipped. Billing failures open the existing configuration circuit; HTTP 429 retains Retry-After/cooldown behavior without sleeping away this request's deadline.

| Setting                                | Default   | Bound                                               |
| -------------------------------------- | --------- | --------------------------------------------------- |
| `INTERVIEW_CUSTOM_TOTAL_TIMEOUT_MS`    | 20,000 ms | Existing global AI limit and 20,000 ms              |
| Persistence reserve                    | 2,000 ms  | Subtracted from provider execution budget           |
| `INTERVIEW_CUSTOM_PROVIDER_TIMEOUT_MS` | 5,000 ms  | 6,000 ms and remaining absolute deadline            |
| `INTERVIEW_CUSTOM_MAX_ATTEMPTS`        | 4         | At most four actual calls; no same-provider retries |

An absolute request deadline begins before lookups, propagates to the shared manager, and is checked before each call and persistence. Skipped circuits/configurations/admission failures do not consume actual-call slots. Driver `timeoutMS` caps the remaining private insertion operation; `insertMany` retains this model's schema validation and timestamps (the schema has no save hooks). Existing unique-key recovery remains. The frontend's existing 40-second timeout accommodates this budget. The local proxy has no lower timeout override; external hosting/proxy timeout limits were not independently verified.

Provider timeouts, network/5xx, rate limiting, billing, authentication/configuration and invalid output fail over. Safety refusals and genuine malformed provider requests remain terminal. Explicit no-answer preserves HTTP 422 behavior. Internal classifications are `ai_provider_timeout`, `ai_provider_rate_limited`, `ai_provider_billing_error`, `ai_provider_configuration_error`, `ai_provider_unavailable`, `ai_invalid_response`, and `no_answer`. Existing public error codes/statuses are preserved where possible; safe user messages now distinguish timeout/rate limiting/configuration without exposing provider internals. Semantic relevance validation now participates in provider fallback rather than failing only after selection.

Structured logs include a shared request ID, operation, provider/model, actual attempt number, attempt timeout, remaining deadline, latency, status, classification, circuit skip state and final chain outcome. No prompts, credentials or authorization headers are logged.

**Live and regression evidence**

One controlled real generation returned HTTP 200 in 3,737 ms using Groq `openai/gpt-oss-120b`. It persisted in an owned private session; repeat requests reused the same session. No additional provider generation was forced. Final absolute-deadline/persistence/logging hardening was subsequently covered by deterministic tests. Actual runtime policy and HTTP request/response are retained below.

- [live.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-failover/live.json)
- [provider-events.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-failover/provider-events.json)
- [port5000-reuse.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-failover/port5000-reuse.json)
- [all-final-tests.txt](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-failover/all-final-tests.txt)
- [post-cleanup-tests.txt](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-failover/post-cleanup-tests.txt)
- [frontend-tests.txt](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-failover/frontend-tests.txt)
- [build.txt](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-failover/build.txt)

The broader relevant backend run passed 137 tests, with three isolated-Mongo integration suites skipped because `INTERVIEW_TEST_MONGO_URI` was not supplied. Focused policy/adaptor regressions and post-cleanup checks passed. The full frontend run passed 703 tests in 118 files. TypeScript no-emit and production build passed. Existing build warnings remain: initial bundle exceeds 4 MB by 17.68 kB; Public Portfolio and Jobs SCSS exceed their 48 kB warning budgets. The initial frontend attempt was denied a loopback test socket by the sandbox; its permitted rerun passed.

Tests cover Groq-first success, both Groq/Gemini fallback directions, timeouts, HTTP 429/500, billing HTTP 400, missing keys, circuit skips without attempt consumption, deadline exhaustion, configured ordering, shared admission, malformed/relevance validation, private persistence, failure non-persistence, ownership and verified lookup precedence. Existing assertions tied to superseded timeouts/attempt budgets were updated.

**Exact changed source files**

- [backend/src/config/aiProviders.js](D:/Developer-Portfolio-Analyzer/backend/src/config/aiProviders.js)
- [backend/src/services/aiProviderManager.js](D:/Developer-Portfolio-Analyzer/backend/src/services/aiProviderManager.js)
- [backend/src/services/interviewPrepService.js](D:/Developer-Portfolio-Analyzer/backend/src/services/interviewPrepService.js)
- [backend/src/services/interviewSessionService.js](D:/Developer-Portfolio-Analyzer/backend/src/services/interviewSessionService.js)
- [backend/src/services/providers/interviewAIProvider.js](D:/Developer-Portfolio-Analyzer/backend/src/services/providers/interviewAIProvider.js)
- [backend/src/tests/aiProviderPlatform.test.js](D:/Developer-Portfolio-Analyzer/backend/src/tests/aiProviderPlatform.test.js)
- [backend/src/tests/interviewCompleteAI.test.js](D:/Developer-Portfolio-Analyzer/backend/src/tests/interviewCompleteAI.test.js)
- [backend/src/tests/interviewCustomSystemDesign.test.js](D:/Developer-Portfolio-Analyzer/backend/src/tests/interviewCustomSystemDesign.test.js)
- [backend/src/tests/interviewPrepPerformance.test.js](D:/Developer-Portfolio-Analyzer/backend/src/tests/interviewPrepPerformance.test.js)
- [backend/src/tests/interviewCustomFailover.test.js](D:/Developer-Portfolio-Analyzer/backend/src/tests/interviewCustomFailover.test.js)

Formatting write/check and JavaScript syntax checks cover these explicit paths. Working-tree and staged Git whitespace checks pass. No source files were moved or deleted. Exact temporary log cleanup is recorded in [cleanup.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-failover/cleanup.json). Active local backend operational logs remain at the path in [port5000-runtime.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-failover/port5000-runtime.json). All source hashes, staged-work preservation and final checks are recorded in [finalization.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-failover/finalization.json).

Provider availability is external and cannot be guaranteed; exhausted eligible providers still produce one accurate final failure. Live verification succeeded, but the three skipped isolated-Mongo suites are not claimed as passing.
