'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../services/skillGapEvidenceService');
const requirements = require('../services/skillGapRequirements');
const contract = require('../services/skillGapCacheContract');
const context = require('../services/developerContextService');
const signals = require('../services/developerSignalService');
const Cache = require('../models/analysisCache');
const User = require('../models/user');
const at = '2026-11-02T00:00:00.000Z';
const user = {
  _id: 'owner',
  activeGithubUsername: 'Current-Dev',
  activeCareerStack: 'Backend',
  activeExperienceLevel: 'Student',
  activeResumeFileId: 'selected-file',
};
const resume = {
  _id: 'analysis-current',
  fileId: 'selected-file',
  userId: 'owner',
  analyzedAt: at,
};
const chain = (value) => ({
  sort() {
    return this;
  },
  select() {
    return this;
  },
  lean: async () => value,
});
function setup(t, row) {
  t.mock.method(context, 'loadUser', async () => user);
  t.mock.method(context, 'resolveResumeAnalysis', async () => resume);
  t.mock.method(User, 'findById', () => chain(user));
  t.mock.method(require('../models/analysis'), 'findOne', () =>
    chain({
      languageDistribution: { JavaScript: 100 },
    }),
  );
  t.mock.method(
    require('../services/integrationInsightService'),
    'getIntegrationInsight',
    async () => ({ mergedSkills: [], integrationScore: 0 }),
  );
  const queries = [];
  t.mock.method(Cache, 'findOne', (filter) => {
    queries.push(filter);
    return chain(row);
  });
  for (const name of ['weeklyReport', 'careerSprint', 'jobCache', 'news'])
    t.mock.method(require('../models/' + name), 'findOne', () => chain(null));
  t.mock.method(require('../models/userCourseProgress'), 'find', () => chain([]));
  const moduleId = require.resolve('../controllers/dashboardcontroller');
  delete require.cache[moduleId];
  t.after(() => {
    delete require.cache[moduleId];
  });
  return { dashboard: require(moduleId), queries };
}
function checkIdentity(filter) {
  const scope = contract.buildScope({
    userId: user._id,
    user,
    resumeIdentity: signals.buildResumeCacheIdentity({ resumeAnalysis: resume }),
  });
  for (const [key, value] of Object.entries(scope)) {
    if (key !== 'createdAt') assert.deepEqual(filter[key], value, key);
  }
  assert.ok(filter.createdAt.$gt instanceof Date);
  const regex = new RegExp(filter.githubUsername.$regex, filter.githubUsername.$options);
  assert.ok(regex.test('current-dev'));
  assert.ok(!regex.test('previous-dev'));
}

test('production adapter has a 50 percent ceiling across all 28 requirement combinations, never promoting claims or spoofed implementation fields', () => {
  let combinations = 0;
  for (const stack of Object.keys(requirements.STACK_SKILLS)) {
    for (const level of Object.keys(requirements.LEVEL_SKILLS)) {
      const required = requirements
        .resolveRequirements(stack, level)
        .skills.map((skill) => skill.name);
      const result = engine.resolve(
        {
          careerStack: stack,
          experienceLevel: level,
          githubData: {
            fetchedAt: at,
            dataAvailability: { repositories: 'complete', repositorySignals: 'complete' },
            repositories: [
              {
                name: 'synthetic-metadata',
                topics: required,
                inspected: true,
                meaningful: true,
                artifact: 'src/app.js',
                kind: 'IMPLEMENTATION',
              },
            ],
          },
          resumeAnalysis: { _id: 'resume', analyzedAt: at, technicalSkills: required },
          integrationSignal: { present: true, updatedAt: at, detectedSkills: required },
        },
        { calculatedAt: at },
      );
      combinations++;
      assert.equal(result.coverage, 50, stack + '/' + level);
      assert.equal(result.demonstratedSkills.length, 0);
      assert.ok(result.partialSkills.length > 0);
    }
  }
  assert.equal(combinations, 28);
});

test('cache scope binds owner, current GitHub, career, resume hash/id and supported producer/policy versions', () => {
  const identity = signals.buildResumeCacheIdentity({ resumeAnalysis: resume });
  const scope = contract.buildScope({ userId: user._id, user, resumeIdentity: identity });
  checkIdentity(scope);
  assert.equal(
    scope.analysisVersion,
    require('../controllers/skillgapcontroller').ANALYSIS_VERSION,
  );
  assert.notEqual(
    signals.buildResumeCacheIdentity({
      resumeAnalysis: { ...resume, analyzedAt: '2026-11-03' },
    }).resumeHash,
    scope.resumeHash,
  );
  const literal = contract.buildScope({
    userId: 'owner',
    user: { ...user, activeGithubUsername: 'a.b' },
    resumeIdentity: identity,
  });
  assert.ok(!new RegExp(literal.githubUsername.$regex).test('axb'));
});

test('Dashboard skills endpoint preserves null/zero and uses complete current identity; absent cache cannot fabricate canonical coverage', async (t) => {
  const row = {
    analysisData: { coverage: null, yourSkills: [{ name: 'JavaScript' }], missingSkills: [] },
  };
  const { dashboard, queries } = setup(t, row);
  const req = { user: { _id: 'owner' }, query: {} };
  const call = async () => {
    let body;
    const res = {
      json: (value) => {
        body = value;
      },
      status: (status) => {
        throw Error('HTTP ' + status);
      },
    };
    await dashboard.getDashboardSkills(req, res);
    return body;
  };
  assert.equal((await call()).coveragePercentage, null);
  row.analysisData.coverage = 0;
  assert.equal((await call()).coveragePercentage, 0);
  for (const query of queries) checkIdentity(query);
  t.mock.method(Cache, 'findOne', () => chain(null));
  assert.equal((await call()).coveragePercentage, null);
});

test('Dashboard context and Developer Signal consumers share the current scoped identity', async (t) => {
  const { dashboard, queries } = setup(t, null);
  await dashboard.__test.getCachedDashboardContext('owner', 'Backend', 'Student');
  checkIdentity(queries.find((query) => query.analysisVersion === contract.ANALYSIS_VERSION));
  const missing = await signals.summarizeSkillGapSignal('owner');
  checkIdentity(queries.at(-1));
  assert.equal(missing.coverage, null);
});

test('canonical null/zero overrides contradictory embedded Skill Gap summaries and remains null in signalsUsed', async (t) => {
  const row = { analysisData: { coverage: null, skillGapSignals: { coverage: 80 } } };
  setup(t, row);
  assert.equal((await signals.summarizeSkillGapSignal('owner')).coverage, null);
  row.analysisData.coverage = 0;
  assert.equal((await signals.summarizeSkillGapSignal('owner')).coverage, 0);
  for (const coverage of [null, 0, 50, 100]) {
    assert.equal(
      signals.buildSignalsUsedSummary({ signals: { skillGapSignals: { coverage } } }).skillGap
        .coverage,
      coverage,
    );
  }
});

test('target skill coverage presents canonical evidence without an invented job-demand bonus', (t) => {
  const { dashboard } = setup(t, null);
  const derive = (coverage) =>
    dashboard.__test
      .buildReadinessCenter({
        latestJob: { skills: ['JavaScript'] },
        latestSkillGapCache: { analysisData: { coverage } },
      })
      .find((item) => item.key === 'market').value;
  assert.equal(derive(null), null);
  assert.equal(derive(0), 0);
  assert.equal(derive(50), 50);
  assert.equal(derive(100), 100);
});

test('missing current Skill Gap evidence does not revive a cached portfolio breakdown or count-based zero', (t) => {
  const { dashboard } = setup(t, null);
  const derive = dashboard.__test.deriveReadinessBreakdown;
  assert.equal(derive({}).skillCoverage, null);
  assert.equal(
    derive({ portfolioScore: { breakdown: { skillCoverage: 88 } } }).skillCoverage,
    null,
  );
});

test('locked portfolio scorer distinguishes unavailable coverage from measured zero while preserving numeric legacy aliases', () => {
  const { calculateTransparentScore } = require('../services/transparentScoringService');
  const input = {
    careerStack: 'Backend',
    githubAnalysis: {
      scores: { codeQuality: 100, projectImpact: 100, consistency: 100, contribution: 100 },
    },
    resumeAnalysis: { atsScore: 100, keywordDensity: 100, contentQuality: 100, formatScore: 100 },
  };
  const missing = calculateTransparentScore({ ...input, skillGapAnalysis: { coverage: null } });
  const zero = calculateTransparentScore({ ...input, skillGapAnalysis: { coverage: 0 } });
  assert.equal(missing.scoring.breakdown.skillCoverage.available, false);
  assert.equal(missing.scoring.breakdown.skillCoverage.value, null);
  assert.equal(zero.scoring.breakdown.skillCoverage.available, true);
  assert.equal(zero.scoring.breakdown.skillCoverage.value, 0);
  assert.ok(missing.overallScore > zero.overallScore);
  // Compatibility aliases are numeric by contract; canonical availability is in scoring.
  assert.equal(missing.breakdown.skillCoverage, 0);
});
