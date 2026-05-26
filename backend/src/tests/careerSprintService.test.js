const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calcWeightedProgress,
  xpForTask,
  levelFromXp
} = require('../services/careerSprintService');

test('calcWeightedProgress uses task points and completion state', () => {
  const progress = calcWeightedProgress([
    { title: 'Learn Docker', points: 4, isCompleted: true },
    { title: 'Build API', points: 6, isCompleted: false }
  ]);

  assert.equal(progress, 40);
});

test('xpForTask adds base XP by priority plus task points', () => {
  assert.equal(xpForTask({ priority: 'high', points: 5 }), 20);
  assert.equal(xpForTask({ priority: 'medium', points: 3 }), 13);
  assert.equal(xpForTask({ priority: 'low', points: 2 }), 7);
});

test('levelFromXp advances one level per 100 XP bucket', () => {
  assert.equal(levelFromXp(0), 1);
  assert.equal(levelFromXp(99), 1);
  assert.equal(levelFromXp(100), 2);
  assert.equal(levelFromXp(245), 3);
});
