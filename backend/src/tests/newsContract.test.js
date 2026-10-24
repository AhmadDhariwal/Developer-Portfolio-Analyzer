const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./fixtures/newsHubRedisFixture');
const { buildNewsSkillEvidence } = require('../services/newsSkillEvidenceService');
const { rankNewsItems } = require('../utils/newsRanker');
const user = {
  _id: 'owner',
  activeGithubUsername: 'selected',
  activeResumeFileId: 'selected-resume',
  activeCareerStack: 'Frontend'
};
const signals = () => ({
  githubSignals: {
    present: true,
    username: 'selected',
    updatedAt: '2026-10-22T00:00:00Z',
    repositories: [{ name: 'repo', language: 'JavaScript', pushedAt: '2026-10-22T00:00:00Z' }],
    technologies: ['React']
  },
  resumeSignals: {
    analyzed: true,
    fileId: 'selected-resume',
    analysisId: 'analysis',
    skills: ['React'],
    technicalSkills: ['React'],
    lastAnalyzedAt: '2026-10-22T00:00:00Z'
  },
  skillGapSignals: { knownSkills: ['React'], provenSkills: ['React', 'Docker'] },
  recommendationSignal: { skills: { recommendedTechnologies: ['Docker'] } }
});
const context = (value = signals()) => ({
  careerStack: 'Frontend',
  experienceLevel: 'Student',
  knownSkills: ['React', 'JavaScript', 'Custom framework'],
  skillGaps: ['Docker'],
  recommendationTechnologies: ['Docker'],
  jobDemandSkills: ['SQL'],
  signals: value
});

test('news provenance reuses Skill Gap statuses without promoting claims, inferred summaries or recommendations', () => {
  const output = buildNewsSkillEvidence(user, context());
  const byName = Object.fromEntries(output.map((skill) => [skill.name, skill]));
  assert.equal(byName.React.status, 'CLAIMED_ONLY');
  assert.equal(byName.JavaScript.status, 'PARTIAL');
  assert.equal(byName.Docker.status, 'NOT_EVIDENCED');
  assert.equal(byName['Custom framework'].status, 'UNKNOWN');
  assert.equal(byName.SQL.status, 'UNKNOWN');
  assert.ok(output.every((skill) => skill.status !== 'DEMONSTRATED'));
  assert.equal(byName.React.evidence[0].kind, 'CLAIM');
  assert.equal(byName.React.evidence[0].type, 'resume');
  assert.equal(byName.JavaScript.evidence[0].kind, 'METADATA');
  assert.equal(byName.JavaScript.evidence[0].id, 'repo');
  assert.deepEqual(byName.Docker.evidence, []);
});

test('active GitHub/resume changes reject former-selection evidence and absent signals stay UNKNOWN', () => {
  const changed = buildNewsSkillEvidence(
    { ...user, activeGithubUsername: 'other', activeResumeFileId: 'other-resume' },
    context()
  );
  assert.ok(changed.every((skill) => skill.status === 'UNKNOWN'));
  assert.ok(changed.every((skill) => skill.evidence.length === 0));
  const missing = buildNewsSkillEvidence(user, context({}));
  assert.ok(missing.every((skill) => skill.status === 'UNKNOWN'));
});

test('integration and portfolio signals remain claims rather than inspected implementation', () => {
  const output = buildNewsSkillEvidence(user, {
    ...context({
      integrationSignal: { present: true, detectedSkills: ['React'] },
      portfolioSignal: { present: true, portfolioSkills: ['Docker'] }
    }),
    knownSkills: ['React', 'Docker']
  });
  assert.equal(output.find((skill) => skill.name === 'React').status, 'CLAIMED_ONLY');
  assert.equal(output.find((skill) => skill.name === 'Docker').status, 'CLAIMED_ONLY');
  assert.ok(output.every((skill) => skill.evidence.every((entry) => entry.kind === 'CLAIM')));
});

test('additive context/article provenance preserves ranking, legacy fields and per-account isolation', async () => {
  const item = {
    id: 'article',
    title: 'React JavaScript Docker update',
    description: '',
    url: 'https://example.com/news',
    source: 'Dev.to',
    category: 'Frontend',
    publishedAt: new Date(),
    popularity: 12,
    tags: []
  };
  const service = load('../services/newsService.js', {
    axios: { get: () => assert.fail('No provider calls allowed') },
    './newsPoolService': {
      readPool: async () => ({ allItems: [item], lastUpdated: new Date() }),
      freshness: () => 'fresh'
    },
    './developerSignalService': {
      getDeveloperSignals: async (id) => (id === 'owner' ? signals() : {}),
      buildSignalHash: () => 'synthetic'
    }
  });
  const currentUser = { ...user, activeExperienceLevel: 'Student' };
  const userContext = await service.buildUserContext(currentUser);
  const before = rankNewsItems([item], userContext)[0];
  const feed = await service.getNewsFeed({ user: currentUser, query: {} });
  const after = feed.items[0];
  for (const field of [
    'rankScore',
    'relevanceScore',
    'relatedSkills',
    'relatedSkillGaps',
    'relevanceReasons',
    'demandTags'
  ])
    assert.deepEqual(after[field], before[field]);
  assert.ok(feed.recommendedBasedOn.detectedSkills.includes('React'));
  assert.equal(feed.recommendedBasedOn.skillEvidenceRuleVersion, 'skill-evidence-coverage-v1');
  assert.equal(after.relatedSkillEvidence.find((skill) => skill.name === 'React').status, 'CLAIMED_ONLY');
  assert.ok(after.relatedSkillEvidence.some((skill) => skill.name === 'Docker' && skill.evidence.length === 0));
  const other = await service.getNewsFeed({ user: { _id: 'other', activeCareerStack: 'Frontend' }, query: {} });
  assert.deepEqual(other.recommendedBasedOn.skillEvidence, []);
  assert.deepEqual(other.items[0].relatedSkillEvidence, []);
});

test('read-state input validation rejects coercion, history injection and owner injection before querying', async () => {
  const controller = load('../controllers/newsController.js', {
    '../models/newsSavedItem': { findOneAndUpdate: () => assert.fail('Invalid input must not query') },
    '../services/newsService': {}
  });
  for (const body of [
    null,
    [],
    true,
    { read: 'false' },
    { read: 0 },
    { read: null },
    { read: false, readAt: null },
    { userId: 'foreign' }
  ]) {
    let status;
    await controller.markSavedNewsAsRead(
      { body, params: { id: 'a'.repeat(24) }, user: { _id: 'owner' } },
      {
        status(code) {
          status = code;
          return { json() {} };
        }
      }
    );
    assert.equal(status, 400);
  }
});
