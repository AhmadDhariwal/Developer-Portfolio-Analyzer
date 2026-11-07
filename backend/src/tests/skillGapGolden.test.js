'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('../services/skillGapEvidenceService');
const requirements = require('../services/skillGapRequirements');
const { project } = require('../services/skillGapCompatibilityService');
const { buildSkillGraph, generateWeeklyLearningRoadmap } = require('../services/skillGraphService');
const { extractClaims } = require('../services/skillGapResumeClaimsService');
const at = '2026-11-02T00:00:00.000Z';
test('recorded public Octocat source replay credits original metadata and excludes fork-only Ruby', () => {
  const sourcePath = path.join(__dirname, '../../verification/github/octocat-source.json');
  const captures = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const capture = captures.find(
    (item) => item.status === 200 && item.url === 'https://api.github.com/users/octocat/repos'
  );
  assert.ok(capture);
  assert.equal(capture.data.length, 8);
  const result = engine.resolve(
    {
      careerStack: 'Frontend',
      experienceLevel: 'Student',
      githubData: {
        repositories: capture.data,
        cache: { cachedAt: capture.collectedAt, stale: true },
        dataAvailability: { repositories: 'complete', repositorySignals: 'partial' }
      }
    },
    { calculatedAt: at }
  );
  assert.equal(result.skills.find((skill) => skill.name === 'HTML').status, 'PARTIAL');
  assert.equal(result.skills.find((skill) => skill.name === 'CSS').status, 'PARTIAL');
  assert.ok(!result.skills.some((skill) => skill.name === 'Ruby'));
  assert.equal(result.demonstratedSkills.length, 0);
  const output = path.join(__dirname, '../../verification/skillgap');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(
    path.join(output, 'public-source-replay.json'),
    JSON.stringify(
      {
        kind: 'recorded-public-source-replay',
        freshLiveCall: false,
        profile: 'octocat',
        collectedAt: capture.collectedAt,
        source: capture.url,
        sourceSha256: require('node:crypto')
          .createHash('sha256')
          .update(fs.readFileSync(sourcePath))
          .digest('hex'),
        independentlyChecked: {
          HTML: 'PARTIAL',
          CSS: 'PARTIAL',
          Ruby: 'excluded fork-only metadata',
          demonstrated: 0
        },
        evidencePolicyVersion: result.evidencePolicyVersion
      },
      null,
      2
    ) + '\n'
  );
});
const sources = ['github', 'resume'].map((type) => ({
  type,
  id: type,
  available: true,
  completeness: 'COMPLETE',
  timestamp: at
}));
const observation = (skill, kind, origin = 'original', extras = {}) => ({
  skill,
  kind,
  source: { type: kind === 'CLAIM' ? 'resume' : 'github', id: origin, origin },
  artifact: 'src/feature.ts',
  timestamp: at,
  inspected: true,
  meaningful: true,
  ...extras
});
// Expectations were authored from evidence descriptions and manual arithmetic;
// no production detector/scorer is used to construct expected classifications.
const cases = [
  {
    name: 'implemented original component',
    observations: [observation('reactjs', 'IMPLEMENTATION')],
    expected: ['DEMONSTRATED', 'NOT_EVIDENCED'],
    coverage: 50
  },
  {
    name: 'dependency metadata only',
    observations: [observation('React', 'METADATA')],
    expected: ['PARTIAL', 'NOT_EVIDENCED'],
    coverage: 25
  },
  {
    name: 'resume claims only',
    observations: [observation('React', 'CLAIM')],
    expected: ['CLAIMED_ONLY', 'NOT_EVIDENCED'],
    coverage: 0
  },
  {
    name: 'complete empty account',
    observations: [],
    expected: ['NOT_EVIDENCED', 'NOT_EVIDENCED'],
    coverage: 0
  },
  {
    name: 'all providers unavailable',
    observations: [],
    sources: [],
    expected: ['UNKNOWN', 'UNKNOWN'],
    coverage: null
  },
  {
    name: 'partial API outage',
    observations: [observation('React', 'METADATA')],
    sources: [sources[0]],
    expected: ['PARTIAL', 'UNKNOWN'],
    coverage: null
  },
  {
    name: 'independent weak origins',
    observations: [
      observation('React', 'METADATA', 'one'),
      observation('React', 'METADATA', 'two')
    ],
    expected: ['PARTIAL', 'NOT_EVIDENCED'],
    coverage: 25
  },
  {
    name: 'copied artifact same origin',
    observations: [
      observation('React', 'IMPLEMENTATION'),
      observation('React', 'IMPLEMENTATION', 'original')
    ],
    expected: ['DEMONSTRATED', 'NOT_EVIDENCED'],
    coverage: 50
  },
  {
    name: 'conflicting technical sources',
    observations: [
      observation('React', 'IMPLEMENTATION'),
      observation('React', 'METADATA', 'conflict', { conflicting: true })
    ],
    expected: ['PARTIAL', 'NOT_EVIDENCED'],
    coverage: 25
  },
  {
    name: 'fully demonstrated independent skills',
    observations: [observation('React', 'IMPLEMENTATION'), observation('TS', 'IMPLEMENTATION')],
    expected: ['DEMONSTRATED', 'DEMONSTRATED'],
    coverage: 100
  },
  {
    name: 'metadata plus resume is still partial',
    observations: [observation('React', 'METADATA'), observation('React', 'CLAIM')],
    expected: ['PARTIAL', 'NOT_EVIDENCED'],
    coverage: 25
  }
];
test('independently specified classification and scoring golden corpus', () => {
  let correct = 0,
    positive = 0,
    predicted = 0,
    truePositive = 0,
    decisions = 0;
  const results = [];
  for (const fixture of cases) {
    const input = {
      requirements: {
        available: true,
        version: 'hand-authored-v1',
        skills: ['React', 'TypeScript'].map((name) => ({
          name,
          requirement: 'REQUIRED',
          weight: 1
        }))
      },
      observations: fixture.observations,
      sources: fixture.sources || sources
    };
    const actual = engine.calculate(input, { calculatedAt: at });
    assert.deepEqual(
      actual.skills.map((s) => s.status),
      fixture.expected,
      fixture.name
    );
    assert.equal(actual.coverage, fixture.coverage, fixture.name);
    assert.deepEqual(engine.calculate(input, { calculatedAt: at }), actual);
    actual.skills.forEach((skill, i) => {
      const expected = fixture.expected[i];
      correct += +(skill.status === expected);
      decisions++;
      const truth = ['DEMONSTRATED', 'PARTIAL'].includes(expected);
      const found = ['DEMONSTRATED', 'PARTIAL'].includes(skill.status);
      positive += +truth;
      predicted += +found;
      truePositive += +(truth && found);
    });
    results.push({
      name: fixture.name,
      coverage: actual.coverage,
      statuses: actual.skills.map((s) => s.status)
    });
    assert.ok(project(actual).missingSkills.every((s) => s.status !== 'UNKNOWN'));
  }
  const report = {
    corpus: 'synthetic independently authored fixtures; not a deployed accuracy claim',
    profiles: cases.length,
    decisions,
    classificationAccuracy: correct / decisions,
    precision: truePositive / predicted,
    recall: truePositive / positive,
    falsePositives: predicted - truePositive,
    falseNegatives: positive - truePositive,
    results
  };
  const output = path.join(__dirname, '../../verification/skillgap');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(
    path.join(output, 'golden-accuracy.json'),
    JSON.stringify(report, null, 2) + '\n'
  );
});
test('production adapter excludes forks/templates and does not infer implementation from names', () => {
  const result = engine.resolve(
    {
      careerStack: 'Frontend',
      experienceLevel: 'Student',
      githubData: {
        cache: { cachedAt: at },
        dataAvailability: { repositories: 'complete', repositorySignals: 'complete' },
        repositories: [
          { name: 'original', language: 'TypeScript' },
          { name: 'react-expert', language: 'JavaScript', topics: ['react'], fork: true },
          { name: 'copied', language: 'Java', topics: ['react'], isTemplate: true }
        ],
        languageDistribution: [{ language: 'Java' }]
      }
    },
    { calculatedAt: at }
  );
  assert.equal(result.skills.find((s) => s.name === 'TypeScript').status, 'PARTIAL');
  assert.equal(result.skills.find((s) => s.name === 'React').status, 'UNKNOWN');
  assert.ok(!result.skills.some((s) => s.name === 'Java'));
  assert.equal(result.demonstratedSkills.length, 0);
});
test('negative and aspirational resume clauses never create positive claims', () => {
  assert.deepEqual(
    extractClaims(
      'No experience with Docker; want to learn Kubernetes; Used TypeScript and React in projects'
    ),
    ['React', 'TypeScript']
  );
  assert.ok(
    !extractClaims('Never used Java. Planning to learn Python. Interested in learning Go.').length
  );
});
test('all four tracks and seven levels keep existing versioned positive-weight matrices', () => {
  let matrices = 0;
  for (const stack of Object.keys(requirements.STACK_SKILLS))
    for (const level of Object.keys(requirements.LEVEL_SKILLS)) {
      const matrix = requirements.resolveRequirements(stack, level);
      assert.equal(matrix.available, true);
      assert.equal(matrix.version, 'skill-gap-requirements-v1');
      assert.ok(matrix.skills.length);
      assert.equal(new Set(matrix.skills.map((s) => s.name)).size, matrix.skills.length);
      assert.ok(matrix.skills.every((s) => s.weight === 1 && s.requirement === 'REQUIRED'));
      matrices++;
    }
  assert.equal(matrices, 28);
});
test('roadmap golden ordering is acyclic, prerequisite-first, and never invents unknown gaps', () => {
  const graph = buildSkillGraph({
    currentSkills: [{ name: 'Git' }],
    missingSkills: [
      { name: 'Kubernetes', jobDemand: 99 },
      { name: 'Docker', jobDemand: 80 },
      { name: 'CI/CD', jobDemand: 90 }
    ],
    evidenceAware: true
  });
  assert.ok(
    graph.nodes.every(
      (node) => node.proficiency === null && node.proficiencyKind === 'uncalibrated'
    )
  );
  const weeks = generateWeeklyLearningRoadmap(graph, 8);
  const weekFor = (name) => weeks.find((w) => w.focusSkills.includes(name))?.week;
  assert.ok(weekFor('Docker') < weekFor('Kubernetes'));
  assert.ok(!weeks.some((w) => w.focusSkills.includes('Git')));
  assert.deepEqual(graph.nodes.map((n) => n.name).sort(), ['CI/CD', 'Docker', 'Git', 'Kubernetes']);
  assert.deepEqual(generateWeeklyLearningRoadmap(buildSkillGraph({ evidenceAware: true }), 8), []);
  const distinct = buildSkillGraph({
    currentSkills: [{ name: 'C#' }, { name: 'C++' }],
    evidenceAware: true
  });
  assert.equal(distinct.nodes.length, 2);
  assert.equal(new Set(distinct.nodes.map((node) => node.id)).size, 2);
  assert.ok(distinct.nodes.every((node) => node.difficulty === 'Applied evidence'));
  const redis = buildSkillGraph({ missingSkills: [{ name: 'Redis' }], evidenceAware: true });
  assert.ok(!redis.nodes.some((n) => n.name === 'PostgreSQL'));
  for (const edge of graph.edges)
    assert.ok(
      graph.nodes.find((n) => n.id === edge.from) && graph.nodes.find((n) => n.id === edge.to)
    );
});

test('temporary resume claims are scoped to the creating account/IP capability', async () => {
  const cache = new Map();
  const aiPath = require.resolve('../services/aiservice');
  const previous = require.cache[aiPath];
  require.cache[aiPath] = {
    id: aiPath,
    filename: aiPath,
    loaded: true,
    exports: {
      setSharedCache: async (key, value) => cache.set(key, value),
      getSharedCache: async (key) => cache.get(key)
    }
  };
  const servicePath = require.resolve('../services/previewResumeCacheService');
  delete require.cache[servicePath];
  try {
    const service = require(servicePath);
    const created = await service.createPreviewResume(
      'Used TypeScript. Never used Docker.',
      'account:one'
    );
    const own = await service.resolvePreviewResume({
      ...created,
      ownerScope: 'account:one',
      claimPolicy: 'skill-gap-v2'
    });
    assert.deepEqual(own.resumeInsights.skills, ['TypeScript']);
    const foreign = await service.resolvePreviewResume({
      ...created,
      ownerScope: 'account:two',
      claimPolicy: 'skill-gap-v2'
    });
    assert.equal(foreign.status, 400);
    assert.ok([...cache.values()].every((value) => !JSON.stringify(value).includes('Never used')));
  } finally {
    if (previous) require.cache[aiPath] = previous;
    else delete require.cache[aiPath];
    delete require.cache[servicePath];
  }
});
