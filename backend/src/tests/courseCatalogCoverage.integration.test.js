'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { fork } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { startMongo } = require('./fixtures/disposableRequestMongo');
const shared = require('../services/sharedCourseCatalogService');
const search = require('../services/courseCatalogSearchService');
const coverage = require('../services/courseCatalogCoverageService');
const acquisition = require('../services/courseCatalogAcquisitionService');
const taxonomy = require('../services/courseCatalogTaxonomy');
const service = require('../services/courseService');
const seed = require('../data/courseAcquisitionCatalog');
const { digest } = require('../utils/courseIdentity');
const snapshot = (courses) =>
  Object.fromEntries(
    taxonomy.technologies.map((topic) => [
      topic,
      Object.fromEntries(
        require('../utils/courseIdentity').COURSE_PROVIDERS.map((provider) => [
          provider,
          courses.filter(
            (course) => course.platform === provider && taxonomy.matches(course, topic),
          ).length,
        ]),
      ),
    ]),
  );
const fixtureJson = async (url) =>
  url === acquisition.SOURCES[0]
    ? {
        superblocks: seed.fcc.map((entry) => entry.manifestSlug || entry.slug),
      }
    : Object.fromEntries(seed.fcc.map((entry) => [entry.slug, { title: entry.title }]));

test(
  'provider-aware coverage and acquisition: real Mongo, bounded workers, reuse, failure and archival',
  { timeout: 120000 },
  async (t) => {
    const runtime = await startMongo({ replicaSet: 'course-acquisition' });
    const oldKey = process.env.YOUTUBE_API_KEY;
    const oldFlag = process.env.COURSES_OFFICIAL_CATALOG_ENABLED;
    process.env.YOUTUBE_API_KEY = 'synthetic-fixture-key';
    process.env.COURSES_OFFICIAL_CATALOG_ENABLED = 'true';
    const workers = [];
    t.after(async () => {
      for (const child of workers)
        if (child.connected) {
          const exited = new Promise((resolve) => child.once('exit', resolve));
          child.send('stop');
          await exited;
        }
      if (oldKey === undefined) delete process.env.YOUTUBE_API_KEY;
      else process.env.YOUTUBE_API_KEY = oldKey;
      if (oldFlag === undefined) delete process.env.COURSES_OFFICIAL_CATALOG_ENABLED;
      else process.env.COURSES_OFFICIAL_CATALOG_ENABLED = oldFlag;
      await mongoose.disconnect();
      const cleanup = await runtime.stop();
      const output = path.resolve(__dirname, '../../verification/courses/acquisition-2026-11-06');
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, 'cleanup.json'), JSON.stringify(cleanup, null, 2));
    });
    await mongoose.connect(runtime.uri);
    const inventory = service.buildFallbackPool('All', 200);
    const before = inventory.filter(
      (course) => !seed.courses.some((added) => added.id === course.id),
    );
    const version = digest([
      ...require('../data/courseCatalog'),
      ...require('../data/openLearningCatalog'),
    ]);
    await shared.getCurated(inventory, version);
    const raw = mongoose.connection.db.collection('shared_course_catalog');

    await t.test(
      'same topic/provider admission deduplicates across concurrent users; unsupported sources require curation',
      async () => {
        await Promise.all(
          Array.from({ length: 20 }, () =>
            coverage.observe('Angular', inventory, {
              revision: version,
              requestDiscovery: search.recordGap,
            }),
          ),
        );
        const rows = (await coverage.report()).states.filter((row) => row.technology === 'Angular');
        assert.equal(rows.length, 8);
        assert.equal(rows.find((row) => row.provider === 'YouTube').state, 'queued');
        assert.equal(rows.find((row) => row.provider === 'MDN').state, 'curation-required');
        assert.equal(rows.find((row) => row.provider === 'Coursera').quality.relevantCount, 2);
        const queue = await mongoose.connection.db
          .collection('course_catalog_discovery')
          .findOne({ _id: 'topics' });
        assert.equal(queue.topics.length, 1);
        assert.equal(queue.topics[0].topic, 'Angular');
      },
    );
    await t.test(
      'insufficient and stale coverage can refresh even when a course already exists',
      async () => {
        const video = {
          id: 'yt_abcdefghijk',
          title: 'Docker course',
          platform: 'YouTube',
          topics: ['Docker'],
          url: 'https://www.youtube.com/watch?v=abcdefghijk',
        };
        const states = await coverage.observe('Docker', [video], {
          revision: 'one-video',
          requestDiscovery: search.recordGap,
        });
        assert.equal(states.find((row) => row.provider === 'YouTube').quality.relevantCount, 1);
        assert.equal(states.find((row) => row.provider === 'YouTube').state, 'queued');
        const stale = await coverage.observe('Docker', [video], {
          revision: 'stale-video',
          freshness: { YouTube: new Date(Date.now() - 1000) },
          requestDiscovery: search.recordGap,
        });
        assert.equal(stale.find((row) => row.provider === 'YouTube').freshness, 'stale');
        assert.equal(
          (
            await mongoose.connection.db
              .collection('course_catalog_discovery')
              .findOne({ _id: 'topics' })
          ).topics.filter((entry) => entry.topic === 'Docker').length,
          1,
        );
      },
    );
    await t.test(
      'a curated-provider-only miss never queues an unsupported API or YouTube work',
      async () => {
        await search.load(
          service.normaliseCourseFilters({ topic: 'Unseen Curriculum Fixture', platform: 'Udemy' }),
        );
        const row = await mongoose.connection.db
          .collection('course_catalog_discovery')
          .findOne({ _id: 'topics' });
        assert.equal(
          row.topics.find((entry) => entry.topic === 'unseen curriculum fixture').state,
          'curation-required',
        );
      },
    );
    await t.test('queue capacity is durable cooldown, never a false queued success', async () => {
      const states = await coverage.observe('Rust', [], {
        revision: 'capacity-fixture',
        providers: ['YouTube'],
        requestDiscovery: async () => ({ status: 'capacity' }),
      });
      assert.equal(states[0].state, 'cooldown');
      assert.equal(states[0].failureReason, 'queue-capacity');
      assert.ok(states[0].nextRetryAt > new Date());
    });
    await t.test(
      'authorization transitions, poor-quality results, cooldown and private-field exclusion are durable',
      async () => {
        delete process.env.YOUTUBE_API_KEY;
        const unavailable = await coverage.observe('RAG', inventory, { revision: 'no-key' });
        assert.equal(
          unavailable.find((row) => row.provider === 'YouTube').state,
          'authorization-required',
        );
        process.env.YOUTUBE_API_KEY = 'synthetic-fixture-key';
        await coverage.observe('RAG', inventory, {
          revision: 'key-ready',
          requestDiscovery: search.recordGap,
        });
        await coverage.recordOutcome('YouTube', 'RAG', {
          courses: [{ title: 'Unrelated video', topics: [] }],
        });
        const row = await mongoose.connection.db
          .collection('course_catalog_coverage')
          .findOne({ technology: 'RAG', provider: 'YouTube' });
        assert.equal(row.failureReason, 'irrelevant-results');
        assert.equal(row.state, 'cooldown');
        assert.ok(row.nextRetryAt > new Date());
        assert.equal(row.userId, undefined);
        await coverage.recordOutcome('YouTube', 'RAG', null);
        assert.equal(
          (
            await mongoose.connection.db
              .collection('course_catalog_coverage')
              .findOne({ technology: 'RAG', provider: 'YouTube' })
          ).failureReason,
          'provider-refresh-in-progress',
        );
        await coverage.recordOutcome('YouTube', 'RAG', {
          status: 'available',
          stale: true,
          courses: [],
        });
        assert.equal(
          (
            await mongoose.connection.db
              .collection('course_catalog_coverage')
              .findOne({ technology: 'RAG', provider: 'YouTube' })
          ).failureReason,
          'stale-cached-results',
        );
        const invalid = await coverage.observe(
          'Angular',
          [
            {
              title: 'Angular',
              platform: 'Coursera',
              url: 'http://127.0.0.1/private',
              topics: ['Angular'],
              userId: 'private',
            },
          ],
          { revision: 'invalid-url', providers: ['Coursera'] },
        );
        assert.equal(invalid[0].quality.relevantCount, 0);
        assert.equal(invalid[0].quality.rejectedCount, 1);
      },
    );
    await t.test('coverage tuple and due-refresh queries use their declared indexes', async () => {
      const states = mongoose.connection.db.collection('course_catalog_coverage');
      const tuple = await states
        .find({ technology: 'Angular', provider: 'YouTube' })
        .explain('executionStats');
      assert.match(JSON.stringify(tuple.queryPlanner.winningPlan), /technology_provider/);
      assert.ok(tuple.executionStats.totalDocsExamined <= 1);
      const due = await states
        .find({ state: 'queued', nextRetryAt: { $lte: new Date() } })
        .sort({ nextRetryAt: 1 })
        .explain('executionStats');
      assert.match(JSON.stringify(due.queryPlanner.winningPlan), /coverage_refresh_due/);
    });
    await t.test(
      'a superseded topic worker cannot overwrite successor provider coverage',
      async () => {
        const governance = require('../services/courseGovernanceService');
        const left = await governance.acquirePoolLease('catalog-gap-worker', 60000);
        assert.equal(left.acquired, true);
        const State = require('../models/integrationGovernanceState');
        const session = await mongoose.connection.startSession();
        try {
          await session.withTransaction(
            async () => {
              assert.equal(
                await governance.fencePoolLease('catalog-gap-worker', left.token, session),
                true,
              );
            },
            { timeoutMS: 5000 },
          );
        } finally {
          await session.endSession();
        }
        await State.collection.updateOne(
          { 'leases.token': left.token },
          { $set: { 'leases.0.until': new Date(0) } },
        );
        const right = await governance.acquirePoolLease('catalog-gap-worker', 60000);
        assert.equal(right.acquired, true);
        const rows = mongoose.connection.db.collection('course_catalog_coverage');
        const before = await rows.findOne({ technology: 'RAG', provider: 'YouTube' });
        assert.equal(
          await coverage.recordOutcome('YouTube', 'RAG', null, Error('old failure'), {
            lease: left,
          }),
          false,
        );
        assert.equal(
          (
            await rows.findOne({ technology: 'RAG', provider: 'YouTube' })
          ).lastProviderCheckAt.getTime(),
          before.lastProviderCheckAt.getTime(),
        );
        assert.equal(
          await coverage.recordOutcome('YouTube', 'RAG', { courses: [] }, null, { lease: right }),
          true,
        );
        await governance.releasePoolLease('catalog-gap-worker', right.token);
      },
    );

    await t.test(
      'two real workers share one official source fetch and subsequent refreshes reuse it',
      async () => {
        const start = () =>
          new Promise((resolve, reject) => {
            const child = fork(path.join(__dirname, 'fixtures/courseAcquisitionWorker.js'), [], {
              env: { ...process.env, COURSE_ACQUISITION_TEST_MONGO: runtime.uri },
              windowsHide: true,
              stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
            });
            workers.push(child);
            child.once('error', reject);
            child.once('message', (message) =>
              message.ready ? resolve(child) : reject(Error(message.error)),
            );
          });
        const pair = await Promise.all([start(), start()]);
        const results = await Promise.all(
          pair.map(
            (child) =>
              new Promise((resolve) => {
                child.once('message', resolve);
                child.send('refresh');
              }),
          ),
        );
        assert.equal(results.filter((message) => message.result?.status === 'published').length, 1);
        assert.equal(
          (
            await mongoose.connection.db
              .collection('acquisition_fixture_calls')
              .findOne({ _id: 'calls' })
          ).count,
          2,
        );
        let calls = 0;
        await acquisition.refresh({
          fetchJson: async () => {
            calls++;
            throw Error('Must reuse');
          },
        });
        assert.equal(calls, 0);
        const source = await raw.findOne({ _id: acquisition.KEY });
        assert.equal(source.courses.length, 17);
        assert.equal(source.quality.unknownSlugs, 0);
      },
    );
    await t.test(
      'source failure retains last-good data and negative caching prevents repeat calls',
      async () => {
        await raw.updateOne({ _id: acquisition.KEY }, { $set: { nextRetryAt: new Date(0) } });
        let calls = 0;
        const fail = async () => {
          calls++;
          throw Object.assign(Error('private provider error'), { response: { status: 429 } });
        };
        assert.equal((await acquisition.refresh({ fetchJson: fail })).status, 'deferred');
        assert.equal((await acquisition.refresh({ fetchJson: fail })).status, 'reused-or-leased');
        assert.equal(calls, 1);
        const row = await raw.findOne({ _id: acquisition.KEY });
        assert.equal(row.courses.length, 17);
        assert.equal(row.failureReason, 'provider-rate-limited');
        assert.ok(!JSON.stringify(row).includes('private provider error'));
        const states = await coverage.observe('Python', inventory, {
          revision: 'source-failure',
          providers: ['freeCodeCamp'],
        });
        assert.equal(states[0].state, 'cooldown');
        assert.equal(states[0].failureReason, 'provider-rate-limited');
        assert.equal(states[0].nextRetryAt.getTime(), row.nextRetryAt.getTime());
      },
    );
    await t.test(
      'expired/crashed source owner is recoverable and a delayed owner is fenced',
      async () => {
        await raw.updateOne(
          { _id: acquisition.KEY },
          { $set: { nextRetryAt: new Date(0), leaseUntil: new Date(0) } },
        );
        let proceed;
        let entered;
        const ready = new Promise((resolve) => {
          entered = resolve;
        });
        const held = new Promise((resolve) => {
          proceed = resolve;
        });
        const delayed = acquisition.refresh({
          fetchJson: async (url) => {
            if (url === acquisition.SOURCES[0]) {
              entered();
              await held;
            }
            return fixtureJson(url);
          },
        });
        await ready;
        await raw.updateOne(
          { _id: acquisition.KEY },
          { $set: { leaseUntil: new Date(0), nextRetryAt: new Date(0) } },
        );
        assert.equal((await acquisition.refresh({ fetchJson: fixtureJson })).status, 'published');
        const published = (await raw.findOne({ _id: acquisition.KEY })).sourceVersion;
        proceed();
        assert.equal((await delayed).status, 'fenced');
        assert.equal((await raw.findOne({ _id: acquisition.KEY })).sourceVersion, published);
      },
    );
    await t.test(
      'public structured retrieval explicitly omits inherited authorization and cookies',
      async () => {
        await raw.updateOne({ _id: acquisition.KEY }, { $set: { nextRetryAt: new Date(0) } });
        const axios = require('axios');
        const original = axios.get;
        let calls = 0;
        axios.get = async (url, options) => {
          calls++;
          assert.ok(acquisition.SOURCES.includes(url));
          assert.equal(options.headers.Authorization, null);
          assert.equal(options.headers.Cookie, null);
          assert.equal(options.auth, null);
          assert.equal(options.maxRedirects, 0);
          assert.equal(options.maxContentLength, 2 * 1024 * 1024);
          return { data: await fixtureJson(url) };
        };
        try {
          assert.equal((await acquisition.refresh()).status, 'published');
        } finally {
          axios.get = original;
        }
        assert.equal(calls, 2);
      },
    );
    await t.test('daily Mongo-authoritative source budget denies before network work', async () => {
      for (let index = 0; index < 4; index++)
        await require('../services/courseGovernanceService').window(
          'official-catalog-http',
          'freeCodeCamp',
          4,
          86400000,
        );
      await raw.updateOne({ _id: acquisition.KEY }, { $set: { nextRetryAt: new Date(0) } });
      const axios = require('axios');
      let calls = 0;
      const original = axios.get;
      axios.get = async () => {
        calls++;
        return {};
      };
      try {
        assert.equal((await acquisition.refresh()).status, 'deferred');
      } finally {
        axios.get = original;
      }
      assert.equal(calls, 0);
      assert.equal(
        (await raw.findOne({ _id: acquisition.KEY })).failureReason,
        'daily-budget-exhausted',
      );
    });
    await t.test(
      'global archival cannot be bypassed through an official duplicate; saved notes remain editable',
      async () => {
        const progress = require('../services/courseProgressService');
        await require('../models/userCourseProgress').init();
        const owner = new mongoose.Types.ObjectId();
        const saved = await progress.saveProgress(owner, 'fb_f8', {
          status: 'in_progress',
          notes: 'Keep original notes',
          progressPercent: 27,
        });
        await raw.updateOne(
          { _id: 'curated' },
          { $set: { 'audits.fb_f8': { archived: true }, auditRevision: 'archival-fixture' } },
        );
        shared.clearMemory();
        search.clearMemory();
        assert.equal(await shared.findCourse('fb_f8'), null);
        assert.ok(
          !(await search.load(service.normaliseCourseFilters({ topic: 'Python' }))).courses.some(
            (course) => course.id === 'fb_f8',
          ),
        );
        const updated = await progress.saveProgress(owner, 'fb_f8', {
          status: 'completed',
          notes: 'Still owned',
        });
        assert.equal(updated.courseId, saved.courseId);
        assert.equal(updated.progressPercent, 27);
        assert.equal((await progress.listProgress(new mongoose.Types.ObjectId())).total, 0);
      },
    );
    await t.test(
      'oldest due topic wins over array order so cooldown retries cannot starve waiting jobs',
      async () => {
        const jobs = mongoose.connection.db.collection('course_catalog_discovery');
        await jobs.updateOne(
          { _id: 'topics', 'topics.topic': 'Angular' },
          {
            $set: {
              'topics.$.state': 'queued',
              'topics.$.nextAttemptAt': new Date(Date.now() - 1000),
            },
          },
        );
        await jobs.updateOne(
          { _id: 'topics', 'topics.topic': 'Docker' },
          { $set: { 'topics.$.state': 'queued', 'topics.$.nextAttemptAt': new Date(0) } },
        );
        const queries = [];
        await search.processDiscoveryQueue({
          fetchProvider: async (query) => {
            queries.push(query);
            return {
              status: 'available',
              courses: [
                {
                  id: 'yt_abcdefghijk',
                  title: 'Docker course',
                  platform: 'YouTube',
                  topics: ['Docker'],
                  url: 'https://www.youtube.com/watch?v=abcdefghijk',
                },
              ],
            };
          },
        });
        assert.deepEqual(queries, ['Docker programming']);
      },
    );
    await t.test(
      'scheduled prewarming respects provider identity and a registered topic outside the legacy subset',
      async () => {
        const previous = process.env.COURSES_BACKGROUND_INGESTION;
        process.env.COURSES_BACKGROUND_INGESTION = 'true';
        const original = service.fetchYouTubeCourses;
        const queries = [];
        const video = service.normaliseCourse({
          id: 'yt_zyxwvutsrqp',
          platform: 'YouTube',
          title: 'Go course fixture',
          topics: ['Go'],
          url: 'https://www.youtube.com/watch?v=zyxwvutsrqp',
          metadataSource: 'youtube-api',
        });
        await raw.updateOne({ _id: acquisition.KEY }, { $set: { freshUntil: new Date(0) } });
        await raw.insertOne({
          _id: 'youtube:Go',
          version: shared.VERSION,
          topic: 'Go',
          courses: [video],
          fingerprint: service.providerConfigurationFingerprint(),
          freshUntil: new Date(0),
          staleUntil: new Date(Date.now() + 86400000),
          updatedAt: new Date(),
        });
        service.fetchYouTubeCourses = async (query) => {
          queries.push(query);
          return { courses: [video], status: 'available' };
        };
        shared.clearMemory();
        try {
          await require('../services/courseCatalogMaintenanceService').maintain({
            probeCourse: async () => ({ status: 200 }),
          });
        } finally {
          service.fetchYouTubeCourses = original;
          if (previous === undefined) delete process.env.COURSES_BACKGROUND_INGESTION;
          else process.env.COURSES_BACKGROUND_INGESTION = previous;
        }
        assert.deepEqual(queries, ['Go programming']);
        const queue = await mongoose.connection.db
          .collection('course_catalog_discovery')
          .findOne({ _id: 'topics' });
        assert.ok(queue.topics.length <= search.MAX_QUEUE_TOPICS);
        assert.ok(
          queue.topics.filter((entry) => !search.KNOWN_TOPICS.includes(entry.topic)).length <=
            search.MAX_GAPS,
        );
      },
    );
    const report = {
      beforeCount: before.length,
      afterCount: inventory.length,
      before: snapshot(before),
      after: snapshot(inventory),
      coverage: await coverage.report(),
      indexes: await mongoose.connection.db.collection('course_catalog_coverage').indexes(),
      source: await raw.findOne({ _id: acquisition.KEY }),
      realProviderCalls: 0,
      fixtureSourceCalls: 2,
    };
    const output = path.resolve(__dirname, '../../verification/courses/acquisition-2026-11-06');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'coverage.json'), JSON.stringify(report, null, 2));
  },
);
