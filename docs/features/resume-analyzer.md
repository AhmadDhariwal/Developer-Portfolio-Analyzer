# Resume Analyzer

Implementation-driven guide for resume upload, active resume, and analysis.

## Current Behavior

Users upload resumes, choose active/default resume context, and explicitly run analysis. Result reads are separate from analysis generation.

## Files To Modify

| Change                    | Files                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UI                        | `frontend/src/app/pages/resume-analyzer/*`                                                                                                                               |
| Frontend services         | `frontend/src/app/shared/services/resume.service.ts`, `frontend/src/app/shared/services/resume-onboarding.service.ts`, `frontend/src/app/shared/services/api.service.ts` |
| Backend routes/controller | `backend/src/routes/resume.routes.js`, `backend/src/controllers/resumecontoller.js`                                                                                      |
| Backend services          | `backend/src/services/resumeservice.js`, `backend/src/services/resumeGuideService.js`                                                                                    |
| Models                    | `backend/src/models/resumeFile.js`, `backend/src/models/resumeAnalysis.js`, `backend/src/models/resumeAnalysisCache.js`                                                  |

## Dependencies

- Multer upload middleware.
- PDF parsing and AI service for explicit analysis.
- Profile default/active resume fields.
- Dashboard, Skill Gap, Recommendations, Weekly Reports, and Scenario context consume latest/default resume signals.

## Request Flow

Upload: `POST /api/resume/upload` -> owner/IP admission and a durable capacity reservation -> bounded PDF validation -> private file and original-byte SHA-256 metadata saved transactionally. The browser sends one upload operation and then analyzes that version.

Analyze: `POST /api/resume/analyze` -> versioned `ResumeAnalysisCache` lookup -> on miss, extract PDF text -> deterministic analysis -> optional constrained AI focus prioritization -> save `ResumeAnalysis` and cache result. Identity combines original PDF bytes, parser/extraction version, scoring rule version, schema version and focus-prompt version. A normal repeat for the same owner/file/hash/version returns before PDF extraction. Force refresh consumes the same budgets; concurrent refreshes join the current job. Historical versions remain readable and are not relabeled.

Read: `GET /api/resume/result`, `GET /api/resume/files`, `GET /api/resume/active`.

## Resource and admission budgets

- PDF only, at most 10 MB, 50 pages and 200,000 extracted characters. Worker heap: 128 MB old generation plus 16 MB young generation; deadline: 15 seconds; two extraction workers per API process. Heap limits do not constitute a total process RSS guarantee.
- MongoDB is the authority. Upload, analysis and guide budgets are independent of public portfolio requests. Hourly owner/IP limits are 10/30 uploads, 20/60 analyses and 5/20 guide downloads. Responses include Retry-After on denial. Force refresh is charged normally.
- Durable work reservations cap global work at eight, work per owner at two, and work per owner/file at one; uploads reserve before multipart parsing. Reservations expire after 90 seconds for crash recovery. Redis remains optional; Resume cache reads and invalidation use a 150 ms acceleration budget.
- AI receives only PII-free deterministic summaries and can return whitelisted focus codes. The five-second deadline aborts the SDK/fetch request. Downloadable guides use deterministic evidence and existing recommendations without a second unrestricted prompt.
- Memory caches are bounded. The existing 30-day Mongo TTL applies only to disposable analysis caches. Durable ResumeFile and ResumeAnalysis histories retain their existing retention policy.
- ATS compatibility is a documented heuristic, not certification against every commercial ATS. Content-stream column ordering is supported for the supplied fixtures; arbitrary table structure, OCR and non-English section headings remain unsupported or ambiguous as documented in the final verification report.

## Change Impact

- Analysis result shape affects several downstream modules.
- Active/default resume changes should invalidate developer signal state, not delete past analyses.

## Testing Files

- `node --check backend/src/controllers/resumecontoller.js`
- `node --check backend/src/services/resumeservice.js`
- `node --check backend/src/middleware/uploadmiddleware.js`
- `node --test backend/src/tests/resumeService.test.js`
- `npm test -- --watch=false --runner-config scripts/resume-vitest.config.mjs` and `npm run build` from `frontend`.
- `node --test backend/src/tests/resumeProduction.test.js backend/src/tests/resumeProductionMongo.test.js`
- `node frontend/scripts/verify-resume-parity.cjs before|after` (requires a built frontend and Playwright; set `ACCEPTANCE_PLAYWRIGHT` if needed).
- `node backend/scripts/generate-resume-fixtures.js` (set `RESUME_FIXTURE_PYTHON` to a Python with reportlab, pypdf and Pillow; `RESUME_FIXTURE_FONT` overrides the Windows Arial default).

## Common Pitfalls

- Do not analyze automatically from read endpoints.
- Preserve uploaded file ownership checks.
- Keep default resume selection explicit and stable.
- AI may prioritize backend-defined improvement focus codes, but factual fields, scores, resume signals, recruiter evidence, and displayed prose remain deterministic and resume-grounded.
- Pipeline logs use the `[ResumeAnalysisPipeline]` prefix and report extraction, cache, deterministic, AI, Mongo write, serialization, and total durations.
