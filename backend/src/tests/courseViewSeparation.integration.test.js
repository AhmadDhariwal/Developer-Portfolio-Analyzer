'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('node:fs');
const path = require('node:path');
const { startMongo } = require('./fixtures/disposableRequestMongo');

test(
  'Discover/For You: owned current v9 evidence gates a 1781-course Mongo catalog',
  { timeout: 180000 },
  async (t) => {
    const runtime = await startMongo({ replicaSet: 'learning-views' });
    const envKeys = [
      'JWT_SECRET',
      'YOUTUBE_API_KEY',
      'COURSES_POOL_STORE_TIMEOUT_MS',
      'COURSES_READ_RATE_LIMIT_MAX',
    ];
    const saved = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    process.env.JWT_SECRET = 'owned-learning-view-fixture';
    process.env.YOUTUBE_API_KEY = '';
    process.env.COURSES_POOL_STORE_TIMEOUT_MS = '5000';
    process.env.COURSES_READ_RATE_LIMIT_MAX = '1000';
    const axios = require('axios');
    const oldGet = axios.get;
    let externalCalls = 0;
    axios.get = async () => {
      externalCalls++;
      throw Error('Provider calls prohibited');
    };
    const ai = require('../services/aiservice');
    const oldRead = ai.getSharedCache;
    const oldWrite = ai.setSharedCache;
    const redis = new Map();
    let redisOffline = false;
    ai.getSharedCache = async (key) => {
      if (redisOffline) throw Error('Redis offline');
      return redis.get(key) || null;
    };
    ai.setSharedCache = async (key, value) => {
      if (redisOffline) throw Error('Redis offline');
      redis.set(key, value);
    };
    let server;
    const evidence = { requests: [], externalCalls: 0 };
    t.after(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
      await new Promise((resolve) => setTimeout(resolve, 30));
      axios.get = oldGet;
      ai.getSharedCache = oldRead;
      ai.setSharedCache = oldWrite;
      await mongoose.disconnect();
      evidence.cleanup = await runtime.stop();
      evidence.externalCalls = externalCalls;
      const output = path.resolve(
        __dirname,
        '../../verification/courses/view-separation-2026-11-06',
      );
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, 'mongo-jwt.json'), JSON.stringify(evidence, null, 2));
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
    await mongoose.connect(runtime.uri);
    const User = require('../models/user');
    const ResumeFile = require('../models/resumeFile');
    const ResumeAnalysis = require('../models/resumeAnalysis');
    const Cache = require('../models/analysisCache');
    const shared = require('../services/sharedCourseCatalogService');
    const service = require('../services/courseService');
    const taxonomy = require('../services/courseCatalogTaxonomy');
    const engine = require('../services/recommendationEngineService');
    const { buildResumeCacheIdentity } = require('../services/developerSignalService');
    const { ANALYSIS_VERSION } = require('../services/skillGapCacheContract');
    const { EVIDENCE_POLICY_VERSION } = require('../services/skillGapEvidenceService');
    const { TAXONOMY_VERSION, MATRIX_VERSION } = require('../services/skillGapRequirements');
    await shared.initialize();
    await require('../services/integrationMongoGovernanceService').initialize();
    const owners = await User.create(
      ['Backend', 'Frontend', 'Backend'].map((stack, i) => ({
        name: 'View fixture',
        email: `views-${i}@fixture.invalid`,
        password: 'fixture',
        activeCareerStack: stack,
        activeExperienceLevel: 'Intern',
      })),
    );
    async function resume(owner, name) {
      const file = await ResumeFile.create({
        userId: owner._id,
        fileName: name + '.pdf',
        fileUrl: '/fixture/' + name,
        fileSize: 1,
      });
      const analysis = await ResumeAnalysis.create({
        userId: owner._id,
        fileId: file._id,
        fileName: file.fileName,
        fileSize: 1,
        analyzedAt: new Date(),
        resumeSignals: { skills: ['JavaScript'] },
      });
      await User.updateOne({ _id: owner._id }, { activeResumeFileId: file._id });
      return { file, analysis };
    }
    async function snapshot(ownerId, analysis, targets) {
      const owner = await User.findById(ownerId).lean();
      return Cache.create({
        userId: ownerId,
        githubUsername: 'view-fixture',
        careerStack: owner.activeCareerStack,
        experienceLevel: owner.activeExperienceLevel,
        ...buildResumeCacheIdentity({ resumeAnalysis: analysis.toObject() }),
        analysisVersion: ANALYSIS_VERSION,
        signalHash: 'view-' + new mongoose.Types.ObjectId(),
        analysisData: {
          ruleVersion: engine.SKILL_RULE,
          evidencePolicyVersion: EVIDENCE_POLICY_VERSION,
          taxonomyVersion: TAXONOMY_VERSION,
          requirementMatrixVersion: MATRIX_VERSION,
          missingSkills: [],
          skills: targets,
          sourceReferences: [
            ...Object.values(
              engine.sourceMetadata({
                username: 'view-fixture',
                githubData: { unavailable: true },
                resumeAnalysis: analysis.toObject(),
              }),
            ),
            { type: 'profile', timestamp: owner.updatedAt },
          ],
        },
      });
    }
    // A schema-required source identity is supplied, with GitHub intentionally unavailable.
    await User.updateMany(
      { _id: { $in: owners.map((owner) => owner._id) } },
      { activeGithubUsername: 'view-fixture' },
    );
    const a = await resume(owners[0], 'backend');
    const b = await resume(owners[1], 'frontend');
    const target = (name, status) => ({ name, status, requirement: 'REQUIRED' });
    const currentSnapshot = (owner, analysis, targets) => snapshot(owner._id, analysis, targets);
    const backendTargets = [
      target('Docker', 'PARTIAL'),
      target('docker', 'PARTIAL'),
      target('JavaScript', 'DEMONSTRATED'),
      target('AWS', 'UNKNOWN'),
    ];
    const frontendTargets = [target('Angular', 'NOT_EVIDENCED'), target('Docker', 'DEMONSTRATED')];
    const raw = mongoose.connection.db.collection('shared_course_catalog');
    const noise = Array.from({ length: 1720 }, (_, i) =>
      service.normaliseCourse({
        id: 'yt_' + String(i).padStart(11, '0'),
        title: `AWS infrastructure fixture ${i}`,
        topics: ['AWS'],
        platform: 'YouTube',
        metadataSource: 'youtube-api',
        url: `https://www.youtube.com/watch?v=${String(i).padStart(11, '0')}`,
      }),
    );
    await raw.insertMany(
      Array.from({ length: 43 }, (_, i) => ({
        _id: `youtube:fixture-${i}`,
        version: shared.VERSION,
        topic: 'AWS',
        courses: noise.slice(i * 40, (i + 1) * 40),
        updatedAt: new Date(),
        freshUntil: new Date(Date.now() + 3600000),
        staleUntil: new Date(Date.now() + 86400000),
      })),
    );
    const app = express();
    app.use(express.json());
    app.use('/api/courses', require('../routes/courseRoutes'));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}/api/courses`;
    async function request(owner, query = {}, attempt = 0, expectedStatus = 200) {
      const token = jwt.sign({ id: String(owner._id) }, process.env.JWT_SECRET, {
        algorithm: 'HS256',
        issuer: 'devinsight-api',
        audience: 'devinsight-web',
        expiresIn: '1h',
        jwtid: require('node:crypto').randomUUID(),
      });
      const response = await fetch(
        origin + '?' + new URLSearchParams({ view: 'for-you', limit: '20', ...query }),
        { headers: { Authorization: 'Bearer ' + token } },
      );
      const body = await response.json();
      evidence.requests.push({
        owner: owners.findIndex((item) => String(item._id) === String(owner._id)),
        query,
        status: response.status,
        total: body.total,
        eligibleSkills: body.personalization?.eligibleSkills,
        state: body.personalization?.learningState,
        attempt,
      });
      if (response.status === 503 && body.code === 'COURSE_ADMISSION_UNAVAILABLE' && attempt < 2) {
        const seconds = Number(response.headers.get('retry-after'));
        assert.ok(seconds > 0 && seconds <= 60);
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        return request(owner, query, attempt + 1, expectedStatus);
      }
      assert.equal(response.status, expectedStatus, JSON.stringify(body));
      return body;
    }
    await t.test(
      'Discover retains 1781 global courses; no evidence returns zero, not career fallback',
      async () => {
        assert.equal((await request(owners[2], { view: 'discover' })).total, 1781);
        assert.equal(
          (await request(owners[2], { view: 'discover', platform: 'YouTube' })).total,
          1720,
        );
        assert.equal(
          (await request(owners[2], { view: 'discover', topic: 'Quantum Computing' })).total,
          0,
        );
        assert.equal((await request(owners[2], { view: 'discover', topic: 'Docker' })).total, 4);
        const empty = await request(owners[2]);
        assert.equal(empty.total, 0);
        assert.equal(empty.personalization.learningState, 'analysis-required');
      },
    );
    await t.test(
      'two current owned v9 analyses produce distinct subsets and accurate provider/page counts',
      async () => {
        await currentSnapshot(owners[0], a.analysis, backendTargets);
        await currentSnapshot(owners[1], b.analysis, frontendTargets);
        const first = await request(owners[0], { limit: '1' });
        assert.equal(first.total, 2);
        assert.equal(first.totalPages, 2);
        assert.deepEqual(first.personalization.eligibleSkills, ['Docker']);
        const second = await request(owners[0], { limit: '1', page: '2' });
        assert.notEqual(first.courses[0].id, second.courses[0].id);
        const front = await request(owners[1]);
        assert.equal(front.total, 3);
        assert.deepEqual(front.personalization.eligibleSkills, ['Angular']);
        assert.ok(front.courses.every(taxonomy.topicPredicate('Angular')));
        assert.equal((await request(owners[0], { platform: 'Coursera' })).total, 2);
        assert.equal((await request(owners[0], { platform: 'YouTube' })).total, 0);
        assert.equal((await request(owners[0], { skill: 'docker' })).total, 2);
        const demonstrated = await request(owners[0], {
          topic: 'JavaScript',
          skillGaps: 'AWS,JavaScript',
        });
        assert.equal(demonstrated.total, 0);
        assert.equal(demonstrated.personalization.learningState, 'skill-not-recommended');
        const expected = service.scoreAndRank(
          service
            .buildFallbackPool('All', 200)
            .filter((course) => ['fb_c2', 'fb_c12'].includes(course.id)),
          {
            careerStack: 'Backend',
            experienceLevel: 'Intern',
            skillGaps: ['Docker'],
            knownSkills: ['JavaScript'],
            targets: backendTargets,
          },
        );
        const actual = await request(owners[0]);
        assert.deepEqual(
          actual.courses.map((course) => [course.id, course.finalScore]),
          expected.map((course) => [course.id, course.finalScore]),
        );
        redisOffline = true;
        assert.equal((await request(owners[1], { topic: 'angular' })).total, 3);
        redisOffline = false;
      },
    );
    await t.test('stale evidence and selected-resume changes invalidate ready caches', async () => {
      await Cache.collection.updateMany(
        { userId: owners[1]._id, analysisVersion: ANALYSIS_VERSION },
        { $set: { 'analysisData.taxonomyVersion': 'incompatible-fixture' } },
      );
      const incompatible = await request(owners[1]);
      assert.equal(incompatible.total, 0);
      assert.equal(incompatible.personalization.learningState, 'analysis-required');
      await Cache.collection.updateMany(
        { userId: owners[1]._id, analysisVersion: ANALYSIS_VERSION },
        { $set: { 'analysisData.taxonomyVersion': TAXONOMY_VERSION } },
      );
      assert.equal((await request(owners[1])).total, 3);
      await Cache.collection.updateMany(
        { userId: owners[0]._id, analysisVersion: ANALYSIS_VERSION },
        { $set: { updatedAt: new Date(Date.now() - 2 * 86400000) } },
      );
      assert.equal((await request(owners[0])).total, 0);
      const next = await resume(owners[0], 'replacement');
      assert.equal((await request(owners[0])).total, 0);
      await currentSnapshot(owners[0], next.analysis, [target('Node.js', 'DEMONSTRATED')]);
      const none = await request(owners[0]);
      assert.equal(none.total, 0);
      assert.equal(none.personalization.learningState, 'no-recommended-skills');
      await currentSnapshot(owners[0], next.analysis, [target('Node.js', 'PARTIAL')]);
      const changed = await request(owners[0]);
      assert.ok(changed.total > 0 && changed.total < 1781);
      assert.deepEqual(changed.personalization.eligibleSkills, ['Node.js']);
      await User.updateOne({ _id: owners[0]._id }, { activeResumeFileId: b.file._id });
      assert.equal((await request(owners[0])).total, 0);
      assert.equal(externalCalls, 0);
    });
    await t.test(
      'evidence storage outages return 503 and recover without catalog fallback',
      async () => {
        const context = require('../services/developerContextService');
        const original = context.resolveResumeAnalysis;
        context.resolveResumeAnalysis = async () => {
          throw Error('fixture evidence outage');
        };
        try {
          const failed = await request(owners[1], {}, 0, 503);
          assert.equal(failed.code, 'COURSE_EVIDENCE_UNAVAILABLE');
          assert.equal(failed.courses, undefined);
        } finally {
          context.resolveResumeAnalysis = original;
        }
        assert.equal((await request(owners[1])).total, 3);
      },
    );
  },
);
