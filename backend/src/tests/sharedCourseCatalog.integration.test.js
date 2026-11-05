'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { startMongo } = require('./fixtures/disposableRequestMongo');
const catalog = require('../services/sharedCourseCatalogService');
const service = require('../services/courseService');
const maintenance = require('../services/courseCatalogMaintenanceService');

const fixture = {
  id: 'yt_abcdefghijk',
  title: 'SQL full course',
  platform: 'YouTube',
  url: 'https://www.youtube.com/watch?v=abcdefghijk',
  topics: ['SQL'],
  metadataSource: 'youtube-api',
  durationHours: 2,
  owner: 'must-not-persist',
  whyRecommended: 'private reason',
  finalScore: 99,
  provenance: { metadataVerifiedAt: '2026-11-05T00:00:00.000Z' },
};

test(
  'global catalog: durable reuse, bounded load, negative caching, SWR, fencing, quotas and recovery',
  { timeout: 120_000 },
  async (t) => {
    const runtime = await startMongo({ replicaSet: 'shared-course-catalog' });
    const originalBudget = process.env.COURSES_YOUTUBE_PIPELINES_PER_25H;
    t.after(async () => {
      if (originalBudget === undefined) delete process.env.COURSES_YOUTUBE_PIPELINES_PER_25H;
      else process.env.COURSES_YOUTUBE_PIPELINES_PER_25H = originalBudget;
      await mongoose.disconnect();
      await runtime.stop();
    });
    await mongoose.connect(runtime.uri);
    let db = mongoose.connection.db.collection('shared_course_catalog');
    let pipelines = 0;
    const fetchProvider = async () => {
      pipelines++;
      return { courses: [fixture, fixture], status: 'available', reason: '' };
    };
    const options = {
      topic: ' SQL ',
      careerStack: 'Backend',
      fingerprint: 'fixture',
      fetchProvider,
    };
    await t.test('canonical aliases and bounded unknown search admission', () => {
      assert.equal(catalog.canonicalTopic(' js '), 'JavaScript');
      assert.equal(catalog.canonicalTopic('JAVASCRIPT'), 'JavaScript');
      assert.equal(catalog.canonicalTopic('untrusted arbitrary phrase', 'Backend'), 'Backend');
    });
    await t.test('worker clock skew cannot reset Mongo quotas or steal active leases', async () => {
      const governance = require('../services/courseGovernanceService');
      const first = await governance.window('clock-fixture', 'owner', 1, 3_600_000);
      assert.equal(first.allowed, true);
      const lease = await governance.acquirePoolLease('clock-fixture');
      assert.equal(lease.acquired, true);
      const actualNow = Date.now;
      const shifted = actualNow() + 2 * 86_400_000;
      try {
        Date.now = () => shifted;
        assert.equal(
          (await governance.window('clock-fixture', 'owner', 1, 3_600_000)).allowed,
          false,
        );
        assert.equal((await governance.acquirePoolLease('clock-fixture')).acquired, false);
      } finally {
        Date.now = actualNow;
        await governance.releasePoolLease('clock-fixture', lease.token);
      }
    });
    await t.test(
      'cold requests share one pipeline; raw coverage excludes private fields and duplicates',
      async () => {
        const result = await Promise.all(
          Array.from({ length: 50 }, () => catalog.getYouTube(options)),
        );
        assert.equal(pipelines, 1);
        assert.ok(result.every((row) => row.courses.length === 1));
        const row = await db.findOne({ _id: 'youtube:SQL' });
        assert.equal(row.courses[0].owner, undefined);
        assert.equal(row.courses[0].whyRecommended, undefined);
        assert.equal(row.courses[0].finalScore, undefined);
        assert.equal(
          row.courses[0].provenance.metadataVerifiedAt,
          fixture.provenance.metadataVerifiedAt,
        );
      },
    );
    await t.test(
      'different profile and provider-filter callers reuse durable raw coverage after memory loss',
      async () => {
        catalog.clearMemory();
        const result = await catalog.getYouTube({
          ...options,
          topic: 'sql',
          careerStack: 'Frontend',
        });
        assert.equal(result.fromCache, true);
        assert.equal(pipelines, 1);
        result.courses[0].title = 'caller mutation';
        assert.equal((await catalog.getYouTube(options)).courses[0].title, fixture.title);
      },
    );
    const samples = [];
    await t.test(
      '3000 simulated warm catalog callers make zero additional provider requests',
      async () => {
        for (let batch = 0; batch < 30; batch++)
          await Promise.all(
            Array.from({ length: 100 }, async () => {
              const started = performance.now();
              const result = await catalog.getYouTube(options);
              samples.push(performance.now() - started);
              assert.equal(result.courses[0].id, fixture.id);
            }),
          );
        assert.equal(pipelines, 1);
        assert.ok(
          catalog.metrics().memoryEntries <= catalog.TOPICS.length + catalog.STACKS.length + 1,
        );
        assert.equal(catalog.metrics().inflight, 0);
      },
    );
    await t.test('fresh rows survive Mongo disconnect/reconnect with Redis absent', async () => {
      catalog.clearMemory();
      await mongoose.disconnect();
      await assert.rejects(catalog.getYouTube(options), { status: 503 });
      await mongoose.connect(runtime.uri);
      db = mongoose.connection.db.collection('shared_course_catalog');
      assert.equal((await catalog.getYouTube(options)).fromCache, true);
      assert.equal(pipelines, 1);
    });
    await t.test(
      'stale data returns immediately and failed refresh retains prior identities',
      async () => {
        catalog.clearMemory();
        await db.updateOne({ _id: 'youtube:SQL' }, { $set: { freshUntil: new Date(0) } });
        let release;
        const pending = new Promise((resolve) => {
          release = resolve;
        });
        const stale = await catalog.getYouTube({
          ...options,
          fetchProvider: async () => {
            pipelines++;
            await pending;
            return { courses: [], status: 'unavailable' };
          },
        });
        assert.equal(stale.courses[0].id, fixture.id);
        assert.match(stale.reason, /refreshed/);
        release();
        for (let i = 0; i < 100 && catalog.metrics().inflight; i++)
          await new Promise((resolve) => setTimeout(resolve, 20));
        const row = await db.findOne({ _id: 'youtube:SQL' });
        assert.equal(row.status, 'unavailable');
        assert.equal(row.courses[0].id, fixture.id);
        assert.equal(row.failureCount, 1);
      },
    );
    await t.test(
      'expired coverage is never resurrected by a failed refresh and failure is negative cached',
      async () => {
        catalog.clearMemory();
        await db.updateOne(
          { _id: 'youtube:SQL' },
          { $set: { freshUntil: new Date(0), staleUntil: new Date(0) } },
        );
        let calls = 0;
        const failed = {
          ...options,
          fetchProvider: async () => {
            calls++;
            return { courses: [], status: 'unavailable' };
          },
        };
        assert.deepEqual((await catalog.getYouTube(failed)).courses, []);
        catalog.clearMemory();
        assert.deepEqual((await catalog.getYouTube(failed)).courses, []);
        assert.equal(calls, 1);
      },
    );
    await t.test('empty coverage is durably negative cached', async () => {
      let calls = 0;
      const empty = {
        ...options,
        topic: 'Python',
        fetchProvider: async () => {
          calls++;
          return { courses: [], status: 'available' };
        },
      };
      assert.deepEqual((await catalog.getYouTube(empty)).courses, []);
      catalog.clearMemory();
      await catalog.getYouTube(empty);
      assert.equal(calls, 1);
    });
    await t.test('expired/crashed worker is fenced by Mongo server time', async () => {
      let release;
      let entered;
      const began = new Promise((resolve) => {
        entered = resolve;
      });
      const held = new Promise((resolve) => {
        release = resolve;
      });
      const first = catalog.getYouTube({
        ...options,
        topic: 'React',
        fetchProvider: async () => {
          entered();
          await held;
          return { courses: [fixture], status: 'available' };
        },
      });
      const rejected = assert.rejects(first, { status: 503 });
      await began;
      await db.updateOne({ _id: 'youtube:React' }, { $set: { leaseUntil: new Date(0) } });
      release();
      await rejected;
      assert.equal((await db.findOne({ _id: 'youtube:React' })).courses, undefined);
      const recovered = await catalog.getYouTube({ ...options, topic: 'React' });
      assert.equal(recovered.courses[0].id, fixture.id);
    });
    await t.test('global request budget denies before external work', async () => {
      process.env.COURSES_YOUTUBE_PIPELINES_PER_25H = '0';
      let called = false;
      await assert.rejects(
        catalog.getYouTube({
          ...options,
          topic: 'Docker',
          fetchProvider: async () => {
            called = true;
          },
        }),
        { status: 503 },
      );
      assert.equal(called, false);
    });
    await t.test(
      'official open providers are filterable and safely saveable identities',
      async () => {
        for (const platform of ['MDN', 'The Odin Project', 'Full Stack Open']) {
          const pool = service.buildFallbackPool(platform, 200);
          assert.equal(pool.length, 1);
          assert.equal(service.normaliseCourseFilters({ platform }).platform, platform);
          assert.ok(require('../utils/courseIdentity').validCourseId(pool[0].id));
          assert.ok(service.isPersistableCoursePool(pool));
          assert.equal(pool[0].rating, null);
        }
      },
    );
    await t.test(
      'scheduled archival requires two audits, invalidates discovery and preserves saved progress',
      async () => {
        const progress = require('../services/courseProgressService');
        const owner = new mongoose.Types.ObjectId();
        const saved = await progress.saveProgress(owner, 'fb_u1', {
          status: 'saved',
          notes: 'keep private',
        });
        const revisionBefore = await catalog.revision();
        await maintenance.maintain({ probeCourse: async () => ({ status: 404 }) });
        assert.ok(await catalog.findCourse('fb_u1'), 'one missing response must not archive');
        await db.updateOne({ _id: 'curated' }, { $set: { 'audits.fb_u1.checkedAt': new Date(0) } });
        await maintenance.maintain({ probeCourse: async () => ({ status: 404 }) });
        assert.equal(await catalog.findCourse('fb_u1'), null);
        assert.notEqual(await catalog.revision(), revisionBefore);
        await assert.rejects(
          progress.saveProgress(new mongoose.Types.ObjectId(), 'fb_u1', { status: 'saved' }),
          { status: 404 },
        );
        const updated = await progress.saveProgress(owner, 'fb_u1', {
          status: 'completed',
          progressPercent: 0,
        });
        assert.equal(updated.notes, 'keep private');
        assert.equal(updated.progressPercent, 0);
        assert.equal(updated.course.url, saved.course.url);
        assert.equal((await progress.listProgress(new mongoose.Types.ObjectId())).total, 0);
        const coverage = await maintenance.coverageReport();
        assert.equal(coverage.urlAudits.fb_u1.archived, true);
        assert.ok(coverage.providers.YouTube > 0);
      },
    );
    const explain = await db
      .find({ version: catalog.VERSION, freshUntil: { $lte: new Date() } })
      .sort({ freshUntil: 1, _id: 1 })
      .limit(2)
      .explain('executionStats');
    const identityExplain = await db.find({ 'courses.id': fixture.id }).explain('executionStats');
    const topicExplain = await db.find({ _id: 'youtube:SQL' }).explain('executionStats');
    assert.match(JSON.stringify(topicExplain.queryPlanner.winningPlan), /_id_/);
    assert.match(JSON.stringify(explain.queryPlanner.winningPlan), /catalog_refresh_schedule/);
    assert.match(
      JSON.stringify(identityExplain.queryPlanner.winningPlan),
      /catalog_course_identity/,
    );
    samples.sort((a, b) => a - b);
    const report = {
      scope:
        'Disposable real Mongo; synthetic provider; direct catalog service callers, not deployed HTTP load',
      simulatedWarmCallers: samples.length,
      warmProviderPipelines: 0,
      estimatedUncachedHttpRequestsAvoided: samples.length * 3,
      avoidanceBaseline:
        'Counterfactual uncached pipeline: two searches and one details request per caller; no live cost measurement',
      warmHitRate: 1,
      p50Ms: samples[Math.floor(samples.length * 0.5)],
      p95Ms: samples[Math.floor(samples.length * 0.95)],
      metrics: catalog.metrics(),
      indexes: await db.indexes(),
      explain,
      identityExplain,
      topicExplain,
    };
    const output = path.resolve(
      __dirname,
      '../../verification/courses/shared-catalog-2026-11-05.json',
    );
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    t.diagnostic(
      JSON.stringify({ p50Ms: report.p50Ms, p95Ms: report.p95Ms, warmHitRate: report.warmHitRate }),
    );
  },
);

test('catalog link auditor blocks redirects to unapproved destinations', async () => {
  const axios = require('axios');
  const old = axios.head;
  let calls = 0;
  axios.head = async () => {
    calls++;
    return { status: 302, headers: { location: 'http://127.0.0.1/private' } };
  };
  try {
    assert.equal(
      (await maintenance.probe('https://www.udemy.com/course/example/', 'Udemy')).status,
      'redirect-review',
    );
    assert.equal(calls, 1);
  } finally {
    axios.head = old;
  }
});
