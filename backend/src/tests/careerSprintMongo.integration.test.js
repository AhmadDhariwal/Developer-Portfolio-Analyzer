'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const User = require('../models/user');
const CareerSprint = require('../models/careerSprint');
const Scenario = require('../models/scenarioSimulation');
const Schedule = require('../models/sprintSchedule');
const Preference = require('../models/sprintPreference');
const Recommendation = require('../models/recommendation');
const { calendar, POLICY } = require('../utils/sprintCalendar');
const { buildResumeCacheIdentity } = require('../services/developerSignalService');

const mock = (request, exports) => {
  const filename = require.resolve(request);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

test('Career Sprint real Mongo/JWT: replay, concurrency, reversal, drafts and ownership persist', async (t) => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  assert.ok(uri, 'MongoDB configuration is required for persistence verification.');
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  } catch {
    assert.fail('Configured MongoDB is unavailable; persistence verification is blocked.');
  }
  const owner = new mongoose.Types.ObjectId();
  const foreign = new mongoose.Types.ObjectId();
  const migrationOwner = new mongoose.Types.ObjectId();
  const conflictOwner = new mongoose.Types.ObjectId();
  const fixtureOwners = [owner, foreign, migrationOwner, conflictOwner];
  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await CareerSprint.deleteMany({ userId: { $in: fixtureOwners } });
    await Scenario.deleteMany({ userId: { $in: fixtureOwners } });
    await Recommendation.deleteMany({ userId: { $in: fixtureOwners } });
    await User.deleteMany({ _id: { $in: fixtureOwners } });
    await Schedule.deleteMany({ _id: { $in: fixtureOwners } });
    await Preference.deleteMany({ _id: { $in: fixtureOwners } });
    await mongoose.disconnect();
  });
  mock('../services/aiservice', {
    getSharedCache: async () => null,
    setSharedCache: async () => {},
    invalidateCacheKey: async () => {}
  });
  mock('../services/developerSignalService', { buildResumeCacheIdentity, getDeveloperSignals: async () => ({}) });
  mock('../controllers/dashboardcontroller', { invalidateDashboardSummaryCache: () => {} });
  mock('../services/scenarioSimulatorService', { invalidateContextCache: () => {} });
  mock('../services/newsService', { invalidateNewsSignalCache: () => {} });
  mock('../services/notificationService', { createNotification: async () => {} });
  await User.create(
    fixtureOwners.map((_id) => ({
      _id,
      name: 'Sprint verification fixture',
      email: `${_id}@sprint.test`,
      password: 'fixture'
    }))
  );
  await CareerSprint.init();
  const app = express();
  app.use(express.json({ limit: '32kb' }));
  app.use('/sprints', require('../routes/careerSprint.routes'));
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const secret = process.env.JWT_SECRET || 'isolated-sprint-verification-secret';
  process.env.JWT_SECRET = secret;
  const token = (id) =>
    jwt.sign({ id }, secret, {
      algorithm: 'HS256',
      issuer: process.env.JWT_ISSUER || 'devinsight-api',
      audience: process.env.JWT_AUDIENCE || 'devinsight-web',
      expiresIn: '5m'
    });
  const call = async (route, { method = 'GET', body, user = owner, authenticated = true } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/sprints${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(authenticated ? { Authorization: `Bearer ${token(user)}` } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await call('/current', { authenticated: false })).status, 401);
  assert.equal((await call('/preferences', { authenticated: false })).status, 401);
  assert.equal((await call('/preferences', { method: 'PUT', body: { timeZone: 'Mars/Olympus' } })).status, 400);
  assert.equal((await call('/preferences', { method: 'PUT', body: { timeZone: 'America/New_York' } })).status, 200);
  const created = await Promise.all(Array.from({ length: 5 }, () => call('/', { method: 'POST', body: {} })));
  assert.ok(created.every((result) => result.status === 201));
  const sprintId = created[0].body._id;
  assert.equal(created[0].body.timeZone, 'America/New_York');
  assert.equal(created[0].body.calendarPolicy, POLICY);
  assert.equal((await call('/preferences', { user: foreign })).body.timeZone, 'UTC');
  assert.ok(created.every((result) => result.body._id === sprintId));
  assert.equal(await CareerSprint.countDocuments({ userId: owner }), 1);
  const route = `/${sprintId}`;
  const additions = await Promise.all(
    Array.from({ length: 5 }, () =>
      call(`${route}/tasks`, {
        method: 'POST',
        body: { title: 'Build an owned project', category: 'project', priority: 'high' }
      })
    )
  );
  assert.ok(additions.every((result) => result.status === 200));
  let persisted = await CareerSprint.findById(sprintId).lean();
  assert.equal(persisted.tasks.length, 1);
  const taskId = String(persisted.tasks[0]._id);
  const taskRoute = `${route}/tasks/${taskId}`;
  assert.equal((await call(taskRoute, { method: 'PUT', user: foreign, body: { isCompleted: true } })).status, 404);
  const completions = await Promise.all(
    Array.from({ length: 5 }, () => call(taskRoute, { method: 'PUT', body: { isCompleted: true } }))
  );
  assert.ok(completions.every((result) => result.status === 200));
  persisted = await CareerSprint.findById(sprintId).lean();
  assert.equal(persisted.xpPoints, 20);
  assert.equal(persisted.tasks[0].isCompleted, true);
  const firstCompletion = persisted.tasks[0].completedAt;
  assert.equal((await call(taskRoute, { method: 'PUT', body: { isCompleted: true } })).status, 200);
  assert.equal(+(await CareerSprint.findById(sprintId).lean()).tasks[0].completedAt, +firstCompletion);
  assert.equal((await call(taskRoute, { method: 'PUT', body: { priority: 'low' } })).status, 409);
  assert.equal((await call(taskRoute, { method: 'DELETE' })).status, 409);
  assert.equal((await call(taskRoute, { method: 'PUT', body: { isCompleted: false } })).status, 200);
  persisted = await CareerSprint.findById(sprintId).lean();
  assert.equal(persisted.xpPoints, 0);
  assert.equal(persisted.tasks[0].completedAt, null);
  assert.equal((await call(taskRoute, { method: 'PUT', body: { priority: 'low', points: 1 } })).status, 200);
  await call(taskRoute, { method: 'PUT', body: { isCompleted: true } });
  assert.equal((await CareerSprint.findById(sprintId).lean()).xpPoints, 6);
  await call(taskRoute, { method: 'PUT', body: { isCompleted: false } });
  const draft = (index) => ({
    name: `Draft ${index}`,
    tasks: [{ title: `Practice draft ${index}`, category: 'practice' }, { title: `Review draft ${index}` }]
  });
  for (let index = 0; index < 8; index++)
    assert.equal((await call(`${route}/ai-plans`, { method: 'POST', body: draft(index) })).status, 200);
  assert.equal((await call(`${route}/ai-plans`, { method: 'POST', body: draft(8) })).status, 409);
  persisted = await CareerSprint.findById(sprintId).lean();
  assert.equal(persisted.aiPlans.length, 8);
  const planId = persisted.aiPlans[0]._id;
  const importRoute = `${route}/ai-plans/${planId}/tasks`;
  assert.equal((await call(importRoute, { method: 'POST', user: foreign, body: { taskIndexes: [0] } })).status, 404);
  assert.equal((await call(importRoute, { method: 'POST', body: { taskIndexes: [-1] } })).status, 400);
  const imports = await Promise.all(
    Array.from({ length: 5 }, () => call(importRoute, { method: 'POST', body: { taskIndexes: [0, 1] } }))
  );
  assert.ok(imports.every((result) => result.status === 200));
  persisted = await CareerSprint.findById(sprintId).lean();
  assert.equal(persisted.tasks.length, 3);
  assert.equal(persisted.xpPoints, 0);
  assert.equal(persisted.tasks.find((task) => task.title === 'Practice draft 0').points, 4);
  assert.equal((await call(`${route}/ai-plans/${planId}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call(taskRoute, { method: 'DELETE' })).status, 200);
  const current = await call('/current?forceRefresh=true');
  assert.equal(current.body.tasks.length, 2);
  assert.equal(current.body.aiPlans.length, 7);
  assert.equal(current.body.xpPoints, 0);
  const history = await call('/history');
  assert.equal(history.body.history[0].tasks.length, 2);
  const scenarios = await Scenario.create(
    [owner, foreign].map((userId) => ({
      userId,
      name: 'Proposed scenario',
      baselineHiringScore: 0,
      baselineJobMatch: 0,
      skills: ['Docker'],
      scenarioHash: `fixture-${userId}`
    }))
  );
  assert.equal(
    (await call(`${route}/import-scenario`, { method: 'POST', body: { scenarioId: String(scenarios[1]._id) } })).status,
    404
  );
  for (let index = 0; index < 2; index++)
    assert.equal(
      (await call(`${route}/import-scenario`, { method: 'POST', body: { scenarioId: String(scenarios[0]._id) } }))
        .status,
      200
    );
  persisted = await CareerSprint.findById(sprintId).lean();
  assert.equal(persisted.aiPlans.length, 8);
  const scenarioPlan = persisted.aiPlans.find((plan) => plan.source === 'scenario');
  assert.equal(String(scenarioPlan.tasks[0].sourceScenarioId), String(scenarios[0]._id));
  assert.equal(persisted.xpPoints, 0);
  const dateAt = (offset) => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  const overlapping = await Promise.all([
    call('/', { method: 'POST', body: { sprintStartDate: dateAt(21), sprintEndDate: dateAt(24) } }),
    call('/', { method: 'POST', body: { sprintStartDate: dateAt(23), sprintEndDate: dateAt(26) } })
  ]);
  assert.deepEqual(overlapping.map((result) => result.status).sort(), [201, 409]);
  const custom = overlapping.find((result) => result.status === 201).body;
  assert.equal(+new Date(custom.weekStartDate), +new Date(custom.sprintStartDate));
  assert.equal(+new Date(custom.weekEndDate), +new Date(custom.sprintEndDate));
  assert.equal(
    (
      await call(`/${custom._id}/dates`, {
        method: 'PUT',
        body: { sprintStartDate: current.body.sprintStartDate, sprintEndDate: current.body.sprintEndDate }
      })
    ).status,
    409
  );
  assert.equal((await call('/current?forceRefresh=true')).body._id, sprintId);
  // Preference changes are prospective; the current window retains its pinned policy.
  assert.equal((await call('/preferences', { method: 'PUT', body: { timeZone: 'Asia/Karachi' } })).status, 200);
  assert.equal((await call('/current')).body.timeZone, 'America/New_York');
  const future = await call('/', { method: 'POST', body: { sprintStartDate: dateAt(40), sprintEndDate: dateAt(46) } });
  assert.equal(future.status, 201);
  assert.equal(future.body.timeZone, 'Asia/Karachi');

  // Exact restore metadata is derived from the pinned calendar, never application-open time.
  const activeCalendar = calendar(created[0].body);
  const lastActivity = activeCalendar.add(new Date(), -2);
  await CareerSprint.updateOne(
    { _id: sprintId },
    { $set: { lastActiveDate: lastActivity, currentStreak: 4, longestStreak: 4, streak: 4 }, $inc: { __v: 1 } }
  );
  const broken = await call('/current');
  assert.equal(broken.body.restoreMeta.canRestore, true);
  assert.equal(+new Date(broken.body.restoreMeta.expiresAt) - +new Date(broken.body.restoreMeta.breakAt), 48 * 3600000);
  assert.equal((await call(`${route}/restore-streak`, { method: 'POST', user: foreign })).status, 400);
  const restores = await Promise.all(
    Array.from({ length: 3 }, () => call(`${route}/restore-streak`, { method: 'POST' }))
  );
  assert.equal(restores.filter((result) => result.status === 200).length, 1);
  persisted = await CareerSprint.findById(sprintId).lean();
  assert.equal(+persisted.lastActiveDate, +lastActivity);
  assert.equal(persisted.xpPoints, 0);

  // New and legacy drafts expose stale context and require an exact fresh acknowledgement.
  await User.updateOne({ _id: owner }, { $set: { activeCareerStack: 'Backend' } });
  const changed = await call('/current');
  const stale = changed.body.aiPlans[0];
  assert.equal(stale.compatibility.requiresAcknowledgement, true);
  const staleRoute = `${route}/ai-plans/${stale._id}/tasks`;
  assert.equal((await call(staleRoute, { method: 'POST', body: { taskIndexes: [0] } })).status, 409);
  assert.equal(
    (await call(staleRoute, { method: 'POST', body: { taskIndexes: [0], acknowledgeContextFingerprint: 'old' } }))
      .status,
    409
  );
  assert.equal(
    (
      await call(staleRoute, {
        method: 'POST',
        body: { taskIndexes: [0], acknowledgeContextFingerprint: stale.compatibility.currentFingerprint }
      })
    ).status,
    200
  );
  assert.equal(
    (await CareerSprint.findById(sprintId).lean()).aiPlans[0].context.fingerprint,
    stale.context.fingerprint
  );
  await CareerSprint.updateOne({ _id: sprintId }, { $unset: { 'aiPlans.0.context': 1 }, $inc: { __v: 1 } });
  assert.equal((await call('/current')).body.aiPlans[0].compatibility.status, 'legacy-context-unknown');

  // Migration is validated on isolated historical fixtures, never the production records.
  const historical = (userId, start, end) => ({
    userId,
    title: 'Owned historical fixture',
    weekStartDate: new Date(start),
    weekEndDate: new Date(end),
    xpPoints: 42,
    level: 1,
    currentStreak: 3,
    tasks: [{ title: 'Historical activity', isCompleted: true, completedAt: new Date(start), points: 3 }]
  });
  const legacyRecords = await CareerSprint.create([
    historical(migrationOwner, '2001-01-01', '2001-01-07T23:59:59.999Z'),
    historical(migrationOwner, '2001-01-08', '2001-01-14T23:59:59.999Z')
  ]);
  const migration = require('../services/sprintReservationMigrationService');
  const options = { userIds: [migrationOwner], legacyTimeZone: 'UTC', deploymentAuthorized: true };
  const beforeMigration = await CareerSprint.find({ userId: migrationOwner }).sort({ _id: 1 }).lean();
  const dry = await migration.inspect(options);
  assert.equal(dry.safe, true);
  assert.equal(dry.proposals.length, 2);
  assert.equal((await CareerSprint.findById(legacyRecords[0]._id).lean()).occupiedDays, undefined);
  assert.equal(
    (
      await call('/', {
        method: 'POST',
        user: migrationOwner,
        body: { sprintStartDate: '2001-01-05', sprintEndDate: '2001-01-10' }
      })
    ).status,
    409
  );
  assert.equal((await migration.apply(options)).applied, 2);
  assert.equal((await migration.apply(options)).applied, 0);
  const afterMigration = await CareerSprint.find({ userId: migrationOwner }).sort({ _id: 1 }).lean();
  for (let i = 0; i < beforeMigration.length; i++)
    for (const key of [
      '_id',
      'weekStartDate',
      'weekEndDate',
      'tasks',
      'xpPoints',
      'level',
      'currentStreak',
      'createdAt',
      'updatedAt'
    ])
      assert.deepEqual(afterMigration[i][key], beforeMigration[i][key]);
  await CareerSprint.create([
    historical(conflictOwner, '2002-01-01', '2002-01-10'),
    historical(conflictOwner, '2002-01-05', '2002-01-15')
  ]);
  const conflicts = await migration.apply({ ...options, userIds: [conflictOwner] });
  assert.equal(conflicts.stopped, true);
  assert.equal(conflicts.applied, 0);
  assert.equal(conflicts.conflicts.length, 1);
  assert.equal(await CareerSprint.countDocuments({ userId: conflictOwner, 'occupiedDays.0': { $exists: true } }), 0);

  // Consume modern authoritative action fields, preserve IDs and omit completed imports.
  const engine = require('../services/recommendationEngineService');
  const profile = require('../services/developerContextService');
  const currentUser = await User.findById(owner).lean();
  const plan = engine.buildPlan({
    careerStack: profile.resolveCareerStack(currentUser),
    experienceLevel: profile.resolveExperienceLevel(currentUser),
    githubData: { unavailable: true },
    resumeInsights: engine.resumeSignals(null)
  });
  const snapshot = await Recommendation.create({
    userId: owner,
    title: 'Current fixture action',
    careerStack: profile.resolveCareerStack(currentUser),
    experienceLevel: profile.resolveExperienceLevel(currentUser),
    snapshotVersion: engine.RULE_VERSION,
    contextHash: 'a'.repeat(64),
    result: plan
  });
  const preview = await require('../services/aiTaskService').generateTasks({ userId: owner, forceRefresh: true });
  const action = preview.tasks.find((task) => task.sourceRecommendationSnapshotId === String(snapshot._id));
  assert.ok(action, 'Modern action record must become a proposed task.');
  assert.equal(action.sourceRecommendationId, plan.recommendations[0].id);
  assert.ok(action.description.includes(plan.recommendations[0].actionableNextStep));
  const sourceDraft = await call(`/${future.body._id}/ai-plans`, {
    method: 'POST',
    body: { name: 'Modern owned action', tasks: [action] }
  });
  assert.equal(sourceDraft.status, 200);
  const sourcePlan = sourceDraft.body.aiPlans[0];
  assert.equal(sourcePlan.tasks[0].sourceRecommendationId, action.sourceRecommendationId);
  const sourceImport = await call(`/${future.body._id}/ai-plans/${sourcePlan._id}/tasks`, {
    method: 'POST',
    body: { taskIndexes: [0] }
  });
  assert.equal(sourceImport.status, 200);
  assert.equal(sourceImport.body.tasks[0].sourceRecommendationId, action.sourceRecommendationId);
  assert.equal(
    sourceImport.body.tasks[0].startDate,
    sourcePlan.tasks[0].startDate,
    'Draft ingestion retains its pinned calendar date.'
  );
  assert.equal(sourceImport.body.tasks[0].endDate, sourcePlan.tasks[0].endDate);
  await call(`/${future.body._id}/tasks/${sourceImport.body.tasks[0]._id}`, {
    method: 'PUT',
    body: { isCompleted: true }
  });
  const nextPreview = await require('../services/aiTaskService').generateTasks({ userId: owner, forceRefresh: true });
  assert.equal(
    nextPreview.tasks.some((task) => task.sourceRecommendationId === action.sourceRecommendationId),
    false
  );
  const adapter = require('../services/sprintRecommendationAdapter');
  const adapterInput = {
    userId: owner,
    user: currentUser,
    careerStack: profile.resolveCareerStack(currentUser),
    experienceLevel: profile.resolveExperienceLevel(currentUser),
    documents: [snapshot.toObject()],
    signals: {}
  };
  assert.equal((await adapter.currentActions(adapterInput)).tasks.length, 1);
  const staleSnapshot = { ...snapshot.toObject(), createdAt: new Date(Date.now() - 2 * 86400000) };
  assert.equal((await adapter.currentActions({ ...adapterInput, documents: [staleSnapshot] })).tasks.length, 0);
  assert.equal(
    (await adapter.currentActions({ ...adapterInput, documents: [{ ...snapshot.toObject(), userId: foreign }] })).tasks
      .length,
    0
  );
  const changedSource = JSON.parse(JSON.stringify(snapshot));
  changedSource.result.sourceMetadata.github.timestamp = '2001-01-01T00:00:00.000Z';
  assert.equal((await adapter.currentActions({ ...adapterInput, documents: [changedSource] })).tasks.length, 0);
});
