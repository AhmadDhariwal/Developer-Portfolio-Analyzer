# Proposed trusted readiness history (approval pending)

AGENTS.md explicitly says: "Never change APIs, dependencies, or schemas without approval."
No AIVersion schema change or backfill has been made in this follow-up.

## Demonstrated issue

`aiversioncontroller.createAiVersion` accepts caller-supplied source names, outputs and
metadata. Therefore an AI version labeled `portfolio_score` is not, by itself, proof of
server-produced scoring. Matching caller metadata cannot establish an authoritative trend.
The Dashboard now excludes those archives rather than showing a fabricated trend.

## Concrete additive proposal

Add one optional top-level structured `provenance` field to the existing AIVersion model:

- `producer`: fixed `portfolio-score-v1` marker, supplied by the portfolio producer only.
- `githubUsername`, `careerStack`, `experienceLevel`, `resumeAnalysisId`, `ruleVersion`:
  the producer's resolved owned context and the actual scoring rule.
- `assessedAt`: scoring calculation time, not archive insertion time.
- `assessmentHash`: deterministic hash of scope plus the recorded scoring assessment.
  Cached archive copies deduplicate by this hash; it is an identity hash, not a signature.

The public create/rollback API would continue to pass only its existing whitelisted
arguments. It would not accept this provenance field. The internal createVersion service
would accept it only from the canonical portfolio producer path, which resolves owned
resume evidence and does not accept client-supplied analysis inputs as canonical.
The producer path's cache identity has already been fixed independently of this proposal.

There would be no default provenance, historical backfill, retention change, new index,
secret, dependency, migration or deployment. Existing versions remain preserved and
unverified. New trusted assessments would become graphable after at least two distinct,
comparable assessments exist for the same user/profile/resume/rule. No GET would generate
an assessment or historical row.

## Current safe behavior

The reader requires top-level server provenance, valid assessment identity/time, numeric
0–100 scores and matching profile/resume/rule. Legacy and user-authored rows are excluded.
It reads at most the latest 32 versions through the existing user/source/version index,
projects bounded scalar scoring data and uses a 1.5-second Mongo query budget. Unknown
history has an explicit empty state. Readiness history is not accepted as complete until
the optional schema/producer change is approved, implemented and verified.
