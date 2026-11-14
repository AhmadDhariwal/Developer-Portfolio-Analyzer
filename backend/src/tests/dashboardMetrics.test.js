const test = require("node:test");
const assert = require("node:assert/strict");
const { buildReadinessCenter } = require("../services/dashboardMetricsService");
const values = (input = {}) =>
  Object.fromEntries(
    buildReadinessCenter(input).map((item) => [item.key, item.value]),
  );

test("missing evidence stays unavailable instead of inventing interview or market readiness", () => {
  const result = values({
    latestJob: { skills: ["TypeScript"] },
    latestWeeklyReport: { meta: { interview: { sessions: 1 } } },
  });
  assert.equal(result.interview, null);
  assert.equal(result.market, null);
  assert.equal(result.resume, null);
  assert.equal(result.portfolio, null);
  assert.equal(result.sprint, null);
});

test("measured zero remains zero across source-owned readiness dimensions", () => {
  const result = values({
    readinessScore: 0,
    integrationScore: 0,
    latestResume: {
      atsScore: 0,
      keywordDensity: 0,
      formatScore: 0,
      contentQuality: 0,
    },
    latestPortfolioCache: {
      analysisData: { portfolioScore: { overallScore: 0 } },
    },
    latestSkillGapCache: { analysisData: { coverage: 0 } },
    latestRecommendationCache: {
      analysisData: { recommendationScores: { interviewReadinessScore: 0 } },
    },
    latestCareerSprint: {
      tasks: [{ _id: "pending", points: 5, isCompleted: false }],
    },
  });
  assert.ok(Object.values(result).every((value) => value === 0));
});

test("Sprint progress uses the authoritative weighted rule and ignores duplicate task IDs", () => {
  const task = { _id: "done", points: 9, isCompleted: true };
  assert.equal(
    values({
      latestCareerSprint: {
        tasks: [task, task, { _id: "pending", points: 1 }],
      },
    }).sprint,
    90,
  );
});

test("deriveReadinessBreakdown derives projectImpact from GitHub and integration evidence when saved portfolio score is absent", () => {
  const { deriveReadinessBreakdown } =
    require("../controllers/dashboardcontroller").__test;
  const analysis = {
    updatedAt: new Date(),
    githubSignals: {
      scoring: {
        breakdown: {
          projectImpact: { value: 25 },
          consistency: { value: 25 },
          contribution: { value: 100 },
        },
      },
    },
  };
  const integrationInsight = {
    providers: [{ provider: "github" }],
    integrationScore: 50,
  };
  // safeAverage([25, 25, 100, 50]) = 50
  const result = deriveReadinessBreakdown({ analysis, integrationInsight });
  assert.equal(result.projectImpact, 50);

  // Without integration, safeAverage([25, 25, 100]) = 50
  const noIntegration = deriveReadinessBreakdown({
    analysis,
    integrationInsight: { providers: [] },
  });
  assert.equal(noIntegration.projectImpact, 50);

  // Integration only without github
  const integrationOnly = deriveReadinessBreakdown({ integrationInsight });
  assert.equal(integrationOnly.projectImpact, 50);

  // Both missing -> null
  const empty = deriveReadinessBreakdown({});
  assert.equal(empty.projectImpact, null);

  // Measured zero preserved
  const zeroAnalysis = {
    updatedAt: new Date(),
    githubSignals: {
      scoring: {
        inputs: {
          projectImpact: 0,
          consistency: 0,
          contribution: 0,
        },
      },
    },
  };
  const zeroIntegration = {
    providers: [{ provider: "github" }],
    integrationScore: 0,
  };
  const zeroResult = deriveReadinessBreakdown({
    analysis: zeroAnalysis,
    integrationInsight: zeroIntegration,
  });
  assert.equal(zeroResult.projectImpact, 0);
});
