# Interview Prep: complete AI question architecture

Audit date: 15 November 2026 (Asia/Karachi). Source/current branch: `fix/bug-01`. PR target: not applicable. No commit, push, deploy, production configuration change, or live AI generation was performed.

## Architecture and root causes

Angular InterviewPrepComponent calls InterviewPrepService/ApiService. Authenticated Express routes validate and rate-limit input, then interviewPrepService coordinates the question repository, shipped seed catalog, shared AI provider adapter, Redis/memory cache, and private interviewPrepSession snapshots. The shared AIService / AIProviderManager supplies configured adapters, model selection, global admission control, retry budgets, timeouts and failover; no second provider system was introduced.

The previous generation path could normalize absent or invalid AI metadata into apparently valid defaults, append request tags before checking them, and return fallback/partial sets inconsistently. The provider adapter allowed only one total attempt, preventing fallback. Custom questions beginning with “Can you…” failed the question-style quality check. Topic-quality matching also compared unstemmed aliases against stemmed text: Node.js, Redis and hyphenated technologies could fail despite matching metadata. Provider/validation failures became HTTP 200 “No verified answer” payloads. Session schemas discarded per-question technology and generation provenance.

The Easy gap has two distinct causes: the shipped curated source contains no Easy records, while many Easy documents exist in MongoDB but fail the public-library eligibility predicates. Reclassifying those records or promoting scraped/AI material to verified would conceal the problem. This change does neither.

## Live coverage and exact sources

The read-only configured MongoDB audit succeeded at `2026-11-15T07:13:23.960Z`. Collection creation and index creation were disabled. These are real application database counts, separate from local deterministic test fixtures. Exact matrices and source-level quality summaries are retained in [complete-ai-coverage.json](complete-ai-coverage.json).

| Source/view                                                 | Records | Easy | Medium | Hard | Senior |
| ----------------------------------------------------------- | ------: | ---: | -----: | ---: | -----: |
| Shipped curated/verified source catalog                     |    1953 |    0 |   1183 |  585 |    185 |
| Shipped Top 30 catalog                                      |    1110 |    0 |    636 |  289 |    185 |
| MongoDB interviewquestionbanks (raw)                        |    6212 | 3004 |   2041 |  982 |    185 |
| MongoDB verified_seed/prebuilt (raw)                        |    2755 |  162 |   1605 |  803 |    185 |
| MongoDB AI pool (raw)                                       |     173 |   43 |     91 |   39 |      0 |
| MongoDB accessible All Questions                            |    1948 |    0 |   1180 |  583 |    185 |
| MongoDB eligible Top flags before UI source supplementation |    1105 |    0 |    634 |  286 |    185 |

Raw source types (sourceType with legacy source fallback): `prebuilt`: 481, `ai`: 146, `scraped`: 3284, `verified_seed`: 2274, `ai_generated`: 27.

4264 raw records are excluded from All Questions. Nonexclusive exclusion indicators: legacyV2: 380, pendingOrRejectedReview: 11, notApproved: 11, lowConfidence: 546, lowQuality: 3163, privateLegacyRows: 9. These indicators overlap and are not intended to sum to the exclusion total. Eligibility also requires approved quality/review state, source/privacy guards, relevance/confidence, noise rejection and exclusion of legacy v2 seeds.

The raw catalog has no exact comparable-question duplicates, missing answers, invalid difficulty values or technology aliases detected by this audit. Canonical duplicates are counted only where canonical keys exist. Near-semantic duplicates and the truth of historical provenance require review; automated quality approval is not evidence of human verification.

`interviewprepsessions` contains 54 retained question snapshots in the aggregate audit. Legacy groups without technology/source metadata remain historical snapshots; they were not rewritten. Counts and difficulty/source groups are retained without user IDs, private questions, or private answers. These records are available only to their owner through history/session routes, never the public library.

All Questions filters run inside MongoDB before skip/limit, with identical count predicates and stable \_id tie-breaking. No 500-record truncation is used. Top 30 remains the ranked verified view, supplemented from the shipped catalog; its raw MongoDB count is not the UI total. The isolated regression checks pagination beyond 500 documents and existing query indexes. Raw records excluded by approval/privacy/legacy rules are deliberately inaccessible through the public UI.

### Accessible live library: every supported technology

| Technology                 | Easy | Medium | Hard | Senior |
| -------------------------- | ---: | -----: | ---: | -----: |
| javascript                 |    0 |     16 |   10 |      5 |
| typescript                 |    0 |     15 |   11 |      5 |
| python                     |    0 |     62 |   26 |      5 |
| java                       |    0 |     62 |   26 |      5 |
| cpp                        |    0 |     62 |   26 |      5 |
| csharp                     |    0 |     20 |    6 |      5 |
| dotnet                     |    0 |     20 |    5 |      5 |
| angular                    |    0 |     17 |    9 |      5 |
| react                      |    0 |     15 |   11 |      5 |
| react-native               |    0 |     20 |    6 |      5 |
| nodejs                     |    0 |     14 |   12 |      5 |
| expressjs                  |    0 |     16 |   10 |      5 |
| nextjs                     |    0 |     62 |   26 |      5 |
| mongodb                    |    0 |     12 |   14 |      5 |
| mysql                      |    0 |     14 |   12 |      5 |
| postgresql                 |    0 |     13 |   13 |      5 |
| sql                        |    0 |     20 |    6 |      5 |
| redis                      |    0 |     62 |   26 |      5 |
| docker                     |    0 |     20 |    6 |      5 |
| kubernetes                 |    0 |     20 |    5 |      5 |
| rest-apis                  |    0 |     13 |   13 |      5 |
| graphql                    |    0 |     13 |   13 |      5 |
| html                       |    0 |     17 |    9 |      5 |
| css                        |    0 |     17 |    9 |      5 |
| git-github                 |    0 |     15 |    8 |      5 |
| oop                        |    0 |     16 |   10 |      5 |
| dsa                        |    0 |     17 |    9 |      5 |
| aws                        |    0 |     62 |   26 |      5 |
| generative-ai              |    0 |     62 |   26 |      5 |
| ai-agents                  |    0 |     62 |   26 |      5 |
| llm                        |    0 |     62 |   26 |      5 |
| rag                        |    0 |     62 |   26 |      5 |
| langchain                  |    0 |     62 |   26 |      5 |
| system-design              |    0 |      0 |   26 |      5 |
| mern                       |    0 |     14 |   12 |      5 |
| mean                       |    0 |     62 |   26 |      5 |
| full-stack-web-development |    0 |     62 |   26 |      5 |

### Shipped curated catalog: every supported technology

| Technology                 | Easy | Medium | Hard | Senior |
| -------------------------- | ---: | -----: | ---: | -----: |
| javascript                 |    0 |     16 |   10 |      5 |
| typescript                 |    0 |     15 |   11 |      5 |
| python                     |    0 |     62 |   26 |      5 |
| java                       |    0 |     62 |   26 |      5 |
| cpp                        |    0 |     62 |   26 |      5 |
| csharp                     |    0 |     20 |    6 |      5 |
| dotnet                     |    0 |     20 |    6 |      5 |
| angular                    |    0 |     17 |    9 |      5 |
| react                      |    0 |     15 |   11 |      5 |
| react-native               |    0 |     20 |    6 |      5 |
| nodejs                     |    0 |     14 |   12 |      5 |
| expressjs                  |    0 |     16 |   10 |      5 |
| nextjs                     |    0 |     62 |   26 |      5 |
| mongodb                    |    0 |     12 |   14 |      5 |
| mysql                      |    0 |     14 |   12 |      5 |
| postgresql                 |    0 |     13 |   13 |      5 |
| sql                        |    0 |     20 |    6 |      5 |
| redis                      |    0 |     62 |   26 |      5 |
| docker                     |    0 |     20 |    6 |      5 |
| kubernetes                 |    0 |     20 |    6 |      5 |
| rest-apis                  |    0 |     13 |   13 |      5 |
| graphql                    |    0 |     13 |   13 |      5 |
| html                       |    0 |     17 |    9 |      5 |
| css                        |    0 |     17 |    9 |      5 |
| git-github                 |    0 |     17 |    9 |      5 |
| oop                        |    0 |     17 |    9 |      5 |
| dsa                        |    0 |     17 |    9 |      5 |
| aws                        |    0 |     62 |   26 |      5 |
| generative-ai              |    0 |     62 |   26 |      5 |
| ai-agents                  |    0 |     62 |   26 |      5 |
| llm                        |    0 |     62 |   26 |      5 |
| rag                        |    0 |     62 |   26 |      5 |
| langchain                  |    0 |     62 |   26 |      5 |
| system-design              |    0 |      0 |   26 |      5 |
| mern                       |    0 |     14 |   12 |      5 |
| mean                       |    0 |     62 |   26 |      5 |
| full-stack-web-development |    0 |     62 |   26 |      5 |

### Raw live catalog: every supported technology

| Technology                 | Easy | Medium | Hard | Senior |
| -------------------------- | ---: | -----: | ---: | -----: |
| javascript                 |  478 |    104 |   32 |      5 |
| typescript                 |  390 |     62 |   31 |      5 |
| python                     |  407 |    103 |   39 |      5 |
| java                       |  310 |    103 |   44 |      5 |
| cpp                        |  225 |     90 |   41 |      5 |
| csharp                     |    9 |     20 |    7 |      5 |
| dotnet                     |    9 |     20 |    6 |      5 |
| angular                    |  203 |     55 |   34 |      5 |
| react                      |  396 |    120 |   39 |      5 |
| react-native               |    8 |     21 |    6 |      5 |
| nodejs                     |   19 |     23 |   17 |      5 |
| expressjs                  |   15 |     26 |   15 |      5 |
| nextjs                     |  361 |    111 |   56 |      5 |
| mongodb                    |    7 |     24 |   22 |      5 |
| mysql                      |   17 |     29 |   21 |      5 |
| postgresql                 |    9 |     29 |   18 |      5 |
| sql                        |    0 |     20 |    6 |      5 |
| redis                      |   13 |     76 |   33 |      5 |
| docker                     |    0 |     20 |    6 |      5 |
| kubernetes                 |    0 |     20 |    5 |      5 |
| rest-apis                  |   12 |     27 |   18 |      5 |
| graphql                    |   10 |     25 |   18 |      5 |
| html                       |    0 |     17 |    9 |      5 |
| css                        |    0 |     17 |    9 |      5 |
| git-github                 |    6 |     28 |   10 |      5 |
| oop                        |    0 |     17 |   11 |      5 |
| dsa                        |    0 |     17 |    9 |      5 |
| aws                        |    6 |     92 |   40 |      5 |
| generative-ai              |    0 |     92 |   42 |      5 |
| ai-agents                  |    3 |     80 |   51 |      5 |
| llm                        |    0 |     82 |   36 |      5 |
| rag                        |    0 |     82 |   36 |      5 |
| langchain                  |    0 |    144 |   67 |      5 |
| system-design              |   15 |      3 |   35 |      5 |
| mern                       |   58 |     62 |   30 |      5 |
| mean                       |   12 |     94 |   42 |      5 |
| full-stack-web-development |    6 |     86 |   41 |      5 |

### Raw live verified sources

| Technology                 | Easy | Medium | Hard | Senior |
| -------------------------- | ---: | -----: | ---: | -----: |
| javascript                 |   24 |     37 |   15 |      5 |
| typescript                 |    6 |     24 |   16 |      5 |
| python                     |    6 |     71 |   31 |      5 |
| java                       |    6 |     71 |   31 |      5 |
| cpp                        |    6 |     71 |   31 |      5 |
| csharp                     |    0 |     20 |    6 |      5 |
| dotnet                     |    0 |     20 |    5 |      5 |
| angular                    |    6 |     29 |   15 |      5 |
| react                      |   21 |     39 |   16 |      5 |
| react-native               |    0 |     20 |    6 |      5 |
| nodejs                     |    6 |     23 |   17 |      5 |
| expressjs                  |    6 |     25 |   15 |      5 |
| nextjs                     |    6 |     71 |   31 |      5 |
| mongodb                    |    6 |     21 |   21 |      5 |
| mysql                      |    6 |     23 |   17 |      5 |
| postgresql                 |    6 |     22 |   18 |      5 |
| sql                        |    0 |     20 |    6 |      5 |
| redis                      |    6 |     73 |   32 |      5 |
| docker                     |    0 |     20 |    6 |      5 |
| kubernetes                 |    0 |     20 |    5 |      5 |
| rest-apis                  |    6 |     22 |   18 |      5 |
| graphql                    |    6 |     22 |   18 |      5 |
| html                       |    0 |     17 |    9 |      5 |
| css                        |    0 |     17 |    9 |      5 |
| git-github                 |    0 |     17 |    9 |      5 |
| oop                        |    0 |     16 |   10 |      5 |
| dsa                        |    0 |     17 |    9 |      5 |
| aws                        |    0 |     82 |   36 |      5 |
| generative-ai              |    0 |     83 |   42 |      5 |
| ai-agents                  |    0 |     71 |   36 |      5 |
| llm                        |    0 |     82 |   36 |      5 |
| rag                        |    0 |     82 |   36 |      5 |
| langchain                  |    0 |    144 |   67 |      5 |
| system-design              |    0 |      0 |   28 |      5 |
| mern                       |   21 |     37 |   18 |      5 |
| mean                       |    6 |     91 |   41 |      5 |
| full-stack-web-development |    6 |     85 |   41 |      5 |

### Raw live AI pool

| Technology                 | Easy | Medium | Hard | Senior |
| -------------------------- | ---: | -----: | ---: | -----: |
| javascript                 |    0 |      4 |    0 |      0 |
| typescript                 |    0 |      1 |    0 |      0 |
| python                     |    0 |      0 |    0 |      0 |
| java                       |    0 |      0 |    0 |      0 |
| cpp                        |    0 |      0 |    0 |      0 |
| csharp                     |    0 |      0 |    0 |      0 |
| dotnet                     |    0 |      0 |    0 |      0 |
| angular                    |    0 |      2 |    0 |      0 |
| react                      |    0 |      0 |    0 |      0 |
| react-native               |    0 |      0 |    0 |      0 |
| nodejs                     |    0 |      0 |    0 |      0 |
| expressjs                  |    0 |      0 |    0 |      0 |
| nextjs                     |    0 |      0 |    0 |      0 |
| mongodb                    |    1 |      3 |    1 |      0 |
| mysql                      |   11 |      6 |    4 |      0 |
| postgresql                 |    2 |      4 |    0 |      0 |
| sql                        |    0 |      0 |    0 |      0 |
| redis                      |    0 |      1 |    0 |      0 |
| docker                     |    0 |      0 |    0 |      0 |
| kubernetes                 |    0 |      0 |    0 |      0 |
| rest-apis                  |    2 |      3 |    0 |      0 |
| graphql                    |    0 |      1 |    0 |      0 |
| html                       |    0 |      0 |    0 |      0 |
| css                        |    0 |      0 |    0 |      0 |
| git-github                 |    6 |     11 |    1 |      0 |
| oop                        |    0 |      1 |    1 |      0 |
| dsa                        |    0 |      0 |    0 |      0 |
| aws                        |    6 |     10 |    4 |      0 |
| generative-ai              |    0 |      9 |    0 |      0 |
| ai-agents                  |    3 |      9 |   15 |      0 |
| llm                        |    0 |      0 |    0 |      0 |
| rag                        |    0 |      0 |    0 |      0 |
| langchain                  |    0 |      0 |    0 |      0 |
| system-design              |    2 |      3 |    2 |      0 |
| mern                       |    9 |     19 |   10 |      0 |
| mean                       |    1 |      3 |    1 |      0 |
| full-stack-web-development |    0 |      1 |    0 |      0 |

## Verified and AI content model

The existing InterviewQuestionBank collection is reused. Curated/verified_seed/prebuilt records retain provenance and ranking. Validated public practice-generation results use source/sourceType `ai_generated`, sourceMeta.verificationStatus `unverified`, generation timestamp, focus, expected difficulty and mode. Automatic quality gates permit reuse; their existing isApproved/qualityStatus fields mean quality eligibility, not human verification. UI/API verification labels come from provenance. Mongo atomic source-priority updates and unique topic/question identities continue to protect verified content from lower-trust overwrites.

Custom answers reuse the existing user-owned InterviewPrepSession model with kind `custom`, not the public bank. Optional per-question topicKey/topicType/source/sourceMeta/generatedAt fields are backward-compatible additions. Deep snapshots preserve code, answer sections, difficulty, category, tags, source and generation metadata; existing progress-version and idempotency-key conflict semantics remain intact. Reopening reads the original owner-scoped snapshot, never current catalog content. Optional fields do not require rewriting old sessions. New custom snapshot request keys also include answer-content identity so regenerating a rejected legacy answer cannot point at its old immutable snapshot.

## Generation contract and controlled coverage filling

`POST /api/interview-prep/generate` and saved-session `POST /api/interview-prep` preserve skill/topic aliases, query/focus, difficulty, category, comma-separated tags, source, and target/limit (bounded to 1–50). Filters are normalized before retrieval; verified content is selected first, validated reusable AI fills the next gap, and one bounded provider operation requests only the remaining count. Shipped seeds supplement partially imported verified data after applying all filters. Generated metadata, structured answers, topic, category, tags, content rubric and duplicates are checked before persistence/delivery; invalid metadata is not defaulted into acceptance. Tag matching retains existing any-tag semantics.

- Empty source or `database`: verified first and AI pool/fallback only for the gap.
- `seed`, `verified_seed`, `prebuilt`: selected verified source only; no AI fallback.
- `ai` / `ai_generated`: AI-origin records only, reusing eligible generated content before generating gaps.
- `scraped`: existing reviewed external-source eligibility only; no AI fallback.

Successful responses contain exactly the requested question count, stable questionId/contentVersion, per-card verificationStatus, aiGeneratedCount and sourceMix. Insufficient results return HTTP 503 with code `insufficient_results`, requestedCount, availableCount and a useful retry/filter message. Questions with another difficulty are never substituted. Generated valid records may remain reusable even when the batch cannot satisfy the requested quantity.

Coverage target defaults to 30 per canonical technology/difficulty; `INTERVIEW_QUESTION_COVERAGE_TARGET` allows 1–100. `auditInterviewCoverage.js` is read-only. The operator-only `fillInterviewQuestionCoverage.js --topic mern --difficulty easy --batch 5 --allow-ai` fills one bounded missing-coverage batch (maximum 10), excludes existing questions and stops. It must be deliberately invoked; it is not imported by startup or cron. The filler was not run against the live database. No bulk generation, schema migration or dependency installation was performed.

Difficulty validation combines required metadata with content-task checks (beginner definitions, applied/advanced work and senior design decisions) plus existing topic/answer quality scoring. This is a conservative deterministic screen, not a substitute for expert review; generated records remain unverified.

## Custom Q&A contract and privacy

`POST /api/interview-prep/ask-question` accepts the existing 12–500 character question and topic context. It searches eligible verified exact/canonical matches and bounded similarity candidates, then the shipped verified catalog, then the same owner’s private history. Otherwise it calls the shared provider adapter. Relevant verified reuse makes no provider call. A generated answer contains actual text, ordinary structured fields (direct answer, key points, explanation, working example, use case, mistakes, discussion tip), sourceType `ai_generated`, sourceLabel `AI-generated answer · Unverified`, verificationStatus `unverified`, generationStatus `generated`, generatedAt and private sessionId.

System-design requests additionally require scopeNote and fifteen systemDesign sections: problem definition, functional/nonfunctional requirements, high-level architecture, component responsibilities, database/API design, data flow, caching, scaling, load balancing, reliability, security, trade-offs and bottlenecks. Prompts require educational/public concepts and explicitly distinguish illustrative Netflix-like designs from unverified company internals. Angular renders these sections as escaped text, preserves multiline code examples and supports long mobile answers.

Provider unavailability returns HTTP 503 / `ai_unavailable` / generationStatus `provider_unavailable`; invalid structured output returns HTTP 503 / `invalid_ai_answer` / `invalid_response`. Explicit provider no-answer returns HTTP 422 / `no_answer`. Invalid input remains HTTP 400. Failures are not cached or persisted as successful answers. The frontend keeps the submitted question for retry and rejects stale incompatible generated sets, partial/incorrect counts and mismatched nested snapshots.

Private custom cache keys include an owner hash and question/topic hash, and the transport coordination identity also includes the owner hash. AIService shared prompt caching is disabled for this adapter. No credentials or user-specific context are placed in public catalog records by Custom Q&A. Existing route authentication, user rate limits, global quotas, distributed admission, cancellation checks and private reads/progress writes are preserved.

Private history is retained until user deletion (the existing retention policy, now explicit in the UI). New authenticated `DELETE /api/interview-prep/sessions/:id` checks ownership, evicts the owner’s custom cache entry and removes only that session. The UI removes displayed retained data after acknowledgement. Ownership/deletion is verified only with task-owned local fixture documents; no live user session was deleted.

## Provider orchestration, cache and indexes

The adapter now allows three total provider attempts with zero adapter-level retries, bounded to the existing 6,200ms provider/coordinator budget and 6,500ms service deadline. Existing AIProviderManager chooses enabled providers and fallback adapters within that single budget; no recursive retry system was introduced. Maximum output is explicitly bounded to 8,000 tokens. Request routes cap question/focus lengths and filter input sizes. Schema/content failures are isolated and public errors omit provider details. User text is explicitly untrusted subject matter in prompts; no secrets or internal configuration are supplied to generation prompts.

Full-filter library/search caches retain topic, difficulty, category, tags, source, page, limit and lookup mode isolation with Redis revision invalidation. Private Custom Q&A uses a new versioned owner-scoped namespace to avoid replaying old failure payloads. The live audit confirmed the stable pagination index; All Questions now hints it for deterministic row/count plans. Existing topic/difficulty/category/source, stable pagination, canonical, token and session owner/request indexes are reused; no production index build was attempted. Runtime configuration check found Gemini, OpenAI, Groq and Anthropic key presence; xAI absent. Redis read-only connectivity/ping succeeded. See [complete-ai-runtime.json](complete-ai-runtime.json). No secret values were recorded.

## Validation and browser evidence

Validation results below distinguish final passes from earlier failed attempts. Provider tests are deterministic fixtures, including real shared-manager fallback control flow. Live provider output quality/latency was not tested and is not claimed. Local MongoDB regression fixtures are distinct from the live read-only coverage audit.

| Check                                                | Final result                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Broad Interview Prep + shared-provider backend suite | 118 passed, 0 failed, 0 skipped; local MongoDB and mocked providers. [Exact output](complete-ai-backend.tap).                                                                                                                                                                   |
| Final private-session/API integration checks         | 11 passed. [Exact output](complete-ai-final-integration.tap).                                                                                                                                                                                                                   |
| Post-cleanup AI/filter/performance regressions       | 30 passed, including rejected legacy-answer snapshot replacement. [Exact output](complete-ai-post-cleanup.tap).                                                                                                                                                                 |
| Full frontend suite                                  | 697 tests / 118 files passed using opt-in two-worker Vitest configuration; original assertions and timeouts retained.                                                                                                                                                           |
| Final focused frontend suite                         | 39 tests / 3 files passed after final UI edits and cleanup. [Exact output](../../../frontend/verification/interview-prep/complete-ai/final-frontend-tests.txt).                                                                                                                 |
| Application TypeScript compilation                   | Passed with --noEmit.                                                                                                                                                                                                                                                           |
| Production build                                     | Passed again after cleanup; [final output](../../../frontend/verification/interview-prep/complete-ai/final-build.txt). Initial bundle 4.01 MB (14.71 kB over warning budget), jobs SCSS 54.35 kB and public-portfolio SCSS 49.97 kB exceed warning budgets. No budgets changed. |
| Playwright final production bundle                   | Seven fixture journeys passed, twelve final screenshots; explicit light/dark/system theme assertions and four viewport sizes.                                                                                                                                                   |
| Runtime configuration/read-only integrations         | Live MongoDB coverage audit and Redis ping succeeded; provider-key presence checked without values. No live AI generation.                                                                                                                                                      |

Initial attempts encountered sandbox socket restrictions, C-drive exhaustion, optional tool-instrumentation socket errors and timing contention. Task-owned temporary storage was moved to D. A repeatable MongoDB plan-selection timeout was fixed by explicitly selecting the already-deployed `topic_stable_page` index for All Questions rows and counts, preserving predicates before pagination. The default full frontend run passed 696/697 tests with a Recommendations timeout; the opt-in two-worker rerun passed all 697 with unchanged timeouts. These earlier failures were not counted as passes.

Browser evidence: [results and captured request/response fixtures](../../../frontend/verification/interview-prep/complete-ai/results.json), [desktop light](../../../frontend/verification/interview-prep/complete-ai/desktop-light.png), [mobile dark](../../../frontend/verification/interview-prep/complete-ai/mobile-dark.png). The output directory retains all twelve device/theme screenshots. Final screenshots were visually inspected; the technology label no longer splits and the Custom Q&A panel no longer stretches internal spacing.

See [complete-ai-validation.json](complete-ai-validation.json) for final check metadata. No browser fixture results are represented as live-provider or live-account results.

## Exact file inventory and cleanup

See [complete-ai-files.json](complete-ai-files.json) for exact task-owned changed/added paths and evidence. No source file was moved or deleted. Pre-existing authentication screenshots and concurrent authentication source/report changes were preserved and excluded from the task inventory.

Only verified task-owned temporary verification files are removed, one exact file at a time, after their relevant results are retained. No recursive directory deletion, Git cleanup, reset, stash or unrelated file deletion is used. The retained cleanup manifest records exact paths: [complete-ai-cleanup.json](complete-ai-cleanup.json).

## Remaining limits

- Live provider calls were deliberately not performed; configured key presence and deterministic provider orchestration tests are not a live generation claim.
- Existing catalog quality and historical source attribution were audited, not silently repaired or reclassified. No Easy curated questions were invented or relabeled.
- Old snapshots missing technology/provenance stay intact; newly saved sessions retain these fields.
- Automated difficulty and relevance checks cannot establish factual correctness or replace human review.
- The one total provider deadline can leave little fallback time if an adapter consumes its entire budget; existing shared timeout policy was retained.

Finalization: all 30 changed/added source files were formatted in write mode and passed the same formatting check. All 21 JavaScript files passed node --check. Application TypeScript, unstaged/staged Git whitespace validation passed; the index remains empty. No source file was moved or deleted. The task-owned MongoDB process is stopped, and all inventoried task temporary-file roots are empty after the final checks; 2,412 verified temporary files were removed; exact deleted temporary paths are in the cleanup manifest.

During a process diagnostic, a truncated credential from an unrelated process appeared in tool output. It was not repeated or included in retained task artifacts; subsequent diagnostics avoided process command-line contents.
