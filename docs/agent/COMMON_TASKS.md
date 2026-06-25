# Common Tasks

## Implement Frontend Caching
1. Read the feature doc.
2. Inspect the feature component and shared service.
3. Add cache-first read before HTTP.
4. Add inflight dedupe with `shareReplay` or an existing service helper.
5. Make manual refresh pass `forceRefresh` or `refresh=true`.
6. Verify cache hit path returns without an HTTP call by code inspection or a browser network run.

## Add A Backend Endpoint
1. Add route in `backend/src/routes/`.
2. Add controller method in the feature controller.
3. Add service/model changes only if the feature doc lists them as normal dependencies.
4. Update [../API_REFERENCE.md](../API_REFERENCE.md) and the feature doc.

## Change Profile Personalization
1. Start with [../features/profile.md](../features/profile.md).
2. Keep `activeGithubUsername`, `activeCareerStack`, `activeExperienceLevel`, `careerGoal`, `targetTimeline`, and `learningPreference` synchronized.
3. Update profile hash/signature handling.
4. Invalidate only dependent personalized modules.

## Add AI Generation
1. Read [../AI_PIPELINE.md](../AI_PIPELINE.md).
2. Add or update prompt/service code.
3. Keep deterministic fallback.
4. Ensure read endpoints do not generate silently.

## Change UI
1. Read the feature doc and [../UI_DESIGN_SYSTEM.md](../UI_DESIGN_SYSTEM.md).
2. Preserve existing component structure unless the task asks for redesign.
3. Avoid broad layout changes outside the target feature.

## Update Documentation
1. Update the relevant `docs/features/*.md` file.
2. Update [../PROJECT_INDEX.md](../PROJECT_INDEX.md) when adding or moving docs.
3. Keep docs concise and implementation-driven.
