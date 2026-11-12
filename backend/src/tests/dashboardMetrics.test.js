const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReadinessCenter } = require('../services/dashboardMetricsService');
const values = (input = {}) =>
  Object.fromEntries(buildReadinessCenter(input).map((item) => [item.key, item.value]));

test('missing evidence stays unavailable instead of inventing interview or market readiness', () => {
  const result = values({
    latestJob: { skills: ['TypeScript'] },
    latestWeeklyReport: { meta: { interview: { sessions: 1 } } },
  });
  assert.equal(result.interview, null);
  assert.equal(result.market, null);
  assert.equal(result.resume, null);
  assert.equal(result.portfolio, null);
  assert.equal(result.sprint, null);
});

test('measured zero remains zero across source-owned readiness dimensions', () => {
  const result = values({
    readinessScore: 0,
    integrationScore: 0,
    latestResume: { atsScore: 0, keywordDensity: 0, formatScore: 0, contentQuality: 0 },
    latestPortfolioCache: { analysisData: { portfolioScore: { overallScore: 0 } } },
    latestSkillGapCache: { analysisData: { coverage: 0 } },
    latestRecommendationCache: {
      analysisData: { recommendationScores: { interviewReadinessScore: 0 } },
    },
    latestCareerSprint: { tasks: [{ _id: 'pending', points: 5, isCompleted: false }] },
  });
  assert.ok(Object.values(result).every((value) => value === 0));
});

test('Sprint progress uses the authoritative weighted rule and ignores duplicate task IDs', () => {
  const task = { _id: 'done', points: 9, isCompleted: true };
  assert.equal(
    values({ latestCareerSprint: { tasks: [task, task, { _id: 'pending', points: 1 }] } }).sprint,
    90,
  );
});
