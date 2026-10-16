'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
process.env.CAREER_SPRINT_AI_TIMEOUT_MS = '2000';
const mock = (request, exports) => {
  const filename = require.resolve(request);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
const query = (value) => ({
  select() {
    return this;
  },
  sort() {
    return this;
  },
  limit() {
    return this;
  },
  lean() {
    return Promise.resolve(value);
  }
});
let existingTitles = [];
mock('../models/user', { findById: () => query({ careerStack: 'Frontend', experienceLevel: 'Intern' }) });
mock('../models/recommendation', { find: () => query([]) });
mock('../models/careerSprint', { find: () => query([{ tasks: existingTitles.map((title) => ({ title })) }]) });
mock('../services/developerSignalService', { getDeveloperSignals: async () => ({}) });
let calls = 0;
let provider = async () => ({ ok: false });
mock('../services/aiservice', {
  getSharedCache: async () => null,
  setSharedCache: async () => {},
  runAIAnalysis: async (...args) => {
    calls++;
    return provider(...args);
  }
});
const planner = require('../services/aiTaskService');
const input = (userId) => ({
  userId,
  technology: 'React',
  sprintStartDate: '2026-10-15',
  sprintEndDate: '2026-10-21',
  forceRefresh: true
});
const tasks = Array.from({ length: 6 }, (_, index) => ({
  title: `Build React feature ${index + 1}`,
  description: `Implement a measurable React component for the Frontend Intern portfolio, part ${index + 1}.`,
  category: ['learning', 'project', 'practice'][index % 3]
}));

test('ordinary deterministic previews use no AI and disclose missing evidence', async () => {
  const before = calls;
  const result = await planner.generateTasks(input('deterministic'));
  assert.equal(calls, before);
  assert.equal(result.planMeta.generationMode, 'deterministic');
  assert.ok(result.planMeta.limitations.length > 0);
  assert.ok(result.tasks.every((task) => task.isCompleted !== true));
});

test('explicit AI preview uses validated text and deterministic points, dates and priorities', async () => {
  provider = async (prompt, _fallback, retries, options) => {
    assert.equal(retries, 0);
    assert.equal(options.returnMeta, true);
    return { ok: true, value: { taskIds: JSON.parse(prompt).targets.map((target) => target.id) } };
  };
  const result = await planner.generateAiTasksWithLLM(input('success'));
  assert.equal(result.planMeta.generationMode, 'llm');
  assert.ok(result.tasks.length >= 6 && result.tasks.length <= 8);
  assert.ok(result.tasks.every((task) => task.points >= 1 && task.points <= 10 && task.startDate && task.endDate));
});

test('AI provider rejection and polluted output fall back without persisting scores', async () => {
  for (const [userId, implementation] of [
    [
      'rejected',
      async () => {
        throw new Error('private provider failure');
      }
    ],
    ['polluted', async () => ({ ok: true, value: { tasks, xpPoints: 999 } })],
    ['invalid', async () => ({ ok: true, value: { tasks: [{ title: 'Unsafe <script>' }] } })]
  ]) {
    provider = implementation;
    const result = await planner.generateAiTasksWithLLM(input(userId));
    assert.equal(result.planMeta.generationMode, 'deterministic');
    assert.equal(result.planMeta.providerLabel, 'Deterministic Plan');
    assert.ok(result.tasks.length > 0);
    assert.equal(result.xpPoints, undefined);
  }
});

test('rapid explicit refresh requests share one provider call', async () => {
  provider = async (prompt) => {
    await new Promise((resolve) => setImmediate(resolve));
    return { ok: true, value: { taskIds: JSON.parse(prompt).targets.map((target) => target.id) } };
  };
  const before = calls;
  const results = await Promise.all(
    Array.from({ length: 5 }, () => planner.generateAiTasksWithLLM(input('concurrent')))
  );
  assert.equal(calls - before, 1);
  assert.ok(results.every((result) => result.planMeta.generationMode === 'llm'));
});

test('hung provider returns deterministic preview within the configured timeout', async () => {
  provider = () => new Promise(() => {});
  const keepAlive = setInterval(() => {}, 100);
  try {
    const started = Date.now();
    const result = await planner.generateAiTasksWithLLM(input('timeout'));
    assert.equal(result.planMeta.generationMode, 'deterministic');
    assert.ok(Date.now() - started < 3000);
  } finally {
    clearInterval(keepAlive);
  }
});

test('existing imported or completed work is omitted from new previews', async () => {
  existingTitles = (await planner.generateTasks(input('existing-baseline'))).tasks.map((task) => task.title);
  provider = async () => ({ ok: true, value: { tasks } });
  const result = await planner.generateAiTasksWithLLM(input('existing'));
  assert.equal(result.tasks.length, 0);
  existingTitles = [];
});
