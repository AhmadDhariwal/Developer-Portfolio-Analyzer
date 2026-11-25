# Custom Q&A: Netflix system-design 503 correction

The exact reported request is now accepted on the original local backend, port 5000:

```json
{ "skill": "system-design", "question": "system design of netflix" }
```

The real provider generated a complete answer in 9487 ms with HTTP 200. All fifteen design fields and an educational scope note persist in an owner-scoped private session as unverified AI content. The final built browser renders the answer, and refresh reuses that same private snapshot with no new provider generation. The public bank gained no matching Netflix question record. The normal local backend remains running, PID 37160. No production deployment was performed.

**Root cause and supporting evidence**

The earlier fix covered practice-question sets. Custom Q&A still had a 6,200 ms provider/coordinator deadline and 6,500 ms service deadline. Its local model preference selected a hardcoded Gemini model instead of using the shared registry's configured model. The original running process logs show Gemini cancelled at approximately 6.2 seconds and no opportunity for configured fallback; the reported API returned HTTP 503 `ai_unavailable`.

There were also independent validation problems behind the same workflow. A natural named task such as “system design of Netflix” failed a question-prefix guard that expected an opening verb. The architecture prompt did not explicitly constrain company names versus canonical technology metadata, or demonstrate the required string-valued schema. Live retries showed complete sections with metadata rejection, and a fallback response with object-valued `example`/components instead of strings. These responses remain rejected. An exhausted provider budget could also replace the actual final invalid-output reason with `attempt_budget`, which then appeared as provider unavailability.

- Original safe provider events: [provider-events-before.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-system-design/provider-events-before.json).
- First corrected live API attempt still failed: [api-acceptance-first.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-system-design/api-acceptance-first.json); its configured providers timed out or returned invalid output.
- Additional strict-validation retry: [live-custom-attempt-2.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-system-design/live-custom-attempt-2.json). Response types and required-field presence were observed without logging answer content: [response-shapes.jsonl](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-system-design/response-shapes.jsonl).
- Actual successful provider generation and private persistence: [live-custom-generation-evidence.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-system-design/live-custom-generation-evidence.json). Its HTTP response is 200; the first rendering assertion failed because it compared CSS-transformed heading case. The corrected final browser test passes.
- Final real browser/API evidence on port 5000: [live-custom-acceptance.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-system-design/live-custom-acceptance.json). Both requests return 200 and reuse the same complete snapshot. No mocked API/provider response was used.
- Final screenshots: [desktop](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-system-design/netflix-custom-desktop.png) and [mobile](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-system-design/netflix-custom-mobile.png).

**Implemented behavior**

System-design answers now receive the existing shared global request budget, capped at 30 seconds, with per-provider attempts capped at 12 seconds and at most three total attempts. Every attempt is also capped by the remaining overall deadline. Other callers retain configured provider deadlines unless they explicitly request the operation-specific bound. Ordinary short Custom Q&A keeps its prior 6.2/6.5-second backend bounds. The frontend allows 40 seconds for Custom Q&A so it cannot cancel a valid bounded architecture fallback at 20 seconds.

Custom Q&A uses configured shared-manager models and an explicit JSON template. Both topic fields must identify the selected technology; Netflix is the design subject. Every architecture field and example remains a nonempty string. All fifteen architecture fields, the scope note, answer quality, confidence and relevance requirements remain in force. The named design-task prefix is accepted while bare labels and missing targets still fail. No quality thresholds were lowered and no invalid output is fabricated into an answer.

Provider/model/time provenance comes from the actual provider outcome and is retained only in the private owned snapshot. Existing saved snapshots remain immutable. Request cancellation now reaches provider work; one cancelled tab cannot cancel another matching caller, and the last cancellation prevents persistence. Shared quotas, admission, circuits and provider order remain active. Budget exhaustion preserves the last meaningful provider/schema failure so invalid output remains distinguishable from unavailable providers.

**Verification**

- Final Interview Prep and shared-AI suite: 152 passed, zero failed or skipped, including real isolated Mongo and multi-process integration tests.
- Twelve new system-design regressions cover the former 6.5-second cutoff, configured models, timeout/schema/type/topic failover, complete private persistence, per-caller cancellation, provider-budget caps, failure classification and invalid bare prompts.
- Post-cleanup focused backend check: 72 passed.
- Full frontend suite: 702 passed across 118 files.
- TypeScript no-emit and production build passed. The existing initial-bundle, Jobs SCSS and Public Portfolio SCSS warning budgets remain exceeded; no unrelated styles were changed.
- The final browser used the actual production frontend build, actual port-5000 API, real providers and actual owner-scoped Mongo persistence. Gemini `gemini-2.5-flash` generated the accepted answer. Final refresh reused it.

- [backend-final-tests.txt](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-system-design/backend-final-tests.txt)
- [post-cleanup-tests.txt](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-system-design/post-cleanup-tests.txt)
- [frontend-final-tests.txt](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-system-design/frontend-final-tests.txt)
- [build-final.txt](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-system-design/build-final.txt)
- [validation.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-system-design/validation.json)
- [source-checks.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-system-design/source-checks.json)
- [finalization.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-system-design/finalization.json)

Formatting uses the repository's installed Prettier with explicit paths, backend options matched between write/check, and the frontend configuration for frontend files. JavaScript syntax and Git working-tree/staged whitespace checks are recorded in finalization. All 53 original staged entries and unrelated existing edits are preserved. No dependency, database schema or public API contract changed. No commit, push, deployment or destructive database operation was performed.

**Exact changed source files**

- [backend/src/services/providers/interviewAIProvider.js](D:/Developer-Portfolio-Analyzer/backend/src/services/providers/interviewAIProvider.js)
- [backend/src/services/interviewPrepService.js](D:/Developer-Portfolio-Analyzer/backend/src/services/interviewPrepService.js)
- [backend/src/services/interviewQuestionQualityService.js](D:/Developer-Portfolio-Analyzer/backend/src/services/interviewQuestionQualityService.js)
- [backend/src/services/aiProviderManager.js](D:/Developer-Portfolio-Analyzer/backend/src/services/aiProviderManager.js)
- [backend/src/tests/interviewCustomSystemDesign.test.js](D:/Developer-Portfolio-Analyzer/backend/src/tests/interviewCustomSystemDesign.test.js)
- [frontend/src/app/shared/services/interview-prep.service.ts](D:/Developer-Portfolio-Analyzer/frontend/src/app/shared/services/interview-prep.service.ts)
- [frontend/src/app/shared/services/interview-prep.service.spec.ts](D:/Developer-Portfolio-Analyzer/frontend/src/app/shared/services/interview-prep.service.spec.ts)
- [frontend/scripts/verify-interview-custom-system-design.cjs](D:/Developer-Portfolio-Analyzer/frontend/scripts/verify-interview-custom-system-design.cjs)

Exact source hashes and unchanged-work checks: [changed-files.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-system-design/changed-files.json). No source file was moved or deleted. Temporary runtime logs and the diagnostic launcher were removed after retaining sanitized evidence. Task-owned disposable Mongo files were removed by exact verified path after stopping only that test process; no directory was recursively deleted. Exact cleanup inventory: [cleanup.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-system-design/cleanup.json). The active port-5000 operational logs are retained at the path in [port5000-runtime.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-system-design/port5000-runtime.json).

The service still correctly returns a retryable 503 if all configured providers time out or return unusable output within the bounded budget. This correction does not claim guaranteed external-provider availability or independently verified knowledge of Netflix internals.
