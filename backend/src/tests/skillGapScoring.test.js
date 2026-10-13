"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { calculate } = require("../services/skillGapScoringService");
const options = {
  calculatedAt: "2026-10-12T00:00:00.000Z",
  sources: [{ type: "github-user", id: "fixture" }],
};
const complete = () => ({
  yourSkills: [{ proficiency: 80 }, { proficiency: 60 }],
  missingSkills: [{ name: "Testing" }],
  evidenceBreakdown: {
    provenSkills: ["Java"],
    claimedButNotProvenSkills: ["React"],
    missingExpectedSkills: ["Testing"],
  },
  resumeAvailable: true,
  githubAvailable: true,
  resumeInsights: { atsScore: 80 },
  githubData: { repoCount: 5 },
  developerSignals: {
    integrationSignal: { present: true, integrationScore: 60 },
    jobsDemandSignal: { present: true },
  },
});
test("legacy complete-input readiness and numeric confidence preserve existing weights and rounding", () => {
  const result = calculate(complete(), options);
  assert.equal(
    result.coverage.score,
    Math.round(((2 / 3) * 0.57 + 0.7 * 0.23 + 0.8 * 0.1 + 0.6 * 0.1) * 100),
  );
  assert.equal(result.confidence.score, 62);
  assert.deepEqual(result, calculate(complete(), options));
  assert.equal(result.coverage.ruleVersion, "skill-gap-coverage-v1");
  assert.equal(result.confidence.ruleVersion, "skill-gap-confidence-v1");
});
test("legacy parity: 5000 complete fixtures retain exact old scores including half-point rounding", () => {
  for (let i = 0; i < 5000; i += 1) {
    const k = (i % 31) + 1,
      m = i % 17,
      p = i % 101,
      a = (i * 7) % 101,
      n = i % 15,
      x = (i * 13) % 101;
    const input = complete();
    input.yourSkills = Array.from({ length: k }, () => ({ proficiency: p }));
    input.missingSkills = Array(m).fill({});
    input.resumeInsights.atsScore = a;
    input.githubData.repoCount = n;
    input.developerSignals.integrationSignal.integrationScore = x;
    input.evidenceBreakdown = {
      provenSkills: Array(k).fill("Java"),
      claimedButNotProvenSkills: Array(m).fill("React"),
    };
    const result = calculate(input, options);
    assert.equal(
      result.coverage.score,
      Math.round(
        ((k / (k + m)) * 0.57 +
          (p / 100) * 0.23 +
          (a / 100) * 0.1 +
          (x / 100) * 0.1) *
          100,
      ),
    );
    assert.equal(
      result.confidence.score,
      Math.round(
        ((k + m * 0.5) / (k + m)) * 40 +
          (a / 100) * 20 +
          Math.min(1, n / 10) * 20 +
          0.8 * 10 +
          0.8 * 10,
      ),
    );
  }
});
test("disconnected integration is unavailable, measured integration zero contributes", () => {
  const input = complete();
  input.developerSignals.integrationSignal = {
    present: false,
    integrationScore: 0,
  };
  const absent = calculate(input, options);
  assert.equal(absent.coverage.breakdown.integration.value, null);
  assert.equal(
    absent.coverage.score,
    Math.round(((2 / 3) * 57 + 70 * 0.23 + 80 * 0.1) / 0.9),
  );
  input.developerSignals.integrationSignal.present = true;
  assert.ok(calculate(input, options).coverage.score < absent.coverage.score);
});
test("optional integrations and job market absence renormalize confidence", () => {
  const input = complete();
  input.developerSignals = {};
  const result = calculate(input, options);
  assert.equal(
    result.confidence.score,
    Math.round((50 * 0.4 + 80 * 0.2 + 50 * 0.2) / 0.8),
  );
  assert.equal(result.confidence.breakdown.jobs.available, false);
});
test("missing resume is distinct from recorded zero and completeness is separate from quality", () => {
  const input = complete();
  input.resumeAvailable = false;
  const missing = calculate(input, options);
  assert.equal(missing.coverage.breakdown.resume.value, null);
  input.resumeAvailable = true;
  input.resumeInsights.atsScore = 0;
  const zero = calculate(input, options);
  assert.equal(zero.coverage.breakdown.resume.value, 0);
  assert.ok(zero.coverage.score < missing.coverage.score);
  assert.equal(zero.evidenceCompleteness.availableCoreSources, 2);
  assert.equal(missing.evidenceCompleteness.availableCoreSources, 1);
});
test("empty, partial and conflicting evidence remain finite and bounded", () => {
  for (const input of [
    {},
    { evidenceBreakdown: { claimedButNotProvenSkills: ["React"] } },
    {
      evidenceBreakdown: {
        provenSkills: ["Java"],
        claimedButNotProvenSkills: ["React"],
        missingExpectedSkills: ["SQL"],
      },
    },
    {
      ...complete(),
      resumeInsights: { atsScore: Infinity },
      yourSkills: [{ proficiency: -20 }, { proficiency: 300 }],
    },
  ]) {
    const result = calculate(input, options);
    for (const score of [result.coverage.score, result.confidence.score])
      assert.ok(score >= 0 && score <= 100);
    assert.ok(!JSON.stringify(result).includes("Infinity"));
  }
});
test("provenance is bounded and cannot leak full source payloads or AI fields", () => {
  const result = calculate(
    { ...complete(), coverage: 100, aiResult: { score: 100 } },
    {
      ...options,
      sources: Array.from({ length: 30 }, () => ({
        type: "resume",
        id: "x".repeat(500),
        text: "private resume",
      })),
    },
  );
  assert.ok(result.coverage.evidence.sources.length <= 12);
  assert.ok(!JSON.stringify(result).includes("private resume"));
  assert.ok(
    result.coverage.evidence.sources.every((source) => source.id.length <= 160),
  );
});
