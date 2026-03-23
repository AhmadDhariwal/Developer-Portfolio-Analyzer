const test = require('node:test');
const assert = require('node:assert/strict');
const { simulateHiringOutcome } = require('../services/scenarioSimulatorService');

test('simulateHiringOutcome returns bounded prediction with improvements', () => {
  const result = simulateHiringOutcome({
    baselineHiringScore: 52,
    baselineJobMatch: 47,
    skills: ['System Design', 'Docker', 'Kubernetes'],
    projects: [
      { name: 'Scalable API Platform', impact: 84, complexity: 'high', weeks: 6 },
      { name: 'Observability Dashboard', impact: 78, complexity: 'medium', weeks: 4 }
    ]
  });

  assert.ok(result.predicted.hiringScore >= 0 && result.predicted.hiringScore <= 100);
  assert.ok(result.predicted.jobMatch >= 0 && result.predicted.jobMatch <= 100);
  assert.ok(result.improvements.hiringScore >= 0);
  assert.ok(result.improvements.jobMatch >= 0);
  assert.ok(Array.isArray(result.assumptions.skillsConsidered));
});

test('simulateHiringOutcome normalizes duplicate skills and empty projects', () => {
  const result = simulateHiringOutcome({
    baselineHiringScore: 60,
    baselineJobMatch: 55,
    skills: ['React', 'react', 'React '],
    projects: []
  });

  assert.equal(result.assumptions.skillsConsidered.length, 1);
  assert.equal(result.assumptions.projectsConsidered.length, 0);
});
