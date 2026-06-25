# GitHub Analyzer

Implementation-driven guide for GitHub analysis.

## Current Behavior
Analyzes public GitHub profiles, computes deterministic scores, optionally calls AI for narrative insights, and persists analysis only through the authenticated save path.

## Files To Modify
| Change | Files |
|---|---|
| Analyzer UI | `frontend/src/app/pages/github-analyzer/*` |
| Frontend request/cache | `frontend/src/app/shared/services/github.service.ts` |
| Backend controller | `backend/src/controllers/githubcontroller.js`, `backend/src/routes/github.routes.js` |
| Core analysis | `backend/src/services/githubservice.js` |
| Prompt | `backend/src/prompts/githubPrompt.js` |
| Persistence | `backend/src/models/analysis.js`, `backend/src/models/repository.js`, `backend/src/models/githubAnalysisCache.js` |

## Dependencies
- GitHub REST API and optional `GITHUB_TOKEN`.
- `notificationService` for saved analysis events.
- Dashboard cache invalidation after saved analysis.
- Profile active username for defaults.

## Request Flow
Preview: `GithubAnalyzerComponent` -> `GithubService.analyzeProfile()` -> `POST /api/github/analyze` -> `githubservice.analyzeGitHubProfile()`.

Save: `GithubService.analyzeAndSave()` -> `POST /api/github/analyze-save` -> persist Analysis/Repository/User active username -> invalidate Dashboard summary.

## Change Impact
- Scoring changes affect Dashboard, Skill Gap, Recommendations, Scenario Simulator, Weekly Reports, and recruiter views.
- Cache key/version changes affect repeat analysis cost and GitHub rate limits.

## Testing Files
- `node --check backend/src/controllers/githubcontroller.js`
- `node --check backend/src/services/githubservice.js`
- `npx -y ng build --configuration development`

## Common Pitfalls
- Do not overwrite saved profile from temporary preview analysis.
- Respect `forceRefresh` cache bypass.
- Be careful with GitHub rate limits and per-repo language/commit calls.
