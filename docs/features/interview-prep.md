# Interview Prep

Implementation-driven guide for interview question bank and practice sessions.

## Current Behavior
Interview Prep is DB-first. It retrieves existing questions, enriches insufficient topic pools through explicit generation/enrichment paths, and tracks sessions.

## Files To Modify
| Change | Files |
|---|---|
| UI | `frontend/src/app/pages/interview-prep/*` |
| Frontend service | `frontend/src/app/shared/services/interview-prep.service.ts` |
| Backend route/controller | `backend/src/routes/interviewPrep.routes.js`, `backend/src/controllers/interviewPrepController.js` |
| Backend services | `backend/src/services/interviewPrepService.js`, `backend/src/services/interviewEnrichmentOrchestrator.js`, `backend/src/services/interviewTopicNormalizer.js` |
| Models | `backend/src/models/interviewQuestionBank.js`, `backend/src/models/interviewPrepSession.js` |

## Dependencies
- AI provider and scraper providers for enrichment.
- Seed catalog and maintenance services.
- Topic normalization aliases.

## Request Flow
Questions: component -> `GET /api/interview-prep/questions` -> DB-first retrieval -> optional enrichment if insufficient.

Generate/custom: `POST /api/interview-prep/generate`, `POST /api/interview-prep/ask-question`.

Session: `POST /api/interview-prep`, history reads through existing service routes.

## Change Impact
- Topic normalization changes affect saved question buckets.
- Generation changes affect AI usage and question quality.

## Testing Files
- `node --check backend/src/controllers/interviewPrepController.js`
- `node --check backend/src/services/interviewPrepService.js`
- `npx -y ng build --configuration development`

## Common Pitfalls
- Preserve DB-first behavior.
- Deduplicate questions before saving.
- Keep explicit generation separate from ordinary reads where possible.
