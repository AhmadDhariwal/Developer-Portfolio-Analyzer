# Documentation Policy

Documentation is part of the implementation contract. Keep it current whenever code behavior changes.

## When Documentation Must Change
Update the corresponding docs when a change affects any of these areas:
- APIs or request/response contracts
- routes or navigation paths
- controllers or request flow
- services or business logic
- models, schemas, or persisted fields
- caching, `profileHash`, `signalHash`, TTLs, or invalidation
- architecture, middleware, workers, or integrations
- feature behavior, read/generate boundaries, or AI usage

## What To Update
| Code Change | Required Docs |
|---|---|
| Feature behavior | Matching `docs/features/*.md` |
| API route/contract | `docs/API_REFERENCE.md` and feature doc |
| Cache behavior | `docs/CACHE_SYSTEM.md` and feature doc |
| AI generation/fallback | `docs/AI_PIPELINE.md` and feature doc |
| Model/schema | `docs/DATABASE.md`, feature doc, and `docs/agent/CHANGE_IMPACT.md` if shared |
| Architecture/middleware/worker | `docs/ARCHITECTURE.md` or `docs/BACKEND_FLOW.md` |
| Frontend routing/layout | `docs/FRONTEND_FLOW.md` and feature doc |
| New feature doc | `docs/PROJECT_INDEX.md` |

## Documentation Checklist
Before merging a change, confirm:
- [ ] `docs/PROJECT_INDEX.md` still points to the right feature doc.
- [ ] The relevant feature doc lists current files to modify, dependencies, request flow, change impact, testing files, and common pitfalls.
- [ ] API route changes are reflected in `docs/API_REFERENCE.md`.
- [ ] Cache or signal changes are reflected in `docs/CACHE_SYSTEM.md`.
- [ ] AI generation or fallback changes are reflected in `docs/AI_PIPELINE.md`.
- [ ] Model/schema changes are reflected in `docs/DATABASE.md`.
- [ ] Route/navigation changes are reflected in `docs/FRONTEND_FLOW.md`.
- [ ] The lightweight docs verifier passes: `node docs/verify-docs.js`.

## Keep Docs Maintainable
- Prefer concise implementation facts over long explanations.
- Link to the owning feature doc instead of repeating details.
- Keep examples current with real route and file names.
- Do not document planned behavior as current behavior.
