# Change Impact

Use this checklist before changing shared code.

## High Impact Areas
| Area | Affected Modules |
|---|---|
| `User` profile fields | Profile, Dashboard, GitHub Analyzer, Skill Gap, Recommendations, News, Scenario Simulator, Weekly Reports, Career Sprint |
| `Analysis` / GitHub analysis | Dashboard, GitHub Analyzer, Skill Gap, Recommendations, Scenario Simulator, Weekly Reports |
| `ResumeAnalysis` / resume files | Resume Analyzer, Dashboard, Skill Gap, Recommendations, Weekly Reports, Scenario Simulator |
| `profileHash` / `signalHash` | Cache invalidation and personalization across most read pages |
| `ApiService` methods | Multiple frontend pages that share endpoints |
| `AuthService` current user shape | Guards, Profile, active username/profile defaults |
| AI provider and prompt services | GitHub, Resume, Skill Gap, Recommendations, Weekly Reports, Career Sprint, Interview Prep |

## Cache Invalidation Boundaries
- Profile changes may invalidate Dashboard, Skill Gap, Recommendations, News, Weekly Reports, and Scenario Simulator context.
- Profile changes must not delete GitHub analysis, resume analysis, saved reports, saved scenarios, or Career Sprint history.
- Mutations that create/update sprint tasks should refresh sprint and scenario context, not unrelated saved reports.

## Before Editing
- Identify whether the endpoint is read or generation.
- Identify the cache key inputs.
- Identify whether the change affects active fields or legacy fields.
- Identify whether existing saved data needs migration.

## After Editing
- Run syntax/compile checks.
- Verify that cache hit, cache miss, and manual refresh paths still make sense.
- Update the relevant feature doc if request flow, dependencies, files, or testing changed.
