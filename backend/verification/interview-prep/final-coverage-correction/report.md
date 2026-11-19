# Interview Prep coverage and generation correction

Implemented on `fix/bug-01`; PR target is not applicable. No commit, push, reset, stash, deployment, dependency change, schema change, or production configuration change. The 53 staged entries present at preflight remain unchanged. All implementation changes from this follow-up are unstaged.

**Observed root causes**

The original local backend on port 5000 ran an older Node process that predated the implementation. A real authenticated Easy MERN request returned HTTP 200 with four Medium questions and one Hard question. Canonical `difficulty`, rather than difficulty tags, establishes this mismatch. The corrected source was loaded separately on a task-owned development API-only backend on port 5007, with background workers disabled. Port 5000 was initially left untouched while restart approval was pending. After the user explicitly approved the restart, the original process (PID 16064) was replaced by the current implementation (PID 22280), preserving normal local backend mode and background services. Built-browser acceptance against port 5000 now passes and the backend remains running. This is local runtime verification, not a deployment or a production-readiness claim.

The source implementation also treated an empty/default source as verified-only and gave Interview generation the short custom-answer deadline. Invalid structured batches were rejected after the shared manager had already counted provider success, preventing semantic failover. Partial valid batches were discarded instead of filling only their remaining gap. Cache hits trusted stored payloads without checking their canonical filters. A partially imported verified Mongo catalog also exposed that raw in-memory catalog templates lacked canonical topic fields; the fallback now uses canonical catalog records before considering AI.

The database's raw Easy count was not evidence of public eligibility. All 3,004 original Easy rows failed the existing public quality predicates. No thresholds were lowered, difficulty relabeled, or legacy content promoted.

**Approved original-runtime restart**

The original port-5000 backend was restarted only after explicit approval. No application source changed during this follow-up. Current runtime: [port5000-runtime.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/port5000-runtime.json). It remains running in its original normal local mode (`node index.js`), with the normal background services preserved. Active operational logs are retained in the task-specific cache path recorded in that runtime record.

Built-browser acceptance now targets `http://localhost:5000`: both default-source requests return exactly five canonical Easy MERN questions with zero new generation, all five retain saved unverified provenance, and verified-only returns HTTP 503 `insufficient_results`. The previous port-5007 acceptance and screenshots are retained under [port5007-retained](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/port5007-retained). The current [live-acceptance.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/live-acceptance.json) and desktop/mobile screenshots show the approved port-5000 runtime. Follow-up checks are recorded in [port5000-finalization.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/port5000-finalization.json).

**Runtime and real-provider evidence**

- Original HTTP request and wrong-difficulty response: [running-backend-before.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/running-backend-before.json)
- First corrected live attempt: [live-acceptance-attempt-1.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/live-acceptance-attempt-1.json). Gemini and OpenAI timed out, Groq succeeded, four unique valid Easy questions were persisted, and the exhausted three-attempt budget produced HTTP 503 `invalid_ai_response` with 4/5 available. The duplicate was not delivered or stored. Safe provider events: [provider-events-attempt-1.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/provider-events-attempt-1.json).
- Successful real-provider retry: [live-provider-acceptance.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/live-provider-acceptance.json). It reused those four records and generated only the missing one through Gemini. HTTP 200 contained exactly five Easy MERN questions. Four records retain Groq `openai/gpt-oss-120b` provenance; one retains Gemini `gemini-2.5-flash`. All five have generation timestamps, structured answers, canonical identities, and unverified AI provenance. No synthetic responses were substituted.
- Final production-build acceptance: [live-acceptance.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/live-acceptance.json). Both generation requests returned five Easy questions with zero new generation; all five cards were visited and their actual metadata checked. Verified-only returned HTTP 503 `insufficient_results` and cleared the previous drill. Mongo provenance and identity fields are asserted. Mobile layout settled at viewport 390, page/card right edge 376, document width 390.
- Desktop: [live-mern-easy-desktop.png](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/live-mern-easy-desktop.png); mobile: [live-mern-easy-mobile.png](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/live-mern-easy-mobile.png).

Actual default-source browser payload:

```json
{
  "skill": "mern",
  "query": "",
  "difficulty": "easy",
  "category": "",
  "source": "database",
  "tags": "",
  "target": 5,
  "limit": 5
}
```

Provider failures were observed live as timeouts followed by fallback. Complete provider unavailability and invalid/wrong-technology/wrong-difficulty output were also tested with deterministic fixtures; those tests are distinct from the live provider acceptance. The final acceptance rerun intentionally reused the saved pool rather than forcing additional paid generation. The task-owned API-only backend was stopped after verification; its metadata is retained.

**Source, validation, persistence, and concurrency behavior**

| Requested source                    | Retrieval and fallback                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Default, All Sources, `database`    | Matching verified/prebuilt records, matching canonical curated catalog, eligible reusable AI, then AI for the exact gap |
| `seed`, `verified_seed`, `prebuilt` | Selected verified source only, with matching catalog fallback where applicable; no AI                                   |
| `ai`, `ai_generated`                | Eligible existing selected AI records, then bounded AI gap generation                                                   |
| `scraped`                           | Reviewed eligible scraped records only; no AI                                                                           |

Canonical technology aliases, difficulty, source, category, tags, and focus/query are applied before repository sort/skip/limit. Difficulty is rejected if unsupported instead of silently sanitized to Medium. Seed fallback uses the same filters before limiting. Cached library/search responses are revalidated and incompatible entries evicted. Cache namespaces were revised; keys retain topic, difficulty, source, category, tags, focus/query, count/page, and lookup mode plus existing Redis revisions. Saved requests return their original snapshot only for compatible filters/count; incompatible reuse returns HTTP 409 without modifying the snapshot.

Each generated row independently passes schema, canonical technology/difficulty/category/tags, answer quality/relevance, and the existing content difficulty rubric. Duplicate and near-duplicate questions are excluded before insert and return. Content validation is heuristic and does not establish expert review or guaranteed factual correctness. Generated questions remain `ai_generated` and `unverified`; quality approval is separate from human verification. Existing verified content cannot be overwritten by AI, and generated rows do not join the verified Top 30. Historical private custom questions are excluded from public duplicate/prompt context.

Semantic invalid-output rejection now occurs inside the existing shared AI manager's parser, allowing its configured failover. Partial batches keep their valid rows and request only the remaining count. A mutable total attempt budget caps all batches at three provider attempts within the existing global request deadline, capped at 30 seconds; `INTERVIEW_AI_GENERATION_TIMEOUT_MS` can lower that bound. Provider quotas, global/provider admission, circuits and shared coordination remain in effect. Custom Q&A keeps its existing 6.2/6.5-second backend bounds; frontend generation/session waits 40 seconds and custom answers 20 seconds. Local concurrent callers share generation, but cancelling one caller does not abort another; cancelling the last caller aborts provider work and prevents subsequent persistence.

**Why the original 58 Easy MERN rows were excluded**

| Raw source label | Raw / eligible | Actual failed public predicates                                                                                                                                | Supplemental metadata findings                                                                                                                               |
| ---------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| prebuilt         | 21 / 0         | All 21 lack quality score; 15 lack confidence; 6 are excluded legacy-v2 seeds                                                                                  | 15 lack canonical topic/source; all 21 lack canonical identity/search keys and complete modern answer sections. Six legacy answers are generic placeholders. |
| scraped          | 28 / 0         | All 28 lack quality score or use legacy 1–5 scores; 15 fail confidence; 15 explicit scraped rows lack approved review; one noisy question and one noisy answer | 13 lack canonical topic/source; all 28 lack canonical/search keys and complete modern answer sections.                                                       |
| ai               | 4 / 0          | Confidence 0.71 and quality 4–5 fail current thresholds                                                                                                        | Legacy answer schema and missing canonical/search keys.                                                                                                      |
| ai_generated     | 5 / 0          | Quality 4–5 fails current threshold                                                                                                                            | Legacy answer schema and missing canonical/search keys; some content is unrelated ML/deep-learning material.                                                 |

Reasons can overlap, so reason totals must not be added as mutually exclusive exclusions. Missing identity/answer-section metadata is reported separately from actual Mongo eligibility predicates. A source label alone does not establish human review. The raw 21 prebuilt rows were not silently repaired or promoted.

Complete per-technology/source/difficulty exclusions, approval/review/confidence/quality/relevance distributions and canonical metadata findings are retained in [coverage-before-detailed.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/coverage-before-detailed.json) and [coverage-after.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/coverage-after.json). Audits are read-only; only the five explicitly accepted live AI questions changed public data.

**Before/after coverage for all supported technologies**

Every vector is Easy / Medium / Hard / Senior. Unchanged vectors appear once; changed vectors show before → after. “Verified-source raw” counts `verified_seed` and `prebuilt` source labels, not eligibility. “AI raw” counts existing AI source labels. Eligible counts use the actual public repository predicate.

| Technology                 | Raw before → after                        | Eligible before → after             | Verified-source raw  | AI raw before → after       |
| -------------------------- | ----------------------------------------- | ----------------------------------- | -------------------- | --------------------------- |
| javascript                 | 478/104/32/5                              | 0/16/10/5                           | 24/37/15/5           | 0/4/0/0                     |
| typescript                 | 390/62/31/5                               | 0/15/11/5                           | 6/24/16/5            | 0/1/0/0                     |
| python                     | 407/103/39/5                              | 0/62/26/5                           | 6/71/31/5            | 0/0/0/0                     |
| java                       | 310/103/44/5                              | 0/62/26/5                           | 6/71/31/5            | 0/0/0/0                     |
| cpp                        | 225/90/41/5                               | 0/62/26/5                           | 6/71/31/5            | 0/0/0/0                     |
| csharp                     | 9/20/7/5                                  | 0/20/6/5                            | 0/20/6/5             | 0/0/0/0                     |
| dotnet                     | 9/20/6/5                                  | 0/20/5/5                            | 0/20/5/5             | 0/0/0/0                     |
| angular                    | 203/55/34/5                               | 0/17/9/5                            | 6/29/15/5            | 0/2/0/0                     |
| react                      | 396/120/39/5                              | 0/15/11/5                           | 21/39/16/5           | 0/0/0/0                     |
| react-native               | 8/21/6/5                                  | 0/20/6/5                            | 0/20/6/5             | 0/0/0/0                     |
| nodejs                     | 19/23/17/5                                | 0/14/12/5                           | 6/23/17/5            | 0/0/0/0                     |
| expressjs                  | 15/26/15/5                                | 0/16/10/5                           | 6/25/15/5            | 0/0/0/0                     |
| nextjs                     | 361/111/56/5                              | 0/62/26/5                           | 6/71/31/5            | 0/0/0/0                     |
| mongodb                    | 7/24/22/5                                 | 0/12/14/5                           | 6/21/21/5            | 1/3/1/0                     |
| mysql                      | 17/29/21/5                                | 0/14/12/5                           | 6/23/17/5            | 11/6/4/0                    |
| postgresql                 | 9/29/18/5                                 | 0/13/13/5                           | 6/22/18/5            | 2/4/0/0                     |
| sql                        | 0/20/6/5                                  | 0/20/6/5                            | 0/20/6/5             | 0/0/0/0                     |
| redis                      | 13/76/33/5                                | 0/62/26/5                           | 6/73/32/5            | 0/1/0/0                     |
| docker                     | 0/20/6/5                                  | 0/20/6/5                            | 0/20/6/5             | 0/0/0/0                     |
| kubernetes                 | 0/20/5/5                                  | 0/20/5/5                            | 0/20/5/5             | 0/0/0/0                     |
| rest-apis                  | 12/27/18/5                                | 0/13/13/5                           | 6/22/18/5            | 2/3/0/0                     |
| graphql                    | 10/25/18/5                                | 0/13/13/5                           | 6/22/18/5            | 0/1/0/0                     |
| html                       | 0/17/9/5                                  | 0/17/9/5                            | 0/17/9/5             | 0/0/0/0                     |
| css                        | 0/17/9/5                                  | 0/17/9/5                            | 0/17/9/5             | 0/0/0/0                     |
| git-github                 | 6/28/10/5                                 | 0/15/8/5                            | 0/17/9/5             | 6/11/1/0                    |
| oop                        | 0/17/11/5                                 | 0/16/10/5                           | 0/16/10/5            | 0/1/1/0                     |
| dsa                        | 0/17/9/5                                  | 0/17/9/5                            | 0/17/9/5             | 0/0/0/0                     |
| aws                        | 6/92/40/5                                 | 0/62/26/5                           | 0/82/36/5            | 6/10/4/0                    |
| generative-ai              | 0/92/42/5                                 | 0/62/26/5                           | 0/83/42/5            | 0/9/0/0                     |
| ai-agents                  | 3/80/51/5                                 | 0/62/26/5                           | 0/71/36/5            | 3/9/15/0                    |
| llm                        | 0/82/36/5                                 | 0/62/26/5                           | 0/82/36/5            | 0/0/0/0                     |
| rag                        | 0/82/36/5                                 | 0/62/26/5                           | 0/82/36/5            | 0/0/0/0                     |
| langchain                  | 0/144/67/5                                | 0/62/26/5                           | 0/144/67/5           | 0/0/0/0                     |
| system-design              | 15/3/35/5                                 | 0/0/26/5                            | 0/0/28/5             | 2/3/2/0                     |
| mern                       | 58/62/30/5 → 63/62/30/5                   | 0/14/12/5 → 5/14/12/5               | 21/37/18/5           | 9/19/10/0 → 14/19/10/0      |
| mean                       | 12/94/42/5                                | 0/62/26/5                           | 6/91/41/5            | 1/3/1/0                     |
| full-stack-web-development | 6/86/41/5                                 | 0/62/26/5                           | 6/85/41/5            | 0/1/0/0                     |
| **Totals**                 | **3004/2041/982/185 → 3009/2041/982/185** | **0/1180/583/185 → 5/1180/583/185** | **162/1605/803/185** | **43/91/39/0 → 48/91/39/0** |

Raw total: 6,212 → 6,217. Public eligible: 1,948 → 1,953. Excluded: 4,264 → 4,264. Existing verified-source and scraped counts are unchanged. Eligible verified-source remains 1,948; eligible AI becomes five. There are zero exact comparable/canonical duplicates and 105 near-duplicate pairs at token Jaccard ≥0.8 before and after. Near-duplicate counts are diagnostic, not a claim that every pair is erroneous. Persisted eligible verified Top rows remain 1,105; the shipped catalog retains 1,110 ranked Top rows across 37 technologies.

**Controlled coverage management**

The audit includes all 148 technology/difficulty cells, targets, available counts and deficits. The legacy default target is 30, configurable with `INTERVIEW_QUESTION_COVERAGE_TARGET`. `INTERVIEW_QUESTION_COVERAGE_TARGETS` accepts a default, per-difficulty and per-technology/difficulty overrides, for example:

```json
{ "default": 30, "difficulties": { "hard": 12 }, "technologies": { "mern": { "easy": 40 } } }
```

Overrides take precedence by cell, then difficulty, then default, then legacy value. Values are integers 0–100; unsupported keys are rejected. With the current default, 135 cells still have a deficit; the task did not bulk-fill them.

Read-only audit command (explicit output preserves historical reports):

```powershell
node backend/src/scripts/auditInterviewCoverage.js --output backend/verification/interview-prep/final-coverage-correction/coverage-after.json
```

An operator may explicitly run one bounded batch after reviewing desired scope:

```powershell
node backend/src/scripts/fillInterviewQuestionCoverage.js --topic mern --difficulty easy --batch 5 --run-id coverage-mern-easy-001 --allow-ai
```

The fill command was not bulk-run in this task. It requires `--allow-ai`, a canonical cell, batch 1–10 and a stable safe run ID. A distributed per-cell lease prevents overlapping operator batches. Existing run-tagged rows reduce the remaining cumulative batch on resume, and the target deficit also caps work. Partial successful inserts are reusable and auditable. Failures retain typed retry metadata and append attempt history to the run report. Reusing a run ID for different filters is rejected. Startup/cron maintenance defaults to no AI generation or legacy AI enrichment.

**Validation and remaining limitations**

Final Interview Prep + shared AI suite: 140 passed, zero failed or skipped, including actual isolated Mongo/JWT and multi-process admission/coordination tests. The partial-catalog integration failure discovered during the broad run was fixed and rechecked. New targeted coverage regressions: 13 passed. Post-cleanup backend regression check: 44 passed.

Full frontend suite: 702 passed across 118 files. TypeScript no-emit check and production build passed. Final post-cleanup reruns are recorded alongside their original results. Build warnings remain: initial bundle 4.02 MB exceeds 4.00 MB by 15.03 kB; unrelated Jobs SCSS 54.35 kB and Public Portfolio SCSS 49.97 kB exceed their 48 kB warning budgets.

The full repository backend run recorded 1,042 tests: 998 passed, 21 failed, 23 skipped. This was an initial full run, not an all-green final repository claim. Its Interview Prep failure is resolved in the later 140-pass suite. Remaining failures include missing isolated Sprint database settings, missing resume PDF fixtures, temporary C-drive Mongo disk-space failures, course/Kaggle/notification assertions, and unrelated performance/visual checks. Skipped suites require their own isolated integration prerequisites. These unrelated modules were not modified to make the run green.

- [backend-tests-final.txt](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/backend-tests-final.txt)
- [post-cleanup-backend-tests.txt](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/post-cleanup-backend-tests.txt)
- [backend-tests-full.txt](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/backend-tests-full.txt)
- [backend-full-failures.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/backend-full-failures.json)
- [frontend-tests-final.txt](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/frontend-tests-final.txt)
- [validation.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/validation.json)
- [production-build-final.txt](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/production-build-final.txt)
- [source-checks.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/source-checks.json)

Formatting was run in write mode on the explicit changed paths, then checked using the same backend options or frontend configuration. Changed JavaScript syntax is checked. Git working-tree and staged whitespace checks, index preservation, source hashes, exact cleanup paths, and restored historical evidence are retained in the finalization records. No source files were moved or deleted.

**Exact changed source files**

- [backend/src/controllers/interviewPrepController.js](D:/Developer-Portfolio-Analyzer/backend/src/controllers/interviewPrepController.js)
- [backend/src/repositories/interviewQuestionRepository.js](D:/Developer-Portfolio-Analyzer/backend/src/repositories/interviewQuestionRepository.js)
- [backend/src/scripts/auditInterviewCoverage.js](D:/Developer-Portfolio-Analyzer/backend/src/scripts/auditInterviewCoverage.js)
- [backend/src/scripts/fillInterviewQuestionCoverage.js](D:/Developer-Portfolio-Analyzer/backend/src/scripts/fillInterviewQuestionCoverage.js)
- [backend/src/services/aiProviderManager.js](D:/Developer-Portfolio-Analyzer/backend/src/services/aiProviderManager.js)
- [backend/src/services/aiservice.js](D:/Developer-Portfolio-Analyzer/backend/src/services/aiservice.js)
- [backend/src/services/interviewCoordinationService.js](D:/Developer-Portfolio-Analyzer/backend/src/services/interviewCoordinationService.js)
- [backend/src/services/interviewCoverageService.js](D:/Developer-Portfolio-Analyzer/backend/src/services/interviewCoverageService.js)
- [backend/src/services/interviewPrepService.js](D:/Developer-Portfolio-Analyzer/backend/src/services/interviewPrepService.js)
- [backend/src/services/interviewQuestionFilters.js](D:/Developer-Portfolio-Analyzer/backend/src/services/interviewQuestionFilters.js)
- [backend/src/services/providers/interviewAIProvider.js](D:/Developer-Portfolio-Analyzer/backend/src/services/providers/interviewAIProvider.js)
- [backend/src/tests/interviewQuestionFilters.test.js](D:/Developer-Portfolio-Analyzer/backend/src/tests/interviewQuestionFilters.test.js)
- [frontend/src/app/pages/interview-prep/interview-prep.component.html](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/interview-prep/interview-prep.component.html)
- [frontend/src/app/pages/interview-prep/interview-prep.component.spec.ts](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/interview-prep/interview-prep.component.spec.ts)
- [frontend/src/app/pages/interview-prep/interview-prep.component.ts](D:/Developer-Portfolio-Analyzer/frontend/src/app/pages/interview-prep/interview-prep.component.ts)
- [frontend/src/app/shared/services/interview-prep.service.spec.ts](D:/Developer-Portfolio-Analyzer/frontend/src/app/shared/services/interview-prep.service.spec.ts)
- [frontend/src/app/shared/services/interview-prep.service.ts](D:/Developer-Portfolio-Analyzer/frontend/src/app/shared/services/interview-prep.service.ts)
- [backend/src/services/interviewCoverageAudit.js](D:/Developer-Portfolio-Analyzer/backend/src/services/interviewCoverageAudit.js)
- [backend/src/services/interviewGenerationFlight.js](D:/Developer-Portfolio-Analyzer/backend/src/services/interviewGenerationFlight.js)
- [backend/src/tests/interviewCoverageCorrection.test.js](D:/Developer-Portfolio-Analyzer/backend/src/tests/interviewCoverageCorrection.test.js)
- [frontend/scripts/verify-interview-live-coverage.cjs](D:/Developer-Portfolio-Analyzer/frontend/scripts/verify-interview-live-coverage.cjs)

Exact source hashes and evidence moves: [changed-files.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/changed-files.json). Exact deleted temporary paths: [cleanup.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/cleanup.json). Historical report restoration: [restored-historical-evidence.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/restored-historical-evidence.json). Final Git checks and artifact inventory: [finalization.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/finalization.json). Original staged-work baseline: [baseline.json](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/final-coverage-correction/baseline.json).
