# DevInsight AI — Skill Gap Backend Finalization

Date: 2026-10-12

STATUS: VERIFIED

The approved evidence classifications, required-skill coverage, categorical
confidence, deterministic AI boundary, versioned results and source-aware caching
are implemented. Focused, complete backend and MongoDB-dependent integration tests
passed with no skipped checks. Backend only; no frontend implementation was started.

## Implemented and files changed

- `src/controllers/skillgapcontroller.js`: canonical inputs, authoritative evidence
  calculation before AI, response compatibility and revision-aware coalescing/cache.
- `src/services/skillGapRequirements.js`: versioned existing requirements, explicit
  aliases, classification and equal fallback weights.
- `src/services/skillGapEvidenceService.js`: pure classification, credit mathematics,
  confidence, bounded references, timestamps, warnings and production source adapter.
- `src/services/skillGapCompatibilityService.js`: existing API skill groups and
  narrative context projected from the authoritative evidence result.
- `src/services/skillGapScoringService.js`: explicitly retained legacy calculations;
  `calculateLegacy` names the compatibility entry point.
- `src/prompts/skillGapPrompt.js`: explains approved statuses without promoting claims
  or changing facts.
- `src/tests/skillGapEvidence.test.js`: status, formula, requirements, source,
  confidence, freshness, bounds and historical compatibility fixtures.
- `src/tests/skillGapMongo.integration.test.js`: real database selection, ownership,
  reanalysis, cache/history and concurrent-source-change verification.
- `src/tests/skillGapScoring.test.js`: historical formula/parity tests retained as
  legacy behavior tests; new coverage is not forced to match the old composite.
- `src/tests/skillgapHardening.test.js`: new response semantics, null coverage,
  adversarial AI and source invalidation.
- `src/tests/skillgapPerformance.test.js`: per-caller source validation with shared
  calculation/AI/persistence for matching snapshots.
- `SKILL_GAP_BACKEND_REPORT.md`: this report.

All implementation is CommonJS. GitHub/Resume analyzers, canonical context service,
central scoring utilities/registry, schemas, frontend, themes and privileged modules
are unchanged. Existing staged changes were preserved; no Git commit or migration
was performed.

## Exact evidence model

The pure engine accepts trusted, artifact-referenced observations. Its production
adapter derives observations only from validated existing analyzer/profile outputs;
it never accepts evidence/status/score overrides from request bodies or AI.

| Status | Exact condition |
| --- | --- |
| DEMONSTRATED | Positive technical IMPLEMENTATION observation, explicitly inspected and meaningful, with an artifact reference, from GitHub or an approved integration; no recorded technical conflict |
| PARTIAL | Positive relevant METADATA observation; or demonstrated implementation with an explicit conflicting technical observation |
| CLAIMED_ONLY | Positive claims only, including resume/profile statements and unverified integration summaries |
| NOT_EVIDENCED | Relevant analyzed sources are available but establish no positive observation for the skill |
| UNKNOWN | No relevant analyzed source establishes an assessment for the skill |

Strong evidence takes precedence over weaker claims/metadata. Independent weak
evidence stays PARTIAL; it never promotes practical proficiency to DEMONSTRATED.
Absence from GitHub never creates a contradiction with a resume claim. Only an
explicit technical conflict produces `conflicting_positive_evidence` and a
conservative PARTIAL classification. Unverified claims cannot create such a conflict.

Required/optional classification is separate from status. A demonstrated optional
skill remains optional and contributes no coverage credit to the denominator.

### Current production evidence capability

The locked GitHub analyzer exposes languages, repository metadata and technology
summaries, but no meaningful inspected implementation findings. Therefore the
production adapter intentionally never emits IMPLEMENTATION observations. No
developer is fabricated as independently proficient.

Exact recognized repository topics and language signals support PARTIAL. Recorded
Dockerfile language is relevant Docker configuration metadata, supporting PARTIAL,
not practical demonstration. Repository names/descriptions and unanchored inferred
technology summaries are ignored. An arbitrary `implementationEvidence` property
on an analyzer payload is ignored rather than treated as newly verified code.

The active owned resume's recorded skill names support CLAIMED_ONLY. Canonical
profile and existing portfolio skill statements remain claims. Integration skill
summaries have no artifact-level provenance, so they also remain claims. ATS,
stars, repository counts, Jira/Slack activity, sprint completion and job demand do
not directly contribute to authoritative coverage.

If a trusted technical integration supplies genuine inspected, meaningful artifact
observations, the pure engine can credit those observations. The current production
adapter supplies no such findings. Without GitHub/Resume data, categorical confidence
is still INSUFFICIENT; technical evidence credit and source completeness remain
separate concepts.

## Existing career requirements

`skill-gap-requirements-v1` migrates the existing Skill Gap stack hints,
experience-level hints, universal defaults and stack-category filter. It adds no
new career requirement. Existing expectations are REQUIRED; there were no explicit
optional matrix entries or per-skill business weights to replace. Weight defaults
to one. Recognized observed skills outside the required matrix are OPTIONAL and
do not become new career requirements.

The explicit dictionary preserves Java/JavaScript, React/React Native, C#/.NET,
Shell/CI/CD, HCL/Terraform and Ruby/Ruby on Rails as distinct concepts. Actual
equivalent aliases such as React.js/React, reactjs/React and postgres/PostgreSQL
deduplicate. General alias normalization does not infer CI/CD from Shell.

The existing required entry `Scalability Patterns` was previously dropped by the
shared detector. It is now preserved in the Skill Gap-local dictionary. All four
stacks and seven experience levels resolve with no missing required entries.
An absent/unrecognized stack or level, unrecognized matrix entry, undefined
classification, invalid weight or contradictory equivalent requirement entries
produce exact warning codes and unavailable coverage. No default career context
is fabricated to avoid that result.

## Final coverage formula and manual examples

```
Coverage = 100 × sum(requiredSkillWeight × evidenceCredit)
                 / sum(requiredSkillWeight)

DEMONSTRATED = 1
PARTIAL = 0.5
CLAIMED_ONLY = 0
NOT_EVIDENCED = 0
```

Round once to an integer and clamp to 0..100 using Stage 2 utilities. Optional
skills are excluded completely. The entire matrix is scored before any prompt or
presentation cap. Zero is a real coverage result; unavailable coverage is null.
UNKNOWN is never silently assigned zero credit.

Three manually verified, equal-weight, two-required-skill fixtures:

| Required skill statuses | Calculation | Coverage |
| --- | --- | --- |
| Two CLAIMED_ONLY skills | 100 × (0 + 0) / 2 | 0% |
| Two PARTIAL skills | 100 × (0.5 + 0.5) / 2 | 50% |
| Two DEMONSTRATED skills | 100 × (1 + 1) / 2 | 100% |

A weighted fixture also verifies a required demonstrated skill of weight two and
a required partial skill of weight one: 100 × (2 + .5) / 3 = 83.333..., rounded to
83. A demonstrated OPTIONAL skill of weight 50 changes neither numerator nor
denominator. These are mathematical test fixtures, not newly invented role matrices.

Unavailable requirements yield `career_requirements_unavailable`. No relevant
analyzed evidence yields `relevant_evidence_unavailable`. Required UNKNOWN evidence
would yield `required_evidence_unknown`. A partially available source set can still
establish credit, with source limitations and completeness reported separately.
Unavailable optional integrations cannot reduce coverage. Claims alone cannot
increase technical coverage.

## Exact categorical confidence model

Confidence describes the reliability of the evidence assessment, not a statistical
probability of practical proficiency. No new confidence percentage is invented.

Each skill is classified in this order:

1. INSUFFICIENT: neither GitHub nor Resume is available, or the skill is UNKNOWN or
   NOT_EVIDENCED. This indicates insufficient skill evidence, not poor proficiency.
2. LOW: any explicit conflict, missing evidence/source timestamp, known stale source
   or observation, incomplete core sources, or CLAIMED_ONLY status.
3. HIGH: DEMONSTRATED with at least two distinct technical artifact origins, both
   core sources explicitly complete, recorded timestamps, and no known stale/conflict
   flag.
4. MEDIUM: DEMONSTRATED with one technical origin under the same complete/recorded/
   non-stale conditions; or PARTIAL with at least two technical origins under those
   conditions. PARTIAL with one origin is LOW.

Overall confidence is the least confident REQUIRED skill assessment; no requirements
or no core evidence yields INSUFFICIENT. Optional skills do not depress this aggregate.

Observations are deduplicated by origin, kind, artifact and conflict finding. Distinct
paths/copies from the same repository or document still have one origin for source
independence. Resume claims do not become independent technical implementation proof.
Duplicate observations do not increase coverage or confidence.

Timestamp presence is not a claim that old evidence has become recent. Actual dates
are retained, STALE flags are reported, and `freshness_age_not_calibrated` warns that
no arbitrary elapsed-time freshness cutoff is applied. A stale demonstrated artifact
remains DEMONSTRATED with unchanged credit; confidence is LOW. Missing timestamps
are explicit limitations, not fabricated calculation dates on the source.

Current GitHub repository-signal sampling is PARTIAL source completeness, so complete
source confidence is not fabricated from sampled metadata.

## Versioned result and bounded provenance

New authoritative rule: `skill-evidence-coverage-v1`.
Requirement matrix: `skill-gap-requirements-v1`.
Feature cache namespace: `v8-skill-evidence-coverage`.

The response includes coverage/unavailability reason, all required/optional skills,
all five status groups, category breakdown, per-skill and overall categorical
confidence, completeness, source references/freshness, bounded warning codes,
ruleVersion, requirementMatrixVersion and calculatedAt. Calculation timestamps are
metadata, not score inputs; changing only calculatedAt does not change facts/scores.

Stage 2 aggregate provenance carries only projected source type/ID and a recorded
upstream ruleVersion where present, plus finite scalar inputs/facts. Each skill has
at most twelve evidence projections; identifiers/artifact paths are bounded to 160
characters. Full input observations are deduplicated/classified before output caps,
so provenance bounds never truncate the scored required matrix. No raw repositories,
resume text or AI payload is duplicated into evidence.

## Legacy compatibility and history

The existing readiness composite is retained only as `legacyReadinessScore` with
`legacyScoring.readiness`. Its historical 57/23/10/10 weights and arithmetic order
are unchanged; 5,000 coverage and numeric-confidence parity fixtures remain green.
Its ruleVersion remains `skill-gap-coverage-v1`; it is not relabeled as new evidence
coverage. Missing optional factors retain the previous available-weight correction.

`deterministicConfidence` and existing per-skill `confidenceScore` fields remain for
compatibility and carry explicit `legacyConfidence`/`legacyConfidenceScore` and
`confidenceKind: legacyHeuristic`. They are not the new evidence-confidence categories.
Legacy factor fields in coverageBreakdown are enumerated as legacy; the authoritative
formula/numerator/denominator identify required-skill evidence coverage.

`yourSkills`, `missingSkills`, `provenSkills`, graph and roadmap remain present.
Current skill entries have explicit evidence status and null uncalibrated proficiency,
instead of invented proficiency percentages. `provenSkills` includes demonstrated
skills only. Required partial/claimed/not-evidenced/unknown skills remain proof gaps.
Claims do not complete graph prerequisites. `missing` is the coverage complement,
or null for unavailable coverage; it does not assert inability.

Historical v6/v7 cache rows and schemas are not migrated, relabeled or deleted.
New results use new cache keys and version fields. Database integration compares
an old v6 record before/after calculations and verifies it remains identical. New
calculations do not borrow another resume or overwrite another source revision.

## AI and cache validation

All authoritative evidence, classifications, requirements, coverage, categorical
confidence, timestamps and warnings are resolved before AI receives a serialized
bounded context. The shared prompt-builder string/name bug is avoided by the new
Skill Gap-local context adapter; shared prompt builders remain unchanged.

AI output is restricted to `analysisSummary` and `levelAssessment`; any additional
field rejects the narrative response. Existing quality/grounding validation remains.
Returned failure and thrown failure use deterministic narrative fallback while all
facts remain intact. Prompts explicitly forbid promotion of claims/metadata to
demonstrated skills. The legacy numeric AI skip threshold remains 70 for compatible
routing only, not as a new evidence-confidence probability. Timeout/retry behavior
remains seven seconds/zero retries.

Every caller validates canonical source revisions before a memory/Redis/Mongo cache
hit or in-flight coalescing. The fingerprint includes active GitHub/resume selection,
raw recorded resume skill evidence and versions/dates, GitHub languages/repositories/
signals/completeness, career stack/experience, profile claims, supporting evidence,
and both new rule/matrix versions. The module's own Skill Gap output is excluded to
avoid direct self-invalidation. Preview resolves its resume reference before sharing
work and excludes private profile/integration signals.

Stale/missing GitHub bypasses persisted result caches and is not persisted as a fresh
result. Source changes invalidate all cache tiers. Concurrent requests with matching
fingerprints share calculation, AI and writes. A request after reanalysis gets a new
fingerprint and cannot reuse an older in-flight snapshot. Memory hits still validate
sources and skip AI/recalculation/result-store access. Per-caller source reads are
intentional; focused performance bounds remain satisfied.

## Test results

- Focused Skill Gap plus canonical-context and scoring-foundation tests: 88/88 passed.
- Full backend regression (`npm test`): 302/302 passed; no failures or skips.
- Skill Gap Mongo integration: passed standalone and in the final complete suite.
  Real Mongo models/queries verify active/foreign/unanalyzed resume selection,
  same-record reanalysis, source/context invalidation, persisted cache reuse, history
  preservation and reanalysis during an in-flight request.
- Existing Support Mongo/Redis failure-recovery integration: passed in the full suite.
- Locked GitHub/Resume and Stage 1/2 regressions: passed in the full suite.
- Legacy parity: 5,000 complete-input readiness/confidence fixtures passed.
- Syntax checks passed for the controller, prompt, four Skill Gap services and both
  new test files. `git diff --check` passed.

The first standalone Mongo attempt was sandbox-blocked (`EACCES` to localhost:27017).
It was rerun successfully with approved local database access; the final full suite
also ran with that access. No critical database verification remains unrun.

## Remaining backend work and next step

Remaining backend work: None for the approved Skill Gap scope.

The lack of inspected implementation findings in current upstream analyzers is a
reported data capability limit, not fabricated verification or an unimplemented
classification rule. Adding code-inspection capability would be a separate analyzer
task; locked analyzer code was not changed.

Next: Skill Gap — Frontend. Frontend implementation has not begun.
