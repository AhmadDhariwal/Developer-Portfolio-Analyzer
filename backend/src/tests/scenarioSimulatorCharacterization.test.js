'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/scenarioSimulatorService');
const base = {
  baselineHiringScore: 40,
  baselineJobMatch: 35,
  role: 'frontend',
  experienceLevel: 'mid',
  durationWeeks: 24,
  skills: [],
  projects: [],
};

test('P0 legacy golden fixtures preserve order-sensitive outputs and identity collision', () => {
  const projects = [
    { name: 'A', impact: 100, complexity: 'high', weeks: 6 },
    { name: 'B', impact: 10, complexity: 'low', weeks: 1 },
  ];
  const first = service.simulateHiringOutcome({ ...base, projects });
  const reversed = service.simulateHiringOutcome({ ...base, projects: [...projects].reverse() });
  assert.deepEqual(first.predicted, { hiringScore: 56, jobMatch: 47 });
  assert.deepEqual(reversed.predicted, { hiringScore: 53, jobMatch: 45 });
  assert.equal(first.scenarioHash, reversed.scenarioHash);
});

test('P0 characterizes legacy zero and coercion defects without endorsing them', () => {
  const result = service.simulateHiringOutcome({
    ...base,
    projects: [{ name: 'A', impact: 0, complexity: 'medium', weeks: 3 }],
  });
  assert.equal(result.projectDetails[0].pts, 6.6);
  const normalized = service.sanitizeScenarioInput({
    ...base,
    durationWeeks: 0,
    baselineHiringScore: null,
    baselineJobMatch: false,
    skills: [{}],
  });
  assert.equal(normalized.isValid, true);
  assert.equal(normalized.value.durationWeeks, 6);
});

test('P0 persistence has owned unique and history indexes and protected API routes', () => {
  const model = require('../models/scenarioSimulation');
  assert.ok(
    model.schema
      .indexes()
      .some(([key, options]) => key.userId === 1 && key.scenarioHash === 1 && options.unique),
  );
  const router = require('../routes/scenarioSimulator.routes');
  for (const layer of router.stack.filter((entry) => entry.route)) {
    assert.equal(layer.route.stack[0].handle.name, 'protect');
  }
});
