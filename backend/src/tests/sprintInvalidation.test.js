'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const calls = [];
const mock = (name, exports) => {
  const filename = require.resolve(name);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
mock('../services/careerSprintService', {
  assertObjectId: () => {},
  restoreStreak: async () => ({ _id: 'sprint' }),
  saveAiPlanToSprint: async () => ({ _id: 'sprint' }),
  importScenarioPlanToSprint: async () => ({ _id: 'sprint' }),
  mutateDraft: async () => ({ _id: 'sprint' }),
  toggleTaskCompletion: async () => ({ _id: 'sprint' })
});
mock('../services/aiTaskService', {});
mock('./../controllers/dashboardcontroller', { invalidateDashboardSummaryCache: () => calls.push('dashboard') });
mock('../services/scenarioSimulatorService', { invalidateContextCache: () => calls.push('scenario') });
mock('../services/newsService', { invalidateNewsSignalCache: () => calls.push('news') });
const controller = require('../controllers/careerSprintController');
const request = {
  user: { _id: 'owner' },
  params: { id: 'sprint', taskId: 'task', planId: 'draft' },
  body: {}
};
const response = { json: () => {} };

test('draft-only operations and restoration preserve News personalization and refresh activity consumers', async () => {
  for (const action of [
    'restoreCareerStreakController',
    'saveAiPlanController',
    'importScenarioPlanController',
    'deleteAiPlanController'
  ]) {
    calls.length = 0;
    await controller[action](request, response);
    assert.deepEqual(calls, ['dashboard', 'scenario'], action);
  }
});

test('real task transitions and draft ingestion still invalidate News task context', async () => {
  for (const [action, body] of [
    ['updateCareerSprintTask', { isCompleted: true }],
    ['addDraftTasksController', { taskIndexes: [0] }]
  ]) {
    calls.length = 0;
    await controller[action]({ ...request, body }, response);
    assert.deepEqual(calls, ['dashboard', 'scenario', 'news'], action);
  }
});
