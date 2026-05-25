const test = require('node:test');
const assert = require('node:assert/strict');
const {
  simulateHiringOutcome,
  sanitizeScenarioInput
} = require('../services/scenarioSimulatorService');

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
  assert.ok(result.confidenceScore >= 0 && result.confidenceScore <= 100);
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

test('simulateHiringOutcome exposes an ordered uncertainty range', () => {
  const result = simulateHiringOutcome({
    baselineHiringScore: 48,
    baselineJobMatch: 42,
    role: 'backend',
    experienceLevel: 'junior',
    durationWeeks: 8,
    skills: ['Node.js', 'Docker', 'PostgreSQL'],
    projects: [{ name: 'Production API', impact: 82, complexity: 'high', weeks: 6 }]
  });

  assert.ok(result.uncertaintyRange.low.hiringScore <= result.uncertaintyRange.expected.hiringScore);
  assert.ok(result.uncertaintyRange.expected.hiringScore <= result.uncertaintyRange.high.hiringScore);
  assert.ok(result.uncertaintyRange.low.jobMatch <= result.uncertaintyRange.expected.jobMatch);
  assert.ok(result.uncertaintyRange.expected.jobMatch <= result.uncertaintyRange.high.jobMatch);
});

test('simulateHiringOutcome lowers confidence for overloaded low-relevance plans', () => {
  const focused = simulateHiringOutcome({
    baselineHiringScore: 50,
    baselineJobMatch: 46,
    role: 'frontend',
    experienceLevel: 'junior',
    durationWeeks: 8,
    skills: ['React', 'TypeScript', 'Next.js'],
    projects: [{ name: 'React Commerce App', impact: 84, complexity: 'medium', weeks: 5 }]
  });

  const overloaded = simulateHiringOutcome({
    baselineHiringScore: 50,
    baselineJobMatch: 46,
    role: 'backend',
    experienceLevel: 'junior',
    durationWeeks: 2,
    skills: ['React', 'Vue', 'Angular', 'Svelte', 'Tailwind', 'Figma', 'Kubernetes'],
    projects: [
      { name: 'Frontend Design System', impact: 85, complexity: 'high', weeks: 8 },
      { name: 'Animation Playground', impact: 78, complexity: 'medium', weeks: 5 }
    ]
  });

  assert.ok(overloaded.confidenceScore < focused.confidenceScore);
  assert.ok(overloaded.meta.suggestedDurationWeeks >= overloaded.meta.durationWeeks);
});

test('sanitizeScenarioInput returns clear validation errors', () => {
  const result = sanitizeScenarioInput({
    baselineHiringScore: 140,
    baselineJobMatch: -5,
    skills: [],
    projects: [{ name: '', impact: 70, complexity: 'medium', weeks: 3 }]
  });

  assert.equal(result.isValid, false);
  assert.ok(result.errors.some((error) => error.field === 'baselineHiringScore'));
  assert.ok(result.errors.some((error) => error.field === 'baselineJobMatch'));
  assert.ok(result.errors.some((error) => error.field === 'projects[0].name'));
});
