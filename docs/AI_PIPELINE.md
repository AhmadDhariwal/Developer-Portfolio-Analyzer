# Shared AI pipeline

The production fallback order is **Gemini → OpenAI → Grok (xAI) → Anthropic**.
Only configured, compatible providers participate. Groq is optional, disabled by default,
and appended only when both `NODE_ENV=development` and `AI_ENABLE_GROQ_DEV=true`.
OpenRouter is no longer registered. Legacy priority settings and admin preference cannot
reorder the production chain.

## Configuration and routing

`backend/src/config/aiProviders.js` is the single provider/limit registry.
`services/aiProviderManager.js` selects adapters and enforces deadlines, refusal handling,
attempt budgets and health. `services/aiProviderAdmissionService.js` uses the dedicated
MongoDB `AIProviderAdmission` model for cross-worker slots, quotas and circuit state.
`services/aiservice.js` preserves the public `runAIAnalysis(prompt, fallback, retries, options)`
contract, cache layers, deterministic fallbacks and metrics.

| Provider | Credential | Model | Transport |
| --- | --- | --- | --- |
| Gemini | `GEMINI_API_KEY` | `GEMINI_MODEL` / `GEMINI_MODELS` | Existing Google SDK |
| OpenAI | `OPENAI_API_KEY` | `OPENAI_MODEL` / `OPENAI_MODELS` | Chat Completions |
| Grok (xAI) | `XAI_API_KEY` | `XAI_MODEL` / `XAI_MODELS` | xAI Chat Completions |
| Anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` / `ANTHROPIC_MODELS` | Messages API |
| Groq, development only | `GROQ_API_KEY` | `GROQ_MODEL` / `GROQ_MODELS` | Groq compatible endpoint |

Existing environment credentials/models are never rewritten by the setup utility.
Explicit environment models take precedence over admin/default models for that provider.
Encrypted admin credentials and models remain supported where no explicit environment
model is supplied. Unpersisted default admin settings cannot silently replace an environment
model. Each provider attempt uses its selected primary compatible model; configured lists
are retained but do not create an unbounded model waterfall.

xAI and Anthropic have no invented default model: choose an accessible model and supply
the matching credential. The complete variable/default/presence inventory and observed live
status are in [the finalization report](../backend/verification/ai-providers/AI-PROVIDERS-FINAL.md).

## Budgets, admission and recovery

- `AI_REQUEST_TIMEOUT_MS` is one total budget, default 30,000 ms; a caller's shorter
  `timeoutMs` wins. Cache lookup time is deducted before routing. Every provider attempt,
  retry, admission operation and release remains inside the remaining request budget.
- Provider caps default to Gemini 6,200 ms, OpenAI/xAI/Anthropic 8,000 ms and Groq 6,000 ms,
  further reduced by the total remaining time. Interview Prep's 6,200 ms provider and
  6,500 ms outer safety budgets are not multiplied by the chain length.
- Default shared global limits: 8 concurrent uncached operations, 120 per minute,
  5,000 per UTC epoch day. Per-provider defaults: 4 concurrent attempts, 60/minute,
  3,000/day. These conservative software request caps are configurable; they are not
  provider token quotas, subscription allowances or a guaranteed spend ceiling.
- Counters and token-owned expiring leases are MongoDB-authoritative. Redis failure cannot
  bypass them. Mongo admission failure stops paid work; cached/deterministic paths remain.
  Quotas reserve conservatively and do not refund partial failures.
- The total attempt cap defaults to four. With multiple providers, transient failures
  advance through the chain without same-provider retries. With one eligible provider,
  at most one jittered retry is allowed for transient infrastructure errors, within the
  same deadline and attempt cap. A module's stricter `maxAttempts` or
  `allowedProviders` remains authoritative.
- Authentication/model-configuration failures open a credential/model-scoped shared circuit
  without retrying that configuration. Replacing credentials/model changes its identity.
  429 honours the larger of configured cooldown and bounded Retry-After. Three consecutive
  failures open a transient circuit; successful recovery resets its counter.
- Lease expiry permits crash recovery; token-conditional release cannot release a successor.
  The TTL index is housekeeping, not the correctness clock. Clocks must be synchronized.
  External billing cannot be made exactly-once after a process crash without provider support.

## Responses and terminal failures

Adapters inspect provider refusal/finish metadata before extracting JSON. OpenAI/xAI refusal
or content filtering, Gemini safety/prompt blocks and Anthropic refusal are terminal.
Invalid input/content restrictions (including ambiguous 403) never trigger a different
provider. A recognized authentication/permission configuration error may skip that broken
configuration; it is not a safety override. Truncated/malformed output may advance to the
next eligible provider, but never enters the successful shared cache.

The manager returns `{ok, provider, model, parsed, latencyMs}` on success or
`{ok:false, reason}` on failure. AIService maps this to the existing JSON value, or
`{ok, value, provider, model, latencyMs, reason}` when `returnMeta` is requested.
Module-specific schemas, factual checks and persistence approval remain the caller's
responsibility; parsing JSON alone is not factual verification. Prompts and module privacy
rules have not been changed.

## Cache compatibility

The Redis/process-memory hierarchy, TTLs and deterministic summary helpers remain.
Default callers retain the prompt hash identity. Restrictive allowed-provider policies and
preferred models add their routing identity, preventing a cache result from bypassing that
restriction. New cached responses carry an internal versioned provenance envelope; callers
still receive their original JSON shape. Existing plain cached JSON remains readable.
Cancellation is checked before cache hits and before successful cache writes. Interview Prep's
`cacheResponse:false` opt-out and separate validated single-flight transport remain.

## Verification and setup

`node backend/src/scripts/configureSharedAiEnvironment.js` previews missing variable names.
Add `--apply` to append only missing settings to the local backend environment/example and
normalize the declared fixed priority. No credential values or fingerprints are printed.

`node backend/src/scripts/verifySharedAiProviders.js --live` makes one bounded synthetic
request per configured production adapter, with no fallback, private data or raw response
logging. It deliberately tests adapters independently; it does not certify distributed
admission or production load. Live status, focused tests, Mongo worker tests, cost/rate notes
and remaining gates are retained in the finalization report.

## Prompt System

Prompts are kept in `backend/src/prompts/` as template functions.

| Prompt File | Used By | Purpose |
|---|---|---|
| `githubPrompt.js` | `githubservice.js` | GitHub profile AI insights |
| `resumePrompt.js` | `resumeservice.js` | Resume scoring and feedback |
| `skillGapPrompt.js` | `skillgapcontroller.js` | Skill gap analysis |
| `recommendationPrompt.js` | `recommendationscontroller.js` | Career recommendations |
| `portfolioScorePrompt.js` | `analysisservice.js` | Portfolio scoring |
| `careerSprintPrompt.js` | `careerSprintService.js` | Sprint plan generation |
| `jobPrompt.js` | `jobService.js` | Job matching |
| `interviewPrepPrompt.js` | `interviewPrepService.js` | Interview Q&A generation |
| `resumeGuidePrompt.js` | `resumeGuideService.js` | Resume improvement guide |
| `weeklyReportPrompt.js` | `weeklyReportService.js` | Weekly report content |

AI prompt templates use `backend/src/services/promptBuilderService.js` for compact JSON, bounded text, and summarized evidence. Skill Gap, GitHub Analyzer, Resume Analysis, Recommendations, Career Sprint, Interview Prep, Portfolio Score, Weekly Reports, Resume Guide, Jobs, and Courses share the same compaction helpers.

Resume Analysis keeps every factual field deterministic. Its optional AI call can only return a subset of backend-provided focus-area codes; the backend maps accepted codes to fixed improvement text and rejects unknown values. AI output cannot supply employers, skills, certifications, schools, dates, experience, scores, recruiter facts, or resume signals. Any AI/cache/provider exception falls back to the complete deterministic result.

Skill Gap builds a compact context before calling `getSkillGapPrompt()`. It summarizes GitHub repositories, resume evidence, portfolio, sprint, weekly report, integration, and job-demand signals instead of sending raw source objects. Resume Analysis sends a bounded resume evidence summary instead of unbounded raw resume text. Prompt size is estimated before every AI request, with a target below 5000 input tokens.

Reusable prompt compaction helpers live in `backend/src/services/promptBuilderService.js`. Feature code should:
- Check feature-level caches first.
- Skip AI when deterministic confidence is sufficient.
- Build compact prompt context only when AI is required.
- Avoid raw objects, duplicate text, and repeated evidence.

Skill Gap uses `SKILL_GAP_AI_THRESHOLD` to decide whether deterministic confidence is sufficient. The default is `70`. Prompt construction remains behind the result-cache miss and AI execution gate, so cached and deterministic-skip requests do not build prompts.

## JSON Extraction And Repair

`aiservice.extractJson()`:
1. Strips markdown code fences.
2. Attempts direct `JSON.parse()`.
3. Extracts the outermost JSON object or array.
4. Repairs truncated JSON by closing unclosed braces/brackets.
5. Throws if all parsing attempts fail.

## Fallback Strategy

Every AI call requires a deterministic fallback:

```javascript
const result = await aiService.runAIAnalysis(prompt, fallback);
```

If AI is disabled, no provider is configured, providers fail, or JSON parsing fails after routing, the fallback is returned. The public method signature remains `runAIAnalysis(prompt, fallback, retries)`.

## Observability

AI logs are structured JSON strings prefixed with `[AIService]`.

Important events:
- `providers_ready`
- `provider_missing_key`
- `provider_model_mismatch`
- `settings_model_ignored`
- `prompt_size`
- `prompt_cache_hit`
- `prompt_cache_miss`
- `redis_cache_hit`
- `redis_cache_miss`
- `redis_cache_set`
- `provider_selected`
- `provider_switched`
- `retry_scheduled`
- `provider_success`
- `provider_error`
- `ai_request_complete`
- `fallback_all_providers_failed`

Provider-manager logs are structured JSON strings prefixed with `[AIProviderManager]` and include:
- `provider_selected`
- `provider_switched`
- `provider_disabled`
- `provider_success`
- `provider_error`
- `retry_scheduled`

Skill Gap request-stage logs are prefixed with `[SkillGapPipeline]` and include cache hit/miss, GitHub cache status, stale cache served, GitHub refresh queued, prompt generation size, AI skipped, AI executed, stage timings, response size, and total request duration. GitHub SWR refresh logs are prefixed with `[GitHubSWR]` and include refresh started, refresh deduped, refresh completed, refresh failed, refresh duration, and TTL-index migration status. AIService benchmark metrics include total AI request time, AI provider latency, Redis latency, prompt size, estimated tokens, cache hit/miss ratio, deterministic skip ratio, provider used, failover, and retry reasons.

## Benchmark Utility

Run the dry benchmark without making external AI calls:

```powershell
node backend\src\scripts\benchmarkAIInfrastructure.js
```

Run the live benchmark only when API keys are configured and a real provider call is acceptable:

```powershell
node backend\src\scripts\benchmarkAIInfrastructure.js --live
```

The report includes enabled/disabled providers, provider health, per-feature prompt size, average and p95 prompt tokens, AIService shared-cache metrics, deterministic skip ratio, database index additions, and live provider latency when `--live` is used.
