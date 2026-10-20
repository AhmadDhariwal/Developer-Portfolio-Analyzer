const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');
const { fork } = require('node:child_process');
const { load } = require('./fixtures/publicPortfolioFixture');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
mongoose.set('autoCreate', false);
mongoose.set('autoIndex', false);

test(
  'isolated Mongo + namespaced configured Upstash: critical portfolio flows',
  { timeout: 120000 },
  async (t) => {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    assert.ok(uri, 'Configured MongoDB required');
    const dbName = `portfolio_test_${randomUUID().replaceAll('-', '')}`;
    const namespace = `portfolio-test:${randomUUID()}:`;
    assert.match(dbName, /^portfolio_test_[a-f0-9]{32}$/);
    const redisService = require('../services/redisCacheService');
    const ownedKeys = new Set();
    const servers = [];
    const ownedFiles = [];
    const imageDirectory = path.resolve(__dirname, '../../uploads/portfolio-images');
    const createsImageDirectory = await fs.access(imageDirectory).then(
      () => false,
      () => true
    );
    t.after(async () => {
      await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
      const client = redisService.getRedisCacheClient();
      if (client && ownedKeys.size) await client.del([...ownedKeys]);
      await redisService.closeRedisCache();
      for (const filename of ownedFiles) await fs.unlink(filename);
      if (createsImageDirectory)
        await fs.rmdir(imageDirectory).catch((error) => {
          if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
        });
      if (mongoose.connection.readyState) {
        assert.equal(mongoose.connection.name, dbName, 'Only drop the owned disposable database');
        await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
      }
    });
    await mongoose.connect(uri, {
      dbName,
      autoCreate: false,
      autoIndex: false,
      serverSelectionTimeoutMS: 5000
    });
    const nativeRedis = await redisService.initRedisCache({ silent: true, probeOnly: true });
    assert.ok(nativeRedis, 'Configured Upstash Redis required');
    const scope = (key) => {
      assert.ok(key.startsWith('public-portfolio:v3:'));
      const scoped = namespace + key;
      ownedKeys.add(scoped);
      return scoped;
    };
    const redis = {
      get: (key) => nativeRedis.get(scope(key)),
      set: (key, value, options) => nativeRedis.set(scope(key), value, options),
      eval: (script, options) =>
        nativeRedis.eval(script, { ...options, keys: options.keys.map(scope) })
    };
    const cacheAccess = { getRedisCacheClient: () => redis };
    const User = require('../models/user');
    const Profile = require('../models/publicProfile');
    const Cache = require('../models/publicProfileCache');
    const Visit = require('../models/publicPortfolioVisit');
    const LegacyVisit = require('../models/publicProfileView');
    const Resume = require('../models/resumeFile');
    const Graph = require('../models/skillGraph');
    const Report = require('../models/weeklyReport');
    for (const Model of [User, Profile, Cache, Visit, LegacyVisit, Resume, Graph, Report])
      await Model.createIndexes();
    const owner = await User.create({
      name: 'Portfolio Owner',
      email: 'owner@example.test',
      password: 'unused-test-password',
      isPublic: true,
      isVerified: true
    });
    const other = await User.create({
      name: 'Other Owner',
      email: 'other@example.test',
      password: 'unused-test-password'
    });
    const profile = await Profile.create({
      userId: owner._id,
      slug: 'portfolio-owner',
      isPublic: true,
      skills: [{ name: 'JavaScript', score: 70 }],
      sections: { visibility: { cta: true } }
    });
    const {
      createPortfolioCache,
      revisionFor
    } = require('../services/publicPortfolioCacheService');
    function worker() {
      const isolatedCache = createPortfolioCache({ redis: cacheAccess });
      const service = load('services/publicProfileService.js', {
        './publicPortfolioCacheService': { portfolioCache: isolatedCache },
        './platformSettingsService': { getDeveloperSettingsSync: () => ({}) }
      });
      const controller = load('controllers/publicProfileController.js', {
        '../services/publicProfileService': service,
        '../services/notificationService': { createNotification: async () => {} }
      });
      const controls = load('middleware/publicPortfolioRateLimit.js', {
        '../services/redisCacheService': cacheAccess
      });
      const router = load('routes/publicProfile.routes.js', {
        '../controllers/publicProfileController': controller,
        '../middleware/publicPortfolioRateLimit': controls
      });
      const app = express();
      app.use(express.json({ limit: '128kb' }));
      app.use(
        '/uploads',
        require('../middleware/publicUploadAccess'),
        express.static(path.resolve(__dirname, '../../uploads'))
      );
      app.use('/api/public-profiles', router);
      return { service, controls, app };
    }
    const a = worker(),
      b = worker();
    for (const worker of [a, b]) {
      const server = await new Promise((resolve) => {
        const instance = worker.app.listen(0, '127.0.0.1', () => resolve(instance));
      });
      servers.push(server);
      worker.base = `http://127.0.0.1:${server.address().port}/api/public-profiles`;
    }
    const token = (account) =>
      jwt.sign({ id: account._id }, process.env.JWT_SECRET, {
        algorithm: 'HS256',
        issuer: process.env.JWT_ISSUER || 'devinsight-api',
        audience: process.env.JWT_AUDIENCE || 'devinsight-web'
      });
    const request = (worker, endpoint, account, options = {}) =>
      fetch(worker.base + endpoint, {
        ...options,
        headers: {
          'user-agent': 'PortfolioIntegrationBrowser',
          ...(account ? { authorization: `Bearer ${token(account)}` } : {}),
          ...(options.headers || {})
        }
      });

    await t.test('cold/memory/Redis/Mongo responses agree and contain no owner data', async () => {
      const first = await request(a, '/portfolio-owner');
      assert.equal(first.status, 200);
      assert.equal(first.headers.get('cache-control'), 'private, no-store');
      const body = await first.json();
      assert.equal(body.email, undefined);
      assert.equal(body.analytics, undefined);
      assert.equal(body.momentum, null);
      assert.deepEqual(await (await request(b, '/portfolio-owner')).json(), body);
      assert.deepEqual(await (await request(a, '/portfolio-owner')).json(), body);
      const durable = await Cache.findOne({ profileId: profile._id }).lean();
      assert.ok(durable);
      const offline = createPortfolioCache({ redis: { getRedisCacheClient: () => null } });
      const account = await User.findById(owner._id)
        .select(
          'name email phoneNumber defaultResumeFileId activeResumeFileId activeGithubUsername activeCareerStack activeExperienceLevel jobTitle location avatar avatarUrl githubUsername website twitter linkedin bio isActive isPublic'
        )
        .lean();
      assert.deepEqual(
        await offline.get(await Profile.findById(profile._id).lean(), account, () =>
          assert.fail('Mongo cache hit should not build')
        ),
        body
      );
    });
    await t.test(
      'edits, account updates, slug rename and unpublish invalidate warmed worker caches',
      async () => {
        const edit = await request(a, '/me', owner, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ headline: 'Updated headline' })
        });
        assert.equal(edit.status, 200);
        assert.equal(
          (await (await request(b, '/portfolio-owner')).json()).headline,
          'Updated headline'
        );
        await User.updateOne({ _id: owner._id }, { $set: { name: 'Updated owner' } });
        assert.equal(
          (await (await request(a, '/portfolio-owner')).json()).user.name,
          'Updated owner'
        );
        await User.updateOne(
          { _id: owner._id },
          { $set: { activeGithubUsername: 'active-portfolio-owner' } }
        );
        const activeIdentity = await (await request(b, '/portfolio-owner')).json();
        assert.equal(activeIdentity.user.githubUsername, 'active-portfolio-owner');
        assert.equal(
          activeIdentity.socialLinks.github,
          'https://github.com/active-portfolio-owner'
        );
        await a.service.updatePublicProfile(owner._id, { slug: 'renamed-owner' });
        assert.equal((await request(b, '/portfolio-owner')).status, 404);
        assert.equal((await request(b, '/renamed-owner')).status, 200);
        await a.service.updatePublicProfile(owner._id, { isPublic: false });
        assert.equal((await request(b, '/renamed-owner')).status, 404);
        assert.equal((await request(a, '/renamed-owner?preview=true', other)).status, 404);
        const preview = await request(b, '/renamed-owner?preview=true', owner);
        assert.equal(preview.status, 200);
        assert.equal((await preview.json()).email, owner.email);
        await a.service.updatePublicProfile(owner._id, { isPublic: true });
      }
    );
    await t.test(
      'private and ownership endpoints require authentication; foreign account cannot edit owner',
      async () => {
        assert.equal((await request(a, '/me')).status, 401);
        assert.equal((await request(a, '/me/analytics')).status, 401);
        const result = await request(a, '/me', other, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ userId: owner._id, headline: 'Foreign edit' })
        });
        assert.equal(result.status, 200);
        assert.equal((await Profile.findById(profile._id)).headline, 'Updated headline');
      }
    );
    await t.test(
      'Mongo unique visit index deduplicates concurrent workers; UTC daily sums are correct',
      async () => {
        await Visit.deleteMany({ profileId: profile._id });
        await Profile.updateOne({ _id: profile._id }, { $set: { totalViews: 0, uniqueViews: 0 } });
        const current = await Profile.findById(profile._id).lean();
        const req = {
          method: 'GET',
          ip: '192.0.2.10',
          headers: { 'user-agent': 'PortfolioBrowserAnalytics' }
        };
        await Promise.all(
          Array.from({ length: 20 }, (_, i) =>
            (i % 2 ? a : b).service.recordProfileView({ profile: current, req })
          )
        );
        assert.equal(await Visit.countDocuments({ profileId: profile._id }), 1);
        const visit = await Visit.findOne({ profileId: profile._id }).lean();
        assert.equal(visit.ipAddress, undefined);
        assert.equal(visit.userAgent, undefined);
        assert.ok(visit.expiresAt > new Date());
        const analytics = await a.service.getPublicProfileAnalytics(owner._id);
        assert.equal(analytics.totalViews, 1);
        assert.equal(analytics.last7Days.at(-1).count, 1);
      }
    );
    await t.test(
      'resume owner binding, confinement, CTA privacy and real PDF response',
      async () => {
        const filename = path.resolve(
          __dirname,
          '../../uploads',
          `portfolio-test-${randomUUID()}.pdf`
        );
        ownedFiles.push(filename);
        await fs.writeFile(filename, '%PDF-1.4\nportfolio test\n%%EOF');
        const file = await Resume.create({
          userId: owner._id,
          fileName: 'test.pdf',
          fileSize: 40,
          fileUrl: filename,
          mimeType: 'application/pdf'
        });
        await User.updateOne({ _id: owner._id }, { $set: { defaultResumeFileId: file._id } });
        assert.equal((await request(a, '/renamed-owner/resume')).status, 200);
        assert.equal((await request(a, '/me/resume', owner)).status, 200);
        assert.equal((await request(a, '/me/resume', other)).status, 404);
        assert.equal(
          (await fetch(a.base.split('/api/')[0] + '/uploads/' + path.basename(filename))).status,
          404
        );
        await Resume.updateOne({ _id: file._id }, { $set: { userId: other._id } });
        assert.equal((await request(a, '/renamed-owner/resume')).status, 404);
        await Resume.updateOne(
          { _id: file._id },
          { $set: { userId: owner._id, fileUrl: path.resolve(__dirname, '../../../AGENTS.md') } }
        );
        assert.equal((await request(a, '/renamed-owner/resume')).status, 404);
        await Resume.updateOne({ _id: file._id }, { $set: { fileUrl: filename } });
        await Profile.updateOne(
          { _id: profile._id },
          { $set: { 'sections.visibility.cta': false } }
        );
        assert.equal((await request(b, '/renamed-owner/resume')).status, 404);
      }
    );
    await t.test('distributed rate quotas share counters and expire', async () => {
      const { response } = require('./fixtures/publicPortfolioFixture');
      const limiterA = a.controls.limiter('integration', 1, 60000),
        limiterB = b.controls.limiter('integration', 1, 60000);
      let admitted = 0;
      const req = { ip: '192.0.2.99' };
      await limiterA(req, response(), () => admitted++);
      const denied = response();
      await limiterB(req, denied, () => admitted++);
      assert.equal(admitted, 1);
      assert.equal(denied.statusCode, 429);
      assert.ok(Number(denied.headers['Retry-After']) > 0);
      const rateKey = [...ownedKeys].find((key) => key.includes(':rate:integration:'));
      assert.ok((await nativeRedis.pTTL(rateKey)) > 0);
    });
    await t.test(
      'Redis distributed single-flight prevents duplicate builds across isolated caches',
      async () => {
        const fresh = { _id: new mongoose.Types.ObjectId(), userId: owner._id, isPublic: true };
        const one = createPortfolioCache({ redis: cacheAccess }),
          two = createPortfolioCache({ redis: cacheAccess });
        let builds = 0;
        const loader = async () => {
          builds++;
          await new Promise((r) => setTimeout(r, 100));
          return { public: true };
        };
        assert.deepEqual(
          await Promise.all([one.get(fresh, {}, loader), two.get(fresh, {}, loader)]),
          [{ public: true }, { public: true }]
        );
        assert.equal(builds, 1);
        const key = `public-portfolio:v3:${fresh._id}:${revisionFor(fresh, {})}`;
        const ttl = await nativeRedis.pTTL(namespace + key);
        assert.ok(ttl > 0 && ttl <= 3600000);
      }
    );
    await t.test(
      'separate Node processes share locks and observe edited content revisions',
      async () => {
        const record = {
          _id: String(new mongoose.Types.ObjectId()),
          isPublic: true,
          headline: 'First content'
        };
        const run = (profile) =>
          new Promise((resolve, reject) => {
            const child = fork(path.join(__dirname, 'fixtures/publicPortfolioWorker.js'), [], {
              stdio: ['ignore', 'ignore', 'ignore', 'ipc']
            });
            const timer = setTimeout(() => {
              child.kill();
              reject(Error('Worker timeout'));
            }, 30000);
            child.once('error', reject);
            child.once('message', (message) => {
              clearTimeout(timer);
              message.error ? reject(Error(message.error)) : resolve(message);
            });
            child.send({ dbName, namespace, profile });
            const key = `public-portfolio:v3:${profile._id}:${revisionFor(profile, {})}`;
            ownedKeys.add(namespace + key);
            ownedKeys.add(namespace + key + ':lock');
          });
        const results = await Promise.all([run(record), run(record)]);
        assert.equal(
          results.reduce((sum, result) => sum + result.builds, 0),
          1
        );
        const updated = await run({ ...record, headline: 'Edited content' });
        assert.equal(updated.payload.headline, 'Edited content');
        assert.equal(updated.builds, 1);
      }
    );
    await t.test(
      'image endpoint enforces auth, MIME, size, structure and generated storage names',
      async () => {
        const png = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=',
          'base64'
        );
        const form = new FormData();
        form.append('image', new Blob([png], { type: 'image/png' }), '../../escape.png');
        const result = await request(a, '/me/project-image', owner, { method: 'POST', body: form });
        assert.equal(result.status, 201);
        const body = await result.json();
        assert.match(
          body.imageUrl,
          new RegExp(`^/uploads/portfolio-images/${owner._id}-[a-f0-9-]+\\.png$`)
        );
        const filename = path.resolve(__dirname, '../../', body.imageUrl.slice(1));
        ownedFiles.push(filename);
        assert.deepEqual(await fs.readFile(filename), png);
        const asset = await fetch(a.base.split('/api/')[0] + body.imageUrl);
        assert.equal(asset.status, 200);
        assert.equal(asset.headers.get('x-content-type-options'), 'nosniff');
        const forged = new FormData();
        forged.append(
          'image',
          new Blob(['<svg onload=alert(1)>'], { type: 'image/png' }),
          'bad.png'
        );
        assert.equal(
          (await request(a, '/me/project-image', owner, { method: 'POST', body: forged })).status,
          400
        );
        const large = new FormData();
        large.append(
          'image',
          new Blob([Buffer.alloc(2 * 1024 * 1024 + 1)], { type: 'image/png' }),
          'large.png'
        );
        assert.equal(
          (await request(a, '/me/project-image', owner, { method: 'POST', body: large })).status,
          413
        );
        assert.equal(
          (
            await request(a, '/me/project-image', undefined, {
              method: 'POST',
              body: new FormData()
            })
          ).status,
          401
        );
      }
    );
    await t.test(
      'platform revocation immediately blocks warmed workers and public resume access',
      async () => {
        await Profile.updateOne(
          { _id: profile._id },
          { $set: { 'sections.visibility.cta': true } }
        );
        assert.equal((await request(a, '/renamed-owner')).status, 200);
        assert.equal((await request(b, '/renamed-owner/resume')).status, 200);
        const Settings = require('../models/platformSettings');
        await Settings.updateOne(
          { scope: 'global' },
          { $set: { 'developer.publicPortfolioVisibility': false } },
          { upsert: true }
        );
        assert.equal((await request(a, '/renamed-owner')).status, 404);
        assert.equal((await request(b, '/renamed-owner')).status, 404);
        assert.equal((await request(a, '/renamed-owner/resume')).status, 404);
        await assert.rejects(a.service.updatePublicProfile(owner._id, { isPublic: true }), {
          statusCode: 403
        });
        await Settings.updateOne(
          { scope: 'global' },
          { $set: { 'developer.publicPortfolioVisibility': true } }
        );
      }
    );
    await t.test(
      'account privacy revocation unpublishes portfolios on warmed workers',
      async () => {
        const controller = load('controllers/profilecontroller.js', {
          '../services/notificationService': { createNotification: async () => {} },
          '../services/platformSettingsService': { getDeveloperSettingsSync: () => ({}) },
          '../services/newsService': { invalidateNewsSignalCache: () => {} },
          './dashboardcontroller': { invalidateDashboardSummaryCache: () => {} }
        });
        const { response } = require('./fixtures/publicPortfolioFixture');
        assert.equal((await request(b, '/renamed-owner')).status, 200);
        const result = response();
        await controller.updateProfileVisibility(
          { user: owner, body: { isPublic: false } },
          result
        );
        assert.equal(result.statusCode, 200);
        assert.equal(result.body.isPublic, false);
        assert.equal((await request(a, '/renamed-owner')).status, 404);
        assert.equal((await request(b, '/renamed-owner')).status, 404);
        assert.equal((await request(b, '/renamed-owner/resume')).status, 404);
        assert.equal((await request(b, '/me/resume', owner)).status, 200);
      }
    );
  }
);
