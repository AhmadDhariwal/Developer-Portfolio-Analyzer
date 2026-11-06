'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');
const { performance } = require('node:perf_hooks');
const { startMongo } = require('./fixtures/disposableRequestMongo');

test(
  'global discovery and My Learning: real Mongo/JWT, background-only coverage and recovery',
  { timeout: 120_000 },
  async (t) => {
    const runtime = await startMongo({ replicaSet: 'learning-discovery' });
    let server;
    const axios = require('axios');
    const originalGet = axios.get;
    const originalEnv = {
      JWT_SECRET: process.env.JWT_SECRET,
      YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
      COURSES_READ_RATE_LIMIT_MAX: process.env.COURSES_READ_RATE_LIMIT_MAX,
      COURSES_POOL_STORE_TIMEOUT_MS: process.env.COURSES_POOL_STORE_TIMEOUT_MS,
    };
    process.env.JWT_SECRET = 'isolated-learning-discovery-signing-secret';
    process.env.YOUTUBE_API_KEY = 'synthetic-fixture-key';
    process.env.COURSES_READ_RATE_LIMIT_MAX = '10000';
    process.env.COURSES_POOL_STORE_TIMEOUT_MS = '5000';
    let externalCalls = 0;
    axios.get = async () => {
      externalCalls++;
      throw Error('Serving must not call a provider');
    };
    t.after(async () => {
      axios.get = originalGet;
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      if (server) await new Promise((resolve) => server.close(resolve));
      await mongoose.disconnect();
      await runtime.stop();
    });
    await mongoose.connect(runtime.uri);
    const User = require('../models/user');
    const owner = new mongoose.Types.ObjectId();
    const foreign = new mongoose.Types.ObjectId();
    await User.create(
      [owner, foreign].map((_id) => ({
        _id,
        name: 'Isolated learning fixture',
        email: `${_id}@fixture.invalid`,
        password: 'fixture',
        activeCareerStack: 'Backend',
        activeExperienceLevel: 'Intern',
      })),
    );
    const catalog = require('../services/sharedCourseCatalogService');
    await catalog.initialize();
    const search = require('../services/courseCatalogSearchService');
    const courses = require('../services/courseService');
    await catalog.ingestCurated(
      courses.buildFallbackPool('All', 200),
      require('../utils/courseIdentity').digest([
        ...require('../data/courseCatalog'),
        ...require('../data/openLearningCatalog'),
      ]),
    );
    await t.test(
      'a cold catalog queues one shared YouTube bootstrap without an inline provider call',
      async () => {
        await Promise.all(
          Array.from({ length: 10 }, () =>
            search.load(courses.normaliseCourseFilters({ view: 'discover' })),
          ),
        );
        const bootstrap = await mongoose.connection.db
          .collection('course_catalog_discovery')
          .findOne({ _id: 'topics' });
        assert.equal(bootstrap.topics.length, 1);
        assert.equal(bootstrap.topics[0].topic, 'Full Stack');
        assert.equal(externalCalls, 0);
      },
    );
    const raw = mongoose.connection.db.collection('shared_course_catalog');
    const video = (index, topic) =>
      courses.normaliseCourse({
        id: 'yt_' + String(index).padStart(11, '0'),
        title: `${topic} verified fixture ${index}`,
        platform: 'YouTube',
        url: 'https://www.youtube.com/watch?v=' + String(index).padStart(11, '0'),
        topics: [topic],
        metadataSource: 'youtube-api',
      });
    for (const [offset, topic] of [
      [100, 'Docker'],
      [200, 'Kubernetes'],
    ])
      await raw.insertOne({
        _id: `youtube:${topic}`,
        version: catalog.VERSION,
        fingerprint: courses.providerConfigurationFingerprint(),
        topic,
        courses: Array.from({ length: 30 }, (_, index) => video(offset + index, topic)),
        updatedAt: new Date(),
        freshUntil: new Date(Date.now() + 3600_000),
        staleUntil: new Date(Date.now() + 86_400_000),
        status: 'available',
      });
    catalog.clearMemory();
    search.clearMemory();
    // The supplied verified video fixtures now satisfy cold provider availability.
    await mongoose.connection.db.collection('course_catalog_discovery').updateOne(
      { _id: 'topics', 'topics.topic': 'Full Stack' },
      {
        $set: {
          'topics.$.state': 'covered',
          'topics.$.nextAttemptAt': new Date(Date.now() + 86_400_000),
        },
      },
    );
    const app = express();
    app.use(express.json());
    app.use('/api/courses', require('../routes/courseRoutes'));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const token = (user) =>
      jwt.sign({ id: String(user) }, process.env.JWT_SECRET, {
        algorithm: 'HS256',
        issuer: 'devinsight-api',
        audience: 'devinsight-web',
        expiresIn: '1h',
        jwtid: require('node:crypto').randomUUID(),
      });
    const network = [];
    async function request(
      route,
      { user = owner, method = 'GET', body, authenticated = true, admissionAttempt = 0 } = {},
    ) {
      const start = performance.now();
      const result = await fetch(origin + '/api/courses' + route, {
        method,
        headers: {
          ...(authenticated ? { Authorization: 'Bearer ' + token(user) } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const data = result.status === 204 ? null : await result.json();
      network.push({
        route,
        method,
        owner: user === owner ? 'owner-fixture' : 'foreign-fixture',
        status: result.status,
        durationMs: performance.now() - start,
        retryAfter: result.headers.get('retry-after'),
        code: data?.code,
        message: result.status >= 400 ? data?.message : undefined,
        total: data?.total,
        admissionAttempt,
      });
      if (
        method === 'GET' &&
        result.status === 503 &&
        data?.code === 'COURSE_ADMISSION_UNAVAILABLE' &&
        admissionAttempt < 2
      ) {
        const seconds = Number(result.headers.get('retry-after'));
        assert.ok(Number.isInteger(seconds) && seconds > 0 && seconds <= 60);
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        return request(route, {
          user,
          method,
          body,
          authenticated,
          admissionAttempt: admissionAttempt + 1,
        });
      }
      return { status: result.status, data, retryAfter: result.headers.get('retry-after') };
    }
    await t.test(
      'Discover paginates the entire shared inventory and includes all eligible providers',
      async () => {
        const first = await request('?view=discover&limit=20');
        assert.equal(first.status, 200);
        assert.equal(first.data.total, 121);
        assert.equal(first.data.providerCounts.YouTube, 60);
        const ids = new Set();
        for (let page = 1; page <= first.data.totalPages; page++) {
          const result = await request(`?view=discover&limit=20&page=${page}`);
          assert.equal(result.status, 200);
          for (const course of result.data.courses) {
            assert.ok(!ids.has(course.id));
            ids.add(course.id);
          }
        }
        assert.equal(ids.size, 121);
        assert.equal(externalCalls, 0);
        const filtered = await request('?view=discover&platform=YouTube&topic=k8s&limit=20');
        assert.equal(filtered.data.total, 30);
        assert.ok(
          filtered.data.courses.every(
            (course) => course.platform === 'YouTube' && course.title.includes('Kubernetes'),
          ),
        );
        assert.equal((await request('?view=discover&topic=Docker')).data.total, 34);
      },
    );
    await t.test(
      'For You uses the same inventory without changing scoring formulas or making provider requests',
      async () => {
        const response = await request('?view=for-you&topic=Docker&skillGaps=Docker');
        assert.equal(response.status, 200);
        assert.equal(response.data.total, 34);
        const expected = courses.scoreAndRank(
          (await search.load(courses.normaliseCourseFilters({ topic: 'Docker' }))).courses,
          {
            careerStack: 'Backend',
            experienceLevel: 'Intern',
            skillGaps: ['Docker'],
            knownSkills: [],
            topic: 'Docker',
            targets: [],
          },
        );
        assert.deepEqual(
          response.data.courses.map((course) => course.id),
          expected.slice(0, 10).map((course) => course.id),
        );
        assert.equal(externalCalls, 0);
      },
    );
    await t.test(
      'expanded GenAI/LLM/RAG inventory queues missing YouTube coverage once without inline calls',
      async () => {
        for (const topic of [
          'GenAI',
          'Generative AI',
          'LLM',
          'large language models',
          'RAG',
          'retrieval augmented generation',
        ]) {
          const result = await request('?view=discover&topic=' + encodeURIComponent(topic));
          assert.equal(result.status, 200);
          assert.equal(result.data.total, /^(RAG|retrieval)/.test(topic) ? 2 : 4);
        }
        await Promise.all(Array.from({ length: 50 }, () => search.recordGap('RAG')));
        const queued = await mongoose.connection.db
          .collection('course_catalog_discovery')
          .findOne({ _id: 'topics' });
        assert.equal(queued.topics.length, 4);
        assert.equal(externalCalls, 0);
        let providerPipelines = 0;
        await Promise.all(
          Array.from({ length: 5 }, () =>
            search.processDiscoveryQueue({
              fetchProvider: async (query) => {
                providerPipelines++;
                return {
                  courses: [video(999, query.split(' programming')[0])],
                  status: 'available',
                };
              },
            }),
          ),
        );
        assert.equal(providerPipelines, 1);
        const populated = await request('?view=discover&topic=GenAI&refresh=true');
        assert.equal(populated.data.total, 5);
        assert.equal(externalCalls, 0);
      },
    );
    await t.test('a delayed discovery claim cannot overwrite a successor queue state', async () => {
      const queue = mongoose.connection.db.collection('course_catalog_discovery');
      const prototype = Object.getPrototypeOf(queue);
      const original = prototype.updateOne;
      let supersededKey;
      let providerPipelines = 0;
      prototype.updateOne = async function (filter, update, options) {
        if (
          this.collectionName === 'course_catalog_discovery' &&
          update.$inc?.['topics.$.attempts'] &&
          !supersededKey
        ) {
          supersededKey = filter.topics?.$elemMatch.key || filter['topics.key'];
          await original.call(
            this,
            { _id: 'topics', 'topics.key': supersededKey },
            {
              $set: {
                'topics.$.state': 'covered',
                'topics.$.nextAttemptAt': new Date(Date.now() + 3_600_000),
                'topics.$.workerToken': 'successor-fixture',
              },
            },
          );
        }
        return original.call(this, filter, update, options);
      };
      try {
        await search.processDiscoveryQueue({
          fetchProvider: async () => {
            providerPipelines++;
            return { courses: [], status: 'empty' };
          },
        });
      } finally {
        prototype.updateOne = original;
      }
      assert.ok(supersededKey);
      const row = await queue.findOne({ _id: 'topics' });
      const entry = row.topics.find((item) => item.key === supersededKey);
      assert.equal(entry.state, 'covered');
      assert.equal(entry.workerToken, 'successor-fixture');
      assert.equal(providerPipelines, 0);
    });
    const progress = require('../models/userCourseProgress');
    await t.test(
      'JWT, save/start, notes, explicit progress, completion, another session and owner isolation',
      async () => {
        assert.equal((await request('/my-learning', { authenticated: false })).status, 401);
        const save = (body) => request('/fb_u1/progress', { method: 'PUT', body });
        assert.equal((await save({ status: 'saved' })).status, 200);
        assert.equal(
          (
            await save({
              status: 'in_progress',
              notes: 'Private fixture notes',
              progressPercent: 27,
            })
          ).data.progressPercent,
          27,
        );
        assert.equal(
          (await request('/my-learning')).data.courses[0].notes,
          'Private fixture notes',
        );
        assert.equal((await request('/my-learning', { user: foreign })).data.total, 0);
        assert.equal(
          (await save({ status: 'completed', progressPercent: 0 })).data.progressPercent,
          0,
        );
        assert.equal((await request('/my-learning?status=completed')).data.total, 1);
        assert.equal(
          (await progress.findOne({ userId: owner }).lean()).notes,
          'Private fixture notes',
        );
      },
    );
    await t.test(
      'a legacy missing snapshot is retained and editable instead of crashing the whole My Learning response',
      async () => {
        await progress.collection.insertOne({
          userId: owner,
          courseId: 'fb_u2',
          status: 'in_progress',
          notes: 'Preserve legacy notes',
          progressPercent: 12,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        if (process.env.LEARNING_BASELINE_REF) {
          const Module = require('node:module');
          const filename = require.resolve('../services/courseProgressService');
          const baseline = new Module(filename, module);
          baseline.filename = filename;
          baseline.paths = Module._nodeModulePaths(path.dirname(filename));
          baseline._compile(
            require('node:child_process').execFileSync(
              'git',
              [
                'show',
                `${process.env.LEARNING_BASELINE_REF}:backend/src/services/courseProgressService.js`,
              ],
              { encoding: 'utf8' },
            ),
            filename,
          );
          const current = require('../services/courseProgressService');
          const fixedList = current.listProgress;
          try {
            current.listProgress = baseline.exports.listProgress;
            assert.equal((await request('/my-learning')).status, 503);
          } finally {
            current.listProgress = fixedList;
          }
        }
        const list = await request('/my-learning');
        assert.equal(list.status, 200);
        assert.equal(list.data.total, 2);
        const recovered = list.data.courses.find((course) => course.courseId === 'fb_u2');
        assert.equal(recovered.recoveryRequired, true);
        assert.equal(recovered.notes, 'Preserve legacy notes');
        assert.equal(recovered.course.url, '');
        const update = await request('/fb_u2/progress', {
          method: 'PUT',
          body: { status: 'completed', progressPercent: 0 },
        });
        assert.equal(update.status, 200);
        assert.equal(update.data.notes, 'Preserve legacy notes');
        assert.equal(
          (await progress.collection.findOne({ userId: owner, courseId: 'fb_u2' })).course,
          undefined,
        );
      },
    );
    await t.test(
      'real storage errors remain 503 and recover; My Learning failure does not break Discover',
      async () => {
        const originalFind = progress.find;
        progress.find = () => {
          throw Object.assign(Error('Controlled storage failure'), {
            code: 'FIXTURE_STORAGE_OUTAGE',
          });
        };
        try {
          const failed = await request('/my-learning');
          assert.equal(failed.status, 503);
          assert.equal(failed.retryAfter, '5');
          assert.equal((await request('?view=discover')).status, 200);
        } finally {
          progress.find = originalFind;
        }
        assert.equal((await request('/my-learning')).data.total, 2);
      },
    );
    await t.test('Discover read quota cannot block My Learning read quota', async () => {
      const quotaOwner = new mongoose.Types.ObjectId();
      await User.create({
        _id: quotaOwner,
        name: 'Quota fixture',
        email: `${quotaOwner}@fixture.invalid`,
        password: 'fixture',
      });
      process.env.COURSES_READ_RATE_LIMIT_MAX = '1';
      try {
        assert.equal((await request('?view=discover', { user: quotaOwner })).status, 200);
        assert.equal((await request('?view=discover', { user: quotaOwner })).status, 429);
        assert.equal((await request('/my-learning', { user: quotaOwner })).status, 200);
      } finally {
        process.env.COURSES_READ_RATE_LIMIT_MAX = '10000';
      }
    });
    await t.test(
      'JWT database outage is a recoverable 503 rather than a false session expiry',
      async () => {
        const findUser = User.findById;
        User.findById = () => ({
          select: async () => {
            throw Object.assign(Error('Controlled auth storage outage'), {
              code: 'FIXTURE_AUTH_STORAGE',
            });
          },
        });
        try {
          const result = await request('/my-learning');
          assert.equal(result.status, 503);
          assert.equal(result.data.code, 'AUTH_STORAGE_UNAVAILABLE');
          assert.equal(result.retryAfter, '5');
        } finally {
          User.findById = findUser;
        }
        assert.equal((await request('/my-learning')).data.total, 2);
      },
    );
    const warmApi = [];
    await t.test(
      'warm searches reuse the global pool across authenticated sessions with zero external calls',
      async () => {
        for (let index = 0; index < 24; index++) {
          const started = performance.now();
          const result = await request('?view=discover&topic=Docker', {
            user: index % 2 ? owner : foreign,
          });
          assert.equal(result.status, 200);
          assert.equal(result.data.total, 34);
          warmApi.push(performance.now() - started);
        }
        assert.equal(externalCalls, 0);
      },
    );
    const warmService = [];
    await t.test(
      '3000 concurrent-batch catalog reads remain bounded and do not call providers',
      async () => {
        const filters = courses.normaliseCourseFilters({ topic: 'Docker' });
        const original = await search.load(filters);
        assert.throws(() => {
          original.courses[0].title = 'poisoned shared entry';
        }, TypeError);
        for (let batch = 0; batch < 30; batch++)
          await Promise.all(
            Array.from({ length: 100 }, async () => {
              const started = performance.now();
              const result = await search.load(filters);
              warmService.push(performance.now() - started);
              assert.equal(result.courses.length, 34);
            }),
          );
        assert.equal(externalCalls, 0);
        assert.ok(search.metrics().bytes <= 16 * 1024 * 1024);
        assert.equal(search.metrics().pending, 0);
      },
    );
    await t.test(
      'unknown-topic admission is globally bounded even with concurrent unique searches',
      async () => {
        await Promise.all(
          Array.from({ length: 90 }, (_, index) =>
            search.recordGap('unseen fixture language ' + index),
          ),
        );
        const row = await mongoose.connection.db
          .collection('course_catalog_discovery')
          .findOne({ _id: 'topics' });
        assert.equal(
          row.topics.filter((entry) => !search.KNOWN_TOPICS.includes(entry.topic)).length,
          search.MAX_GAPS,
        );
        assert.equal(new Set(row.topics.map((entry) => entry.key)).size, row.topics.length);
        assert.ok(row.topics.length <= search.MAX_QUEUE_TOPICS);
        assert.equal(
          (await search.recordGap('another distinct missing technology')).status,
          'capacity',
        );
        assert.equal(externalCalls, 0);
        // Known Skill Gap technologies retain reserved capacity after arbitrary misses exhaust their slots.
        assert.equal((await search.recordGap('Terraform')).status, 'queued');
      },
    );
    await t.test(
      'large full-catalog pools are paginated without durable per-user inventory copies',
      async () => {
        for (const [index, topic] of [
          'SQL',
          'React',
          'Python',
          'Java',
          'Angular',
          'Git',
        ].entries()) {
          await raw.insertOne({
            _id: `youtube:${topic}`,
            version: catalog.VERSION,
            fingerprint: courses.providerConfigurationFingerprint(),
            topic,
            courses: Array.from({ length: 40 }, (_, item) =>
              video(1000 + index * 40 + item, topic),
            ),
            updatedAt: new Date(),
            freshUntil: new Date(Date.now() + 3600_000),
            staleUntil: new Date(Date.now() + 86_400_000),
            status: 'available',
          });
        }
        catalog.clearMemory();
        search.clearMemory();
        const large = await request('?view=discover&refresh=true&limit=20');
        assert.equal(large.status, 200);
        assert.equal(large.data.total, 362);
        assert.equal(large.data.courses.length, 20);
        assert.equal(
          await require('../models/analysisCache').countDocuments({
            userId: owner,
            analysisVersion: 'courses_pool_v6_evidence',
            signalHash: large.data.cacheMetadata.signalHash,
          }),
          0,
        );
        assert.equal(
          await mongoose.connection.db
            .collection('integrationgovernancestates')
            .countDocuments({ 'completed.pool.total': 362 }),
          0,
        );
        assert.equal(externalCalls, 0);
      },
    );
    await t.test(
      'Mongo primary interruption recovers saved data without a false JWT expiry',
      async () => {
        await mongoose.connection.db
          .admin()
          .command({ replSetStepDown: 2, force: true })
          .catch((error) => {
            if (![11600, 11602, 10107, 13435, 189].includes(error.code)) throw error;
          });
        let recovered;
        for (let attempt = 0; attempt < 4; attempt++) {
          recovered = await request('/my-learning');
          assert.ok([200, 503].includes(recovered.status));
          if (recovered.status === 200) break;
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
        assert.equal(recovered.status, 200);
        assert.equal(recovered.data.total, 2);
        assert.equal(
          recovered.data.courses.find((record) => record.courseId === 'fb_u1').notes,
          'Private fixture notes',
        );
      },
    );
    const explain = await raw.aggregate(search.pipeline('Docker')).explain('executionStats');
    assert.match(JSON.stringify(explain), /catalog_full_text/);
    const userExplain = await progress
      .find({ userId: owner })
      .sort({ updatedAt: -1, _id: -1 })
      .explain('executionStats');
    assert.doesNotMatch(JSON.stringify(userExplain.queryPlanner.winningPlan), /COLLSCAN/);
    assert.match(JSON.stringify(userExplain.queryPlanner.winningPlan), /user_course_recent/);
    assert.doesNotMatch(JSON.stringify(userExplain.queryPlanner.winningPlan), /"stage":"SORT"/);
    const latencies = network
      .filter((entry) => entry.route.startsWith('?'))
      .map((entry) => entry.durationMs)
      .sort((a, b) => a - b);
    const output =
      process.env.COURSES_ACQUISITION_OUTPUT ||
      path.resolve(__dirname, '../../verification/courses/defects-2026-11-05');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(
      path.join(output, 'mongo-network.json'),
      JSON.stringify(
        {
          network,
          externalCalls,
          baselineRef: process.env.LEARNING_BASELINE_REF || null,
          warmApi: {
            samples: warmApi.length,
            p50Ms: warmApi.sort((a, b) => a - b)[12],
            p95Ms: warmApi[22],
          },
          warmService: {
            samples: warmService.length,
            concurrency: 100,
            p50Ms: warmService.sort((a, b) => a - b)[1500],
            p95Ms: warmService[2850],
          },
          catalog: search.metrics(),
          p50Ms: latencies[Math.floor(latencies.length * 0.5)],
          p95Ms: latencies[Math.floor(latencies.length * 0.95)],
          explain,
          userExplain,
        },
        null,
        2,
      ) + '\n',
    );
  },
);
