'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const fixture = require('./fixtures/scenarioMongo');
const User = require('../models/user');
const Sprint = require('../models/careerSprint');
const Scenario = require('../models/scenarioSimulation');
const { sprintWindow } = require('../utils/sprintCalendar');
const { exportScenario } = require('../services/scenarioSprintExportService');
test('P2 owned atomic receipts survive concurrent replay, edit, delete and draft ingestion', async (t) => {
  const mongo = await fixture.start();
  t.after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });
  await mongoose.connect(mongo.uri);
  await Promise.all([Sprint.init(), Scenario.init()]);
  const owner = new mongoose.Types.ObjectId();
  await User.create({
    _id: owner,
    name: 'Scenario fixture',
    email: `${owner}@example.invalid`,
    password: 'fixture',
  });
  const window = sprintWindow('America/New_York', '2026-11-01', '2026-11-07');
  const sprint = await Sprint.create({
    userId: owner,
    ...window,
    weekStartDate: window.sprintStartDate,
    weekEndDate: window.sprintEndDate,
  });
  const scenario = {
    name: 'Intent',
    scenarioHash: 'fixture-evaluation',
    durationWeeks: 24,
    skills: ['React', 'Docker'],
    projects: [{ name: 'A'.repeat(160), impact: 0, complexity: 'low', weeks: 3 }],
  };
  const results = await Promise.all(
    Array.from({ length: 50 }, () => exportScenario(owner, sprint._id, scenario, 'active-tasks')),
  );
  assert.equal(results.filter((result) => !result.replayed).length, 1);
  let saved = await Sprint.findById(sprint._id);
  assert.equal(saved.tasks.length, 3);
  assert.equal(saved.scenarioReceipts.length, 1);
  assert.equal(saved.xpPoints, 0);
  assert(
    saved.tasks.every(
      (task) =>
        !task.isCompleted && task.startDate >= saved.sprintStartDate && task.endDate <= saved.sprintEndDate,
    ),
  );
  saved.tasks[0].title = 'Edited';
  saved.tasks[1].deleteOne();
  await saved.save();
  assert((await exportScenario(owner, sprint._id, scenario, 'active-tasks')).replayed);
  assert.equal((await Sprint.findById(sprint._id)).tasks.length, 2);
  await assert.rejects(
    exportScenario(new mongoose.Types.ObjectId(), sprint._id, scenario),
    (error) => error.statusCode === 404,
  );
  const draft = await exportScenario(owner, sprint._id, scenario, 'draft');
  assert.equal(draft.tasksAdded, 0);
  saved = await Sprint.findById(sprint._id);
  assert.equal(saved.aiPlans.length, 1);
  assert.equal(saved.tasks.length, 2);
  const { mutateDraft } = require('../services/careerSprintService');
  const context = await require('../services/sprintDraftContextService').currentContext(owner);
  await mutateDraft(owner, sprint._id, saved.aiPlans[0]._id, [0, 1, 2], context.fingerprint);
  saved = await Sprint.findById(sprint._id);
  assert.equal(saved.tasks.length, 2, 'source item identity prevents replay even after edit/delete');
  saved.tasks.push({ title: 'Legacy imported work', sourceScenarioHash: 'old-hash', points: 3 });
  await saved.save();
  await assert.rejects(
    exportScenario(owner, sprint._id, { ...scenario, scenarioHash: 'old-hash' }, 'active-tasks'),
    (error) => error.statusCode === 409,
  );
  const referenceOwner = new mongoose.Types.ObjectId();
  const currentWindow = sprintWindow('Asia/Karachi');
  const current = await Sprint.create({
    userId: referenceOwner,
    ...currentWindow,
    weekStartDate: currentWindow.sprintStartDate,
    weekEndDate: currentWindow.sprintEndDate,
    currentStreak: 5,
    lastActiveDate: new Date('2026-01-01'),
  });
  const before = current.toObject();
  const id = await require('../services/scenarioSprintExportService').resolveCurrentSprintId(referenceOwner);
  assert.equal(String(id), String(current._id));
  assert.deepEqual(
    (await Sprint.findById(id)).toObject(),
    before,
    'Target lookup does not mutate inactivity, streak or display state.',
  );
});
