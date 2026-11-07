'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Sprint = require('../models/careerSprint');
const Schedule = require('../models/sprintSchedule');
const migration = require('../services/sprintReservationMigrationService');
const reservations = require('../services/sprintReservationService');
const policy = require('../services/sprintLegacyPolicy');
const { sprintWindow } = require('../utils/sprintCalendar');
const { ensureCareerSprintIndexes } = require('../scripts/ensureCareerSprintIndexes');

test('isolated Mongo: legacy exceptions preserve history, enforce read-only access and reserve both overlaps', async (t) => {
  const uri = process.env.CAREER_SPRINT_ISOLATED_MONGO_URI;
  assert.match(
    uri || '',
    /^mongodb:\/\/127\.0\.0\.1:\d+\/career_sprint_legacy_test_[a-z0-9_]+$/,
    'An explicitly isolated loopback database is required.'
  );
  await mongoose.connect(uri, { autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 5000 });
  const owner = new mongoose.Types.ObjectId();
  const knownOwner = new mongoose.Types.ObjectId();
  const owners = [owner, knownOwner];
  t.after(async () => {
    await Sprint.deleteMany({ userId: { $in: owners } });
    await Schedule.deleteMany({ _id: { $in: owners } });
    await mongoose.disconnect();
  });
  await Sprint.createCollection();
  await ensureCareerSprintIndexes();
  assert.equal((await ensureCareerSprintIndexes()).created.length, 0);
  const snapshot = (start, end, userId = owner) => ({
    userId,
    weekStartDate: start,
    weekEndDate: end,
    xpPoints: 42,
    level: 1,
    currentStreak: 3,
    longestStreak: 7,
    streak: 3,
    lastActiveDate: start,
    tasks: [{ title: 'Preserved activity', isCompleted: true, completedAt: start, points: 4 }],
    aiPlans: []
  });
  const now = Date.now();
  const start = new Date(now - 86400000);
  const end = new Date(now + 86400000);
  const records = await Sprint.create([
    snapshot(start, end),
    snapshot(new Date(now - 3600000), new Date(now + 2 * 86400000))
  ]);
  await Sprint.updateMany({ userId: owner }, { $set: { updatedAt: new Date(now) } }, { timestamps: false });
  const before = await Sprint.find({ userId: owner }).sort({ _id: 1 }).lean();
  const legacyExceptions = Object.fromEntries(
    before.map((record) => [
      String(record._id),
      {
        owner: String(owner),
        start: record.weekStartDate.toISOString(),
        end: record.weekEndDate.toISOString(),
        reason: 'timezone-provenance-unresolved',
        evidence: 'Isolated fixture: intentionally missing original deployment calendar.'
      }
    ])
  );
  const options = { userIds: [owner], legacyExceptions, deploymentAuthorized: true };
  const dry = await migration.inspect(options);
  assert.equal(dry.safe, true);
  assert.equal(dry.conflicts.length, 1);
  assert.equal(dry.conflicts[0].grandfathered, true);
  assert.equal(dry.exceptions.length, 2);
  assert.deepEqual(await Sprint.find({ userId: owner }).sort({ _id: 1 }).lean(), before);
  assert.equal(await Schedule.exists({ _id: owner }), null);
  await assert.rejects(migration.apply({ ...options, deploymentAuthorized: false }), /authorization/);
  const wrong = structuredClone(legacyExceptions);
  wrong[String(records[0]._id)].owner = String(knownOwner);
  assert.equal((await migration.inspect({ ...options, legacyExceptions: wrong })).safe, false);

  // Runtime protects unresolved records even before migration approval.
  const mock = (request, exports) => {
    const filename = require.resolve(request);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  };
  mock('../services/aiservice', {
    getSharedCache: async () => null,
    setSharedCache: async () => {},
    invalidateCacheKey: async () => {}
  });
  mock('../services/developerSignalService', { getDeveloperSignals: async () => ({}) });
  const service = require('../services/careerSprintService');
  const current = await service.getCurrentSprint(owner);
  assert.equal(current._id, String(records[1]._id));
  assert.equal(current.legacyAccess.readOnly, true);
  assert.equal(current.restoreMeta.canRestore, false);
  assert.equal(current.analytics.consistencyScore, null);
  assert.deepEqual(await Sprint.find({ userId: owner }).sort({ _id: 1 }).lean(), before);
  const sprintId = records[0]._id;
  const taskId = records[0].tasks[0]._id;
  for (const mutate of [
    () => service.addTaskToSprint(owner, sprintId, { title: 'Forbidden' }),
    () => service.toggleTaskCompletion(owner, sprintId, taskId, false),
    () => service.editTask(owner, sprintId, taskId, { title: 'Forbidden' }),
    () => service.deleteTask(owner, sprintId, taskId),
    () => service.updateSprintDates(owner, sprintId, '2030-01-01', '2030-01-07'),
    () => service.restoreStreak(owner, sprintId),
    () => service.mutateDraft(owner, sprintId, new mongoose.Types.ObjectId()),
    () => service.importScenarioPlanToSprint(owner, sprintId),
    () => service.saveAiPlanToSprint(owner, sprintId, { tasks: [{ title: 'Forbidden' }] }),
    () => service.mergeProposedTasks(owner, sprintId, [{ title: 'Forbidden' }])
  ])
    await assert.rejects(mutate(), { statusCode: 409 });
  await assert.rejects(
    require('../services/recommendationHandoffService').handoff({
      userId: owner,
      recommendation: { id: 'fixture-action', title: 'Proposed work' },
      signalHash: 'fixture-context',
      expectedSignalHash: 'fixture-context'
    }),
    { statusCode: 409 }
  );

  assert.equal((await migration.apply(options)).applied, 2);
  assert.equal((await migration.apply(options)).applied, 0);
  // Stored exception metadata is sufficient on rerun; no timezone is invented.
  assert.equal((await migration.apply({ userIds: [owner], deploymentAuthorized: true })).applied, 0);
  const after = await Sprint.find({ userId: owner }).sort({ _id: 1 }).lean();
  for (let i = 0; i < before.length; i++) {
    const { legacyException, reservationPolicy, __v, ...preserved } = after[i];
    const { __v: originalVersion, ...original } = before[i];
    assert.deepEqual(preserved, original);
    assert.equal(__v, originalVersion + 1);
    assert.equal(reservationPolicy, policy.EXCEPTION_POLICY);
    assert.equal(legacyException.owner, String(owner));
    assert.equal(after[i].occupiedDays, undefined);
  }
  const schedule = await Schedule.findById(owner).lean();
  assert.equal(schedule.windows.length, 2);
  await assert.rejects(reservations.reserve(owner, new mongoose.Types.ObjectId(), start, end), {
    statusCode: 409
  });
  const futureStart = new Date(now + 10 * 86400000);
  const futureEnd = new Date(now + 12 * 86400000);
  const futureToken = await reservations.reserve(owner, new mongoose.Types.ObjectId(), futureStart, futureEnd);
  await reservations.release(owner, futureToken);
  const history = await service.getSprintHistory(owner, 12);
  assert.equal(history.length, 2);
  assert.ok(history.every((item) => item.legacyAccess.readOnly && item.xpPoints === 42 && item.tasks[0].isCompleted));
  assert.equal((await service.getCurrentSprint(owner))._id, current._id);

  // Proven per-record zones remain distinct and use their local dates, including DST.
  const known = await Sprint.create([
    snapshot(new Date('2001-01-01T19:00Z'), new Date('2001-01-08T18:59:59.999Z'), knownOwner),
    snapshot(new Date('2026-03-02T05:00Z'), new Date('2026-03-09T03:59:59.999Z'), knownOwner)
  ]);
  const knownOptions = {
    userIds: [knownOwner],
    deploymentAuthorized: true,
    legacyTimeZones: { [known[0]._id]: 'Asia/Karachi', [known[1]._id]: 'America/New_York' }
  };
  const mapped = await migration.inspect(knownOptions);
  assert.equal(mapped.safe, true);
  assert.equal(mapped.proposals[0].occupiedDays.length, 7);
  assert.equal(mapped.proposals[1].occupiedDays.length, 7);
  // A concurrent version change stops a partially applied run; retry resumes safely.
  const update = Sprint.updateOne.bind(Sprint);
  let raced = false;
  const mocked = t.mock.method(Sprint, 'updateOne', async (filter, changes, opts) => {
    if (!raced && String(filter._id) === mapped.proposals[1].id) {
      raced = true;
      await update({ _id: mapped.proposals[1].id }, { $inc: { __v: 1 } }, { timestamps: false });
    }
    return update(filter, changes, opts);
  });
  const interrupted = await migration.apply(knownOptions);
  mocked.mock.restore();
  assert.equal(interrupted.stopped, true);
  assert.equal(interrupted.applied, 1);
  assert.equal((await migration.apply(knownOptions)).applied, 1);
  assert.equal((await migration.apply(knownOptions)).applied, 0);
  const pinned = sprintWindow('UTC', '2031-01-01', '2031-01-07');
  await Sprint.create({ ...snapshot(pinned.sprintStartDate, pinned.sprintEndDate, knownOwner), ...pinned });
  await assert.rejects(
    Sprint.create({ ...snapshot(pinned.sprintStartDate, pinned.sprintEndDate, knownOwner), ...pinned }),
    { code: 11000 }
  );
  await Schedule.updateOne({ _id: owner }, { $pull: { windows: { sprintId: String(sprintId) } } });
  const broken = await migration.apply(options);
  assert.equal(broken.stopped, true);
  assert.equal(broken.applied, 0);
  assert.equal(broken.reservationMismatches.length, 1);
});
