'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { startMongo } = require('./fixtures/disposableRequestMongo');
const search = require('../services/courseCatalogSearchService');
const shared = require('../services/sharedCourseCatalogService');
const service = require('../services/courseService');
const { digest } = require('../utils/courseIdentity');

test(
  'intelligent discovery: Mongo authority, filtered demand and asynchronous reuse',
  { timeout: 120000 },
  async (t) => {
    const runtime = await startMongo({ replicaSet: 'intelligent-discovery' });
    const variables = [
      'YOUTUBE_API_KEY',
      'COURSES_GAP_DISCOVERY_ENABLED',
      'COURSES_MAINTENANCE_ENABLED',
      'COURSES_YOUTUBE_PIPELINES_PER_25H',
    ];
    const previous = Object.fromEntries(variables.map((key) => [key, process.env[key]]));
    process.env.YOUTUBE_API_KEY = 'synthetic-fixture-only';
    process.env.COURSES_GAP_DISCOVERY_ENABLED = 'true';
    process.env.COURSES_MAINTENANCE_ENABLED = 'true';
    let calls = 0;
    t.after(async () => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await mongoose.disconnect();
      await runtime.stop();
    });
    await mongoose.connect(runtime.uri);
    await shared.initialize();
    const queue = mongoose.connection.db.collection('course_catalog_discovery');
    const filters = (value) => service.normaliseCourseFilters({ view: 'discover', ...value });
    const load = (value) => search.load(filters(value));
    const job = async (topic) =>
      (await queue.findOne({ _id: 'topics' }))?.topics.find(
        (entry) => entry.topic === search.canonicalQuery(topic),
      );
    const video = (id, topic, extras = {}) =>
      service.normaliseCourse({
        id: 'yt_' + id,
        platform: 'YouTube',
        title: `${topic} verified course`,
        topics: [topic],
        url: `https://www.youtube.com/watch?v=${id}`,
        metadataSource: 'youtube-api',
        durationHours: 1,
        metadataVerifiedAt: new Date().toISOString(),
        ...extras,
      });

    await t.test(
      'arbitrary concurrent topic misses share one durable job and no inline provider calls',
      async () => {
        const results = await Promise.all(
          Array.from({ length: 25 }, () => load({ topic: 'Quantum Widgets', platform: 'YouTube' })),
        );
        assert.ok(
          results.every(
            (result) => result.courses.length === 0 && result.discovery.status === 'pending',
          ),
        );
        assert.equal((await queue.findOne({ _id: 'topics' })).topics.length, 1);
        assert.equal(calls, 0);
        assert.equal((await job('Quantum Widgets')).state, 'queued');
      },
    );

    await t.test(
      'one worker publishes globally; warm reads and a second worker make no additional call',
      async () => {
        const before = (await load({ topic: 'Quantum Widgets', platform: 'YouTube' })).revision;
        const snapshotAt = new Date(0);
        const fetchProvider = async () => {
          calls++;
          return {
            status: 'available',
            courses: ['quantum0001', 'quantum0002', 'quantum0003'].map((id) =>
              video(id, 'Quantum Widgets'),
            ),
          };
        };
        await Promise.all([
          search.processDiscoveryQueue({ fetchProvider }),
          search.processDiscoveryQueue({ fetchProvider }),
        ]);
        const result = await load({ topic: 'Quantum Widgets', platform: 'YouTube' });
        const lagging = await require('../services/courseDiscoveryStatusService').describe({
          topic: 'quantum widgets',
          matching: [],
          courses: [],
          freshness: {},
          revision: before,
          filters: filters({ topic: 'Quantum Widgets', platform: 'YouTube' }),
          catalogReadAt: snapshotAt,
          requestDiscovery: search.recordGap,
        });
        assert.equal(lagging.status, 'pending');
        const currentCoverage = await mongoose.connection.db
          .collection('course_catalog_coverage')
          .findOne({ technology: 'quantum widgets', provider: 'YouTube' });
        assert.equal(currentCoverage.quality.relevantCount, 3);
        await require('../services/courseCatalogCoverageService').observe('quantum widgets', [], {
          revision: 'older-api-snapshot',
          providers: ['YouTube'],
          catalogReadAt: snapshotAt,
        });
        const protectedCoverage = await mongoose.connection.db
          .collection('course_catalog_coverage')
          .findOne({ technology: 'quantum widgets', provider: 'YouTube' });
        assert.equal(protectedCoverage.quality.relevantCount, 3);
        assert.equal(protectedCoverage.state, 'healthy');
        assert.equal(result.courses.length, 3);
        assert.equal(result.discovery.status, 'ready');
        assert.notEqual(result.revision, before);
        await Promise.all(
          Array.from({ length: 25 }, () => load({ topic: 'Quantum Widgets', platform: 'YouTube' })),
        );
        await search.processDiscoveryQueue({ fetchProvider });
        assert.equal(calls, 1);
      },
    );

    await t.test(
      'duration shortages record bounded metadata demand; ratings and difficulty never promise enrichment',
      async () => {
        const duration = await load({
          topic: 'Quantum Widgets',
          platform: 'YouTube',
          duration: '10+',
        });
        assert.equal(duration.courses.length, 0);
        assert.equal(duration.discovery.reason, 'filter-mismatch');
        const rating = await load({ topic: 'Quantum Widgets', platform: 'YouTube', rating: '4.5' });
        assert.equal(rating.discovery.status, 'unavailable');
        assert.equal(rating.discovery.reason, 'missing-verified-metadata');
        const level = await load({
          topic: 'Quantum Widgets',
          platform: 'YouTube',
          level: 'Advanced',
        });
        assert.equal(level.discovery.status, 'unavailable');
        const row = await mongoose.connection.db
          .collection('course_catalog_coverage')
          .findOne({ technology: 'quantum widgets', provider: 'YouTube' });
        assert.equal(row.quality.relevantCount, 3);
        assert.equal(row.demand.filteredCount, 0);
        assert.equal(row.userId, undefined);
        assert.equal(calls, 1);
      },
    );

    await t.test(
      'curation-only providers and unavailable workers stop pending states',
      async () => {
        const curated = await load({ topic: 'Unpublished Curriculum', platform: 'Udemy' });
        assert.equal(curated.discovery.status, 'unavailable');
        assert.equal((await job('Unpublished Curriculum')).state, 'curation-required');
        process.env.COURSES_GAP_DISCOVERY_ENABLED = 'false';
        const disabled = await load({ topic: 'Frobulator', platform: 'YouTube' });
        assert.equal(disabled.discovery.status, 'unavailable');
        assert.equal((await job('Frobulator')).state, 'curation-required');
        process.env.COURSES_GAP_DISCOVERY_ENABLED = 'true';
        const rating = await load({ topic: 'Zettamorph', platform: 'YouTube', rating: '5' });
        assert.equal(rating.discovery.status, 'unavailable');
        assert.equal((await job('Zettamorph')).state, 'curation-required');
      },
    );

    await t.test(
      'unconfigured retrieval stays unavailable and recovers when authorized',
      async () => {
        delete process.env.YOUTUBE_API_KEY;
        const missing = await load({ topic: 'Astroflux', platform: 'YouTube' });
        assert.equal(missing.discovery.status, 'unavailable');
        assert.equal((await job('Astroflux')).state, 'curation-required');
        process.env.YOUTUBE_API_KEY = 'synthetic-fixture-only';
        const recovered = await load({ topic: 'Astroflux', platform: 'YouTube' });
        assert.equal(recovered.discovery.status, 'pending');
        await queue.updateOne(
          { _id: 'topics', 'topics.topic': 'astroflux' },
          {
            $set: {
              'topics.$.state': 'cooldown',
              'topics.$.nextAttemptAt': new Date(Date.now() + 86400_000),
            },
          },
        );
      },
    );
    await t.test(
      'failed providers enter cooldown without losing existing courses or retrying per read',
      async () => {
        await load({ topic: 'Crashology', platform: 'YouTube' });
        await search.processDiscoveryQueue({
          fetchProvider: async () => {
            calls++;
            return { status: 'unavailable', courses: [] };
          },
        });
        const result = await load({ topic: 'Crashology', platform: 'YouTube' });
        assert.equal(result.discovery.status, 'cooldown');
        assert.ok(result.discovery.retryAfterSeconds > 0);
        assert.equal(calls, 2);
        await Promise.all(
          Array.from({ length: 20 }, () => load({ topic: 'Crashology', platform: 'YouTube' })),
        );
        assert.equal(calls, 2);
        assert.equal(
          (await load({ topic: 'Quantum Widgets', platform: 'YouTube' })).courses.length,
          3,
        );
      },
    );

    await t.test(
      'pipeline quotas reject new acquisition before invoking the provider',
      async () => {
        process.env.COURSES_YOUTUBE_PIPELINES_PER_25H = '0';
        await load({ topic: 'Quotaflow', platform: 'YouTube' });
        await assert.rejects(
          search.processDiscoveryQueue({
            fetchProvider: async () => {
              calls++;
              throw Error('must not call');
            },
          }),
        );
        const result = await load({ topic: 'Quotaflow', platform: 'YouTube' });
        assert.equal(result.discovery.status, 'cooldown');
        assert.equal(calls, 2);
      },
    );

    await t.test(
      'partial results survive pending discovery; aliases reuse the canonical topic',
      async () => {
        const result = await load({ topic: 'rag' });
        assert.equal(result.courses.length, 2);
        assert.equal(result.discovery.status, 'pending');
        const alias = await load({ topic: 'Retrieval Augmented Generation' });
        assert.deepEqual(
          alias.courses.map((course) => course.id),
          result.courses.map((course) => course.id),
        );
        assert.equal(
          (await queue.findOne({ _id: 'topics' })).topics.filter(
            (entry) => entry.key === digest('RAG').slice(0, 24),
          ).length,
          1,
        );
      },
    );
  },
);
