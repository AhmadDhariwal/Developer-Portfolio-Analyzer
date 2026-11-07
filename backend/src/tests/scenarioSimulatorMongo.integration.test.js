'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const fixture = require('./fixtures/scenarioMongo');
const engine = require('../services/scoring/scenarioPlanningScore');
const service = require('../services/scenarioSimulatorService');
const Scenario = require('../models/scenarioSimulation');
const input = {
  ruleVersion: engine.RULE_VERSION,
  baselineHiringScore: 40,
  baselineJobMatch: 35,
  baselineAuthority: 'user-assumption',
  baselineConfirmed: true,
  role: 'frontend',
  experienceLevel: 'mid',
  durationWeeks: 6,
  skills: ['React'],
  projects: [],
};
test('P1 disposable Mongo: unique immutable snapshots, replay, ownership and cursor history', async (t) => {
  const mongo = await fixture.start();
  t.after(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });
  await mongoose.connect(mongo.uri, { serverSelectionTimeoutMS: 3000 });
  await Scenario.init();
  const indexes = await Scenario.collection.indexes();
  assert(indexes.some((item) => item.unique && item.key.userId === 1 && item.key.scenarioHash === 1));
  assert(indexes.some((item) => item.key.userId === 1 && item.key.createdAt === -1 && item.key._id === -1));
  const owner = new mongoose.Types.ObjectId();
  const foreign = new mongoose.Types.ObjectId();
  const payload = { ...input, evaluation: engine.calculate(input).evaluation };
  const results = await Promise.all(
    Array.from({ length: 100 }, () => service.saveScenarioForUser(owner, payload)),
  );
  assert.equal(new Set(results.map((item) => String(item._id))).size, 1);
  assert.equal(await Scenario.countDocuments({ userId: owner }), 1);
  const first = results[0];
  const replay = await service.saveScenarioForUser(owner, { ...payload, name: 'Do not overwrite' });
  assert.deepEqual(replay, first);
  assert.equal(await service.deleteScenarioForUser(foreign, first._id), false);
  assert.equal((await service.getScenarioHistoryForUser(foreign)).history.length, 0);
  await assert.rejects(
    service.saveScenarioForUser(owner, { ...payload, skills: ['Docker'] }),
    (error) => error.statusCode === 409,
  );
  for (let index = 0; index < 4; index++) {
    const next = { ...input, baselineHiringScore: index };
    await service.saveScenarioForUser(owner, { ...next, evaluation: engine.calculate(next).evaluation });
  }
  const ids = [];
  let cursor;
  do {
    const page = await service.getScenarioHistoryForUser(owner, 2, { cursor });
    ids.push(...page.history.map((item) => String(item._id)));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(ids.length, 5);
  assert.equal(new Set(ids).size, 5);
  assert(await service.deleteScenarioForUser(owner, first._id));
  assert.equal((await service.getScenarioHistoryForUser(owner)).history.length, 4);
  const User = require('../models/user');
  const ResumeFile = require('../models/resumeFile');
  const ResumeAnalysis = require('../models/resumeAnalysis');
  const fileId = new mongoose.Types.ObjectId();
  const unanalyzed = new mongoose.Types.ObjectId();
  await User.create({
    _id: owner,
    name: 'Selected source fixture',
    email: `${owner}@example.invalid`,
    authProvider: 'github',
    providers: ['github'],
    activeResumeFileId: fileId,
  });
  await ResumeFile.collection.insertMany([
    { _id: fileId, userId: owner, fileName: 'one.pdf', uploadDate: new Date() },
    { _id: unanalyzed, userId: owner, fileName: 'two.pdf', uploadDate: new Date() },
  ]);
  await ResumeAnalysis.collection.insertOne({
    userId: owner,
    fileId,
    skills: { technical: ['Claimed Rust'] },
    atsScore: 0,
    analyzedAt: new Date(),
  });
  const selected = await service.getScenarioContext(owner);
  assert.deepEqual(selected.signals.claimedSkills, ['Claimed Rust']);
  assert.equal(
    selected.profile.baselineHiringScore,
    55,
    'zero ATS is not averaged into a fabricated baseline',
  );
  assert.equal(selected.dataTrust.baselineHiringScore.authority, 'user-assumption');
  await User.updateOne({ _id: owner }, { $set: { activeResumeFileId: unanalyzed } });
  const changed = await service.getScenarioContext(owner);
  assert.equal(changed.profile.resumeFileId, String(unanalyzed));
  assert.equal(changed.sources.find((source) => source.key === 'resume').status, 'missing');
  assert.deepEqual(changed.signals.claimedSkills, []);
  await require('../models/recommendation').collection.insertMany([
    {
      userId: owner,
      careerStack: 'Full Stack',
      experienceLevel: 'Student',
      techStack: ['Current target'],
      createdAt: new Date(),
    },
    {
      userId: owner,
      careerStack: 'Full Stack',
      experienceLevel: 'Student',
      techStack: ['Stale target'],
      createdAt: new Date(Date.now() - 8 * 86400000),
    },
  ]);
  const fresh = await service.getScenarioContext(owner);
  assert.deepEqual(fresh.signals.recommendationSkills, ['Current target']);
});
