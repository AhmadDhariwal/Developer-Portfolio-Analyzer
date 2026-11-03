'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../services/recommendationEngineService');
const base = { username: 'fixture', careerStack: 'Backend', experienceLevel: 'Intern' };

// Expected actions are authored independently from the engine's helpers and IDs.
const cases = [
  {
    name: 'unknown repository flags do not establish missing work',
    input: { githubData: { repositories: [{ name: 'api' }] } },
    expected: [['Review Backend evidence', 'Low', 'careerPaths']],
  },
  {
    name: 'explicit negative flags support exactly two corrective actions',
    input: { githubData: { repositories: [{ name: 'api', hasReadme: false, hasTests: false }] } },
    expected: [
      ['Document api', 'High', 'projects'],
      ['Add testing evidence to api', 'Medium', 'projects'],
    ],
  },
  {
    name: 'current positive flags suppress contradictory nested historical flags',
    input: {
      githubData: {
        repositories: [
          { name: 'api', hasReadme: true, hasTests: true, testing: { hasTests: false } },
        ],
      },
    },
    expected: [['Review Backend evidence', 'Low', 'careerPaths']],
  },
  {
    name: 'current resume sections suppress resolved warning codes',
    input: {
      resumeAnalysis: {
        _id: 'selected',
        resumeSignals: {
          sectionPresence: { projects: true },
          warnings: [
            { code: 'missing_projects_section', severity: 'high', message: 'Missing projects.' },
          ],
        },
      },
    },
    expected: [['Review Backend evidence', 'Low', 'careerPaths']],
  },
  {
    name: 'speculative AI resume concerns never become source warnings',
    input: {
      resumeAnalysis: {
        _id: 'selected',
        concerns: ['No quantified impact'],
        resumeSignals: { warnings: [] },
      },
    },
    expected: [['Review Backend evidence', 'Low', 'careerPaths']],
  },
  {
    name: 'all evidence statuses retain their distinct meaning',
    input: {
      skillGap: {
        skills: [
          { name: 'SQL', status: 'CLAIMED_ONLY', priority: 'High' },
          { name: 'Docker', status: 'NOT_EVIDENCED', priority: 'Medium' },
          { name: 'Testing', status: 'PARTIAL', priority: 'Medium' },
          { name: 'React', status: 'UNKNOWN' },
          { name: 'Node.js', status: 'DEMONSTRATED' },
        ],
      },
    },
    expected: [
      ['Build technical proof for SQL', 'High', 'learning'],
      ['Build technical proof for Docker', 'Medium', 'learning'],
      ['Build technical proof for Testing', 'Medium', 'learning'],
      ['Review evidence for React', 'Low', 'learning'],
    ],
  },
];

test('independent recommendation golden cases: no false positives or missing legitimate actions', () => {
  let falsePositives = 0;
  let missing = 0;
  let expectedTotal = 0;
  for (const fixture of cases) {
    const result = engine.buildPlan({ ...base, ...fixture.input });
    const actual = result.recommendations.map(({ title, priority, category }) => [
      title,
      priority,
      category,
    ]);
    const expected = fixture.expected.map(JSON.stringify).sort();
    const observed = actual.map(JSON.stringify).sort();
    falsePositives += observed.filter((item) => !expected.includes(item)).length;
    missing += expected.filter((item) => !observed.includes(item)).length;
    expectedTotal += expected.length;
    assert.deepEqual(observed, expected, fixture.name);
    assert.ok(
      result.recommendations.every((card) => card.evidence.length > 0 && card.sources.length > 0)
    );
    assert.deepEqual(
      result.recommendations,
      engine.buildPlan({ ...base, ...fixture.input }).recommendations
    );
  }
  assert.equal(expectedTotal, 10);
  assert.equal(falsePositives, 0);
  assert.equal(missing, 0);
});

test('four review horizons partition all ranked actions exactly once without time estimates', () => {
  const result = engine.buildPlan({
    ...base,
    githubData: {
      repositories: Array.from({ length: 20 }, (_, i) => ({
        name: `repo-${i}`,
        hasReadme: false,
        hasTests: false,
      })),
    },
  });
  const horizons = ['immediateActions', 'next30Days', 'next60Days', 'next90Days'].map(
    (key) => result.roadmap[key]
  );
  assert.deepEqual(
    horizons.map((items) => items.length),
    [4, 8, 12, 16]
  );
  assert.deepEqual(
    horizons.flat().map((card) => card.id),
    result.recommendations.map((card) => card.id)
  );
  assert.equal(new Set(horizons.flat().map((card) => card.id)).size, 40);
  assert.ok(
    horizons.flat().every((card) => card.estimatedImpact === null && card.estimatedEffort === '')
  );
});

test('current evidence policy, taxonomy, matrix and analysis version are mandatory', () => {
  const at = new Date().toISOString();
  const context = {
    ...base,
    userId: 'owner',
    resumeHash: 'no-resume',
    resumeAnalysisId: 'no-resume',
  };
  const data = {
    ruleVersion: engine.SKILL_RULE,
    evidencePolicyVersion: 'skill-gap-evidence-policy-v2',
    taxonomyVersion: 'skill-gap-taxonomy-v1',
    requirementMatrixVersion: 'skill-gap-requirements-v1',
  };
  const cache = {
    ...context,
    githubUsername: 'fixture',
    analysisVersion: 'v9-skill-evidence-governance',
    updatedAt: at,
    analysisData: data,
  };
  assert.ok(engine.compatibleSkillGap(cache, context));
  for (const field of ['evidencePolicyVersion', 'taxonomyVersion', 'requirementMatrixVersion']) {
    assert.equal(
      engine.compatibleSkillGap(
        { ...cache, analysisData: { ...data, [field]: 'obsolete' } },
        context
      ),
      null
    );
  }
  assert.equal(
    engine.compatibleSkillGap({ ...cache, analysisVersion: 'v6-skill-intelligence' }, context),
    null
  );
});
