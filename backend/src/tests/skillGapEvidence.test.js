"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../services/skillGapEvidenceService");
const dictionary = require("../services/skillGapRequirements");
const time = "2026-10-12T00:00:00.000Z";
const options = { calculatedAt: time };
const requirements = (entries = ["React", "TypeScript"]) => ({
  available: true,
  version: "fixture-matrix-v1",
  skills: entries.map((name) =>
    typeof name === "string"
      ? { name, requirement: "REQUIRED", weight: 1, category: "Frontend" }
      : name,
  ),
});
const sources = () =>
  ["github", "resume"].map((type) => ({
    type,
    id: type,
    available: true,
    completeness: "COMPLETE",
    timestamp: time,
  }));
const observation = (skill, kind = "METADATA", id = "repo1", extra = {}) => ({
  skill,
  kind,
  source: {
    type: kind === "CLAIM" ? "resume" : "github",
    id,
    origin: `${kind === "CLAIM" ? "resume-file" : "github-repository"}:${id}`,
  },
  timestamp: time,
  inspected: true,
  meaningful: true,
  artifact: "src/fixture.js",
  ...extra,
});
const run = (observations = [], extra = {}) =>
  engine.calculate(
    {
      requirements: requirements(),
      observations,
      sources: sources(),
      ...extra,
    },
    options,
  );
const status = (result, name = "React") =>
  result.skills.find((skill) => skill.name === name);

test("every approved evidence status has deterministic conservative classification", () => {
  assert.equal(
    status(run([observation("React", "IMPLEMENTATION")])).status,
    "DEMONSTRATED",
  );
  assert.equal(status(run([observation("React")])).status, "PARTIAL");
  assert.equal(
    status(run([observation("React", "CLAIM")])).status,
    "CLAIMED_ONLY",
  );
  assert.equal(status(run()).status, "NOT_EVIDENCED");
  assert.equal(status(run([], { sources: [] })).status, "UNKNOWN");
  assert.equal(run([], { sources: [] }).coverage, null);
});
test("implementation requires inspected meaningful artifact evidence from a technical source", () => {
  for (const extra of [
    { inspected: false },
    { meaningful: false },
    { artifact: "" },
    { source: { type: "resume", id: "resume" } },
    { source: { type: "profile", id: "profile" } },
  ]) {
    const result = run(
      [observation("React", "IMPLEMENTATION", "repo1", extra)],
      {
        sources: [
          ...sources(),
          { type: "profile", id: "profile", available: true, timestamp: time },
        ],
      },
    );
    assert.notEqual(status(result).status, "DEMONSTRATED");
  }
});
test("weak independent evidence and corroborated resume claims never become demonstrated", () => {
  const result = run([
    observation("React"),
    observation("React", "METADATA", "repo2"),
    observation("React", "CLAIM"),
  ]);
  assert.equal(status(result).status, "PARTIAL");
  assert.equal(status(result).independentTechnicalSources, 2);
  assert.equal(status(result).evidenceConfidence, "MEDIUM");
  assert.equal(result.coverage, 25);
});
test("duplicate and copied evidence never raises credit or source independence", () => {
  const entry = observation("React", "IMPLEMENTATION");
  const single = run([entry]);
  const copies = run(Array.from({ length: 100 }, () => ({ ...entry })));
  assert.deepEqual(single, copies);
  const copiedOrigin = run([
    entry,
    observation("React", "IMPLEMENTATION", "copy", {
      source: { type: "github", id: "copy", origin: "github-repository:repo1" },
      artifact: "another/path.js",
    }),
  ]);
  assert.equal(status(copiedOrigin).independentTechnicalSources, 1);
  assert.equal(status(copiedOrigin).evidenceConfidence, "MEDIUM");
  assert.equal(copiedOrigin.coverage, single.coverage);
});
test("0%, 50%, 100% manually verified required-only coverage", () => {
  assert.equal(
    run([observation("React", "CLAIM"), observation("TypeScript", "CLAIM")])
      .coverage,
    0,
  );
  assert.equal(
    run([observation("React"), observation("TypeScript")]).coverage,
    50,
  );
  assert.equal(
    run([
      observation("React", "IMPLEMENTATION"),
      observation("TypeScript", "IMPLEMENTATION"),
    ]).coverage,
    100,
  );
});
test("optional and required classifications are independent of evidence status", () => {
  const input = {
    requirements: requirements([
      { name: "React", weight: 2, requirement: "REQUIRED" },
      { name: "TypeScript", weight: 1, requirement: "REQUIRED" },
      { name: "Git", weight: 50, requirement: "OPTIONAL" },
    ]),
  };
  const result = run(
    [
      observation("React", "IMPLEMENTATION"),
      observation("TypeScript"),
      observation("Git", "IMPLEMENTATION"),
    ],
    input,
  );
  // (2*1 + 1*.5) / 3 * 100 = 83.333..., rounded to 83.
  assert.equal(result.coverage, 83);
  assert.equal(status(result, "Git").requirement, "OPTIONAL");
  assert.equal(status(result, "Git").status, "DEMONSTRATED");
  assert.equal(result.scoring.evidence.inputs.requiredWeight, 3);
  assert.equal(result.optionalSkills.length, 1);
});
test("claims, ATS, stars, repository counts, Jira and Slack scores cannot increase coverage", () => {
  const resolved = engine.resolve(
    {
      careerStack: "Frontend",
      experienceLevel: "Student",
      githubData: {
        repoCount: 999,
        totalStars: 99999,
        repositories: [],
        cache: { cachedAt: time },
      },
      resumeAnalysis: {
        _id: "resume",
        analyzedAt: time,
        atsScore: 100,
        resumeSignals: { skills: ["React", "TypeScript"] },
      },
      integrationSignal: {
        present: true,
        integrationScore: 100,
        detectedSkills: ["Docker"],
        usedProviders: ["jira", "slack"],
      },
    },
    options,
  );
  assert.equal(resolved.coverage, 0);
  assert.equal(status(resolved).status, "CLAIMED_ONLY");
  assert.equal(resolved.demonstratedSkills.length, 0);
});
test("production GitHub adapter accepts exact language/topics only and never fabricates code inspection", () => {
  const resolved = engine.resolve(
    {
      careerStack: "Frontend",
      experienceLevel: "Student",
      githubData: {
        cache: { cachedAt: time },
        repositories: [
          {
            name: "React-demo",
            description: "I know React",
            language: "JavaScript",
            topics: ["typescript"],
            technologies: ["React"],
            implementationEvidence: [{ skill: "React", inspected: true }],
          },
        ],
      },
    },
    options,
  );
  assert.equal(status(resolved).status, "NOT_EVIDENCED");
  assert.equal(status(resolved, "TypeScript").status, "PARTIAL");
  assert.equal(resolved.demonstratedSkills.length, 0);
});
test("unavailable requirements, missing entries and all evidence absence return null with a reason", () => {
  assert.equal(
    run([], {
      requirements: {
        available: false,
        missingEntries: ["careerStack:missing"],
      },
    }).coverage,
    null,
  );
  const missing = run([], {
    requirements: requirements(["Not an existing requirement"]),
  });
  assert.equal(missing.coverage, null);
  assert.ok(
    missing.warnings.some((warning) =>
      warning.includes("Not an existing requirement"),
    ),
  );
  const empty = run([], { sources: [] });
  assert.equal(
    empty.coverageUnavailableReason,
    "relevant_evidence_unavailable",
  );
  assert.equal(empty.evidenceConfidence, "INSUFFICIENT");
});
test("Dockerfile metadata is partial Docker evidence; profile and integration summaries stay claims", () => {
  const resolved = engine.resolve(
    {
      careerStack: "Backend",
      experienceLevel: "Student",
      githubData: {
        cache: { cachedAt: time },
        repositories: [{ name: "container", language: "Dockerfile" }],
      },
      profile: { _id: "owner", skills: ["SQL"], updatedAt: time },
      profileSignal: {
        present: true,
        portfolioSkills: ["React"],
        updatedAt: time,
      },
      integrationSignal: {
        present: true,
        detectedSkills: ["AWS"],
        updatedAt: time,
      },
    },
    options,
  );
  assert.equal(status(resolved, "Docker").status, "PARTIAL");
  assert.equal(status(resolved, "SQL").status, "CLAIMED_ONLY");
  assert.equal(status(resolved, "React").status, "CLAIMED_ONLY");
  assert.equal(status(resolved, "AWS").status, "CLAIMED_ONLY");
  assert.equal(resolved.demonstratedSkills.length, 0);
});
test("partial source limitations stay separate from coverage and missing integrations have no penalty", () => {
  const observations = [observation("React"), observation("TypeScript")];
  const githubOnly = run(observations, { sources: [sources()[0]] });
  assert.equal(githubOnly.coverage, 50);
  assert.equal(githubOnly.evidenceCompleteness.availableCoreSources, 1);
  assert.ok(githubOnly.warnings.includes("partial_source_limitations"));
  assert.equal(
    run(observations, {
      sources: [
        ...sources(),
        { type: "integration", id: "optional", available: false },
      ],
    }).coverage,
    50,
  );
});
test("absence from GitHub never contradicts a resume claim", () => {
  const result = run([observation("React", "CLAIM")]);
  assert.equal(status(result).status, "CLAIMED_ONLY");
  assert.ok(
    !result.warnings.some((warning) => warning.includes("conflicting")),
  );
});
test("explicit technical conflict warns and conservatively classifies positive implementation as partial", () => {
  const result = run([
    observation("React", "IMPLEMENTATION"),
    observation("React", "METADATA", "repo2", { conflicting: true }),
  ]);
  assert.equal(status(result).status, "PARTIAL");
  assert.equal(status(result).evidenceConfidence, "LOW");
  assert.ok(result.warnings.includes("conflicting_positive_evidence:React"));
  assert.equal(result.coverage, 25);
});
test("old timestamp and explicit staleness are retained without downgrading demonstrated status or coverage", () => {
  const result = run([
    observation("React", "IMPLEMENTATION", "old", {
      timestamp: "2010-01-01",
      freshness: "STALE",
    }),
  ]);
  assert.equal(status(result).status, "DEMONSTRATED");
  assert.equal(result.coverage, 50);
  assert.equal(
    status(result).evidence[0].timestamp,
    "2010-01-01T00:00:00.000Z",
  );
  assert.equal(status(result).evidenceConfidence, "LOW");
  assert.ok(status(result).warnings.includes("stale_evidence"));
});
test("HIGH/MEDIUM/LOW/INSUFFICIENT confidence has explicit strength/independence/completeness/freshness criteria", () => {
  const strong = observation("React", "IMPLEMENTATION");
  assert.equal(
    status(run([strong, observation("React", "IMPLEMENTATION", "repo2")]))
      .evidenceConfidence,
    "HIGH",
  );
  assert.equal(status(run([strong])).evidenceConfidence, "MEDIUM");
  assert.equal(status(run([observation("React")])).evidenceConfidence, "LOW");
  assert.equal(
    status(run([observation("React", "CLAIM")])).evidenceConfidence,
    "LOW",
  );
  assert.equal(
    status(run([strong], { sources: [sources()[0]] })).evidenceConfidence,
    "LOW",
  );
  assert.equal(
    status(
      run([
        observation("React", "IMPLEMENTATION", "repo1", { timestamp: null }),
      ]),
    ).evidenceConfidence,
    "LOW",
  );
  assert.equal(status(run()).evidenceConfidence, "INSUFFICIENT");
  assert.equal(
    status(run([], { sources: [] })).evidenceConfidence,
    "INSUFFICIENT",
  );
});
test("aliases deduplicate actual equivalents and preserve Java/JavaScript, React/Native, .NET/C# and Shell/CI/CD", () => {
  assert.deepEqual(dictionary.normalize(["React.js", "reactjs", "React"]), [
    "React",
  ]);
  assert.deepEqual(
    dictionary.normalize([
      "Java",
      "JavaScript",
      "React",
      "React Native",
      ".NET",
      "C#",
      "Shell",
      "CI/CD",
      "HCL",
      "Terraform",
    ]),
    [
      "Java",
      "JavaScript",
      "React",
      "React Native",
      ".NET",
      "C#",
      "Shell",
      "CI/CD",
      "HCL",
      "Terraform",
    ],
  );
  assert.equal(dictionary.canonicalize("constructor"), "");
  const duplicate = run([observation("reactjs"), observation("React")], {
    requirements: requirements(["React.js", "React", "TypeScript"]),
  });
  assert.equal(duplicate.requiredSkills.length, 2);
  assert.equal(duplicate.coverage, 25);
});
test("versioned existing matrices preserve their entries, filters and equal weights without invented requirements", () => {
  for (const stack of Object.keys(dictionary.STACK_SKILLS))
    for (const level of Object.keys(dictionary.LEVEL_SKILLS)) {
      const matrix = dictionary.resolveRequirements(stack, level);
      assert.equal(matrix.available, true);
      assert.equal(matrix.version, "skill-gap-requirements-v1");
      assert.equal(
        new Set(matrix.skills.map((skill) => skill.name)).size,
        matrix.skills.length,
      );
      assert.ok(
        matrix.skills.every(
          (skill) => skill.requirement === "REQUIRED" && skill.weight === 1,
        ),
      );
      assert.ok(
        matrix.skills.some((skill) => skill.name === "Scalability Patterns"),
      );
    }
  assert.deepEqual(
    dictionary.resolveRequirements("", "invalid").missingEntries,
    ["careerStack:(absent)", "experienceLevel:invalid"],
  );
  assert.ok(
    !dictionary
      .resolveRequirements("Backend", "Student")
      .skills.some((skill) => skill.name === "Accessibility"),
  );
});
test("bounded evidence, category breakdown and calculation timestamps do not change facts", () => {
  const observations = Array.from({ length: 100 }, (_, index) =>
    observation("React", "METADATA", `repo${index}`, {
      rawResume: "secret",
      rawRepository: "secret",
    }),
  );
  const result = run(observations);
  assert.equal(status(result).evidence.length, 12);
  assert.equal(result.categoryBreakdown.Frontend.coverage, 25);
  assert.equal(result.ruleVersion, "skill-evidence-coverage-v1");
  assert.ok(!JSON.stringify(result).includes("secret"));
  const later = engine.calculate(
    { requirements: requirements(), observations, sources: sources() },
    { calculatedAt: "2027-01-01" },
  );
  assert.equal(later.coverage, result.coverage);
  assert.deepEqual(later.skills, result.skills);
  assert.equal(later.evidenceConfidence, result.evidenceConfidence);
});
test("historical scores are never relabeled or migrated by a new calculation", () => {
  const historical = {
    coverage: 87,
    ruleVersion: "skill-gap-coverage-v1",
    calculatedAt: "2026-01-01",
  };
  const before = JSON.stringify(historical);
  const result = run([observation("React", "CLAIM")], { historical });
  assert.equal(result.coverage, 0);
  assert.equal(JSON.stringify(historical), before);
});
test("genuine analyzed integration artifacts can establish coverage while absent core sources remain insufficient for confidence", () => {
  const result = run(
    [
      observation("React", "IMPLEMENTATION", "integration-artifact", {
        source: {
          type: "integration",
          id: "integration-artifact",
          origin: "verified-artifact",
        },
      }),
    ],
    {
      requirements: requirements(["React"]),
      sources: [
        {
          type: "integration",
          id: "integration-artifact",
          available: true,
          timestamp: time,
        },
      ],
    },
  );
  assert.equal(result.coverage, 100);
  assert.equal(result.demonstratedSkills.length, 1);
  assert.equal(result.evidenceConfidence, "INSUFFICIENT");
  assert.equal(result.evidenceCompleteness.availableCoreSources, 0);
});
test("conflicting equivalent requirement entries cannot silently alter the required denominator", () => {
  const result = run([observation("React", "IMPLEMENTATION")], {
    requirements: requirements([
      { name: "React.js", requirement: "OPTIONAL", weight: 1 },
      { name: "React", requirement: "REQUIRED", weight: 2 },
    ]),
  });
  assert.equal(result.coverage, null);
  assert.ok(result.warnings.includes("conflicting_requirement_entry:React"));
});
