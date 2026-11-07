const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { load, query, response } = require('./fixtures/publicPortfolioFixture');
const context = require('../services/developerContextService');
function controller(overrides = {}) {
  return load('controllers/profilecontroller.js', {
    '../services/notificationPersistenceService': { commit: async (_owner, work) => work(null) },
    '../services/newsService': { invalidateNewsSignalCache: () => {} },
    './dashboardcontroller': { invalidateDashboardSummaryCache: () => {} },
    '../services/platformSettingsService': { getDeveloperSettingsSync: () => ({}) },
    '../services/publicProfileService': { invalidatePublicProfileCacheForUser: async () => {} },
    ...overrides
  });
}
test('profile hash retains the signal contract and includes selected resume and intent', () => {
  const user = {
    githubUsername: 'OctoCat',
    careerStack: 'Backend',
    experienceLevel: 'Intern',
    defaultResumeFileId: 'resume-a',
    careerGoal: 'Improve portfolio',
    targetTimeline: 'Immediately',
    learningPreference: 'Reading'
  };
  const expected = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        activeGithubUsername: 'octocat',
        activeCareerStack: 'Backend',
        activeExperienceLevel: 'Intern',
        resumeFileId: 'resume-a',
        careerGoal: 'Improve portfolio',
        targetTimeline: 'Immediately',
        learningPreference: 'Reading'
      })
    )
    .digest('hex');
  assert.equal(context.buildProfileHash(user), expected);
  assert.equal(controller().__test.buildProfileHash(user), expected);
  assert.notEqual(context.buildProfileHash({ ...user, activeResumeFileId: 'resume-b' }), expected);
  assert.equal(context.buildProfileHash({ ...user, name: 'Renamed', avatar: 'new' }), expected);
});
test('OAuth profile edits work; long biography survives; notification writes stay independent', async () => {
  const user = {
    _id: 'owner',
    name: 'OAuth Owner',
    notifications: { weeklyScoreReport: true },
    async save() {
      return this;
    },
    set(key, value) {
      assert.equal(key, 'notifications.weeklyScoreReport');
      this.notifications.weeklyScoreReport = value;
    }
  };
  const api = controller({
    '../models/user': { findById: async () => user },
    '../services/developerContextService': { ...context, resolveResumeFile: async () => null }
  });
  const res = response();
  await api.updateProfile(
    { user, body: { bio: 'x'.repeat(500), notifications: { weeklyScoreReport: false } } },
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(user.bio.length, 500);
  assert.equal(res.body.notifications.weeklyScoreReport, false);
});
test('malformed resume IDs, non-string fields and unsafe links return validation errors', async () => {
  const api = controller({
    '../models/user': { findById: () => assert.fail('must reject before database lookup') }
  });
  for (const body of [
    { defaultResumeFileId: 'invalid' },
    { name: {} },
    { website: 'javascript:alert(1)' },
    { linkedin: 'https://name:password@example.test' }
  ]) {
    const res = response();
    await api.updateProfile({ user: { _id: 'owner' }, body }, res);
    assert.equal(res.statusCode, 400);
  }
});
test('recruiter discovery revocation preserves the separate publication opt-in', async () => {
  const user = {
    _id: 'owner',
    role: 'developer',
    isPublic: true,
    async save() {
      return this;
    }
  };
  const api = controller({ '../models/user': { findById: async () => user } });
  const res = response();
  await api.updateProfileVisibility({ user, body: { isPublic: false } }, res);
  assert.deepEqual(res.body, { isPublic: false });
});
test('password read explicitly selects the hash and rejects concurrent credential changes', async () => {
  const bcrypt = require('bcryptjs');
  const password = await bcrypt.hash('Original-password-1!', 4);
  let selection;
  const api = controller({
    '../models/user': {
      findById: () => ({
        select: async (fields) => {
          selection = fields;
          return { _id: 'owner', password };
        }
      }),
      updateOne: async (filter) => {
        assert.equal(filter.password, password);
        return { matchedCount: 0 };
      }
    }
  });
  const res = response();
  await api.updatePassword(
    {
      user: { _id: 'owner' },
      body: { currentPassword: 'Original-password-1!', newPassword: 'Updated-password-2!' }
    },
    res
  );
  assert.equal(selection, '+password');
  assert.equal(res.statusCode, 409);
});

test('news rejects a warm signal entry immediately when another worker changes personalization', async () => {
  let reads = 0;
  const service = load('services/newsService.js', {
    './developerSignalService': {
      getDeveloperSignals: async () => {
        reads++;
        return {};
      },
      buildSignalHash: () => 'fixture'
    }
  });
  const user = { _id: 'owner', activeCareerStack: 'Frontend' };
  await service.buildUserContext(user);
  await service.buildUserContext(user);
  assert.equal(reads, 1);
  await service.buildUserContext({ ...user, activeCareerStack: 'Backend' });
  assert.equal(reads, 2);
});
test('sprint draft compatibility includes intent while retaining the saved plan', async () => {
  let user = {
    _id: 'owner',
    careerStack: 'Frontend',
    experienceLevel: 'Student',
    careerGoal: ''
  };
  const service = load('services/sprintDraftContextService.js', {
    '../models/user': { findById: () => query(user) },
    './coursePersonalizationService': {
      resolveSkillSignals: async () => ({ fingerprint: 'same-evidence' })
    }
  });
  const before = await service.currentContext('owner');
  const plan = { context: before };
  user = { ...user, careerGoal: 'Improve portfolio' };
  const after = await service.currentContext('owner');
  assert.notEqual(before.fingerprint, after.fingerprint);
  assert.equal(service.compatibility(plan, after).requiresAcknowledgement, true);
  assert.equal(plan.context.fingerprint, before.fingerprint);
});

test(
  'disposable replica set: CRUD, ownership, concurrency, upload, deletion rollback and cleanup',
  { skip: !process.env.PROFILE_ACCEPTANCE_MONGO, timeout: 90000 },
  async (t) => {
    const mongoose = require('mongoose');
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const fs = require('node:fs/promises');
    const os = require('node:os');
    const path = require('node:path');
    const uri = process.env.PROFILE_ACCEPTANCE_MONGO;
    assert.match(
      uri,
      /^mongodb:\/\/127\.0\.0\.1:27139\//,
      'Only the task-owned loopback replica set is allowed'
    );
    const dbName = `profile_acceptance_${crypto.randomBytes(8).toString('hex')}`;
    const storage = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-acceptance-'));
    process.env.PUBLIC_IMAGE_STORAGE_ROOT = storage;
    process.env.JWT_SECRET = 'disposable-profile-test-signing-key';
    const serverHandles = [];
    t.after(async () => {
      for (const server of serverHandles) await new Promise((resolve) => server.close(resolve));
      assert.equal(mongoose.connection.name, dbName);
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
      for (const kind of ['avatars', 'portfolio-images']) {
        const directory = path.join(storage, kind);
        for (const name of await fs.readdir(directory).catch(() => []))
          await fs.unlink(path.join(directory, name));
        await fs.rmdir(directory).catch(() => {});
      }
      await fs.rmdir(storage);
      delete process.env.PUBLIC_IMAGE_STORAGE_ROOT;
    });
    await mongoose.connect(uri, { dbName, autoIndex: false, serverSelectionTimeoutMS: 5000 });
    const User = require('../models/user');
    const Resume = require('../models/resumeFile');
    const Profile = require('../models/publicProfile');
    const Cleanup = require('../models/accountDeletionCleanup');
    const deletion = require('../services/accountDeletionService');
    const models = [
      ...deletion.ownedModels,
      'organization',
      'publicProfile',
      'publicProfileView',
      'publicPortfolioVisit',
      'publicProfileCache',
      'Candidate',
      'repository',
      'sprintPreference',
      'sprintSchedule',
      'RecruiterMatch',
      'RecruiterShortlist',
      'Job',
      'integrationConnection',
      'integrationInsight',
      'integrationSyncLog',
      'integrationLinkedProfile',
      'accountDeletionCleanup'
    ];
    for (const name of new Set(models)) await require(`../models/${name}`).createCollection();
    const owner = await User.create({
      name: 'Owner',
      email: 'owner@example.test',
      providers: ['google'],
      githubUsername: 'octocat',
      careerStack: 'Frontend',
      activeCareerStack: 'Backend'
    });
    const other = await User.create({
      name: 'Other',
      email: 'other@example.test',
      providers: ['google']
    });
    const resume = await Resume.create({
      userId: owner._id,
      fileName: 'fixture.pdf',
      fileUrl: 'uploads/not-a-real-file.pdf',
      fileSize: 20
    });
    const foreign = await Resume.create({
      userId: other._id,
      fileName: 'foreign.pdf',
      fileUrl: 'uploads/foreign.pdf',
      fileSize: 20
    });
    const published = await Profile.create({
      userId: owner._id,
      slug: 'profile-acceptance',
      isPublic: true
    });
    const app = express();
    app.use(express.json());
    const router = load('routes/profile.routes.js', {
      '../controllers/profilecontroller': controller(),
      '../middleware/publicPortfolioRateLimit': { uploadLimit: (_req, _res, next) => next() }
    });
    app.use('/api/profile', router);
    const server = await new Promise((resolve) => {
      const handle = app.listen(0, '127.0.0.1', () => resolve(handle));
    });
    serverHandles.push(server);
    const base = `http://127.0.0.1:${server.address().port}/api/profile`;
    let token = jwt.sign({ id: String(owner._id) }, process.env.JWT_SECRET, {
      issuer: 'devinsight-api',
      audience: 'devinsight-web',
      expiresIn: '5m'
    });
    async function call(route, method = 'GET', body) {
      const headers = { Authorization: `Bearer ${token}` };
      if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
      const res = await fetch(base + route, {
        method,
        headers,
        body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined
      });
      const payload = await res.json();
      return { status: res.status, payload, cache: res.headers.get('cache-control') };
    }
    const read = await call('/me');
    assert.equal(read.status, 200);
    assert.equal(read.payload.careerStack, 'Frontend');
    assert.equal(read.payload.activeCareerStack, 'Backend');
    assert.equal(read.cache, 'private, no-store');
    assert.equal(
      (await call('/me', 'PUT', { defaultResumeFileId: String(foreign._id) })).status,
      400
    );
    const saved = await call('/me', 'PUT', {
      bio: 'b'.repeat(500),
      defaultResumeFileId: String(resume._id)
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.payload.bio.length, 500);
    assert.notEqual(saved.payload.profileHash, read.payload.profileHash);
    await Promise.all([
      call('/me', 'PUT', { notifications: { weeklyScoreReport: false } }),
      call('/me', 'PUT', { notifications: { jobMatchAlerts: false } }),
      call('/me', 'PUT', { location: 'Karachi' })
    ]);
    const after = await User.findById(owner._id).lean();
    assert.equal(after.notifications.weeklyScoreReport, false);
    assert.equal(after.notifications.jobMatchAlerts, false);
    assert.equal(after.location, 'Karachi');
    assert.equal(
      (await call('/career/active', 'PUT', { careerStack: 'AI/ML', experienceLevel: 'Intern' }))
        .status,
      200
    );
    assert.equal((await User.findById(owner._id)).careerStack, 'Frontend');
    assert.equal(
      (
        await call('/career', 'PUT', {
          careerStack: 'Full Stack',
          experienceLevel: 'Student',
          careerGoal: 'Improve portfolio',
          targetTimeline: 'Immediately',
          learningPreference: 'Reading'
        })
      ).status,
      200
    );
    assert.equal((await User.findById(owner._id)).activeCareerStack, 'Full Stack');
    await call('/visibility', 'PUT', { isPublic: false });
    assert.equal((await Profile.findById(published._id)).isPublic, true);
    const forged = new FormData();
    forged.append('avatar', new Blob(['<svg/>'], { type: 'image/png' }), 'avatar.png');
    assert.equal((await call('/avatar', 'POST', forged)).status, 400);
    const png = await require('sharp')({
      create: { width: 8, height: 8, channels: 3, background: '#336699' }
    })
      .png()
      .toBuffer();
    const uploads = await Promise.all(
      [1, 2].map(async () => {
        const form = new FormData();
        form.append('avatar', new Blob([png], { type: 'image/png' }), 'forged.html');
        return call('/avatar', 'POST', form);
      })
    );
    uploads.forEach((result) => assert.equal(result.status, 200));
    assert.equal(
      (await fs.readdir(path.join(storage, 'avatars'))).length,
      1,
      'concurrent avatar replacement retains only the winner'
    );
    const bcrypt = require('bcryptjs');
    await User.updateOne(
      { _id: owner._id },
      {
        $set: { password: await bcrypt.hash('Original-password-1!', 4) },
        $addToSet: { providers: 'local' }
      }
    );
    assert.equal(
      (
        await call('/password', 'PUT', {
          currentPassword: 'wrong',
          newPassword: 'Updated-password-2!'
        })
      ).status,
      401
    );
    const rotated = await call('/password', 'PUT', {
      currentPassword: 'Original-password-1!',
      newPassword: 'Updated-password-2!'
    });
    assert.equal(rotated.status, 200);
    assert.equal(
      (await call('/me')).status,
      401,
      'password change revokes old sessions immediately'
    );
    token = rotated.payload.token;
    assert.equal((await call('/me')).status, 200, 'replacement token keeps this session usable');
    const children = [];
    const ask = (child, message) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Worker timeout')), 10000);
        child.once('message', (value) => {
          clearTimeout(timer);
          value.error ? reject(Error(value.error)) : resolve(value);
        });
        child.send(message);
      });
    t.after(async () => {
      for (const child of children) if (child.connected) await ask(child, { op: 'close' });
    });
    const startWorker = async () => {
      const child = require('node:child_process').fork(
        path.join(__dirname, 'fixtures/profileSettingsWorker.js'),
        [],
        { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }
      );
      children.push(child);
      await ask(child, { op: 'connect', uri, dbName });
      return child;
    };
    const workers = await Promise.all([startWorker(), startWorker()]);
    for (const worker of workers)
      assert.ok((await ask(worker, { op: 'read', slug: published.slug })).payload);
    await User.updateOne({ _id: owner._id }, { $set: { name: 'Renamed on another worker' } });
    for (const worker of workers)
      assert.match(
        JSON.stringify((await ask(worker, { op: 'read', slug: published.slug })).payload),
        /Renamed on another worker/
      );
    await Profile.updateOne({ _id: published._id }, { $set: { isPublic: false } });
    for (const worker of workers)
      assert.equal(
        (await ask(worker, { op: 'read', slug: published.slug })).payload,
        null,
        'warm cache cannot restore publication'
      );
    await Profile.updateOne({ _id: published._id }, { $set: { isPublic: true } });
    await ask(workers[0], { op: 'close' });
    const restarted = await startWorker();
    assert.ok((await ask(restarted, { op: 'read', slug: published.slug })).payload);
    for (const worker of children) if (worker.connected) await ask(worker, { op: 'close' });
    const matching = require('../services/recruiter/matchingService');
    assert.deepEqual(
      await matching.listCandidates(),
      [],
      'portfolio publication cannot opt into discovery'
    );
    const analytics = require('../services/publicPortfolioAnalyticsPersistence');
    await require('../models/publicPortfolioVisit').createIndexes();
    const visit = {
      profileId: published._id,
      viewerHash: 'fixture-visitor',
      viewedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000)
    };
    await Promise.all([analytics.record(published, visit), analytics.record(published, visit)]);
    assert.equal(
      (await Profile.findById(published._id)).totalViews,
      1,
      'duplicate receipts roll back counter increments'
    );
    assert.equal(
      await require('../models/publicPortfolioVisit').countDocuments({
        profileId: published._id
      }),
      1
    );
    // All deletion ownership selectors are exercised without fabricating valid domain scores.
    for (const name of deletion.ownedModels) {
      const Model = require(`../models/${name}`);
      if (['resumeFile'].includes(name)) continue;
      await Model.collection.insertMany([{ userId: owner._id }, { userId: other._id }]);
    }
    await require('../models/organization').collection.insertOne({ ownerId: owner._id });
    assert.equal((await call('/me', 'DELETE')).status, 409);
    assert.ok(await User.exists({ _id: owner._id }));
    assert.ok(await Resume.exists({ _id: resume._id }));
    assert.equal(await Cleanup.countDocuments(), 0);
    await require('../models/organization').deleteMany({ ownerId: owner._id });
    assert.equal((await call('/me', 'DELETE')).status, 200);
    assert.equal(await User.exists({ _id: owner._id }), null);
    assert.equal(await Profile.countDocuments({ userId: owner._id }), 0);
    for (const name of deletion.ownedModels) {
      const Model = require(`../models/${name}`);
      assert.equal(await Model.countDocuments({ userId: owner._id }), 0, name);
      assert.ok(await Model.exists({ userId: other._id }), `${name} preserves other user`);
    }
    assert.equal(await Cleanup.countDocuments(), 0);
    assert.equal((await fs.readdir(path.join(storage, 'avatars'))).length, 0);
    const images = require('../services/publicImageStorageService');
    await images.put('avatars', owner._id, png, 'png');
    await Cleanup.create({ _id: owner._id, resumeUrls: [] });
    const remove = t.mock.method(images, 'remove', async () => {
      throw Error('Fixture storage outage');
    });
    await assert.rejects(deletion.processCleanup(owner._id), /Fixture storage outage/);
    assert.ok(await Cleanup.exists({ _id: owner._id }), 'failed cleanup remains durable');
    remove.mock.restore();
    await deletion.processCleanup(owner._id);
    assert.equal(await Cleanup.exists({ _id: owner._id }), null);
    for (let attempt = 0; attempt < 3; attempt++) {
      const racing = await User.create({
        name: 'Race fixture',
        email: `race-${attempt}@example.test`,
        providers: ['google']
      });
      await Promise.allSettled([
        require('../services/publicProfileService').getOrCreatePublicProfile(racing._id),
        deletion.deleteAccount(racing._id)
      ]);
      assert.equal(await User.exists({ _id: racing._id }), null);
      assert.equal(
        await Profile.countDocuments({ userId: racing._id }),
        0,
        'initialization cannot resurrect a deleted portfolio'
      );
    }
    assert.equal((await call('/me')).status, 401, 'deleted accounts cannot reuse JWTs');
  }
);
