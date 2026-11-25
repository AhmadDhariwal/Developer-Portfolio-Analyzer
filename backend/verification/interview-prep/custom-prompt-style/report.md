# Custom prompt wording and mixed failure correction

The screenshot shows a real failure: Groq returned a response that was rejected; Gemini and OpenAI timed out; Anthropic returned a billing failure. The last billing failure incorrectly summarized the whole chain as a configuration problem.

The exact text “tell me the full flow of the rag like how tha rag works and what is its purpose” fails the generated-question opening-phrase guard. Custom Q&A accepts user-written requests, so that style rule belongs to generated public questions, not private user input. An internal custom-prompt context now propagates consistently through provider validation, storable-record approval and private-history validation. Schema completeness, unsafe-content, relevance, confidence, quality and ownership checks remain active. Generated public question validation is unchanged.

Mixed failure aggregation now preserves the fact that different providers failed for different reasons, instead of attributing the whole request to the last billing/configuration error. A single billing-only failure still retains its specific classification. No public API fields, database schema, dependencies or provider configuration were changed.

The exact RAG text was tested against the real local API using selected skill `rag`. Groq returned HTTP 200 in 6,978 ms; a repeated request reused the same private session. The first probe failed before HTTP during backend startup and did not invoke a provider. This report does not claim all external provider failures are eliminated.

Evidence: [live request/response](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-prompt-style/live.json) and [regression tests](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-prompt-style/final-tests.txt). All 76 final focused tests passed. The suite covers the exact wording, private approval, strict public-question rules, unsafe/empty responses, mixed errors, existing fallbacks, ownership and persistence. JavaScript syntax, explicit Prettier write/check and both Git whitespace checks pass. No frontend files changed in this correction; the existing staged UI work is preserved. No commit, push, deployment or destructive cleanup occurred.

Exact changed source files:

- [backend/src/services/interviewQuestionQualityService.js](D:/Developer-Portfolio-Analyzer/backend/src/services/interviewQuestionQualityService.js)
- [backend/src/services/interviewEnrichmentOrchestrator.js](D:/Developer-Portfolio-Analyzer/backend/src/services/interviewEnrichmentOrchestrator.js)
- [backend/src/services/interviewPrepService.js](D:/Developer-Portfolio-Analyzer/backend/src/services/interviewPrepService.js)
- [backend/src/services/providers/interviewAIProvider.js](D:/Developer-Portfolio-Analyzer/backend/src/services/providers/interviewAIProvider.js)
- [backend/src/services/aiProviderManager.js](D:/Developer-Portfolio-Analyzer/backend/src/services/aiProviderManager.js)
- [backend/src/tests/interviewCustomPromptStyle.test.js](D:/Developer-Portfolio-Analyzer/backend/src/tests/interviewCustomPromptStyle.test.js)

[Finalization and source hashes](D:/Developer-Portfolio-Analyzer/backend/verification/interview-prep/custom-prompt-style/finalization.json). No source files moved/deleted and no task-owned temporary scripts/log files were created; active operational logs are retained with the backend.
