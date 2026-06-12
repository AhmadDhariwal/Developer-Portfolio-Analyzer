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

test('simulateHiringOutcome is deterministic for the same skill-only plan', () => {
  const payload = {
    baselineHiringScore: 50,
    baselineJobMatch: 45,
    role: 'frontend',
    experienceLevel: 'junior',
    durationWeeks: 6,
    skills: ['React', 'TypeScript'],
    projects: []
  };

  const first = simulateHiringOutcome(payload);
  const second = simulateHiringOutcome(payload);

  assert.deepEqual(first.predicted, second.predicted);
  assert.equal(first.scenarioHash, second.scenarioHash);
  assert.ok(first.breakdown.skills > 0);
  assert.equal(first.breakdown.projects, 0);
});

test('simulateHiringOutcome supports project-only plans', () => {
  const result = simulateHiringOutcome({
    baselineHiringScore: 54,
    baselineJobMatch: 50,
    role: 'backend',
    experienceLevel: 'mid',
    durationWeeks: 8,
    skills: [],
    projects: [{ name: 'Production API', impact: 85, complexity: 'high', weeks: 6 }]
  });

  assert.equal(result.skillDetails.length, 0);
  assert.equal(result.projectDetails.length, 1);
  assert.ok(result.breakdown.projects > 0);
  assert.ok(result.suggestions.some((item) => item.includes('Add role-aligned skills')));
});

test('simulateHiringOutcome rewards skill and project synergy', () => {
  const skillOnly = simulateHiringOutcome({
    baselineHiringScore: 50,
    baselineJobMatch: 45,
    role: 'frontend',
    experienceLevel: 'mid',
    durationWeeks: 8,
    skills: ['React'],
    projects: []
  });

  const synergized = simulateHiringOutcome({
    baselineHiringScore: 50,
    baselineJobMatch: 45,
    role: 'frontend',
    experienceLevel: 'mid',
    durationWeeks: 8,
    skills: ['React'],
    projects: [{ name: 'React Dashboard', impact: 80, complexity: 'medium', weeks: 5 }]
  });

  assert.ok(synergized.breakdown.synergy > skillOnly.breakdown.synergy);
  assert.ok(synergized.improvements.hiringScore > skillOnly.improvements.hiringScore);
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

test('simulateHiringOutcome warns on very short overloaded plans and stays stable on long plans', () => {
  const short = simulateHiringOutcome({
    baselineHiringScore: 45,
    baselineJobMatch: 40,
    role: 'devops',
    experienceLevel: 'junior',
    durationWeeks: 1,
    skills: ['Docker', 'Kubernetes', 'Terraform', 'AWS', 'Linux'],
    projects: [{ name: 'Kubernetes Platform', impact: 90, complexity: 'high', weeks: 8 }]
  });

  const long = simulateHiringOutcome({
    baselineHiringScore: 45,
    baselineJobMatch: 40,
    role: 'devops',
    experienceLevel: 'junior',
    durationWeeks: 24,
    skills: ['Docker', 'Kubernetes', 'Terraform'],
    projects: [{ name: 'Kubernetes Platform', impact: 90, complexity: 'high', weeks: 8 }]
  });

  assert.equal(short.meta.overloaded, true);
  assert.ok(short.warnings.length > 0);
  assert.equal(long.meta.durationWeeks, 24);
  assert.ok(long.predicted.hiringScore <= 100);
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

test('sanitizeScenarioInput rejects no-input plans', () => {
  const result = sanitizeScenarioInput({
    baselineHiringScore: 50,
    baselineJobMatch: 50,
    skills: [],
    projects: []
  });

  assert.equal(result.isValid, false);
  assert.ok(result.errors.some((error) => error.field === 'plan'));
});

test('sanitizeScenarioInput removes duplicate skills and projects with warnings', () => {
  const result = sanitizeScenarioInput({
    baselineHiringScore: 50,
    baselineJobMatch: 50,
    durationWeeks: 6,
    skills: ['React', 'react', 'React '],
    projects: [
      { name: 'React Dashboard', impact: 80, complexity: 'medium', weeks: 4 },
      { name: 'react dashboard', impact: 70, complexity: 'medium', weeks: 3 }
    ]
  });

  assert.equal(result.isValid, true);
  assert.deepEqual(result.value.skills, ['React']);
  assert.equal(result.value.projects.length, 1);
  assert.ok(result.warnings.length >= 2);
});

test('sanitizeScenarioInput validates project fields', () => {
  const result = sanitizeScenarioInput({
    baselineHiringScore: 50,
    baselineJobMatch: 50,
    durationWeeks: 6,
    skills: [],
    projects: [{ name: 'Broken Plan', impact: 120, complexity: 'massive', weeks: 30 }]
  });

  assert.equal(result.isValid, false);
  assert.ok(result.errors.some((error) => error.field === 'projects[0].impact'));
  assert.ok(result.errors.some((error) => error.field === 'projects[0].complexity'));
  assert.ok(result.errors.some((error) => error.field === 'projects[0].weeks'));
});
