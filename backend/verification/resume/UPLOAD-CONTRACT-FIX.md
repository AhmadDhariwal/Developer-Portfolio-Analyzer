# Resume upload multipart contract fix

Status: fixed and locally verified.

## Cause and correction

The Resume Analyzer page appended the selected PDF under multipart field `resume`, while the existing backend middleware uses `single('file')`. Multer rejected the unexpected field before PDF extraction with HTTP 400 and `{ "message": "Invalid resume upload" }`. Other frontend ResumeService uploads already used `file`.

The page now appends `file`, preserving the existing API contract, PDF-only validation and 10 MB limit. No backend production code, authentication, storage configuration or UI markup/styles changed. Refresh the page after the rebuilt frontend is available before retrying the upload.

The earlier component tests mocked ApiService without checking FormData contents. The new component regression dispatches the native file-input change event and checks that exactly one request contains only `file`, with the selected PDF and the expected analyze call. A source-generated synthetic PDF is used by real multipart HTTP middleware tests to confirm both filesystem and B2 memory parser modes accept `file` and reproduce the original 400 for `resume`. These tests do not call live B2 or change user documents.

## Scope and finalization

Authorized existing branch: `fix/resume`. PR target: not applicable. Existing staged implementation work was preserved. No commit, push, migration, deployment or credential changes were performed.

Changed production file:

- `D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/resume-analyzer/resume-analyzer.component.ts` — correct multipart field.

Changed/new test files:

- `D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/resume-analyzer/resume-analyzer.component.spec.ts` — inspect the actual FormData payload from the upload UI.
- `D:/Developer-Portfolio-Analyzer/backend/src/tests/resumeUploadContract.test.js` — real HTTP multipart tests for both parser storage modes; exact task-owned filesystem uploads are removed in test cleanup.

Retained evidence/documentation:

- `D:/Developer-Portfolio-Analyzer/backend/verification/resume/UPLOAD-CONTRACT-FIX.md`
- `D:/Developer-Portfolio-Analyzer/frontend/verification/resume/upload-contract-frontend-tests.log`
- `D:/Developer-Portfolio-Analyzer/frontend/verification/resume/upload-contract-build.log`

No source files moved or deleted. No pre-existing evidence was removed. Cleanup confirmed no `resume-contract-fixture-*` files remain in backend/uploads. No duplicate screenshots, traces or temporary scripts were created.

## Validation

- Backend multipart HTTP tests: 2 passed, 0 failed; actual filesystem and B2 memory middleware paths.
- Frontend tests: 85 test files / 492 tests passed, 0 failed (bounded worker configuration; includes all 18 Resume Analyzer component tests).
- Application TypeScript no-emit check: passed.
- Production build: passed; existing unrelated landing-page stylesheet warning remains (56.67 kB against a 48 kB warning budget).
- Prettier: explicit changed source paths formatted in write mode and checked with the same options.
- Changed backend JavaScript syntax: passed.
- Git working-tree and staged whitespace checks: passed.

The optional binary PDF accuracy fixtures from the earlier task are not present in this checkout, so this follow-up uses the existing source-based PDF fixture builder and does not claim a fresh run of the broader PDF corpus. Existing live infrastructure/production gates remain unchanged. The fix specifically addresses the reported multipart rejection.
