# Agent Rules

Use these rules for every code task in this repository.

## Scope
- Start at [../PROJECT_INDEX.md](../PROJECT_INDEX.md).
- Read the relevant feature doc before editing.
- Keep route names, API contracts, database schemas, and saved user data stable unless the task explicitly requires a contract change.
- Prefer surgical edits in the files listed by the feature doc.

## Verification
- Run the smallest useful check: `node --check` for backend files, targeted Angular build for frontend changes, and existing focused specs when listed.
- Do not claim browser/network behavior unless it was actually run.
- If a cache or AI behavior is verified by static inspection only, say so.

## Cache And Signal Rules
- Respect `profileHash` and `signalHash` boundaries.
- Manual refresh should bypass cache intentionally; normal navigation should use cache-first paths.
- Do not invalidate GitHub analysis, resume analysis, saved reports, saved scenarios, or sprint history from profile-only changes.

## AI Rules
- Read pages must not trigger hidden AI generation.
- Generation must be behind explicit POST/generate/analyze actions or documented scheduler paths.
- Preserve deterministic fallbacks.

## Safety
- Never revert unrelated work.
- Do not move files or redesign UI unless requested.
- Update docs when changing routes, request flow, cache behavior, AI behavior, or shared models.
