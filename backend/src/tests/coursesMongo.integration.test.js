'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const express = require('express');
require('dotenv').config({
  path: path.resolve(__dirname, '../../.env'),
  quiet: true,
});
const User = require('../models/user');
const ResumeFile = require('../models/resumeFile');
const ResumeAnalysis = require('../models/resumeAnalysis');
const GitHubAnalysisCache = require('../models/githubAnalysisCache');
const AnalysisCache = require('../models/analysisCache');
const CareerSprint = require('../models/careerSprint');
const Progress = require('../models/userCourseProgress');
const IntegrationGovernanceState = require('../models/integrationGovernanceState');
const engine = require('../services/recommendationEngineService');
const signals = require('../services/developerSignalService');
const mock = (request, exports) => {
  const filename = require.resolve(request);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

test('Learning Hub real Mongo/JWT: current evidence, cache identity, owned learning and atomic Sprint handoff', async (t) => {
  assert.ok(
    process.env.MONGODB_URI || process.env.MONGO_URI,
    'MongoDB is required for this integration suite.',
  );
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
  });
  const owner = new mongoose.Types.ObjectId();
  const foreign = new mongoose.Types.ObjectId();
  const username = 'lh-' + owner.toString().slice(-12);
  const shared = new Map();
  let redisOffline = false;
  let aiCalls = 0;
  mock('../services/aiservice', {
    getSharedCache: async (key, namespace) => {
      if (redisOffline) throw new Error('Redis offline');
      return shared.get(namespace + ':' + key) || null;
    },
    setSharedCache: async (key, value, ttl, namespace) => shared.set(namespace + ':' + key, value),
    invalidateCacheKey: async () => {},
    runAIAnalysis: async () => {
      aiCalls++;
      throw new Error('Course reads must not call AI');
    },
  });
  mock('../services/developerSignalService', {
    ...signals,
    getDeveloperSignals: async () => ({}),
  });
  const previousYoutubeKey = process.env.YOUTUBE_API_KEY;
  process.env.YOUTUBE_API_KEY = '';
  const controller = require('../controllers/courseController');
  const progress = require('../services/courseProgressService');
  const personalization = require('../services/coursePersonalizationService');
  const { migrateCourseIndexes } = require('../scripts/migrateCourseIndexes');
  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => setTimeout(resolve, 50));
    await Promise.all([
      User.deleteMany({ _id: { $in: [owner, foreign] } }),
      require('../models/sprintSchedule').deleteMany({
        _id: { $in: [owner, foreign] },
      }),
      require('../models/sprintPreference').deleteMany({
        _id: { $in: [owner, foreign] },
      }),
      ...[ResumeFile, ResumeAnalysis, AnalysisCache, CareerSprint, Progress].map((model) =>
        model.deleteMany({ userId: { $in: [owner, foreign] } }),
      ),
      GitHubAnalysisCache.deleteMany({ normalizedUsername: username }),
      IntegrationGovernanceState.collection.deleteMany({ _id: /^courses:v1:/ }).catch(() => {}),
    ]);
    if (previousYoutubeKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = previousYoutubeKey;
    await mongoose.disconnect();
  });
  const firstMigration = await migrateCourseIndexes(AnalysisCache, Progress);
  assert.equal(firstMigration.results.length, 4);
  const secondMigration = await migrateCourseIndexes(AnalysisCache, Progress);
  assert.ok(
    secondMigration.results
      .slice(0, 2)
      .every((item) => ['exists', 'covered_by'].includes(item.action)),
  );
  await User.create([
    {
      _id: owner,
      name: 'Learning fixture',
      email: owner + '@learning.test',
      password: 'fixture',
      activeGithubUsername: username,
      activeCareerStack: 'Backend',
      activeExperienceLevel: 'Intern',
    },
    {
      _id: foreign,
      name: 'Other fixture',
      email: foreign + '@learning.test',
      password: 'fixture',
      activeCareerStack: 'Frontend',
      activeExperienceLevel: 'Student',
    },
  ]);
  const files = await ResumeFile.create(
    ['current', 'not-analyzed'].map((name) => ({
      userId: owner,
      fileName: name + '.pdf',
      fileUrl: '/learning-test/' + name,
      fileSize: 1,
    })),
  );
  await User.updateOne({ _id: owner }, { activeResumeFileId: files[0]._id });
  const resume = await ResumeAnalysis.create({
    userId: owner,
    fileId: files[0]._id,
    fileName: 'current.pdf',
    fileSize: 1,
    analyzedAt: new Date(),
    resumeSignals: {
      skills: ['Node.js'],
      scoring: { score: null, ruleVersion: 'resume-overall-score-v1' },
    },
  });
  const githubData = {
    fetchedAt: new Date().toISOString(),
    repositories: [{ name: 'fixture', hasReadme: true }],
    dataAvailability: { repositories: 'complete' },
  };
  await GitHubAnalysisCache.create({
    githubUsername: username,
    normalizedUsername: username,
    result: githubData,
    expiresAt: new Date(Date.now() + 3600000),
  });
  const { ANALYSIS_VERSION } = require('../services/skillGapCacheContract');
  const { EVIDENCE_POLICY_VERSION } = require('../services/skillGapEvidenceService');
  const { TAXONOMY_VERSION, MATRIX_VERSION } = require('../services/skillGapRequirements');
  const snapshotData = {
    ruleVersion: engine.SKILL_RULE,
    evidencePolicyVersion: EVIDENCE_POLICY_VERSION,
    taxonomyVersion: TAXONOMY_VERSION,
    requirementMatrixVersion: MATRIX_VERSION,
    coverage: null,
    missingSkills: [],
    sourceReferences: [
      ...Object.values(
        engine.sourceMetadata({ username, githubData, resumeAnalysis: resume.toObject() }),
      ),
      { type: 'profile', timestamp: (await User.findById(owner).lean()).updatedAt },
    ],
    skills: [
      { name: 'SQL', status: 'CLAIMED_ONLY', requirement: 'REQUIRED' },
      { name: 'Docker', status: 'PARTIAL', requirement: 'REQUIRED' },
      { name: 'React', status: 'NOT_EVIDENCED', requirement: 'OPTIONAL' },
      { name: 'Testing', status: 'UNKNOWN', requirement: 'REQUIRED' },
      { name: 'Node.js', status: 'DEMONSTRATED', requirement: 'REQUIRED' },
    ],
  };
  const snapshot = await AnalysisCache.create({
    userId: owner,
    githubUsername: username.toUpperCase(),
    careerStack: 'Backend',
    experienceLevel: 'Intern',
    ...signals.buildResumeCacheIdentity({ resumeAnalysis: resume.toObject() }),
    analysisVersion: ANALYSIS_VERSION,
    signalHash: 'snapshot-1',
    analysisData: snapshotData,
  });
  // A newer historical snapshot must not mask the current assessment.
  const historical = snapshot.toObject();
  delete historical._id;
  await AnalysisCache.create({
    ...historical,
    analysisVersion: 'v8-skill-evidence-coverage',
    updatedAt: new Date(Date.now() + 1000),
    signalHash: 'historical-snapshot',
  });
  const user = () => User.findById(owner).lean();
  const resolve = async () =>
    personalization.resolveSkillSignals(owner, 'Backend', 'Intern', null, await user());
  const call = async (query = {}, userId = owner) => {
    const out = { status: 200 };
    const req = { user: await User.findById(userId).lean(), query };
    await controller.fetchCourses(req, {
      status(code) {
        out.status = code;
        return this;
      },
      json(body) {
        out.body = body;
        return this;
      },
      set() {},
    });
    return out;
  };
  await t.test(
    'current version and all five evidence classes are preserved; claimed skills are not proficiency',
    async () => {
      const out = await resolve();
      assert.equal(out.personalization.status, 'evidence-informed');
      assert.deepEqual(out.skillGaps, ['SQL', 'Docker', 'React']);
      assert.deepEqual(out.knownSkills, ['Node.js']);
      assert.equal(out.targets.find((item) => item.name === 'SQL').status, 'CLAIMED_ONLY');
      const response = await call({ platform: 'Coursera' });
      assert.equal(response.status, 200);
      assert.equal(response.body.personalization.status, 'evidence-informed');
      assert.equal(JSON.stringify(response.body).includes('resumeSignals'), false);
    },
  );
  await t.test(
    'memory, Redis and Mongo reuse current pools; source changes bypass every tier',
    async () => {
      const first = await call({ platform: 'Coursera' });
      const hash = first.body.cacheMetadata.signalHash;
      assert.equal(first.body.cacheMetadata.cacheLayer, 'memory');
      await new Promise((resolve) => setTimeout(resolve, 50));
      controller.clearCourseMemoryCache();
      assert.equal((await call({ platform: 'Coursera' })).body.cacheMetadata.cacheLayer, 'redis');
      controller.clearCourseMemoryCache();
      shared.clear();
      redisOffline = true;
      assert.equal((await call({ platform: 'Coursera' })).body.cacheMetadata.cacheLayer, 'mongo');
      redisOffline = false;
      await AnalysisCache.updateOne(
        { _id: snapshot._id },
        { $set: { 'analysisData.skills.0.status': 'DEMONSTRATED' } },
      );
      const changed = await call({ platform: 'Coursera' });
      assert.notEqual(changed.body.cacheMetadata.signalHash, hash);
      assert.equal(changed.body.fromCache, false);
      assert.ok(!changed.body.recommendedBasedOn.skillGapsUsed.includes('SQL'));
      await AnalysisCache.updateOne(
        { _id: snapshot._id },
        { $set: { 'analysisData.skills.0.status': 'CLAIMED_ONLY' } },
      );
    },
  );
  await t.test(
    'legacy, temporary, stale and incompatible snapshots use a clear limitation, never old scores',
    async () => {
      for (const fields of [
        { 'analysisData.ruleVersion': 'legacy' },
        { 'analysisData.cacheMetadata.temporary': true },
        { resumeHash: 'other' },
      ]) {
        await AnalysisCache.updateOne({ _id: snapshot._id }, { $set: fields });
        const out = await resolve();
        assert.equal(out.personalization.status, 'career-context-only');
        assert.deepEqual(out.skillGaps, []);
        await AnalysisCache.updateOne(
          { _id: snapshot._id },
          {
            $set: {
              analysisData: snapshotData,
              ...signals.buildResumeCacheIdentity({
                resumeAnalysis: resume.toObject(),
              }),
            },
          },
        );
      }
      await GitHubAnalysisCache.updateOne(
        { normalizedUsername: username },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );
      assert.equal((await resolve()).personalization.status, 'career-context-only');
      await GitHubAnalysisCache.updateOne(
        { normalizedUsername: username },
        { $set: { expiresAt: new Date(Date.now() + 3600000) } },
      );
    },
  );
  await t.test(
    'selected unanalyzed resume, revised GitHub sources, career stack and owner invalidate personalization',
    async () => {
      const original = (await resolve()).fingerprint;
      await User.updateOne({ _id: owner }, { activeResumeFileId: files[1]._id });
      assert.equal((await resolve()).personalization.status, 'career-context-only');
      await User.updateOne({ _id: owner }, { activeResumeFileId: files[0]._id });
      await GitHubAnalysisCache.updateOne(
        { normalizedUsername: username },
        {
          $set: {
            'result.fetchedAt': new Date(Date.now() + 1000).toISOString(),
          },
        },
      );
      const changed = await resolve();
      assert.notEqual(changed.fingerprint, original);
      assert.equal(changed.personalization.status, 'career-context-only');
      await GitHubAnalysisCache.updateOne(
        { normalizedUsername: username },
        { $set: { result: githubData } },
      );
      const foreignResult = await personalization.resolveSkillSignals(
        foreign,
        'Backend',
        'Intern',
        null,
        await User.findById(foreign).lean(),
      );
      assert.deepEqual(foreignResult.skillGaps, []);
      await User.updateOne({ _id: owner }, { activeCareerStack: 'Frontend' });
      const next = await call({ platform: 'Coursera' });
      assert.equal(next.body.recommendedBasedOn.careerStack, 'Frontend');
      assert.equal(next.body.personalization.status, 'career-context-only');
      await User.updateOne({ _id: owner }, { activeCareerStack: 'Backend' });
    },
  );
  await t.test(
    'filters, paging, forced refresh, invalid input and no-provider fallback remain accurate',
    async (child) => {
      const a = await call({ platform: 'Coursera', page: '1', limit: '2' });
      const b = await call({ platform: 'Coursera', page: '2', limit: '2' });
      child.diagnostic(
        JSON.stringify({
          eligibility: a.body.personalization,
          page1: {
            status: a.status,
            total: a.body.total,
            ids: a.body.courses.map((item) => item.id),
          },
          page2: {
            status: b.status,
            total: b.body.total,
            ids: b.body.courses.map((item) => item.id),
          },
        }),
      );
      assert.equal(ANALYSIS_VERSION, 'v9-skill-evidence-governance');
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
      assert.equal(a.body.total, b.body.total);
      // SQL/CLAIMED_ONLY and Docker/PARTIAL are the only Backend learning targets.
      // React is outside this stack, Testing is UNKNOWN and Node.js is DEMONSTRATED.
      assert.deepEqual(a.body.personalization.eligibleSkills, ['SQL', 'Docker']);
      const pages = [...a.body.courses, ...b.body.courses];
      assert.ok(pages.every((item) => item.platform === 'Coursera'));
      assert.equal(a.body.total, 3);
      assert.equal(a.body.courses.length, 2);
      assert.equal(b.body.courses.length, 1);
      assert.deepEqual(pages.map((item) => item.id).sort(), ['fb_c12', 'fb_c2', 'fb_c5']);
      assert.equal(new Set(pages.map((item) => item.id)).size, pages.length);
      assert.deepEqual([a.body.page, a.body.totalPages, a.body.hasMore], [1, 2, true]);
      assert.deepEqual([b.body.page, b.body.totalPages, b.body.hasMore], [2, 2, false]);
      assert.ok(
        pages.every(
          (item) =>
            item.matchedTargets.length > 0 &&
            item.matchedTargets.every((skill) => ['SQL', 'Docker'].includes(skill)),
        ),
      );
      assert.ok(pages.every((item) => !item.level || item.level === 'Beginner'));
      const beyond = await call({ platform: 'Coursera', page: '99', limit: '2' });
      assert.equal(beyond.body.page, 2);
      assert.deepEqual(
        beyond.body.courses.map((item) => item.id),
        b.body.courses.map((item) => item.id),
      );
      assert.equal(a.body.cacheMetadata.signalHash, b.body.cacheMetadata.signalHash);
      assert.equal((await call({ platform: 'Coursera', refresh: 'true' })).body.fromCache, false);
      assert.equal((await call({ platform: { $ne: 'All' } })).status, 400);
      const yt = await call({ platform: 'YouTube' });
      assert.equal(yt.body.total, 0);
      assert.equal(yt.body.recommendedBasedOn.youtubeStatus, 'not-requested');
      assert.equal(yt.body.cacheMetadata.requestCounters.providerCalls, 0);
      const deepLink = await call({ skill: 'SQL', platform: 'Coursera' });
      assert.ok(deepLink.body.courses.length > 0);
      assert.ok(
        deepLink.body.courses.every((item) =>
          /sql/i.test([item.title, item.description, ...item.topics].join(' ')),
        ),
      );
      for (const skill of ['Node.js', 'Testing', 'React']) {
        const excluded = await call({ view: 'for-you', platform: 'Coursera', skill });
        assert.equal(excluded.status, 200);
        assert.equal(excluded.body.personalization.learningState, 'skill-not-recommended', skill);
        assert.equal(excluded.body.total, 0, skill);
        assert.deepEqual(excluded.body.courses, [], skill);
      }
      const discover = await call({ view: 'discover', platform: 'Coursera', skill: 'React' });
      assert.equal(discover.status, 200);
      assert.ok(
        discover.body.courses.some((item) => item.id === 'fb_c4'),
        'Discover retains the React catalog course excluded from For You.',
      );
      assert.equal(aiCalls, 0);
    },
  );
  await t.test(
    'expired pool caches and evidence/Redis/Mongo outages never serve obsolete personalization',
    async (child) => {
      await call({ platform: 'Coursera' });
      await new Promise((resolve) => setTimeout(resolve, 50));
      controller.clearCourseMemoryCache();
      const old = new Date(Date.now() - 7 * 60 * 60 * 1000);
      await AnalysisCache.updateMany(
        { userId: owner, analysisVersion: controller.COURSE_POOL_VERSION },
        { $set: { updatedAt: old } },
        { timestamps: false },
      );
      for (const [key, value] of shared)
        shared.set(key, { ...value, updatedAt: old.toISOString() });
      assert.equal((await call({ platform: 'Coursera' })).body.fromCache, false);
      const find = AnalysisCache.findOne;
      redisOffline = true;
      controller.clearCourseMemoryCache();
      const redisFallback = await call({ view: 'for-you', platform: 'Coursera' });
      assert.equal(
        redisFallback.status,
        200,
        'Redis failure alone must preserve owned v9 personalization.',
      );
      assert.equal(redisFallback.body.personalization.status, 'evidence-informed');
      assert.equal(redisFallback.body.total, 3);
      // Keep the valid personalized pool warm: evidence must still be checked
      // before a memory hit. Fail only the v9 evidence query, not catalog storage.
      AnalysisCache.findOne = function (query, ...args) {
        if (query.analysisVersion !== ANALYSIS_VERSION) return find.call(this, query, ...args);
        return {
          sort() {
            return this;
          },
          select() {
            return this;
          },
          lean: async () => {
            throw new Error('Mongo unavailable');
          },
        };
      };
      try {
        const fallback = await call({ platform: 'Coursera' });
        child.diagnostic(JSON.stringify({ evidenceUnavailable: fallback }));
        assert.equal(fallback.status, 503);
        assert.equal(fallback.body.code, 'COURSE_EVIDENCE_UNAVAILABLE');
        assert.equal(
          Object.hasOwn(fallback.body, 'courses'),
          false,
          'Never serve the warm personalized pool when evidence cannot be checked.',
        );
        const app = express();
        // Exercise HTTP response semantics on synthetic loopback data. Production
        // auth/admission middleware is unchanged and outside these two assertions.
        app.get('/courses', async (req, res) =>
          controller.fetchCourses({ user: await user(), query: req.query }, res),
        );
        const httpServer = app.listen(0, '127.0.0.1');
        await new Promise((resolve) => httpServer.once('listening', resolve));
        try {
          const base = `http://127.0.0.1:${httpServer.address().port}/courses`;
          const unavailable = await fetch(`${base}?view=for-you&platform=Coursera`);
          assert.equal(unavailable.status, 503);
          assert.equal(unavailable.headers.get('retry-after'), '5');
          assert.equal(unavailable.headers.get('cache-control'), 'private, no-store');
          assert.equal((await unavailable.json()).code, 'COURSE_EVIDENCE_UNAVAILABLE');
          const discovery = await fetch(`${base}?view=discover&platform=Coursera`);
          assert.equal(discovery.status, 200, 'Discover does not require personalized evidence.');
          const catalog = await discovery.json();
          assert.ok(catalog.courses.length > 0);
          assert.equal(catalog.personalization.ruleVersion, 'catalog-discover-v1');
          assert.deepEqual(catalog.requestedSkills, []);
        } finally {
          await new Promise((resolve) => httpServer.close(resolve));
        }
      } finally {
        AnalysisCache.findOne = find;
        redisOffline = false;
      }
      const recovered = await call({ view: 'for-you', platform: 'Coursera' });
      assert.equal(recovered.status, 200);
      assert.equal(recovered.body.personalization.status, 'evidence-informed');
      assert.equal(recovered.body.total, 3);
      assert.deepEqual(
        (await AnalysisCache.findById(snapshot._id)).analysisData.skills,
        snapshotData.skills,
      );
      assert.equal(aiCalls, 0);
    },
  );
  await t.test(
    'progress CRUD is owner-isolated, bounded, explicit and idempotent under concurrent saves',
    async () => {
      const saved = await progress.saveProgress(owner, 'fb_u2', {
        status: 'saved',
        notes: 'My note',
      });
      assert.equal(saved.progressPercent, null);
      assert.equal(saved.completionSource, 'self-reported');
      assert.equal(Object.hasOwn(saved, 'userId'), false);
      await Promise.all(
        Array.from({ length: 6 }, () =>
          progress.saveProgress(owner, 'fb_u2', {
            status: 'in_progress',
            progressPercent: 25,
          }),
        ),
      );
      assert.equal(await Progress.countDocuments({ userId: owner, courseId: 'fb_u2' }), 1);
      assert.equal((await progress.listProgress(foreign)).total, 0);
      const completed = await progress.saveProgress(owner, 'fb_u2', {
        status: 'completed',
      });
      const repeated = await progress.saveProgress(owner, 'fb_u2', {
        status: 'completed',
      });
      assert.equal(completed.progressPercent, 25);
      assert.equal(String(completed.completedAt), String(repeated.completedAt));
      assert.equal(
        (await AnalysisCache.findById(snapshot._id)).analysisData.skills[0].status,
        'CLAIMED_ONLY',
      );
      await assert.rejects(
        progress.saveProgress(owner, 'fb_u2', {
          status: 'saved',
          userId: foreign,
        }),
        /Only status/,
      );
      await assert.rejects(
        progress.saveProgress(owner, 'fb_u2', {
          status: 'saved',
          progressPercent: '80',
        }),
        /explicit number/,
      );
      await assert.rejects(
        progress.saveProgress(owner, 'fb_u2', {
          status: 'saved',
          notes: 'x'.repeat(2001),
        }),
        /2000/,
      );
      await assert.rejects(
        progress.saveProgress(owner, 'unknown', { status: 'saved' }),
        /Invalid course/,
      );
      await assert.rejects(
        progress.saveProgress(owner, 'fb_u999', { status: 'saved' }),
        /unavailable/,
      );
      await progress.removeProgress(foreign, 'fb_u2');
      assert.equal((await progress.listProgress(owner)).total, 1);
      await progress.removeProgress(owner, 'fb_u2');
      await progress.removeProgress(owner, 'fb_u2');
      assert.equal((await progress.listProgress(owner)).total, 0);
    },
  );
  await t.test(
    'JWT HTTP endpoints protect ownership and course handoff inserts one task atomically',
    async () => {
      const app = express();
      app.use(express.json({ limit: '16kb' }));
      app.use('/api/courses', require('../routes/courseRoutes'));
      server = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      const base = `http://127.0.0.1:${server.address().port}/api/courses`;
      const token = (id) =>
        jwt.sign({ id: String(id) }, process.env.JWT_SECRET, {
          algorithm: 'HS256',
          issuer: 'devinsight-api',
          audience: 'devinsight-web',
          expiresIn: '5m',
        });
      const http = async (route, method = 'GET', body, userId = owner) => {
        const response = await fetch(base + route, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(userId ? { Authorization: 'Bearer ' + token(userId) } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        return {
          status: response.status,
          body: response.status === 204 ? null : await response.json(),
          cache: response.headers.get('cache-control'),
          rateLimit: response.headers.get('ratelimit-limit'),
          retryAfter: response.headers.get('retry-after'),
        };
      };
      assert.equal((await http('/my-learning', 'GET', undefined, null)).status, 401);
      const savedRes = await http('/fb_u2/progress', 'PUT', { status: 'saved' });
      assert.equal(savedRes.status, 200);
      assert.ok(Number(savedRes.rateLimit) > 0);
      const prevRefreshLimit = process.env.COURSES_REFRESH_RATE_LIMIT_MAX;
      process.env.COURSES_REFRESH_RATE_LIMIT_MAX = '2';
      try {
        assert.equal((await http('?refresh=true', 'GET', undefined, foreign)).status, 200);
        assert.equal((await http('?refresh=true', 'GET', undefined, foreign)).status, 200);
        const throttled = await http('?refresh=true', 'GET', undefined, foreign);
        assert.equal(throttled.status, 429);
        assert.equal(throttled.body.code, 'COURSE_RATE_LIMITED');
        assert.ok(Number(throttled.retryAfter) >= 1);
      } finally {
        if (prevRefreshLimit === undefined) delete process.env.COURSES_REFRESH_RATE_LIMIT_MAX;
        else process.env.COURSES_REFRESH_RATE_LIMIT_MAX = prevRefreshLimit;
      }
      assert.equal((await http('/fb_u2/career-sprint', 'POST', {}, foreign)).status, 404);
      assert.equal(
        (await http('/fb_u2/career-sprint', 'POST', { targetSkill: 'Java' })).status,
        400,
      );
      assert.equal((await http('/fb_u2/career-sprint', 'POST', { points: 100 })).status, 400);
      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          http('/fb_u2/career-sprint', 'POST', { targetSkill: 'Node.js' }),
        ),
      );
      assert.ok(
        responses.every((out) => out.status === 200),
        JSON.stringify(responses),
      );
      assert.equal(responses.filter((out) => !out.body.alreadyAdded).length, 1);
      const sprint = await CareerSprint.findOne({ userId: owner }).lean();
      assert.equal(sprint.tasks.length, 1);
      assert.equal(sprint.tasks[0].points, 3, 'existing Sprint schema default');
      assert.equal(sprint.tasks[0].startDate, null);
      assert.equal(sprint.tasks[0].endDate, null);
      assert.match(sprint.tasks[0].description, /Skill: Node.js/);
      assert.equal(await CareerSprint.countDocuments({ userId: foreign }), 0);
      await Progress.updateOne(
        { userId: owner, courseId: 'fb_u2' },
        { $set: { 'course.title': 'Provider renamed this course' } },
      );
      const renamed = await http('/fb_u2/career-sprint', 'POST', {
        targetSkill: 'Node.js',
      });
      assert.equal(renamed.status, 200);
      assert.equal(renamed.body.alreadyAdded, true);
      assert.equal((await CareerSprint.findOne({ userId: owner }).lean()).tasks.length, 1);
      const sprintDoc = await CareerSprint.findOne({ userId: owner });
      const sprintTask = sprintDoc.tasks[0];
      const sprintService = require('../services/careerSprintService');
      await sprintService.editTask(owner, sprintDoc._id, sprintTask._id, {
        title: 'User Edited Title',
        description: 'User completely modified their course description notes.',
      });
      const replayAfterEdit = await http('/fb_u2/career-sprint', 'POST', {
        targetSkill: 'Node.js',
      });
      assert.equal(replayAfterEdit.status, 200);
      assert.equal(replayAfterEdit.body.alreadyAdded, true);
      assert.equal((await CareerSprint.findOne({ userId: owner }).lean()).tasks.length, 1);
      assert.equal(
        (await http('/fb_u2/career-sprint', 'POST', { targetSkill: 'Express' })).status,
        409,
      );
      await http('/fb_u2/progress', 'PUT', { status: 'completed' });
      assert.equal((await http('/fb_u2/career-sprint', 'POST', {})).status, 409);
      const mine = await http('/my-learning?status=completed');
      assert.equal(mine.body.total, 1);
      assert.match(mine.cache, /no-store/);
      assert.equal((await http('/my-learning', 'GET', undefined, foreign)).body.total, 0);
      assert.equal((await http('/fb_u2/progress', 'DELETE')).status, 204);
      assert.equal((await http('/fb_u2/progress', 'DELETE')).status, 204);
      const { id, title, platform, url } = require('../data/courseCatalog').find(
        (item) => item.id === 'fb_e3',
      );
      assert.equal((await http('/fb_e3/progress', 'PUT', { status: 'saved' })).status, 404);
      await Progress.create({
        userId: owner,
        courseId: id,
        course: { id, title, platform, url },
        status: 'saved',
      });
      const retired = await http('/fb_e3/progress', 'PUT', {
        status: 'in_progress',
        notes: 'Keep my notes',
      });
      assert.equal(retired.status, 200);
      assert.equal(retired.body.courseId, id);
      assert.equal(retired.body.course.url, '');
      assert.equal(retired.body.notes, 'Keep my notes');
      assert.equal(
        (await Progress.findOne({ userId: owner, courseId: id }).lean()).course.url,
        url,
      );
      assert.equal(aiCalls, 0);
    },
  );
});
