"use strict";

const { numeric, clampScore, safeAverage } = require("./scoring/math");
const { scoreFeatures } = require("./scoring/aggregate");

// LEGACY COMPATIBILITY ONLY. Authoritative evidence coverage is calculated by
// skillGapEvidenceService. Retain these historical formulas and rule versions.
const COVERAGE_WEIGHTS = Object.freeze({
  balance: 0.57,
  proficiency: 0.23,
  resume: 0.1,
  integration: 0.1,
});
const CONFIDENCE_WEIGHTS = Object.freeze({
  evidence: 0.4,
  resume: 0.2,
  github: 0.2,
  integration: 0.1,
  jobs: 0.1,
});
const calculate = (
  {
    yourSkills = [],
    missingSkills = [],
    evidenceBreakdown = {},
    resumeInsights = {},
    githubData = {},
    developerSignals = {},
    resumeAvailable = false,
    githubAvailable = false,
  } = {},
  options = {},
) => {
  const count = yourSkills.length + missingSkills.length;
  const averageProficiency = safeAverage(
    yourSkills.map((skill) => clampScore(skill.proficiency)),
    { fallback: 0 },
  );
  const integrationAvailable =
    developerSignals.integrationSignal?.present === true;
  const jobsAvailable = developerSignals.jobsDemandSignal?.present === true;
  const ats =
    resumeAvailable && numeric(resumeInsights.atsScore) !== null
      ? clampScore(resumeInsights.atsScore)
      : null;
  const integration =
    integrationAvailable &&
    numeric(developerSignals.integrationSignal?.integrationScore) !== null
      ? clampScore(developerSignals.integrationSignal.integrationScore)
      : null;
  const proven = (evidenceBreakdown.provenSkills || []).length;
  const claimed = (evidenceBreakdown.claimedButNotProvenSkills || []).length;
  const absent = (evidenceBreakdown.missingExpectedSkills || []).length;
  const total = proven + claimed + absent;
  const facts = {
    knownSkillCount: yourSkills.length,
    missingSkillCount: missingSkills.length,
    resumeAvailable,
    githubAvailable,
    integrationAvailable,
    jobsAvailable,
  };
  const coverage = scoreFeatures(
    {
      balance: count ? (yourSkills.length / count) * 100 : 0,
      proficiency: clampScore(averageProficiency),
      resume: ats,
      integration,
    },
    COVERAGE_WEIGHTS,
    "skill-gap-coverage-v1",
    { ...options, facts },
  );
  const confidence = scoreFeatures(
    {
      evidence: total ? ((proven + claimed * 0.5) / total) * 100 : 30,
      resume: ats,
      github: githubAvailable
        ? Math.min(1, Math.max(0, numeric(githubData.repoCount) || 0) / 10) *
          100
        : null,
      integration: integrationAvailable ? 80 : null,
      jobs: jobsAvailable ? 80 : null,
    },
    CONFIDENCE_WEIGHTS,
    "skill-gap-confidence-v1",
    { ...options, facts },
  );
  // Retain legacy arithmetic order at half-point rounding boundaries.
  if (ats !== null && integration !== null) {
    coverage.score = clampScore(
      ((count ? yourSkills.length / count : 0) * 0.57 +
        (clampScore(averageProficiency) / 100) * 0.23 +
        (ats / 100) * 0.1 +
        (integration / 100) * 0.1) *
        100,
    );
  }
  if (
    ats !== null &&
    githubAvailable &&
    integrationAvailable &&
    jobsAvailable
  ) {
    confidence.score = clampScore(
      (total ? (proven + claimed * 0.5) / total : 0.3) * 40 +
        (ats / 100) * 20 +
        Math.min(1, Math.max(0, numeric(githubData.repoCount) || 0) / 10) * 20 +
        0.8 * 10 +
        0.8 * 10,
    );
  }
  return {
    coverage,
    confidence,
    evidenceCompleteness: {
      resumeAvailable,
      githubAvailable,
      availableCoreSources: Number(resumeAvailable) + Number(githubAvailable),
      totalCoreSources: 2,
    },
    averageProficiency: clampScore(averageProficiency),
  };
};

module.exports = { calculate, calculateLegacy: calculate, COVERAGE_WEIGHTS, CONFIDENCE_WEIGHTS };
