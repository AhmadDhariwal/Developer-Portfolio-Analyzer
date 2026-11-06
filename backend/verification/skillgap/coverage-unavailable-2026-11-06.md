# Skill Gap unavailable coverage investigation

Branch: `fix/learning-hub-p1`. Initial index and working tree were clean. PR target:
not applicable. No commits, pushes, deployments, external providers, browser
automation or production account/database reads were used.

## Proven cause and change

The Angular warning dictionary lacked `required_evidence_unknown`. Its fallback
replaced underscores with spaces, producing “required evidence unknown”. It now
renders exactly: “Coverage cannot be calculated because evidence for one or more
required skills is unknown.” The existing Unavailable state remains intact.

No backend implementation defect was established. The current producer and v9
policy explain the unavailable result without lost data:

1. `backend/src/services/skillGapRequirements.js` resolves Full Stack / 2-3 years
   into 20 deduplicated required skills, all with weight 1. The authoritative
   denominator exists; it is not inferred from counters.
2. `backend/src/services/githubservice.js` samples repository signals (limit 2)
   and explicitly publishes `dataAvailability.repositorySignals: 'sampled'`.
   This is a real producer limitation, not a serialization mismatch. Reporting
   complete signals would misrepresent the inspected source scope.
3. `backend/src/services/skillGapEvidenceService.js` maps sampled signals to
   PARTIAL source completeness. Its aggregate `complete` requires both GitHub
   and resume to be available and COMPLETE. A skill with no observation is
   UNKNOWN under incomplete sources, rather than NOT_EVIDENCED. Exact repository
   languages/topics supply metadata (PARTIAL); resume/profile statements remain
   CLAIMED_ONLY. Unanchored inferred summaries cannot substitute for evidence.
4. The same service intentionally returns null / required_evidence_unknown if
   any required skill is UNKNOWN. Source age/staleness changes warnings and
   confidence, not these evidence statuses or the denominator.
5. `backend/src/services/developerContextService.js` uses active career fields
   before legacy fields and resolves the selected owned resume file's latest
   analysis. An unanalyzed or foreign selection cannot borrow historical resume
   evidence. The controller uses these active fields, not stale request targets.
6. `backend/src/controllers/skillgapcontroller.js` includes requirements version,
   career target, selected resume identity/content, GitHub evidence and source
   completeness in the signal hash. Cache reads validate the current source
   revision. Evidence fields, null coverage and the reason are copied into the
   response. Historical analyses are preserved, not migrated or rewritten.
7. The Angular service requests backend validation for sequential loads; the
   component unwraps data/result envelopes and spreads the backend response.
   Rendering preserves null and backend classifications. The explanation
   dictionary was the confirmed defect.

## Reproduction values

These are synthetic fixtures, not values attributed to the user's live account.
The persisted API fixture uses React + TypeScript repository metadata, a selected
resume claiming React, and the real producer's sampled completeness contract.

| API field                                   | Before patch                 | After patch (verified fixture) |
| ------------------------------------------- | ---------------------------- | ------------------------------ |
| analysis version                            | v9-skill-evidence-governance | unchanged                      |
| rule version                                | skill-evidence-coverage-v1   | unchanged                      |
| coverage                                    | null                         | null                           |
| coverageUnavailableReason                   | required_evidence_unknown    | unchanged                      |
| requiredSkillCount / requiredWeight         | 20 / 20                      | unchanged                      |
| weightedCredit                              | 1                            | unchanged                      |
| partial / unknown                           | 2 / 18                       | unchanged                      |
| demonstrated / claimed-only / not-evidenced | 0 / 0 / 0                    | unchanged                      |

An additional pure fixture with SQL as the selected resume claim yields 2 PARTIAL,
1 CLAIMED_ONLY and 17 UNKNOWN, with the same weight 20, credit 1 and null coverage.
A distinct synthetic fixture claiming every requirement has no UNKNOWN entries:
2 PARTIAL + 18 CLAIMED_ONLY, credit 1 / weight 20, coverage 5. This verifies the
unchanged formula when evidence is assessable; it does not supply missing claims
to an actual profile. With no sources, all 20 skills are UNKNOWN and the reason is
relevant_evidence_unavailable. An invalid requirements target instead returns
career_requirements_unavailable and requiredWeight 0.

## Validation

- PASS: `node --test src/tests/skillGapFullStackCoverage.test.js src/tests/skillGapEvidence.test.js src/tests/skillGapConsumerContracts.test.js`
  from `backend`: 25 tests, 0 failures. Covers known/unknown/mixed evidence,
  required-only denominator, null, missing requirements, normalization, staleness,
  JSON round trips and existing consumer compatibility.
- PASS: `node --test --test-name-pattern='Skill Gap Mongo: active selection' src/tests/skillGapMongo.integration.test.js`
  from `backend`: 1 selected test, 0 failures. Uses disposable local Mongo and
  mocked providers. Verifies the Full Stack response, persisted selected resume,
  cache reload, force refresh, resume/profile changes, concurrent invalidation,
  history preservation and Learning Hub evidence-informed targets. Initial
  sandbox run failed before application assertions (Mongo startup); retry outside
  the sandbox passed. A local startup probe confirmed the sandbox listener could
  start but its client did not connect within readiness. Its task-owned directory
  `backend/verification/skillgap/devinsight-real-integrations-gy8ixA` was removed by
  fixture teardown; absence was verified. No production database was involved.
- PASS: `node frontend/node_modules/typescript/bin/tsc --noEmit -p frontend/tsconfig.app.json`.
- PASS: `node --check` for both changed backend test files.
- PASS: explicit-path Prettier write/check for both Angular files and both backend
  test files (backend: printWidth 100, trailingComma none). No repository-wide
  formatting or source cleanup was performed.
- PASS: `npm test -- --watch=false --include=src/app/pages/skill-gap/skill-gap.component.spec.ts --include=src/app/shared/services/skill-gap.service.spec.ts`
  from `frontend`: 30 tests in 2 files. Covers exact explanation rendering after
  envelope unwrapping and refresh, Unavailable/no progress bar, known coverage,
  stale timestamps, refresh failure, cancelled late profile responses, active
  resume separation and downstream cache invalidation. Initial sandbox execution
  compiled successfully but failed before tests because Vitest's temporary cache
  rename returned EPERM. Only these two failed spec files were retried outside
  the sandbox and passed.
- PASS: `npm run build` from `frontend`. Existing unrelated warning:
  `landing-page.component.scss` is 56.67 kB against a 48 kB warning budget.
- PASS: final explicit-path formatting checks and `git diff --check` /
  `git diff --cached --check`. No staged changes, moved/deleted source files,
  abandoned scripts or task-owned obsolete repository artifacts remain.

No authentication/JWT implementation was changed; broader JWT, stress,
performance and unrelated suites were not run. Only failed verification commands
were retried. Existing historical artifacts and user work were preserved.

## Exact file inventory

- Modified: `frontend/src/app/pages/skill-gap/skill-gap-presentation.ts`
- Modified: `frontend/src/app/pages/skill-gap/skill-gap.component.spec.ts`
- Modified: `backend/src/tests/skillGapMongo.integration.test.js`
- Added: `backend/src/tests/skillGapFullStackCoverage.test.js`
- Added: `backend/verification/skillgap/coverage-unavailable-2026-11-06.md`
- Moved/deleted source or historical files: none.

Only the warning mapping changes application behavior. Formulas, statuses,
readiness, version constants, APIs and cross-module implementations are unchanged.
The user's real selected resume and persisted evidence remain uninspected by
design; findings establish the reproducible policy path, not live account facts.
