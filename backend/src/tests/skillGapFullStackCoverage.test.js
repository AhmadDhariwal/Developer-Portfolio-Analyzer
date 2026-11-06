"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../services/skillGapEvidenceService");
const dictionary = require("../services/skillGapRequirements");
const at = "2026-11-01T00:00:00.000Z";
const requirements = dictionary.resolveRequirements("Full Stack", "2-3 years");
const input = () => ({
  careerStack: "Full Stack",
  experienceLevel: "2-3 years",
  githubData: {
    fetchedAt: at,
    dataAvailability: { repositories: "complete", repositorySignals: "sampled" },
    repositories: [{ name: "local-fixture", language: "TypeScript", topics: ["react"] }]
  },
  resumeAnalysis: {
    _id: "selected-fixture",
    fileId: "selected-file",
    analyzedAt: at,
    resumeSignals: { skills: ["SQL"] }
  }
});
const resolve = (value) => engine.resolve(value, { calculatedAt: at });

test("Full Stack / 2-3 years: sampled evidence preserves known denominator and mixed unknowns through JSON", () => {
  const value = input();
  const result = resolve(value);
  assert.equal(requirements.available, true);
  assert.equal(requirements.skills.length, 20);
  assert.equal(result.coverage, null);
  assert.equal(result.coverageUnavailableReason, "required_evidence_unknown");
  assert.deepEqual(result.scoring.evidence.inputs, { weightedCredit: 1, requiredWeight: 20 });
  assert.equal(result.partialSkills.length, 2);
  assert.equal(result.claimedOnlySkills.length, 1);
  assert.equal(result.unknownSkills.length, 17);
  assert.equal(result.notEvidencedSkills.length, 0);
  assert.equal(result.evidenceCompleteness.complete, false);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.deepEqual(resolve(value), result);

  // Age/staleness affects confidence and warnings, never promotes unknowns to gaps.
  value.githubData.cache = { stale: true, cachedAt: at };
  const stale = resolve(value);
  assert.equal(stale.coverage, null);
  assert.deepEqual(stale.scoring.evidence.inputs, result.scoring.evidence.inputs);
  assert.deepEqual(
    stale.skills.map((skill) => skill.status),
    result.skills.map((skill) => skill.status)
  );
  assert.ok(stale.warnings.includes("stale_source:github"));
});

test("Full Stack / 2-3 years: known evidence calculates coverage; absence and invalid requirements stay unavailable", () => {
  const value = input();
  // Synthetic complete claims establish assessed status, not implementation proof.
  value.resumeAnalysis.resumeSignals.skills = requirements.skills.map((skill) => skill.name);
  const known = resolve(value);
  assert.equal(known.coverage, 5); // 100 * (2 * .5) / 20
  assert.equal(known.coverageUnavailableReason, null);
  assert.equal(known.unknownSkills.length, 0);
  assert.equal(known.claimedOnlySkills.length, 18);
  assert.equal(known.demonstratedSkills.length, 0);

  const absent = resolve({ careerStack: "Full Stack", experienceLevel: "2-3 years" });
  assert.equal(absent.coverage, null);
  assert.equal(absent.coverageUnavailableReason, "relevant_evidence_unavailable");
  assert.equal(absent.unknownSkills.length, 20);
  assert.equal(absent.scoring.evidence.inputs.requiredWeight, 20);

  const missing = resolve({ ...value, experienceLevel: "unknown-level" });
  assert.equal(missing.coverage, null);
  assert.equal(missing.coverageUnavailableReason, "career_requirements_unavailable");
  assert.equal(missing.scoring.evidence.inputs.requiredWeight, 0);
});
