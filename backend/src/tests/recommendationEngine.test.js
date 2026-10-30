'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../services/recommendationEngineService');
const date = new Date().toISOString();
const githubData = {
  repositories: [{ name: 'api', hasReadme: false, hasTests: false }],
  githubSignals: { analyzedAt: date, scoring: { ruleVersion: 'github-health-score-v1', score: 0 } },
};
const resumeAnalysis = {
  _id: 'analysis-a',
  fileId: 'file-a',
  analyzedAt: date,
  scoring: {
    score: null,
    ruleVersion: 'resume-overall-score-v1',
    evidence: { facts: { quantifiedAchievementCount: 2 } },
  },
  resumeSignals: {
    skills: ['SQL'],
    warnings: [
      { code: 'missing_metrics', severity: 'high', message: 'Few metrics.' },
      { code: 'missing_projects_section', severity: 'high', message: 'Missing project section.' },
    ],
  },
};
const context = {
  userId: 'owner',
  username: 'dev',
  careerStack: 'Backend',
  experienceLevel: 'Intern',
  resumeHash: 'hash-a',
  resumeAnalysisId: 'analysis-a',
  sources: engine.sourceMetadata({ username: 'dev', githubData, resumeAnalysis }),
};
const skill = (name, status, requirement = 'REQUIRED') => ({
  name,
  status,
  requirement,
  evidenceConfidence: 'LOW',
});
const snapshot = (coverage = null) => ({
  ruleVersion: engine.SKILL_RULE,
  coverage,
  calculatedAt: date,
  skills: [
    skill('SQL', 'CLAIMED_ONLY'),
    skill('Testing', 'PARTIAL'),
    skill('Docker', 'NOT_EVIDENCED'),
    skill('React', 'UNKNOWN'),
    skill('Node.js', 'DEMONSTRATED'),
    skill('SQL', 'CLAIMED_ONLY'),
    skill('Optional', 'PARTIAL', 'OPTIONAL'),
  ],
  sourceReferences: Object.values(context.sources),
});
const cache = (coverage) => ({
  ...context,
  githubUsername: context.username,
  analysisData: snapshot(coverage),
  updatedAt: date,
});
const plan = (overrides = {}) =>
  engine.buildPlan({
    username: 'dev',
    careerStack: 'Backend',
    experienceLevel: 'Intern',
    githubData,
    resumeAnalysis,
    resumeInsights: engine.resumeSignals(resumeAnalysis),
    skillGap: snapshot(0),
    ...overrides,
  });

test('compatible snapshots preserve unavailable coverage and genuine zero', () => {
  assert.equal(engine.compatibleSkillGap(cache(null), context).coverage, null);
  assert.equal(engine.compatibleSkillGap(cache(0), context).coverage, 0);
  assert.equal(plan().sourceScores.githubHealth, 0);
  assert.equal(plan().sourceScores.resumeOverall, null);
  assert.equal(plan().sourceScores.skillEvidenceCoverage, 0);
  assert.equal(plan().recommendationScores.readinessScore, null);
});

test('ownership, identity, selected resume, stack, level, rule and timestamps are mandatory', () => {
  for (const changes of [
    { userId: 'foreign' },
    { githubUsername: 'other' },
    { resumeHash: 'other' },
    { resumeAnalysisId: 'analysis-b' },
    { careerStack: 'Frontend' },
    { experienceLevel: 'Student' },
    { updatedAt: '2000-01-01' },
    { analysisData: { ...snapshot(), ruleVersion: 'legacy' } },
    { analysisData: { ...snapshot(), cacheMetadata: { temporary: true } } },
  ]) {
    assert.equal(
      engine.compatibleSkillGap({ ...cache(), ...changes }, context),
      null,
      JSON.stringify(changes),
    );
  }
  const changedSources = {
    ...context,
    sources: {
      ...context.sources,
      github: { ...context.sources.github, timestamp: new Date(Date.now() + 1000).toISOString() },
    },
  };
  assert.equal(engine.compatibleSkillGap(cache(), changedSources), null);
  assert.equal(
    engine.compatibleSkillGap(cache(), {
      ...context,
      sources: { ...context.sources, github: { ...context.sources.github, freshness: 'STALE' } },
    }),
    null,
  );
});

test('claims, partial technical evidence and absent proof have distinct actionable language', () => {
  const result = plan();
  for (const status of ['CLAIMED_ONLY', 'PARTIAL', 'NOT_EVIDENCED', 'UNKNOWN'])
    assert.ok(result.recommendations.some((card) => card.evidenceStatus === status));
  assert.equal(
    result.technologies.some((item) => item.name === 'Node.js'),
    false,
  );
  const unknown = result.recommendations.find((card) => card.evidenceStatus === 'UNKNOWN');
  assert.equal(unknown.priority, 'Low');
  assert.match(unknown.actionableNextStep, /Review/);
  assert.doesNotMatch(
    JSON.stringify(result),
    /developer lacks|does not know|must learn|hiring probability|weeks/,
  );
});

test('stable IDs, priority order, required/optional rules and cross-source deduplication', () => {
  const first = plan();
  const reverse = plan({ skillGap: { ...snapshot(0), skills: [...snapshot(0).skills].reverse() } });
  assert.deepEqual(
    first.recommendations.map((item) => item.id),
    reverse.recommendations.map((item) => item.id),
  );
  assert.equal(
    new Set(first.recommendations.map((item) => item.id)).size,
    first.recommendations.length,
  );
  assert.equal(first.technologies.filter((item) => item.name === 'SQL').length, 1);
  assert.equal(first.technologies.find((item) => item.name === 'Optional').priority, 'Medium');
  assert.deepEqual(
    engine
      .rank([
        { id: 'low', priority: 'Low' },
        { id: 'high-b', priority: 'High', estimatedImpact: 5 },
        { id: 'high-a', priority: 'High', estimatedImpact: 6 },
      ])
      .map((item) => item.id),
    ['high-a', 'high-b', 'low'],
  );
});

test('current completion evidence suppresses resolved repository, skill and metrics work', () => {
  const result = plan({
    githubData: { ...githubData, repositories: [{ name: 'api', hasReadme: true, hasTests: true }] },
  });
  assert.equal(result.projects.length, 0);
  assert.equal(
    result.resumeRecommendations.some((item) => /outcomes/.test(item)),
    false,
  );
  const changes = engine.versionChanges(result, plan());
  assert.ok(changes.obsoleteRecommendations.length);
  assert.deepEqual(changes.completedRecommendations, []);
  assert.equal(changes.delta.scoreChange, null);
});

test('resume-only and GitHub-only sources produce useful actions without borrowing data', () => {
  const resumeOnly = plan({ githubData: {}, skillGap: null });
  assert.ok(resumeOnly.resumeRecommendations.length);
  assert.equal(resumeOnly.sourceMetadata.github.available, false);
  assert.equal(resumeOnly.sourceScores.skillEvidenceCoverage, null);
  const githubOnly = plan({ resumeAnalysis: null, resumeInsights: {}, skillGap: null });
  assert.ok(githubOnly.projects.length);
  assert.equal(githubOnly.resumeRecommendations.length, 0);
  assert.equal(githubOnly.sourceMetadata.resume.available, false);
});

test('AI ideas remain supplemental and unsupported facts, numbers, URLs and guarantees are rejected', () => {
  const result = plan();
  const before = JSON.stringify(result);
  const accepted = engine.safeSuggestions(
    {
      learningActions: [
        'Practice SQL joins in a small project',
        'You lack SQL skill',
        'SQL will raise your score by 30',
        'Guaranteed hiring after SQL',
        'Study SQL for two weeks',
        'Learn SQL at https://example.com',
        'Learn a completely unrelated language',
      ],
    },
    result,
  );
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].aiGenerated, true);
  assert.equal(JSON.stringify(result), before);
});

test('modern null scores never fall back to legacy ATS or convert boolean/empty values to zero', () => {
  const result = engine.resumeSignals({ ...resumeAnalysis, atsScore: 99 });
  assert.equal(result.overallScore, null);
  assert.equal(result.atsScore, null);
  for (const value of [null, undefined, '', ' ', [], {}, true, false, 'not-number'])
    assert.equal(engine.number(value), null);
  assert.equal(engine.number(0), 0);
});

test('source/profile revisions affect fingerprints; optional profile context stays factual', () => {
  assert.notEqual(
    engine.hash({ resumeAnalysis }),
    engine.hash({ resumeAnalysis: { ...resumeAnalysis, fileId: 'file-b' } }),
  );
  const result = plan({
    supportingSignals: { portfolioSignal: { present: true, listedProjects: 0, updatedAt: date } },
  });
  assert.ok(
    result.recommendations.some((item) =>
      item.factualSignals.some((fact) => fact.fact === 'Portfolio listedProjects: 0'),
    ),
  );
  assert.ok(
    result.recommendations.every(
      (item) =>
        item.ruleVersion === engine.RULE_VERSION && item.actionableNextStep && item.sources.length,
    ),
  );
});
