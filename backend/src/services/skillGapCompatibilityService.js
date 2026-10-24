"use strict";
const dictionary = require("./skillGapRequirements");
const { numeric } = require("./scoring/math");

const project = (resolved, legacyGroups = {}) => {
  const legacy = new Map(
    [
      ...(legacyGroups.yourSkills || []),
      ...(legacyGroups.missingSkills || []),
    ].map((skill) => [dictionary.canonicalize(skill.name), skill]),
  );
  const convert = (skill) => {
    const meta = dictionary.metadata(skill.name);
    const legacyConfidence = numeric(legacy.get(skill.name)?.confidenceScore);
    return {
      ...skill,
      proficiency: null,
      proficiencyKind: "uncalibrated",
      confidenceScore: legacyConfidence,
      legacyConfidenceScore: legacyConfidence,
      confidenceKind: "legacyHeuristic",
      isFoundational: skill.requirement === "REQUIRED",
      priority: meta.priority || "Medium",
      jobDemand: meta.jobDemand || 0,
      source:
        [...new Set(skill.evidence.map((item) => item.type))].join(" + ") ||
        "Analyzed sources",
      sourceReferences: skill.evidence,
      evidence: skill.evidence
        .slice(0, 5)
        .map(
          (item) =>
            `${item.type}: ${item.artifact || item.kind.toLowerCase()} (${item.id})`,
        ),
      whyExists:
        skill.status === "NOT_EVIDENCED"
          ? "Available analyzed sources do not establish this skill; this does not establish inability."
          : skill.status === "UNKNOWN"
            ? "Available sources are insufficient to assess this skill."
            : `${skill.status}: supported by the recorded evidence references.`,
      levelRelevance: "Current",
    };
  };
  const all = resolved.skills.map(convert);
  return {
    yourSkills: all.filter((skill) =>
      ["DEMONSTRATED", "PARTIAL", "CLAIMED_ONLY"].includes(skill.status),
    ),
    missingSkills: all.filter(
      (skill) =>
        skill.requirement === "REQUIRED" && skill.status !== "DEMONSTRATED",
    ),
    weakSkills: all.filter(
      (skill) =>
        skill.requirement === "REQUIRED" &&
        ["PARTIAL", "CLAIMED_ONLY"].includes(skill.status),
    ),
    highDemandSkills: all.filter(
      (skill) =>
        skill.requirement === "REQUIRED" &&
        skill.status !== "DEMONSTRATED" &&
        skill.jobDemand >= 78,
    ),
    provenSkills: resolved.demonstratedSkills.map((skill) => skill.name),
    githubSkills: resolved.skills
      .filter((skill) => skill.evidence.some((item) => item.type === "github"))
      .map((skill) => skill.name),
    resumeSkills: resolved.skills
      .filter((skill) => skill.evidence.some((item) => item.type === "resume"))
      .map((skill) => skill.name),
    claimedButNotProvenSkills: resolved.claimedOnlySkills.map(
      (skill) => skill.name,
    ),
  };
};
const promptContext = (resolved, careerStack, experienceLevel) => ({
  profile: { careerStack, experienceLevel },
  skills: resolved.skills
    .map((skill) => ({
      name: skill.name,
      requirement: skill.requirement,
      status: skill.status,
      confidence: skill.evidenceConfidence,
    }))
    .slice(0, 80),
  coverage: resolved.coverage,
  evidenceConfidence: resolved.evidenceConfidence,
  warnings: resolved.warnings,
  ruleVersion: resolved.ruleVersion,
  limitations:
    "No current analyzer output exposes meaningful inspected implementation. Claims and metadata do not demonstrate proficiency.",
});
const narrative = (resolved) => ({
  analysisSummary:
    resolved.coverage === null
      ? "Skill coverage is unavailable because career requirements or relevant analyzed evidence are unavailable. This does not establish inability."
      : `Required-skill evidence coverage is ${resolved.coverage}%. ${resolved.demonstratedSkills.length} skills are demonstrated and ${resolved.partialSkills.length} have partial technical evidence. Resume statements remain claims unless independently evidenced.`,
  levelAssessment:
    "Use the recorded evidence status to choose learning and proof-building actions. A skill not established by available analyzed sources does not imply inability.",
});

module.exports = { project, promptContext, narrative };
