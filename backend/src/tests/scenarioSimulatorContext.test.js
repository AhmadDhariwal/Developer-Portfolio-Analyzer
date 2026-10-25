'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { collect, getScenarioContext } = require('../services/scenarioContextService');
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
test('selected-context mismatch excludes stale Skill Gap suggestions without discarding other sources', async () => {
  const now = new Date();
  const adapters = Object.fromEntries(keys.map((key) => [key, () => null]));
  adapters.skillGap = () => ({
    _id: 'old',
    updatedAt: now,
    resumeAnalysisId: 'old-resume',
    analysisData: {
      ruleVersion: 'skill-evidence-coverage-v1',
      skills: [{ name: 'Docker', status: 'NOT_EVIDENCED' }],
    },
  });
  const context = await getScenarioContext('owner', {
    user: { careerStack: 'Frontend', experienceLevel: 'Student' },
    adapters,
    now,
  });
  assert.equal(context.sources.find((source) => source.key === 'skillGap').status, 'incompatible');
  assert.deepEqual(context.signals.missingSkills, []);
});
test('all eight independent failures retain healthy sources and classify failures', async () => {
  const now = new Date('2026-10-25T00:00:00Z');
  for (const failed of keys) {
    const adapters = Object.fromEntries(
      keys.map((key) => [
        key,
        async () => {
          if (key === failed) throw Error('fixture');
          return { _id: key, updatedAt: now, expiresAt: new Date(+now + 86400000) };
        },
      ]),
    );
    const sources = await collect(adapters, { now });
    assert.equal(sources.find((item) => item.key === failed).status, 'error');
    assert.equal(sources.filter((item) => item.status === 'available').length, 7);
  }
});
test('successful source reads are not aborted after completion', async () => {
  let aborted = 0;
  const adapters = Object.fromEntries(
    keys.map((key) => [
      key,
      (signal) => {
        signal.addEventListener('abort', () => aborted++);
        return null;
      },
    ]),
  );
  await collect(adapters);
  assert.equal(aborted, 0, 'Only timeout/cancellation should abort database operations.');
});
test('bounded fanout aborts hung sources and releases pending admission', async () => {
  let concurrent = 0;
  let maximum = 0;
  let aborted = 0;
  const adapters = Object.fromEntries(
    keys.map((key) => [
      key,
      (signal) =>
        new Promise((resolve) => {
          concurrent++;
          maximum = Math.max(maximum, concurrent);
          signal.addEventListener(
            'abort',
            () => {
              aborted++;
              concurrent--;
              resolve(null);
            },
            { once: true },
          );
        }),
    ]),
  );
  const context = await getScenarioContext('fixture', {
    user: { careerStack: 'Frontend' },
    adapters,
    sourceTimeoutMs: 10,
  });
  assert(maximum <= 4);
  assert.equal(aborted, 8);
  assert(context.degraded);
  assert.equal(context.sources.length, 8);
  const recovered = await getScenarioContext('fixture', {
    user: { careerStack: 'Frontend' },
    adapters: Object.fromEntries(keys.map((key) => [key, () => null])),
  });
  assert.equal(recovered.degraded, false);
});
