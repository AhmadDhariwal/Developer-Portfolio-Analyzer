'use strict';

// This verifier never bootstraps a configured account or writes to a remote database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { MongoClient, ObjectId, BSON } = require('mongodb');
const express = require('express');
const jwt = require('jsonwebtoken');
const uri = process.env.CAREER_SPRINT_FINAL_E2E_URI;
assert.match(uri || '', /^mongodb:\/\/127\.0\.0\.1:\d+\/career_sprint_final_e2e_[a-z0-9_]+$/);
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const remoteReadUri = process.env.MONGODB_URI || process.env.MONGO_URI;
process.env.MONGODB_URI = uri;
process.env.MONGO_URI = uri;
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
const output = path.resolve(__dirname, '../../verification/career-sprint/final-e2e');
const Sprint = require('../models/careerSprint');
const User = require('../models/user');
const Progress = require('../models/userCourseProgress');
const hash = (value) => crypto.createHash('sha256').update(BSON.EJSON.stringify(value)).digest('hex');
const report = { startedAt: new Date().toISOString(), checks: [], limitations: [] };
const port = Number(process.env.CAREER_SPRINT_FINAL_E2E_PORT || 4327);
let server;
let remote;
const check = async (name, work) => {
  try {
    const detail = await work();
    report.checks.push({ name, status: 'PASS', detail });
  } catch (error) {
    report.checks.push({ name, status: 'FAIL', message: error.message });
  }
};
const save = () =>
  fs.writeFileSync(path.join(output, 'integrated-results.json'), JSON.stringify(report, null, 2) + '\n');
const main = async () => {
  fs.mkdirSync(output, { recursive: true });
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  await Sprint.init();
  // AI failure is injected only at the external provider boundary; all application,
  // calendar, cache, signal, controller, auth and persistence code remains real.
  require('../services/aiservice').runAIAnalysis = async () => ({ ok: false, error: 'isolated-provider-unavailable' });
  const app = express();
  app.use(express.json());
  app.use('/api/career-sprints', require('../routes/careerSprint.routes'));
  app.use('/api/courses', require('../routes/courseRoutes'));
  app.use('/api/profile', require('../routes/profile.routes'));
  app.use('/api/simulator', require('../routes/scenarioSimulator.routes'));
  app.use('/api/recommendations', require('../routes/recommendations.routes'));
  app.use('/api/weekly-reports', require('../routes/weeklyReport.routes'));
  const { protect } = require('../middleware/authmiddleware');
  app.get('/api/dashboard/summary', protect, require('../controllers/dashboardcontroller').getDashboardSummary);
  const root = path.resolve(__dirname, '../../../frontend/dist/frontend/browser');
  app.use(express.static(root));
  app.get('/app/{*rest}', (_req, res) => res.sendFile(path.join(root, 'index.html')));
  server = await new Promise((resolve) => {
    const listener = app.listen(port, '127.0.0.1', () => resolve(listener));
  });
  const token = (id) =>
    jwt.sign({ id: String(id) }, process.env.JWT_SECRET, {
      algorithm: 'HS256',
      issuer: process.env.JWT_ISSUER || 'devinsight-api',
      audience: process.env.JWT_AUDIENCE || 'devinsight-web',
      expiresIn: '1h'
    });
  const request = async (owner, route, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${port}/api${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(owner ? { Authorization: `Bearer ${token(owner)}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() };
  };
  const createOwner = async () =>
    User.create({
      name: 'Isolated Sprint verifier',
      email: `${new mongoose.Types.ObjectId()}@sprint.test`,
      password: 'fixture',
      notifications: { weeklyScoreReport: false },
      careerStack: 'Backend',
      experienceLevel: 'Intern'
    });
  await check('JWT rejects unauthenticated request', async () =>
    assert.equal((await request(null, '/career-sprints/current')).status, 401)
  );
  // Explicit hand calculations, independent of the scoring helper implementation.
  const scenarios = [
    {
      name: 'weighted partial',
      tasks: [
        [10, 'high'],
        [5, 'medium'],
        [1, 'low']
      ],
      done: [0],
      xp: 25,
      level: 1,
      progress: 63,
      equation: 'XP=15+10=25; level=1; progress=round(10/16*100)=63 (integer score contract)'
    },
    {
      name: 'level boundary',
      tasks: Array.from({ length: 5 }, () => [10, 'high']),
      done: [0, 1, 2, 3],
      xp: 100,
      level: 2,
      progress: 80,
      equation: 'XP=4*(15+10)=100; level=2; progress=40/50*100=80'
    },
    {
      name: 'mixed all complete',
      tasks: [
        [1, 'low'],
        [4, 'medium'],
        [8, 'high']
      ],
      done: [0, 1, 2],
      xp: 43,
      level: 1,
      progress: 100,
      equation: 'XP=(5+1)+(10+4)+(15+8)=43; level=1; progress=13/13*100=100'
    }
  ];
  let browserOwner;
  for (const scenario of scenarios)
    await check(`independent mathematics: ${scenario.name}`, async () => {
      const owner = await createOwner();
      browserOwner ||= owner;
      const created = await request(owner._id, '/career-sprints', 'POST', {});
      assert.equal(created.status, 201);
      const base = `/career-sprints/${created.body._id}`;
      const ids = [];
      for (let i = 0; i < scenario.tasks.length; i++) {
        const [points, priority] = scenario.tasks[i];
        const added = await request(owner._id, `${base}/tasks`, 'POST', {
          title: `Independent task ${i}`,
          points,
          priority,
          category: 'project'
        });
        assert.equal(added.status, 200);
        ids.push(added.body.tasks.find((task) => task.title === `Independent task ${i}`)._id);
      }
      for (const index of scenario.done)
        assert.equal(
          (await request(owner._id, `${base}/tasks/${ids[index]}`, 'PUT', { isCompleted: true })).status,
          200
        );
      const fresh = await request(owner._id, '/career-sprints/current');
      assert.equal(fresh.body.xpPoints, scenario.xp);
      assert.equal(fresh.body.level, scenario.level);
      assert.equal(fresh.body.analytics.progressPercent, scenario.progress);
      const target = `${base}/tasks/${ids[scenario.done[0]]}`;
      const replay = await Promise.all(
        Array.from({ length: 5 }, () => request(owner._id, target, 'PUT', { isCompleted: true }))
      );
      assert.ok(replay.every((r) => r.status === 200 && r.body.xpPoints === scenario.xp));
      const [points, priority] = scenario.tasks[scenario.done[0]];
      const reversalXp = scenario.xp - points - { high: 15, medium: 10, low: 5 }[priority];
      assert.equal((await request(owner._id, target, 'PUT', { isCompleted: false })).body.xpPoints, reversalXp);
      assert.equal((await request(owner._id, target, 'PUT', { isCompleted: true })).body.xpPoints, scenario.xp);
      assert.equal((await Sprint.findById(created.body._id).lean()).xpPoints, scenario.xp);
      return { ...scenario, reversalXp, replayRequests: 5, persisted: true };
    });
  await check('Learning Hub handoff replay after Sprint task edit', async () => {
    const owner = await createOwner();
    await request(owner._id, '/career-sprints', 'POST', {});
    const courseId = 'fb_u2';
    await Progress.create({
      userId: owner._id,
      courseId,
      status: 'saved',
      course: {
        id: courseId,
        title: 'Node API practice',
        url: 'https://www.freecodecamp.org/learn/',
        platform: 'freeCodeCamp',
        topics: ['Node.js']
      }
    });
    const route = `/courses/${courseId}/career-sprint`;
    const first = await request(owner._id, route, 'POST', { targetSkill: 'Node.js' });
    assert.equal(first.status, 200);
    assert.equal((await request(owner._id, route, 'POST', { targetSkill: 'Node.js' })).body.alreadyAdded, true);
    const current = (await request(owner._id, '/career-sprints/current')).body;
    const task = current.tasks.find((item) => item.title.startsWith('Study '));
    const edited = await request(owner._id, `/career-sprints/${current._id}/tasks/${task._id}`, 'PUT', {
      description: task.description,
      title: task.title
    });
    assert.equal(edited.status, 200);
    const replay = await request(owner._id, route, 'POST', { targetSkill: 'Node.js' });
    report.courseReplay = {
      beforeEdit: 200,
      edit: edited.status,
      afterEdit: replay.status,
      response: replay.body,
      taskCount: (await Sprint.findById(current._id).lean()).tasks.length
    };
    assert.equal(
      replay.status,
      200,
      'Same course and target skill must remain an idempotent replay after editing its Sprint task.'
    );
    assert.equal(replay.body.alreadyAdded, true);
  });
  if (process.argv.includes('--audit-legacy'))
    await check(
      'all 15 actual legacy records: read-only source, isolated HTTP rejection and preservation',
      async () => {
        const manifest = require('../../verification/career-sprint/legacy-unblocking/legacy-exceptions.json');
        remote = new MongoClient(remoteReadUri, { serverSelectionTimeoutMS: 15000 });
        await remote.connect();
        // Native Mongo driver, only find/indexes operations; no model initialization remotely.
        const source = remote.db().collection(Sprint.collection.name);
        const filter = { _id: { $in: Object.keys(manifest).map((id) => new ObjectId(id)) } };
        const records = await source.find(filter).sort({ _id: 1 }).toArray();
        assert.equal(records.length, 15);
        const before = hash(records);
        await Sprint.collection.insertMany(records);
        for (const owner of [...new Set(records.map((r) => String(r.userId)))])
          await User.create({
            _id: owner,
            name: 'Isolated legacy fixture',
            email: `${owner}@legacy.test`,
            password: 'fixture'
          });
        for (const record of records) {
          const history = await request(record.userId, '/career-sprints/history?limit=12');
          const visible = history.body.history.find((s) => s._id === String(record._id));
          assert.ok(visible, `Historical record ${record._id} is visible`);
          assert.equal(visible.legacyAccess.readOnly, true);
          assert.equal(visible.legacyAccess.timeZone, null);
          // These actual windows are historical, so /current correctly creates a new
          // current-week Sprint. Inspect each preserved record's real serializer instead.
          const current = await require('../services/careerSprintService').serializeSprint(record);
          assert.equal(current.analytics.consistencyScore, null);
          assert.equal(current.analytics.activeWindowDays, null);
          assert.equal(current.analytics.completedInLastSevenDays, null);
          assert.deepEqual(current.analytics.dailyActivity, []);
          assert.equal(visible.xpPoints, record.xpPoints);
          assert.equal(visible.tasks.length, record.tasks.length);
          const result = await request(record.userId, `/career-sprints/${record._id}/tasks`, 'POST', {
            title: 'Must reject'
          });
          assert.equal(result.status, 409);
        }
        assert.equal(
          hash(await Sprint.collection.find(filter).sort({ _id: 1 }).toArray()),
          before,
          'Complete isolated legacy documents must remain byte-for-byte equivalent'
        );
        assert.equal(
          hash(await source.find(filter).sort({ _id: 1 }).toArray()),
          before,
          'Read-only remote source unchanged'
        );
        const indexes = await source.indexes();
        report.legacy = {
          count: records.length,
          unchangedHash: before,
          indexes,
          readOnlyRejections: 15,
          unresolvedTimezones: 15
        };
        return report.legacy;
      }
    );
  if (browserOwner) {
    fs.writeFileSync(
      path.join(output, 'browser-session.json'),
      JSON.stringify({
        pid: process.pid,
        origin: `http://127.0.0.1:${port}`,
        token: token(browserOwner._id),
        user: { _id: String(browserOwner._id), name: browserOwner.name, role: 'developer' }
      })
    );
  }
  report.limitations.push(
    'External AI provider success is controlled in existing tests; this run injects provider unavailability and makes no paid provider request.'
  );
  save();
  console.log(
    JSON.stringify({
      checks: report.checks.map(({ name, status, message }) => ({ name, status, message })),
      keepAlive: process.argv.includes('--serve')
    })
  );
  if (process.argv.includes('--serve')) return;
  await new Promise((resolve) => server.close(resolve));
  await remote?.close();
  await mongoose.disconnect();
  process.exit(report.checks.some((c) => c.status === 'FAIL') ? 1 : 0);
};
main().catch(async (error) => {
  report.fatal = error.message;
  save();
  console.error(error.message);
  await remote?.close();
  await mongoose.disconnect();
  process.exit(1);
});
