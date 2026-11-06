'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { learningSkills } = require('../services/coursePersonalizationService');
const signals = (targets, status = 'evidence-informed') => ({
  targets,
  personalization: { status },
});
test('only current evidence targets supply normalized missing/partial learning skills', () => {
  assert.deepEqual(
    learningSkills(
      signals([
        { name: 'Docker', status: 'PARTIAL' },
        { name: 'docker', status: 'PARTIAL' },
        { name: 'nodejs', status: 'CLAIMED_ONLY' },
        { name: 'React', status: 'NOT_EVIDENCED' },
        { name: 'JavaScript', status: 'DEMONSTRATED' },
        { name: 'AWS', status: 'UNKNOWN' },
      ]),
    ),
    ['Docker', 'Node.js', 'React'],
  );
});
test('demonstrated aliases take precedence over contradictory learning targets', () => {
  assert.deepEqual(
    learningSkills(
      signals([
        { name: 'nodejs', status: 'PARTIAL' },
        { name: 'Node.js', status: 'DEMONSTRATED' },
      ]),
    ),
    [],
  );
});
test('absent, incompatible or career-only evidence never supplies catalog eligibility', () => {
  assert.deepEqual(
    learningSkills(signals([{ name: 'Docker', status: 'PARTIAL' }], 'career-context-only')),
    [],
  );
  assert.deepEqual(learningSkills({}), []);
});
test('career category eligibility excludes unrelated targets without changing Skill Gap scores', () => {
  assert.deepEqual(
    learningSkills(
      signals([
        { name: 'Angular', status: 'PARTIAL' },
        { name: 'Docker', status: 'PARTIAL' },
      ]),
      'Backend',
    ),
    ['Docker'],
  );
});
