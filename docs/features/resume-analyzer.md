# Resume Analyzer

Implementation-driven guide for resume upload, active resume, and analysis.

## Current Behavior
Users upload resumes, choose active/default resume context, and explicitly run analysis. Result reads are separate from analysis generation.

## Files To Modify
| Change | Files |
|---|---|
| UI | `frontend/src/app/pages/resume-analyzer/*` |
| Frontend services | `frontend/src/app/shared/services/resume.service.ts`, `frontend/src/app/shared/services/resume-onboarding.service.ts`, `frontend/src/app/shared/services/api.service.ts` |
| Backend routes/controller | `backend/src/routes/resume.routes.js`, `backend/src/controllers/resumecontoller.js` |
| Backend services | `backend/src/services/resumeservice.js`, `backend/src/services/resumeGuideService.js` |
| Models | `backend/src/models/resumeFile.js`, `backend/src/models/resumeAnalysis.js`, `backend/src/models/resumeAnalysisCache.js` |

## Dependencies
- Multer upload middleware.
- PDF parsing and AI service for explicit analysis.
- Profile default/active resume fields.
- Dashboard, Skill Gap, Recommendations, Weekly Reports, and Scenario context consume latest/default resume signals.

## Request Flow
Upload: `POST /api/resume/upload` -> file metadata saved.

Analyze: `POST /api/resume/analyze` -> extract text -> AI/deterministic analysis -> save `ResumeAnalysis`.

Read: `GET /api/resume/result`, `GET /api/resume/files`, `GET /api/resume/active`.

## Change Impact
- Analysis result shape affects several downstream modules.
- Active/default resume changes should invalidate developer signal state, not delete past analyses.

## Testing Files
- `node --check backend/src/controllers/resumecontoller.js`
- `node --check backend/src/services/resumeservice.js`
- `npx -y ng build --configuration development`

## Common Pitfalls
- Do not analyze automatically from read endpoints.
- Preserve uploaded file ownership checks.
- Keep default resume selection explicit and stable.
