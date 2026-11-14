# Recommendations backend finalization

## STATUS: VERIFIED

Implemented on `codex/recommendations-backend-finalization` from the latest fetched
`origin/task/ui`, commit `843dcacc3cae83a7bb1bd4984251920e7b100671`.
The starting `release1` working tree was clean and matched the integrated baseline.
No commit or push was made. Frontend, locked analyzers, canonical context resolver,
scoring foundations, Career Sprint and Courses implementation files are unchanged.

## EXISTING MODULE AUDIT

| Existing implementation                                                      | Required correction                                                                     |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Large controller containing orchestration, ranking, caches and AI validation | Extract cohesive services while preserving routes and hybrid behavior                   |
| Legacy missing-skills and score composites                                   | Use current compatible evidence; preserve null; do not call coverage readiness          |
| Active-profile cache aliases returned before context validation              | Resolve current owned sources before cache reuse                                        |
| Latest arbitrary Skill Gap snapshot                                          | Match identity, selected resume, stack, level, source revisions and rule version        |
| Legacy Recommendation records                                                | Add immutable versioned snapshots without deleting historical records                   |
| Client-driven Sprint tasks                                                   | Add an authenticated server-resolved, atomic Recommendations handoff                    |
| Existing frontend arrays and score fields                                    | Preserve field shapes and add evidence/action metadata; unsupported composites are null |

Reviewed the controller, prompt, model, routes, services, deterministic fallback,
AI integration, Redis/Mongo caches, frontend consumers, Sprint integration and tests.
Historical records remain readable and are explicitly distinguished from current results.

## FUNCTIONAL DEFECTS FOUND AND FIXED

- Removed stale cache aliases and selected-resume/analysis mismatches.
- Included current resume scoring, deterministic signals and complete cache-identity fields.
- Rejected changed canonical context with HTTP 409 instead of silently combining sources.
- Excluded incompatible, stale and legacy Skill Gap evidence from current coverage.
- Fixed async error propagation and repeated execution of Mongoose thenable queries.
- Removed invented gains, timelines and readiness composites; preserved unavailable numeric signals.
- Suppressed completed README/testing and current resume improvements.
- Constrained AI enrichment and retained deterministic actions on failure.
- Added durable resume-only snapshots, bounded history and private preview isolation.
- Added atomic, owned Sprint handoff and validation of source changes during generation.

## RECOMMENDATION GENERATION MODEL

CommonJS services separate deterministic evidence/ranking, generation/cache orchestration,
AI narrative validation, history and Sprint handoff. Utilities contain shared pure helpers.

Supported categories include skills, technical proof, repository improvements,
resume improvements and career/learning actions. Each action carries a stable semantic
ID, category, title, description, priority reason, bounded factual signals, source/freshness,
next step, target and navigation metadata with rule provenance.

PARTIAL, CLAIMED_ONLY, NOT_EVIDENCED and UNKNOWN produce distinct actions.
DEMONSTRATED skills are not outstanding work. UNKNOWN requests evidence review;
absence of evidence never establishes inability. Explicit repository false flags and
deterministic resume warnings support corrective actions; unknown values do not.

## EXACT PRIORITIZATION RULES

The approved ordering remains High = 3, Medium = 2, Low = 1, followed by a valid
numeric estimated-impact tie-break, then stable ID for reproducibility.
New evidence actions do not manufacture estimated impacts.

- Compatible requirement priorities use the existing snapshot/dictionary metadata.
- UNKNOWN or stale-source review actions are Low.
- Explicit missing README is High; explicit missing tests is Medium.
- Resume warnings use deterministic severity: high → High, low → Low, otherwise Medium.
- Supported profile follow-through is Medium; generic evidence/context review is Low.
- Semantic target IDs deduplicate overlapping actions. Current positive evidence suppresses completed work.

No locked weights or scoring rules were changed. Legacy aggregate score fields remain
present but null with availability/provenance metadata because no calibrated replacement
was approved. Skill Gap coverage is returned separately.

## EVIDENCE AND SOURCE INTEGRITY

The approved Stage 1 resolver remains authoritative. Sources are owned and scoped to
active GitHub identity, selected resume and its exact analysis, career stack and experience.
A changed selection cannot borrow another analysis. Resume-only and GitHub-only inputs work.

Current Skill Gap results require `skill-evidence-coverage-v1`, compatible source
identities/revisions and freshness. Null coverage stays null; genuine zero stays zero.
Source metadata is bounded and freshness is explicit. No raw resume text is exposed.
Temporary previews neither aggregate saved-profile signals nor persist profile snapshots.

## AI FALLBACK AND SAFEGUARDS

Passive reads do not call Recommendations AI. Explicit refresh may call the existing
AI service with a seven-second timeout and no retries. Deterministic facts, IDs, scores,
priorities, evidence and ordering cannot be overridden.

Existing narrative validation is retained. Accepted learning ideas are supplemental,
target-anchored and marked AI-generated. Unsupported factual weaknesses, URLs,
numbers, guarantees, hiring/salary predictions and timelines are rejected.
Provider failure or rejected output returns useful deterministic recommendations.

## CACHE / PERSISTENCE / INVALIDATION

Version: `v6-recommendations-evidence`; rule: `recommendations-evidence-v1`.
Signal hashes cover active identity, selected resume, analysis evidence/revisions,
compatible Skill Gap, stack, level and supporting profile signals.

Memory, Redis and Mongo fallback behavior is retained with current-context validation.
In-process requests share generation; waiters revalidate core source revisions.
The existing Redis token lease bounds optional AI concurrency; busy leases return
deterministic results. Persistence failures do not create a misleading profile memory hit.

The Recommendation model adds immutable versioned snapshots and a partial unique
owner/version/hash index. Legacy records are preserved. Resume-only persistence avoids
the shared AnalysisCache requirement for a nonempty GitHub username.

Deployment: from `backend`, run
`node src/scripts/migrateRecommendationSnapshotIndex.js`.
The migration only creates the required index and was tested twice for idempotence.

## CAREER SPRINT HANDOFF

The new Recommendations endpoint resolves the current action server-side and verifies
authentication, ownership, action ID and signal hash. An atomic conditional push prevents
duplicate task creation; five simultaneous requests produced exactly one task.
Repeated requests return already-added behavior. Stale actions return 409; foreign/missing
actions return 404. Sprint cache invalidation and existing task defaults are preserved.

No Career Sprint or Courses engine changes were needed. Navigation points to existing
Sprint and Courses routes; Courses uses supported skill discovery parameters.

## API RESPONSE CONTRACT

Existing generation/profile and saved-preview endpoints remain available.
Compatibility fields include projects, technologies, careerPaths,
structuredRecommendations, action arrays, roadmap and recommendationScores.
New metadata includes rich recommendations, sourceMetadata/sourceScores,
rule/version provenance and navigation actions. Unsupported composites are null.

- `GET /api/recommendations/history`: authenticated, bounded legacy/versioned summaries.
- `POST /api/recommendations/:id/career-sprint`: authenticated; body `{signalHash}`.
- Saved previews retain owner checks and bounded client-summary data without raw resume text.
- Temporary generation remains separate from saved-profile history.

## FILES CHANGED AND FOLDER STRUCTURE

Exact changed/added source paths:

- `backend/src/controllers/recommendationscontroller.js`
- `backend/src/models/recommendation.js`
- `backend/src/prompts/recommendationPrompt.js`
- `backend/src/routes/recommendations.routes.js`
- `backend/src/scripts/recommendationsReleaseVerify.js`
- `backend/src/tests/recommendationsHardening.test.js`
- `backend/src/tests/recommendationsPerfMeasure.js`
- `backend/src/tests/recommendationsPerformance.test.js`
- `backend/src/scripts/migrateRecommendationSnapshotIndex.js`
- `backend/src/services/recommendationEngineService.js`
- `backend/src/services/recommendationGenerationService.js`
- `backend/src/services/recommendationHandoffService.js`
- `backend/src/services/recommendationHistoryService.js`
- `backend/src/services/recommendationNarrativeService.js`
- `backend/src/services/recommendationService.js`
- `backend/src/tests/recommendationEngine.test.js`
- `backend/src/tests/recommendationGeneration.test.js`
- `backend/src/tests/recommendationsMongo.integration.test.js`
- `backend/src/utils/recommendationUtilities.js`

Retained documentation/evidence:

- `backend/RECOMMENDATIONS_BACKEND_REPORT.md`
- `backend/verification/recommendations/results.json`

No files moved. Controller responsibilities were extracted into the existing services
and utilities folders. Tests and migration remain in their established folders.

## FORMATTING / CLEANUP RESULTS

Prettier write and check modes passed all 19 changed JavaScript files.
Changed JavaScript syntax checks and Git whitespace validation passed.
Unused imports and abandoned prompt helpers were removed.

Task-owned files deleted after reference checks and retaining verification totals:

- `backend/src/scripts/finalizeRecommendations.tmp.cjs`
- `backend/verification/recommendations/full-tests.log`
- `backend/verification/recommendations/focused-tests.log`

No screenshots or traces were generated. No unrelated/untracked user work, fixtures,
historical records, source assets or licenses were deleted. Final documentation/evidence
also passes Prettier. No backend lint, typecheck or build script is configured.

The root `AGENTS.md` already contains the requested mandatory project finalization
instructions. These guide coding tasks; ordinary shell commands do not silently delete files.

## FOCUSED / FULL / MONGODB TESTS

- Focused Recommendations suites: **36 passed, zero failed or skipped**.
- Final full backend regression: **325 passed, zero failed or skipped**, 114.6 seconds.
- Real MongoDB/HTTP integration: **9 tests** included in these passing runs.

Full regression command:

```powershell
$testFiles = @(rg --files backend/src/tests -g '*.test.js' | Sort-Object)
node --test --test-concurrency=1 --test-reporter=spec @testFiles
```

Coverage includes source combinations, missing/stale/legacy evidence, null versus zero,
claimed versus demonstrated skills, ordering, deduplication, completed work, adversarial
AI/failure, cache invalidation, generation concurrency, ownership, previews/history and
atomic Sprint handoff. Real ephemeral HTTP routes use signed JWTs and Mongo persistence.
Fixture cleanup is scoped to random test owners. Migration/index behavior is tested.

Existing performance limits were preserved and passed; concurrent generation uses one AI
pipeline. Locked analyzer/context/scoring and existing Sprint/Courses regressions passed.
Final code was formatted and cleaned before the full regression. Subsequent cleanup
removed only unreferenced raw logs after retaining results; final syntax/format/whitespace
checks confirm the retained files.

## PRODUCT DECISIONS REQUIRING APPROVAL

None pending for the completed backend scope. Future calibrated readiness composites or
material ranking-weight changes require a product decision; none were invented here.

## REMAINING ISSUES

After log cleanup, 26 of 27 focused checks passed on the first run; the existing
50 ms memory-performance threshold observed 52.8 ms. The unchanged performance
suite immediately passed both tests when rerun independently. This timing check
is sensitive to local scheduling; no assertion was weakened. The full 325-test
regression and real database tests had already passed with zero skips.

No critical backend or required database behavior remains untested.
Paid live AI calls and live multi-host Redis deployment were not exercised; controlled
AI adversarial/failure and Redis lock/fallback paths were tested.
The external release-verification CLI was updated but not run against a separately
deployed server; real local HTTP/Mongo integration covers the backend contracts.
Frontend adoption of the new metadata and atomic handoff remains the next task.

## NEXT: Recommendations Frontend

Frontend development was not started.
