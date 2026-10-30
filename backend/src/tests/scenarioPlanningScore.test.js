'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../services/scoring/scenarioPlanningScore');
const base = {
  ruleVersion: engine.RULE_VERSION,
  baselineHiringScore: 40,
  baselineJobMatch: 35,
  baselineConfirmed: true,
  baselineAuthority: 'user-assumption',
  role: 'frontend',
  experienceLevel: 'mid',
  durationWeeks: 24,
  skills: ['markdown', 'git', 'html', 'React'],
  projects: [],
};
test('v2 equivalent permutations have identical full results and evaluation identity', () => {
  const projects = [
    { name: 'A', impact: 100, complexity: 'high', weeks: 6 },
    { name: 'B', impact: 10, complexity: 'low', weeks: 1 },
  ];
  assert.deepEqual(
    engine.calculate({ ...base, projects }),
    engine.calculate({ ...base, skills: [...base.skills].reverse(), projects: [...projects].reverse() }),
  );
});
test('v2 retains zero contribution and strict assumptions/types', () => {
  const result = engine.calculate({
    ...base,
    skills: [],
    projects: [{ name: 'A', impact: 0, complexity: 'medium', weeks: 3 }],
  });
  assert.equal(result.projectDetails[0].pts, 0);
  for (const patch of [
    { durationWeeks: 0 },
    { durationWeeks: 1.2 },
    { baselineHiringScore: null },
    { baselineJobMatch: false },
    { skills: [{}] },
    { baselineConfirmed: false },
    { ruleVersion: 'future' },
    { baselineAuthority: 'verified' },
  ])
    assert.throws(
      () => engine.calculate({ ...base, ...patch }),
      (error) => error.statusCode === 400,
    );
});
test('v2 frozen rule inputs and bounded deterministic seeded calculations', () => {
  const custom = engine.calculate({ ...base, skills: ['__proto__', 'constructor', 'toString'] });
  assert(Number.isFinite(custom.breakdown.total));
  assert.throws(() => engine.calculate({ ...base, role: 'constructor' }));
  const rules = require('../services/scoring/scenarioPlanningRules');
  assert.throws(() => {
    rules.marketDemand.react = 100;
  });
  let seed = 12345;
  const random = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32;
  for (let index = 0; index < 1000; index++) {
    const input = {
      ...base,
      baselineHiringScore: random() * 100,
      baselineJobMatch: random() * 100,
      durationWeeks: 1 + Math.floor(random() * 24),
      projects: [
        {
          name: 'A',
          impact: Math.floor(random() * 101),
          complexity: 'high',
          weeks: 1 + Math.floor(random() * 24),
        },
      ],
    };
    const result = engine.calculate(input);
    assert.deepEqual(result, engine.calculate(input));
    for (const key of ['hiringScore', 'jobMatch']) {
      assert(Number.isFinite(result.predicted[key]));
      assert(result.predicted[key] >= 0 && result.predicted[key] <= 100);
      assert(result.improvements[key] >= 0 && result.improvements[key] <= (key === 'hiringScore' ? 40 : 29));
      assert(
        result.uncertaintyRange.low[key] <= result.predicted[key] &&
          result.predicted[key] <= result.uncertaintyRange.high[key],
      );
    }
    assert(result.meta.suggestedDurationWeeks <= 24);
  }
});
