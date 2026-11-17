# Custom Q&A answer coverage

## Audit and root cause
See architecture-before.md (written before implementation). Existing checks covered response shape, topic relevance, trust and system-design fields, but not individual user requirements. Cache/private reuse bypassed completeness checks. Explanation normalization collapsed line breaks.

## Final data flow
Selected technology and question -> generic intent/requirements and verified nonsecret project context -> cache -> verified database exact/similar -> canonical seed -> owned private history -> existing shared AI generation -> structural checks -> separate semantic evaluation for complex requests -> at most one repair and re-evaluation -> private unverified persistence.

The generic plan identifies the subject, objective, clauses, depth and relevant requirements. Local use includes installation, startup, verification, CLI/API interaction, integration, configuration and troubleshooting. Programming, multi-part, architecture, workflow, comparison and diagnostic questions receive separate evaluation. Simple concepts use lightweight deterministic subject/substance checks without another AI call. No technology-specific production branches were introduced.

The evaluator checks every requirement and user clause, requiring reasons and literal evidence from the answer. Generator self-certification, headings and keywords cannot establish complex coverage. Evaluation is a separate prompt/call using existing provider ordering; it can use the same provider/model. It is not an independent external factual oracle.

Generation, evaluation, legacy revalidation and repair share the existing four actual-call maximum, total 20-second policy, persistence reserve, cancellation, admission and circuits. Stage caps deduct actual usage without losing reserved evaluation slots. Two generation rounds are the maximum, not a guarantee both fit. An incomplete answer returns an honest failure and is not saved.

Versioned quality receipts in existing Mixed sourceMeta bind request/context and answer content. Cache is versioned. Incomplete/stale hits are rejected. At most one suitable legacy candidate receives evaluation within the same budget. Historical private snapshots and in-memory canonical seeds are not overwritten; historical viewing shows a pre-coverage warning. Public verified catalog/private ownership/source labels remain intact.

Project context reads package declarations, matching source filenames, module syntax and environment variable NAMES only. No .env values are read. Declarations are not proof of installation/service state. The endpoint supplies no client OS/conversation context; guidance must label general OS alternatives and not claim Windows/WSL status or existing integrations.

The safe Angular renderer displays headings, lists, fenced commands/code and expected output with preserved whitespace and mobile scrolling. It uses interpolation, not raw HTML. Existing structured/system-design fields remain available.

## Exact inventory and scope
See task-source-files.json for all 20 source/test/script paths, including the original and externally relocated frontend paths. Evidence files and active operational logs are listed in artifacts.json. No files were moved/deleted by this task. No API routes, schemas, dependencies, commits, pushes or deployments changed. Initial branch fix/bug-01 was clean. Concurrent external staging and frontend folder reorganization were preserved; tests describe the working tree, not the intermediate staged snapshot.

## Verification
- Dedicated coverage suite: 22 passed. All ten requested intents, programming, incomplete Redis regression, evidence, repair/failure, cache/version/context/content binding and immutable private reuse are covered.
- Full frontend: 706 tests / 119 files passed before the concurrent folder restructuring (frontend-final-tests.txt). The full suite was not rerun after those external moves.
- Production build passed before the external moves (build.txt); initial bundle about 4.02 MB exceeds 4 MB, and public portfolio/jobs styles exceed 48 kB budgets. The final post-move build FAILED (build-final.txt): NG2008 at frontend/src/app/features/admin/pages/activity-logs/admin-activity-logs.component.ts:71; stylesheet ../../../pages/activity-logs/activity-logs.component.scss no longer exists at that relative path. This is outside Custom Q&A; it was preserved without unrelated edits. The current full working-tree build is therefore not clean.
- Desktop/mobile browser fixtures passed (browser-fixtures.json and retained PNGs): selected technology/question, error/retry, formatting, saved-session reopening, mobile overflow. Explicitly synthetic HTTP responses; no live providers or DB writes.
- TypeScript passed initially and again after the external moves settled (typescript-recheck.txt, exit 0). An intermediate check caught files disappearing during those moves (typescript-final.txt); no unrelated import edits were made by this task.
- Broad backend regression: 159 passed, 3 MongoDB integration suites skipped, 0 failed (all-backend-final-tests.txt). The later programming-intent regression is included in the separate 22-pass coverage suite. Compatibility suite: 3 passed. All 17 final checks passed: explicit-file Prettier write/check, backend/script syntax, working-tree and staged whitespace validation (final-checks.json). Prettier was run in write mode and then check mode at both original and relocated frontend paths. The failed post-restructuring build is recorded separately in build-final.txt; it is not counted as a passing check.

## Limits
No live provider generation/evaluation or live MongoDB persistence was verified for this change. Mocks establish boundaries and orchestration, not future answer factual correctness. The semantic evaluator can misjudge coverage; simple-concept checks are intentionally lightweight. Real provider credential, quota, billing, timeout or network problems can still return 503. Evaluation adds latency within the unchanged deadline. This report does not claim every possible bug is fixed.

## Local runtime and finalization
The previously authorized normal backend restart was applied: port 5000, PID 8336, root HTTP 200 verified over IPv4 (runtime.json and runtime-check.json). This verifies API startup, not provider availability or answer quality. No disposable task-owned temporary files were identified. Reusable verification scripts, regression fixtures, diagnostic runs and final screenshots were retained. No task-owned or unrelated files were deleted.

## Remaining integration issue
Correct the moved admin activity-log stylesheet reference in the separate restructuring task, then repeat the full frontend build/tests. No completion claim is made for that unrelated work. Real AI provider availability and live database persistence also remain unverified. Earlier failed diagnostic runs are retained as verification evidence; the backend syntax/timing failures in those runs were resolved by the final passing regression and syntax checks.
