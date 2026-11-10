'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../services/scoring/scenarioPlanningScore');
const { getScenarioContext } = require('../services/scenarioContextService');
const input = {
  ruleVersion: engine.RULE_VERSION,
  baselineHiringScore: 30,
  baselineJobMatch: 30,
  baselineAuthority: 'user-assumption',
  baselineConfirmed: true,
  role: 'frontend',
  experienceLevel: 'mid',
  durationWeeks: 24,
  skills: [],
  projects: [],
};
test('v2 diminishing returns, sensitivity, capacity and zero-only project invariants', () => {
  const skills = Array.from({ length: 10 }, (_, index) => `custom${index}`);
  const result = engine.calculate({ ...input, skills });
  const points = result.skillDetails.map((item) => item.pts);
  assert(points[0] === points[2] && points[2] > points[3] && points[5] > points[6]);
  const project = { name: 'Showcase', impact: 0, complexity: 'low', weeks: 1 };
  const zero = engine.calculate({ ...input, projects: [project] });
  assert.equal(zero.breakdown.projects, 0);
  assert.deepEqual(zero.predicted, { hiringScore: 30, jobMatch: 30 });
  let previous = 0;
  for (const impact of [0, 20, 40, 60, 80, 100]) {
    const value = engine.calculate({ ...input, projects: [{ ...project, impact }] });
    assert(value.predicted.hiringScore >= previous);
    previous = value.predicted.hiringScore;
  }
  assert(
    engine.calculate({ ...input, skills: ['React'] }).improvements.hiringScore >
      engine.calculate({ ...input, skills: ['Markdown'] }).improvements.hiringScore,
  );
  const overloaded = engine.calculate({ ...input, durationWeeks: 1, skills });
  assert(overloaded.meta.overloaded);
  assert(overloaded.improvements.hiringScore < result.improvements.hiringScore);
});
test('context coalesces in-flight owned identity reads and revalidates after completion', async () => {
  const keys = [
    'github',
    'resume',
    'skillGap',
    'recommendations',
    'careerSprint',
    'portfolio',
    'integrations',
    'jobsDemand',
  ];
  let reads = 0;
  const adapters = Object.fromEntries(
    keys.map((key) => [
      key,
      async () => {
        reads++;
        await new Promise((resolve) => setImmediate(resolve));
        return null;
      },
    ]),
  );
  const options = { user: { careerStack: 'Frontend', experienceLevel: 'Student' }, adapters };
  const results = await Promise.all(
    Array.from({ length: 100 }, () => getScenarioContext('coalesced-owner', options)),
  );
  assert.equal(reads, 8);
  assert(results.every((value) => value === results[0]));
  await getScenarioContext('coalesced-owner', options);
  assert.equal(reads, 16);
  await Promise.all(
    ['coalesced-owner', 'another-owner'].map((owner) => getScenarioContext(owner, options)),
  );
  assert.equal(reads, 32);
});
