# Deterministic scoring foundation (Stage 2)

These CommonJS modules depend only on other scoring modules. They do not read or
write databases, invoke AI, resolve developer identity, or manage feature caches.
Callers resolve identity with `developerContextService` before providing inputs.

## Result contract

```js
{
  score: 80, // 0..100, or null when no quality signal is available
  breakdown: {
    codeQuality: { value: 80, weight: 1, contribution: 80, available: true }
  },
  warnings: [], // bounded deterministic warning codes
  evidence: {
    sources: [{ type: 'github-user', id: 'developer' }],
    inputs: { codeQuality: 80 },
    facts: { repoCount: 6 }
  },
  ruleVersion: 'github-health-score-v1',
  calculatedAt: '2026-10-08T00:00:00.000Z'
}
```

`calculatedAt` is calculation metadata, not an input to any score. Supply it in
engine options for reproducible full-result tests; otherwise it is generated at
calculation time. Numerical results and evidence do not depend on wall-clock time.
Recency extraction remains in the existing feature modules.

`numeric()` maps unavailable/invalid values to null and retains measured zero.
Optional null signals are excluded from averages and normalized denominators;
available weights retain their original relative proportions. Engines use the
original multiplication/addition order when all inputs are available, preserving
the existing complete-input formulas and rounding. No engine assigns new business
weights. The general weighted helper requires explicit weights and unique signal
IDs; repeated IDs count once (first occurrence), with a warning. Distinct signals
with equal numerical values remain distinct. Percentage bounds and rounding are
explicit; division by zero returns null unless a caller supplies a fallback.

## Rules and migration boundary

| Engine | Version | Centralized calculation |
| --- | --- | --- |
| GitHub health | `github-health-score-v1` | Existing 24/17/18/13/14/14 final aggregate |
| Resume overall | `resume-overall-score-v1` | Existing 18/12/12/16/12/12/10/8 final aggregate |
| Portfolio | `portfolio-score-v1` | Existing four stack-dependent weights; available resume/project component averages |
| Sprint progress | `sprint-progress-v1` | Completed task points / total task points × 100 |

The portfolio engine intentionally removes AI score blending. AI is allowed to
provide the existing narrative summary, but the controller allow-lists that field
and obtains every numerical field and scoring metadata from the deterministic
service. Disconnected integrations are unavailable, rather than a quality zero.
Confidence checks retain their existing policy. Compatibility normalization uses
explicit numeric presence so a recorded score of zero is not replaced by another
score/default.

Sprint progress retains the legacy absent/zero-point fallback of one point. Tasks
with a repeated `_id` count once; tasks without an ID remain distinct. Invalid
negative point values are ignored with a warning. Its legacy numeric adapter
returns zero for an empty sprint, while the shared contract reports null.

GitHub repository/component extraction, Resume parsing/component rules, Skill Gap
coverage/confidence, Simulator impacts/confidence, Job ranking, sprint XP/streaks/
productivity, Weekly Report composites, Dashboard composites, and the placeholder
Developer Score are intentionally not migrated. Shared integer clamps are used
in existing developer-side consumers; Simulator uses shared clamps and rounding.
These primitive integrations do not claim a new version for an unmigrated formula.
Recruiter/Admin/Super Admin engines and all frontend files are untouched.

## Evidence and historical compatibility

Evidence allows only flat finite numbers, booleans and null summary/input values,
plus projected source `type`, `id`, and an optional *recorded* source `ruleVersion`.
There are at most 12 source references and 32 entries each for inputs and facts.
Identifiers are limited to 160 characters and keys to 64. Warnings/breakdown are
also bounded. Full GitHub payloads, repository lists, resume text/contact details,
nested objects, and AI responses are excluded. A resume hash is a source reference,
not a copy of the resume. Domain evidence is normally well below 2 KB.

Newly computed GitHub/Resume results carry the result in `githubSignals.scoring`
and `resumeSignals.scoring`, respectively, using existing schema containers.
New portfolio responses carry an additive `scoring` result. No schema fields,
historical records, analysis versions, or old cache entries are rewritten. Old
results without rule metadata remain unversioned; a cache read does not stamp a
new version/date. Source versions are carried only when explicitly recorded.
`getEngine(ruleVersion)` performs exact lookup; future implementations must be
registered alongside earlier versions, without aliasing unknown historical rules
to the newest rule. Sprint's numeric adapters do not relabel persisted progress.

## Deferred product decisions

- A deterministic experience-level calibration is not defined for portfolio
  scoring; the former AI calibration is not replaced with guessed thresholds.
- The placeholder Developer Score weights/formula are not an approved policy.
- Feature-specific treatment of unavailable signals, positive-only Simulator
  baseline averages, and Weekly Report/Dashboard composite weights must be settled
  at the dedicated feature stages before migrating those formulas.
- Job ranking currently puts skill gaps into the candidate skill list and uses
  heuristic default scores; whether these should count as demonstrated skills is
  a product/evidence decision, not a Stage 2 weight change.

Existing feature cache freshness and historic AI-influenced portfolio results are
retained for later feature stages; they are not relabeled as newly calculated
deterministic results.

## Verification

The pre-change baseline passed 220/220 backend tests and 45/45 frontend tests.
The final complete backend suite passed 239/239 (220 existing plus 19 foundation
tests), with no failures or skips. The frontend baseline passed 45/45; no frontend
source files were changed. New tests cover primitive edge cases, missing versus
measured-zero signals, evidence bounds, rule lookup/history compatibility,
repeatability, sprint deduplication, and malicious AI output at the portfolio API.
GitHub/Resume analyzer hardening tests also verify newly computed lean metadata.
Fixed-fixture parity checks compare 5,000 GitHub and 5,000 Resume aggregates with
their original formulas. Stage 1 context regression tests remain green.
