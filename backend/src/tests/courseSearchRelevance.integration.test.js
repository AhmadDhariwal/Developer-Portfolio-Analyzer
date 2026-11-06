'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');
const { startMongo } = require('./fixtures/disposableRequestMongo');

test(
  'strict global search relevance through Mongo, JWT, caches and background discovery',
  { timeout: 120000 },
  async (t) => {
    const runtime = await startMongo({ replicaSet: 'course-relevance' });
    const saved = Object.fromEntries(
      ['JWT_SECRET', 'YOUTUBE_API_KEY', 'COURSES_POOL_STORE_TIMEOUT_MS'].map((key) => [
        key,
        process.env[key],
      ]),
    );
    process.env.JWT_SECRET = 'isolated-relevance-fixture-signing';
    process.env.YOUTUBE_API_KEY = 'synthetic-fixture-only';
    process.env.COURSES_POOL_STORE_TIMEOUT_MS = '5000';
    const axios = require('axios');
    const originalGet = axios.get;
    const ai = require('../services/aiservice');
    const originalReadCache = ai.getSharedCache;
    const originalWriteCache = ai.setSharedCache;
    ai.getSharedCache = async () => null;
    ai.setSharedCache = async () => {};
    let inlineCalls = 0;
    axios.get = async () => {
      inlineCalls++;
      throw Error('No inline provider calls permitted');
    };
    let server;
    const evidence = { requests: [], providerPipelines: 0, inlineCalls: 0 };
    const output = path.resolve(__dirname, '../../verification/courses/relevance-2026-11-06');
    t.after(async () => {
      axios.get = originalGet;
      ai.getSharedCache = originalReadCache;
      ai.setSharedCache = originalWriteCache;
      if (server) await new Promise((resolve) => server.close(resolve));
      await mongoose.disconnect();
      evidence.cleanup = await runtime.stop();
      evidence.inlineCalls = inlineCalls;
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(
        path.join(
          output,
          process.env.COURSES_RELEVANCE_RUN === 'before' ? 'before.json' : 'after.json',
        ),
        JSON.stringify(evidence, null, 2),
      );
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
    await mongoose.connect(runtime.uri);
    const shared = require('../services/sharedCourseCatalogService');
    const search = require('../services/courseCatalogSearchService');
    const courses = require('../services/courseService');
    await shared.initialize();
    const User = require('../models/user');
    const owners = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
    await User.create(
      owners.map((_id) => ({
        _id,
        name: 'Relevance fixture',
        email: `${_id}@fixture.invalid`,
        password: 'fixture',
        activeCareerStack: 'Backend',
        activeExperienceLevel: 'Intern',
      })),
    );
    const video = (index, title, topics = [], extra = {}) =>
      courses.normaliseCourse({
        id: 'yt_' + String(index).padStart(11, '0'),
        title,
        platform: 'YouTube',
        topics,
        url: 'https://www.youtube.com/watch?v=' + String(index).padStart(11, '0'),
        metadataSource: 'youtube-api',
        durationHours: 1,
        ...extra,
      });
    const raw = mongoose.connection.db.collection('shared_course_catalog');
    async function publish(topic, inventory) {
      await raw.updateOne(
        { _id: `youtube:${topic}` },
        {
          $set: {
            version: shared.VERSION,
            fingerprint: courses.providerConfigurationFingerprint(),
            topic,
            courses: inventory,
            updatedAt: new Date(),
            status: 'available',
            freshUntil: new Date(Date.now() + 3600000),
            staleUntil: new Date(Date.now() + 86400000),
          },
        },
        { upsert: true },
      );
      shared.clearMemory();
      search.clearMemory();
    }
    // 57 controlled Cloud Computing records plus the reviewed Python computing course
    // reproduce 58 false matches without reading or changing a user's database.
    const clouds = Array.from({ length: 57 }, (_, i) =>
      video(i + 1, `AWS Cloud Computing foundations ${i}`, ['AWS', 'Cloud Computing']),
    );
    await publish('AWS', clouds.slice(0, 40));
    await publish('Cloud Computing', clouds.slice(40));
    const direct = await search.load(
      courses.normaliseCourseFilters({ topic: 'Quantum Computing', view: 'discover' }),
    );
    evidence.directQuantum = {
      count: direct.courses.length,
      titles: direct.courses.map((course) => course.title),
      discovery: direct.discovery,
    };
    await require('../services/integrationMongoGovernanceService').initialize();
    const app = express();
    app.use(express.json());
    app.use('/api/courses', require('../routes/courseRoutes'));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}/api/courses`;
    async function request(topic, extra = {}, owner = owners[0], attempt = 0) {
      const params = new URLSearchParams({ view: 'discover', topic, limit: '20', ...extra });
      const token = jwt.sign({ id: String(owner) }, process.env.JWT_SECRET, {
        algorithm: 'HS256',
        issuer: 'devinsight-api',
        audience: 'devinsight-web',
        expiresIn: '1h',
        jwtid: require('node:crypto').randomUUID(),
      });
      const response = await fetch(`${origin}?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json();
      evidence.requests.push({
        query: Object.fromEntries(params),
        status: response.status,
        admissionAttempt: attempt,
        code: body.code,
        total: body.total,
        discovery: body.discovery,
        ids: body.courses?.map((course) => course.id),
        titles: body.courses?.map((course) => course.title),
      });
      if (response.status === 503 && body.code === 'COURSE_ADMISSION_UNAVAILABLE' && attempt < 2) {
        const seconds = Number(response.headers.get('retry-after'));
        assert.ok(seconds > 0 && seconds <= 60);
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        return request(topic, extra, owner, attempt + 1);
      }
      assert.equal(response.status, 200, JSON.stringify(body));
      return body;
    }

    await t.test(
      'Quantum Computing excludes 58 generic computing matches before counts and pagination',
      async () => {
        const candidates = await raw.aggregate(search.pipeline('quantum computing')).toArray();
        evidence.quantumCandidateRows = candidates.length;
        const result = await request('Quantum Computing');
        evidence.quantumBeforeAcquisition = {
          total: result.total,
          titles: result.courses.map((course) => course.title),
        };
        assert.equal(result.total, 0);
        assert.equal(result.providerCounts.YouTube || 0, 0);
        assert.equal(result.totalPages, 1);
        assert.equal(result.discovery.status, 'pending');
        const cloud = await request('Cloud Computing');
        assert.equal(cloud.total, 57);
        assert.equal((await request('Quantum Computing')).total, 0);
        const otherOwner = await request('Quantum Computing', {}, owners[1]);
        assert.equal(otherOwner.total, 0);
        assert.equal(inlineCalls, 0);
      },
    );

    await t.test(
      'the background worker publishes a genuine topic match, globally reused without new calls',
      async () => {
        await search.processDiscoveryQueue({
          fetchProvider: async (query) => {
            evidence.providerPipelines++;
            assert.match(query, /quantum computing/i);
            return {
              status: 'available',
              courses: [video(100, 'Quantum Computing foundations', ['Quantum Computing'])],
            };
          },
        });
        for (const owner of owners) {
          const result = await request('Quantum Computing', {}, owner);
          assert.equal(result.total, 1);
          assert.equal(result.courses[0].id, 'yt_00000000100');
        }
        assert.equal(evidence.providerPipelines, 1);
        assert.equal(inlineCalls, 0);
      },
    );

    await t.test(
      'Qiskit and qubits qualify contextually while generic cloud siblings remain excluded',
      async () => {
        await publish('quantum computing', [
          video(100, 'Quantum Computing foundations', ['Quantum Computing']),
          video(103, 'Cloud Computing on AWS', ['AWS']),
        ]);
        await publish('Qiskit', [video(101, 'Qiskit circuits laboratory', ['Qiskit'])]);
        await publish('Qubits', [video(102, 'Qubits and quantum gates', ['Qubits'])]);
        const result = await request('Quantum Computing');
        assert.equal(result.total, 3);
        assert.deepEqual(
          new Set(result.courses.map((course) => course.id)),
          new Set(['yt_00000000100', 'yt_00000000101', 'yt_00000000102']),
        );
        const narrow = await request('Quantum Computing', {
          platform: 'YouTube',
          duration: '0-2',
          limit: '1',
          page: '2',
        });
        assert.equal(narrow.total, 3);
        assert.equal(narrow.courses.length, 1);
        assert.equal(narrow.totalPages, 3);
        assert.equal((await request('Quantum Computing', { rating: '4.5' })).total, 0);
        assert.equal((await request('Quantum Computing', { level: 'Advanced' })).total, 0);
        assert.equal((await request('Quantum Computing', { platform: 'Udemy' })).total, 0);
        const personalized = await request('Quantum Computing', { view: 'for-you' });
        assert.equal(personalized.total, 0);
        assert.equal(personalized.personalization.learningState, 'analysis-required');
        assert.ok(personalized.courses.every((course) => course.id !== 'yt_00000000103'));
      },
    );

    await t.test(
      'specific technologies, aliases and unseen compound topics reject generic overlaps',
      async () => {
        await publish('Java', [
          video(201, 'Java concurrency', ['Java']),
          video(202, 'JavaScript concurrency', ['JavaScript']),
          video(203, 'Nebula Widgets laboratory', ['Nebula Widgets']),
          video(204, 'Generic Widgets introduction', ['Widgets']),
        ]);
        const java = await request('Java', { platform: 'YouTube' });
        assert.deepEqual(
          java.courses.map((course) => course.id),
          ['yt_00000000201'],
        );
        const javascript = await request('JavaScript', { platform: 'YouTube' });
        assert.deepEqual(
          javascript.courses.map((course) => course.id),
          ['yt_00000000202'],
        );
        assert.equal((await request('Nebula Widgets', { platform: 'YouTube' })).total, 1);
        assert.equal((await request('Unseen Widgets', { platform: 'YouTube' })).total, 0);
        for (const [topic, minimum] of [
          ['Angular', 3],
          ['Generative AI', 4],
          ['RAG', 2],
          ['Docker', 4],
        ]) {
          const result = await request(topic);
          assert.ok(result.total >= minimum, topic);
        }
        const genai = await request('genai');
        const canonical = await request('Generative AI');
        assert.deepEqual(
          genai.courses.map((course) => course.id),
          canonical.courses.map((course) => course.id),
        );
        assert.equal(inlineCalls, 0);
        const explain = await raw
          .aggregate(search.pipeline('quantum computing'))
          .explain('executionStats');
        assert.match(JSON.stringify(explain), /catalog_full_text/);
        evidence.explain = explain;
      },
    );
  },
);
