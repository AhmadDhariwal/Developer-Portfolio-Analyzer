# Skill Gap

Implementation-driven guide for skill-gap analysis.

## Current Behavior
Skill Gap compares GitHub, resume, profile, sprint, recommendations, and demand signals against the active career profile. Results are cached by signal hash and career profile.

Displayed skill names are normalized through the shared industry skill catalog before they reach the response. Aliases such as `reactjs`, `node js`, and `Dockerfile` are canonicalized, while malformed tokens or non-skill text are filtered out. Current, missing, weak, and high-demand skills should include source and evidence text so the UI can explain why the skill is present, why it matters, and how it was detected.

The current analysis version is `v6-skill-intelligence`. It uses the existing cache-key strategy but intentionally avoids reusing older `v5` cached payloads so stale malformed skill names do not bypass the stricter validation. Missing-skill objects may include additive metadata such as `businessImpact`, `learningEffort`, `recommendedResources`, `suggestedProject`, `whyExists`, and `whyItMatters`; existing consumers should continue using the original fields.

Skill Gap now builds AI prompts only after backend cache lookup and deterministic confidence checks. A normal request first builds the cheap identity pieces (resume identity, active profile, and stable cache signal hash), checks the shared Skill Gap result cache, then checks `AnalysisCache`. GitHub cache reads, developer signal aggregation, skill detection, prompt generation, and AI execution happen only after those cache layers miss or a manual refresh is requested. When AI is required, the prompt uses a compact context with summarized GitHub repositories, resume evidence, platform signals, job demand, and deterministic skill groups rather than raw source objects.

GitHub analysis uses Stale-While-Revalidate in the Skill Gap path. If a GitHub analysis cache row exists, Skill Gap serves it immediately even when expired and queues a background refresh. If no row exists, Skill Gap returns a safe empty GitHub signal and queues a refresh instead of blocking the response on GitHub API calls. Only one background refresh can run per normalized GitHub username in a backend process; duplicate refresh attempts are logged and skipped.

The controller logs stage timings for shared result cache lookup, Mongo cache lookup, GitHub fetch, resume fetch, signal aggregation, skill detection, deterministic summary cache lookup/write, prompt generation, AI response, cache write, response serialization, derived DB time, AI pipeline time, and total request duration.

Latency controls:
- `SKILL_GAP_AI_RETRIES` defaults to `0` so transient provider issues do not multiply endpoint latency.
- `SKILL_GAP_AI_THRESHOLD` configures the deterministic-confidence threshold for skipping AI. The default remains `70`.
- `skill_gap:result:<hash>` stores full result payloads in Redis when available, with process-memory fallback through `AIService`.
- Deterministic summaries are stored via `AIService.getDeterministicSummary('skill_gap', identity)` and reused before rebuilding deterministic groups.
- The Skill Gap result-cache key intentionally excludes previous Skill Gap output to prevent self-referential cache churn. It is based on the user/profile identity, active career profile, resume identity, GitHub username, and analysis version.

## Files To Modify
| Change | Files |
|---|---|
| UI/cache | `frontend/src/app/pages/skill-gap/*` |
| Frontend service | `frontend/src/app/shared/services/skill-gap.service.ts` |
| Backend analysis | `backend/src/controllers/skillgapcontroller.js`, `backend/src/routes/skillgap.routes.js` |
| Skill graph | `backend/src/services/skillGraphService.js`, `backend/src/models/skillGraph.js` |
| Shared cache | `frontend/src/app/shared/services/frontend-analysis-cache.service.ts` |

## Dependencies
- Active profile fields from `CareerProfileService`.
- `Analysis`, `ResumeAnalysis`, `AnalysisCache`, `WeeklyReport`, `CareerSprint`, `Recommendation`.
- GitHub fallback analysis can run inside backend skill-gap analysis.

## Request Flow
`/app/skill-gap` -> active username/profile -> frontend cache check -> `POST /api/skillgap/skill-gap` -> `skillgapcontroller.analyzeSkillGap()` -> signal aggregation -> result + cache metadata.

## Change Impact
- Signal key changes affect Recommendations, Dashboard, Weekly Reports, and Scenario context.
- Profile changes should refresh mounted Skill Gap once and avoid recursive requests.

## Testing Files
- `node --check backend/src/controllers/skillgapcontroller.js`
- `npx -y ng build --configuration development`

## Common Pitfalls
- Route is `POST /api/skillgap/skill-gap`, not `/api/skillgap/analyze`.
- Keep frontend cache validation tied to current `signalHash`.
- Avoid duplicate init calls; service inflight dedupe should collapse identical requests.
