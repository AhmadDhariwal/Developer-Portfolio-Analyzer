# Skill Gap and Interview Prep UI review

Date: 2026-11-08, Asia/Karachi. Source/working branch: `fix/interview-prep`, HEAD at preflight `493c6697dad28f01c622c0261a2ce70c03b1a395`. PR/integration target: not applicable. Five existing frontend files were staged before review; that index is preserved. This review adds unstaged corrections and tests rather than replacing the staged implementation.

## Findings and changes

The original user-facing rename and compact insufficient-evidence styling were broadly correct. No backend scoring defect was established. Nine new template getters were unnecessary: assessed/unknown/total getters repeatedly traversed the same skills, including intermediate filtered arrays when falling back to the full skills list. Missing/stale source getters also repeated lookups. `OnPush` reduces when a view is checked but does not memoize getters during a check.

The overview now computes one `summary` in `ngOnChanges` only when the `analysis` input changes. A single traversal counts required skills; the assessed total is the required total minus unknowns. Explicit required lists take precedence, with the existing REQUIRED-tagged full-list fallback retained. Unrecognized statuses are not counted as assessed. Missing breakdowns display counts unavailable instead of inventing a `0 of 0` denominator. The component's existing `@Input` API and `OnPush` strategy remain intact. The parent already replaces analysis objects when consuming responses; this follows that existing immutable-input pattern. No visible latency speedup is claimed from an unmeasured UI benchmark. Input-lifecycle tests verify reuse across view checks/unrelated inputs and recomputation for replacement analyses.

Other verified presentation defects:

- Missing availability metadata previously fell through to advice that assumed both sources were available. It now has an explicit unknown-source state. Reference-level source availability/freshness is used first, followed by completeness references and existing legacy availability flags. Explicitly unavailable sources do not also receive stale-source instructions. Recorded timestamps are not converted into stale status by an invented age threshold.
- Sampled GitHub evidence is explained explicitly. Refreshing or adding manifests cannot be promised to make every requirement assessable. The Skill Gap evidence adapter reads repository languages/topics and selected-resume claims, not manifest contents or inspected implementation. Removed the misleading `package.json`/`Dockerfile` guidance and explained that additional evidence does not guarantee coverage/proficiency.
- The shared `partial_source_limitations` label incorrectly described incomplete sources only as unavailable. It now distinguishes incomplete or unavailable evidence and explains when coverage can be calculated.
- “Your generated questions and answers stay private” was too broad: the generation endpoint can reuse/persist approved questions in the shared bank without an owner-scoped generation identity. Corrected that description while retaining the private saved-session statement. No sharing, storage or authorization behavior changed.

The staged Question Generator/Generate Questions labels, internal `practice` tab/handlers, routes and APIs are preserved. Mock Interview naming is untouched. The existing 20 px insufficient-evidence CSS rule is more specific than the mobile numeric-score rule; no stylesheet refactor was necessary. No browser/layout or live-theme inspection is claimed by these component tests.

## Evidence trace and limits

Source inspection confirms:

1. `githubservice.js` limits repository signal sampling to two repositories and publishes `repositorySignals: sampled` and its signal limit.
2. `skillGapEvidenceService.js` maps that producer scope to PARTIAL completeness. Complete evidence requires both GitHub and resume core sources to be available and COMPLETE. Without positive evidence, incomplete sources produce UNKNOWN; they are not converted to NOT_EVIDENCED. Required UNKNOWN skills withhold coverage with `required_evidence_unknown`.
3. `developerContextService.js` resolves the active/default selected owned resume file, then its latest owned analysis. A foreign or unanalyzed selection cannot borrow another resume's history. The existing v9 controller/cache identity and Learning Hub consumer contracts were inspected/tested; their implementation was unchanged.
4. A new **synthetic** Full Stack / 0–1 years contract fixture has 20 required skills, 2 PARTIAL, 1 CLAIMED_ONLY, 17 UNKNOWN and null coverage. Its resume source references the selected fixture analysis; SQL remains a claim and Docker remains UNKNOWN. JSON serialization preserves that result. These numbers are not attributed to the user's live account.

No authenticated live profile, current personal resume or production v9 HTTP response was read in this review. The pasted summary establishes the implementation's claimed investigation, not fresh live-account diagnostics. This review verifies the source path and controlled contracts without inventing user-specific findings. Backend formulas, requirements, statuses, ownership/cache rules, historical records, AI/provider/environment configuration and downstream Learning Hub behavior remain unchanged.

## Validation

| Check                                                                                     | Result                                    | Evidence                                                                                |
| ----------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| Affected Angular specs                                                                    | PASS, 52/52 in 4 files, child exit 0      | [angular-verified.log](angular-verified.log), [commands/timings](verified-results.json) |
| Skill Gap evidence/scoring/Full Stack, selected-resume ownership and downstream contracts | PASS, 48/48, child exit 0                 | [backend-contracts.log](backend-contracts.log), [metadata](targeted-results.json)       |
| TypeScript application compilation                                                        | PASS, exit 0                              | [typescript-final.log](typescript-final.log), [metadata](verified-results.json)         |
| Production build                                                                          | PASS, exit 0; Angular generation 54.661 s | [production-build.log](production-build.log), [metadata](verified-results.json)         |
| Formatting, backend test syntax, whitespace and preserved index                           | Final checks retained                     | [finalization.json](finalization.json)                                                  |

The build retains the unrelated Landing Page component-style warning: 56.67 kB versus its 48 kB warning budget. It is outside this task and was not changed.

The first Angular test build failed because the new fixture omitted required `totalWeeks`; that fixture was corrected. The next launch compiled but ran zero tests because the filesystem sandbox rejected a Vitest temporary-cache rename with EPERM. Both failures are retained in [angular-targeted.log](angular-targeted.log) and [angular-targeted-final.log](angular-targeted-final.log). The successful launch used the same focused test selection outside that sandbox. No assertions or thresholds were weakened. Tests, TypeScript and build used the installed Angular CLI/TypeScript executables (the commands behind the repository's npm scripts); exact arguments, working directories, exit codes and timings are retained. No broad regression suite ran.

## Exact source inventory and finalization

Changed by this review, in addition to the previously staged work:

1. `frontend/src/app/pages/skill-gap/components/overview/skill-gap-overview.component.ts` — input-driven cached summary, one-pass counts and explicit source states.
2. `frontend/src/app/pages/skill-gap/components/overview/skill-gap-overview.component.html` — cached bindings and accurate counts/source guidance.
3. `frontend/src/app/pages/skill-gap/components/overview/skill-gap-overview.component.spec.ts` — new, 12 focused overview tests.
4. `frontend/src/app/pages/skill-gap/skill-gap-presentation.ts` — truthful partial-source explanation.
5. `frontend/src/app/pages/interview-prep/interview-prep.component.html` — accurate shared-bank/private-session description.
6. `frontend/src/app/pages/interview-prep/interview-prep.component.spec.ts` — generator labels, loading/disabled action and unchanged tab/API behavior.
7. `backend/src/tests/skillGapFullStackCoverage.test.js` — exact 0–1 years contract fixture.

The previously staged stylesheet and parent Skill Gap spec were not edited by this review. No source moved or deleted. All logs in this review directory are essential verification evidence; none were treated as disposable simply because a run failed. No task-owned temporary scripts/screenshots were created in the repository. The requested production bundle is retained as build output. Explicit-path formatter write/check, syntax and scoped Git checks are recorded in `finalization.json`; the complete task artifact inventory is [files.json](files.json). No credentials, dependency changes, production data operations, commits, pushes, merges or deployments.
