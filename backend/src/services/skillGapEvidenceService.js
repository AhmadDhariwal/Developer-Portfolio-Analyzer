"use strict";

const { numeric, clampScore, safeDivide } = require("./scoring/math");
const { createScoreResult } = require("./scoring/result");
const { leanWarnings } = require("./scoring/evidence");
const dictionary = require("./skillGapRequirements");
const RULE_VERSION = "skill-evidence-coverage-v1";
const CREDIT = Object.freeze({
  DEMONSTRATED: 1,
  PARTIAL: 0.5,
  CLAIMED_ONLY: 0,
  NOT_EVIDENCED: 0,
});
const STATUSES = Object.freeze([
  "DEMONSTRATED",
  "PARTIAL",
  "CLAIMED_ONLY",
  "NOT_EVIDENCED",
  "UNKNOWN",
]);
const ref = (value) =>
  typeof value === "string" ? value.trim().slice(0, 160) : "";
const timestamp = (value) => {
  if (value == null || value === "") return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : time.toISOString();
};

// Confidence describes the reliability of this evidence assessment, not a
// probability of proficiency. A single weak source never becomes strong proof.
const confidenceFor = ({
  status,
  technicalOrigins,
  fresh,
  complete,
  conflicts,
  coreAvailable,
}) => {
  if (!coreAvailable || status === "UNKNOWN" || status === "NOT_EVIDENCED")
    return "INSUFFICIENT";
  if (conflicts || !fresh || !complete || status === "CLAIMED_ONLY")
    return "LOW";
  if (status === "DEMONSTRATED")
    return technicalOrigins >= 2 ? "HIGH" : "MEDIUM";
  return technicalOrigins >= 2 ? "MEDIUM" : "LOW";
};

const calculate = (
  { requirements, observations = [], sources = [] } = {},
  options = {},
) => {
  const calculatedAt = createScoreResult({
    score: null,
    ruleVersion: RULE_VERSION,
    calculatedAt: options.calculatedAt,
  }).calculatedAt;
  const sourceList = (Array.isArray(sources) ? sources : [])
    .filter((source) =>
      ["github", "resume", "profile", "integration"].includes(source?.type),
    )
    .map((source) => ({
      type: source.type,
      id: ref(source.id),
      ...(ref(source.ruleVersion) ? { ruleVersion: ref(source.ruleVersion) } : {}),
      available: source.available === true,
      completeness: ["COMPLETE", "PARTIAL"].includes(source.completeness)
        ? source.completeness
        : "UNKNOWN",
      timestamp: timestamp(source.timestamp),
      freshness:
        source.freshness === "STALE"
          ? "STALE"
          : timestamp(source.timestamp)
            ? "RECORDED"
            : "UNKNOWN",
    }));
  const core = ["github", "resume"].map(
    (type) =>
      sourceList.find((source) => source.type === type) || {
        type,
        id: "",
        available: false,
        completeness: "UNKNOWN",
        timestamp: null,
        freshness: "UNKNOWN",
      },
  );
  const coreAvailable = core.some((source) => source.available);
  const complete = core.every(
    (source) => source.available && source.completeness === "COMPLETE",
  );
  const warnings = [];
  if (!requirements?.available)
    warnings.push("career_requirements_unavailable");
  for (const entry of requirements?.missingEntries || [])
    warnings.push(`missing_requirement_entry:${ref(entry)}`);
  if (!coreAvailable) warnings.push("github_and_resume_evidence_unavailable");
  if (!complete) warnings.push("partial_source_limitations");
  for (const source of sourceList) {
    if (!source.available) continue;
    if (source.freshness === "STALE")
      warnings.push(`stale_source:${source.type}`);
    if (!source.timestamp)
      warnings.push(`source_timestamp_unavailable:${source.type}`);
    else if (source.freshness !== "STALE")
      warnings.push(`freshness_age_not_calibrated:${source.type}`);
  }
  const observed = new Map();
  // Classify over all deduplicated observations. Only bounded projections are
  // returned; evidence truncation never changes the calculation.
  for (const item of Array.isArray(observations) ? observations : []) {
    const name = dictionary.canonicalize(item?.skill);
    const type = item?.source?.type;
    const id = ref(item?.source?.id);
    if (
      !name ||
      !["github", "resume", "profile", "integration"].includes(type) ||
      !id
    )
      continue;
    if (!sourceList.some((source) => source.type === type && source.available))
      continue;
    const kind = ["IMPLEMENTATION", "METADATA", "CLAIM"].includes(item.kind)
      ? item.kind
      : "CLAIM";
    // A resume/profile statement cannot be relabeled inspected implementation.
    const technical = ["github", "integration"].includes(type);
    const implementation =
      technical &&
      kind === "IMPLEMENTATION" &&
      item.inspected === true &&
      item.meaningful === true &&
      Boolean(ref(item.artifact));
    const effectiveKind = implementation
      ? "IMPLEMENTATION"
      : technical && kind === "METADATA"
        ? "METADATA"
        : "CLAIM";
    const origin = ref(item.source.origin) || `${type}:${id}`;
    const entry = {
      kind: effectiveKind,
      type,
      id,
      origin,
      artifact: ref(item.artifact),
      timestamp: timestamp(item.timestamp),
      freshness:
        item.freshness === "STALE"
          ? "STALE"
          : timestamp(item.timestamp)
            ? "RECORDED"
            : "UNKNOWN",
      conflicting: technical && effectiveKind !== "CLAIM" && item.conflicting === true,
    };
    const entries = observed.get(name) || [];
    const key = JSON.stringify([
      origin,
      effectiveKind,
      entry.artifact,
      entry.conflicting,
    ]);
    if (!entries.some((existing) => existing.key === key))
      entries.push({ ...entry, key });
    observed.set(name, entries);
  }
  const relevantAnalyzedEvidenceAvailable = coreAvailable || [...observed.values()].some(entries =>
    entries.some(entry => entry.type === "integration" && entry.kind !== "CLAIM"));
  const requirementsByName = new Map();
  for (const entry of requirements?.skills || []) {
    const name = dictionary.canonicalize(entry?.name);
    if (!name) {
      warnings.push(`missing_requirement_entry:${ref(entry?.name)}`);
      continue;
    }
    if (!["REQUIRED", "OPTIONAL"].includes(entry.requirement)) {
      warnings.push(`missing_requirement_classification:${name}`);
      continue;
    }
    const weight = entry.weight === undefined ? 1 : numeric(entry.weight);
    if (weight === null || weight <= 0) {
      warnings.push(`invalid_requirement_weight:${name}`);
      continue;
    }
    const previous = requirementsByName.get(name);
    if (previous && (previous.weight !== weight || previous.requirement !== entry.requirement))
      warnings.push(`conflicting_requirement_entry:${name}`);
    if (!previous)
      requirementsByName.set(name, {
        name,
        category: entry.category || dictionary.metadata(name).category,
        requirement: entry.requirement,
        weight,
      });
  }
  const skills = [
    ...new Set([...requirementsByName.keys(), ...observed.keys()]),
  ]
    .sort()
    .map((name) => {
      const requirement = requirementsByName.get(name) || {
        name,
        category: dictionary.metadata(name).category,
        requirement: "OPTIONAL",
        weight: 1,
      };
      const entries = observed.get(name) || [];
      const positive = entries.filter((entry) => !entry.conflicting);
      const conflicts =
        entries.some((entry) => entry.conflicting) &&
        positive.some((entry) => entry.kind !== "CLAIM");
      const implementation = positive.some(
        (entry) => entry.kind === "IMPLEMENTATION",
      );
      const metadata = positive.some((entry) => entry.kind === "METADATA");
      const status = implementation
        ? conflicts
          ? "PARTIAL"
          : "DEMONSTRATED"
        : metadata
          ? "PARTIAL"
          : positive.length
            ? "CLAIMED_ONLY"
          : relevantAnalyzedEvidenceAvailable
              ? "NOT_EVIDENCED"
              : "UNKNOWN";
      const technicalOrigins = new Set(
        positive
          .filter((entry) => entry.kind !== "CLAIM")
          .map((entry) => entry.origin),
      ).size;
      const fresh =
        positive.length > 0 &&
        positive.every(
          (entry) => entry.timestamp && entry.freshness !== "STALE",
        ) &&
        core
          .filter((source) => source.available)
          .every((source) => source.timestamp && source.freshness !== "STALE");
      if (conflicts) warnings.push(`conflicting_positive_evidence:${name}`);
      const evidence = entries.slice(0, 12).map(({ key, ...entry }) => entry);
      return {
        ...requirement,
        status,
        evidenceCredit: Object.hasOwn(CREDIT, status) ? CREDIT[status] : null,
        evidenceConfidence: confidenceFor({
          status,
          technicalOrigins,
          fresh,
          complete,
          conflicts,
          coreAvailable,
        }),
        independentTechnicalSources: technicalOrigins,
        evidence,
        warnings: leanWarnings([
          ...(conflicts ? ["conflicting_positive_evidence"] : []),
          ...(entries.some((entry) => entry.freshness === "STALE")
            ? ["stale_evidence"]
            : []),
          ...(entries.some((entry) => !entry.timestamp)
            ? ["evidence_timestamp_unavailable"]
            : []),
          ...(entries.some((entry) => entry.timestamp && entry.freshness !== "STALE")
            ? ["freshness_age_not_calibrated"] : []),
        ]),
      };
    });
  const required = skills.filter((skill) => skill.requirement === "REQUIRED");
  const denominator = required.reduce((sum, skill) => sum + skill.weight, 0);
  const numerator = required.reduce(
    (sum, skill) => sum + skill.weight * (skill.evidenceCredit ?? 0),
    0,
  );
  const invalidMatrix =
    !requirements?.available ||
    !required.length ||
    warnings.some((warning) =>
      /^(missing_requirement_entry|missing_requirement_classification|invalid_requirement_weight|conflicting_requirement_entry):/.test(
        warning,
      ),
    );
  const reason = invalidMatrix
    ? "career_requirements_unavailable"
    : !relevantAnalyzedEvidenceAvailable
      ? "relevant_evidence_unavailable"
      : required.some((skill) => skill.status === "UNKNOWN")
        ? "required_evidence_unknown"
        : null;
  const result = createScoreResult({
    score: reason ? null : safeDivide(numerator * 100, denominator),
    ruleVersion: RULE_VERSION,
    calculatedAt,
    warnings,
    evidence: {
      sources: sourceList
        .filter((source) => source.available)
        .map((source) => ({ type: source.type, id: source.id, ...(source.ruleVersion ? { ruleVersion: source.ruleVersion } : {}) })),
      inputs: { weightedCredit: numerator, requiredWeight: denominator },
      facts: {
        requiredSkillCount: required.length,
        optionalSkillCount: skills.length - required.length,
        coreSourcesAvailable: core.filter((source) => source.available).length,
      },
    },
  });
  const rank = { INSUFFICIENT: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
  const confidence =
    !required.length || !coreAvailable
      ? "INSUFFICIENT"
      : required.reduce(
          (lowest, skill) =>
            rank[skill.evidenceConfidence] < rank[lowest]
              ? skill.evidenceConfidence
              : lowest,
          "HIGH",
        );
  const categoryBreakdown = Object.fromEntries(
    [...new Set(skills.map((skill) => skill.category))].map((category) => {
      const categorySkills = skills.filter(
        (skill) => skill.category === category,
      );
      const requiredSkills = categorySkills.filter(
        (skill) => skill.requirement === "REQUIRED",
      );
      const weight = requiredSkills.reduce(
        (sum, skill) => sum + skill.weight,
        0,
      );
      const credit = requiredSkills.reduce(
        (sum, skill) => sum + skill.weight * (skill.evidenceCredit ?? 0),
        0,
      );
      return [
        category,
        {
          requiredSkillCount: requiredSkills.length,
          optionalSkillCount: categorySkills.length - requiredSkills.length,
          requiredWeight: weight,
          weightedCredit: credit,
          coverage:
            reason || !weight
              ? null
              : clampScore(safeDivide(credit * 100, weight)),
        },
      ];
    }),
  );
  return {
    coverage: result.score,
    coverageUnavailableReason: reason,
    skills,
    requiredSkills: required,
    optionalSkills: skills.filter((skill) => skill.requirement === "OPTIONAL"),
    ...Object.fromEntries(
      STATUSES.map((status) => [
        {
          DEMONSTRATED: "demonstratedSkills",
          PARTIAL: "partialSkills",
          CLAIMED_ONLY: "claimedOnlySkills",
          NOT_EVIDENCED: "notEvidencedSkills",
          UNKNOWN: "unknownSkills",
        }[status],
        skills.filter((skill) => skill.status === status),
      ]),
    ),
    categoryBreakdown,
    evidenceConfidence: confidence,
    evidenceCompleteness: {
      githubAvailable: core[0].available,
      resumeAvailable: core[1].available,
      availableCoreSources: core.filter((source) => source.available).length,
      totalCoreSources: 2,
      complete,
      sources: sourceList.slice(0, 12),
    },
    sourceReferences: sourceList.slice(0, 12),
    warnings: result.warnings,
    ruleVersion: RULE_VERSION,
    requirementMatrixVersion: requirements?.version || null,
    calculatedAt,
    scoring: result,
  };
};

// Feature-local adapter. No current analyzer output establishes inspected code
// implementation, so this adapter deliberately never emits IMPLEMENTATION.
const resolve = (
  {
    githubData = {},
    resumeAnalysis,
    resumeInsights = {},
    profile = {},
    integrationSignal = {},
    profileSignal = {},
    careerStack,
    experienceLevel,
    preview = false,
  } = {},
  options = {},
) => {
  const githubAvailable =
    githubData.cache?.source !== "miss-background-refresh" &&
    Boolean(
      githubData.cache?.cachedAt ||
      githubData.githubSignals?.analyzedAt ||
      githubData.fetchedAt ||
      (Array.isArray(githubData.repositories) &&
        githubData.repositories.length) ||
      githubData.dataAvailability?.repositories === "complete",
    );
  const resumeAvailable = preview
    ? resumeInsights.analyzed === true
    : Boolean(resumeAnalysis);
  const githubTime =
    githubData.githubSignals?.analyzedAt ||
    githubData.fetchedAt ||
    githubData.cache?.cachedAt;
  const resumeTime =
    resumeAnalysis?.analyzedAt ||
    resumeAnalysis?.createdAt ||
    resumeInsights.lastAnalyzedAt;
  const sources = [
    {
      type: "github",
      id: String(
        githubData.githubSignals?.username ||
          profile.activeGithubUsername ||
          profile.githubUsername ||
          "github",
      ),
      available: githubAvailable,
      timestamp: githubTime,
      ruleVersion: githubData.githubSignals?.scoring?.ruleVersion || githubData.scoring?.ruleVersion,
      freshness: githubData.cache?.stale ? "STALE" : "RECORDED",
      completeness:
        githubData.dataAvailability?.repositories === "complete" &&
        githubData.dataAvailability?.repositorySignals === "complete"
          ? "COMPLETE"
          : "PARTIAL",
    },
    {
      type: "resume",
      id: String(resumeAnalysis?._id || resumeInsights.analysisId || "resume"),
      available: resumeAvailable,
      timestamp: resumeTime,
      ruleVersion: resumeAnalysis?.resumeSignals?.scoring?.ruleVersion || resumeAnalysis?.scoring?.ruleVersion,
      completeness: "COMPLETE",
    },
    {
      type: "profile",
      id: String(profile._id || "profile"),
      available: Boolean(profile._id) || profileSignal.present === true,
      timestamp: profile.updatedAt || profileSignal.updatedAt,
      completeness: "COMPLETE",
    },
    {
      type: "integration",
      id: "integration-summary",
      available: integrationSignal.present === true,
      timestamp: integrationSignal.updatedAt,
      completeness: "PARTIAL",
    },
  ];
  const observations = [];
  const add = (skill, kind, source, time, artifact = "", stale = false) =>
    observations.push({
      skill,
      kind,
      source,
      timestamp: time,
      artifact,
      freshness: stale ? "STALE" : "RECORDED",
    });
  // Ignore names/descriptions and unanchored inferred technology summaries.
  // Exact topics and real language names are relevant metadata, not code proof.
  for (const repo of Array.isArray(githubData.repositories)
    ? githubData.repositories
    : []) {
    if (!repo?.name) continue;
    const source = {
      type: "github",
      id: ref(repo.name),
      origin: `github-repository:${ref(repo.name)}`,
    };
    const time = repo.pushedAt || repo.updatedAt || githubTime;
    for (const skill of dictionary.normalize([
      repo.language === "Dockerfile" ? "Docker" : repo.language,
      ...(Array.isArray(repo.topics) ? repo.topics : []),
    ]))
      add(
        skill,
        "METADATA",
        source,
        time,
        "repository-metadata",
        githubData.cache?.stale,
      );
  }
  for (const language of Array.isArray(githubData.languageDistribution)
    ? githubData.languageDistribution
    : []) {
    const skill = dictionary.canonicalize(language?.language === "Dockerfile" ? "Docker" : language?.language);
    if (
      !skill ||
      observations.some(
        (item) => item.skill === skill && item.source.type === "github",
      )
    )
      continue;
    add(
      skill,
      "METADATA",
      {
        type: "github",
        id: "language-distribution",
        origin: "github-language-distribution",
      },
      githubTime,
      "language-distribution",
      githubData.cache?.stale,
    );
  }
  let resumeSkills;
  if (preview)
    resumeSkills =
      resumeInsights.technicalSkills || resumeInsights.skills || [];
  else if (Array.isArray(resumeAnalysis?.resumeSignals?.skills))
    resumeSkills = resumeAnalysis.resumeSignals.skills;
  else if (Array.isArray(resumeAnalysis?.technicalSkills))
    resumeSkills = resumeAnalysis.technicalSkills;
  else
    resumeSkills = [
      ...(resumeAnalysis?.skills instanceof Map
        ? resumeAnalysis.skills.values()
        : Object.values(resumeAnalysis?.skills || {})),
    ].flat();
  for (const skill of dictionary.normalize(resumeSkills))
    add(
      skill,
      "CLAIM",
      {
        type: "resume",
        id: sources[1].id,
        origin: `resume-file:${String(resumeAnalysis?.fileId || resumeInsights.fileId || sources[1].id)}`,
      },
      resumeTime,
    );
  // Profile has no calibrated skill evidence; explicit statements stay claims.
  for (const skill of dictionary.normalize(profile.skills || []))
    add(
      skill,
      "CLAIM",
      {
        type: "profile",
        id: sources[2].id,
        origin: `profile:${sources[2].id}`,
      },
      profile.updatedAt,
    );
  // Aggregated integration skills have no artifact-level technical provenance.
  for (const skill of dictionary.normalize(profileSignal.portfolioSkills || []))
    add(skill, "CLAIM", { type: "profile", id: sources[2].id, origin: `profile:${sources[2].id}` }, profileSignal.updatedAt);
  for (const skill of dictionary.normalize(
    integrationSignal.detectedSkills || [],
  ))
    add(
      skill,
      "CLAIM",
      {
        type: "integration",
        id: "integration-summary",
        origin: "integration-summary",
      },
      integrationSignal.updatedAt,
    );
  return calculate(
    {
      requirements: dictionary.resolveRequirements(
        careerStack,
        experienceLevel,
      ),
      observations,
      sources,
    },
    options,
  );
};

module.exports = {
  RULE_VERSION,
  CREDIT,
  STATUSES,
  confidenceFor,
  calculate,
  resolve,
};
