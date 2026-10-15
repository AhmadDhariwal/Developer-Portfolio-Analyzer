'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const User = require('../models/user');
const ResumeFile = require('../models/resumeFile');
const ResumeAnalysis = require('../models/resumeAnalysis');
const GitHubAnalysisCache = require('../models/githubAnalysisCache');
const AnalysisCache = require('../models/analysisCache');
const Recommendation = require('../models/recommendation');
const SavedPreview = require('../models/savedPreview');
const CareerSprint = require('../models/careerSprint');
const engine = require('../services/recommendationEngineService');
const signals = require('../services/developerSignalService');
const mock = (request, exports) => {
  const filename = require.resolve(request);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

test('Recommendations Mongo: canonical context, invalidation, history, ownership, AI failure and atomic Sprint handoff', async (t) => {
  assert.ok(
    process.env.MONGODB_URI || process.env.MONGO_URI,
    'MongoDB connection is required, not skipped.',
  );
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
  });
  const owner = new mongoose.Types.ObjectId();
  const foreign = new mongoose.Types.ObjectId();
  const username = `rec-${owner.toString().slice(-12)}`;
  const shared = new Map();
  let aiCalls = 0;
  let redisFailure = false;
  let aiOutput = { ok: false };
  let aiGate = null;
  mock('../services/aiservice', {
    getSharedCache: async (key, namespace) => {
      if (redisFailure) throw new Error('Redis offline');
      return shared.get(`${namespace}:${key}`) || null;
    },
    setSharedCache: async (key, value, ttl, namespace) => shared.set(`${namespace}:${key}`, value),
    runAIAnalysis: async () => {
      aiCalls++;
      if (aiGate) {
        aiGate.started();
        await aiGate.promise;
      }
      await new Promise((resolve) => setTimeout(resolve, 15));
      return aiOutput;
    },
  });
  mock('../services/notificationService', { createNotification: async () => {} });
  mock('../services/aiVersionService', { createVersion: async () => {} });
  // Supporting sources are deterministic fixtures; identity, all source documents,
  // recommendation persistence, cache queries and Sprint mutation use real MongoDB.
  mock('../services/developerSignalService', {
    ...signals,
    getDeveloperSignals: async () => ({
      portfolioSignal: { present: false },
      careerSprintSignal: { present: false },
      careerProfileSignal: { present: true, careerStack: 'Backend' },
    }),
    getPublicJobMarketSignal: async () => ({ present: false, topSkills: [] }),
  });
  const controller = require('../controllers/recommendationscontroller');
  const call = async (handler, body = {}, userId = owner, params = {}) => {
    const user = userId ? await User.findById(userId).lean() : null;
    const out = { status: 200 };
    const response = {
      status(value) {
        out.status = value;
        return this;
      },
      json(value) {
        out.body = value;
        return this;
      },
      send() {
        return this;
      },
    };
    await controller[handler]({ user, body, params }, response);
    return out;
  };
  t.after(async () => {
    await new Promise((resolve) => setImmediate(resolve));
    await Promise.all(
      [
        User,
        ResumeFile,
        ResumeAnalysis,
        AnalysisCache,
        Recommendation,
        SavedPreview,
        CareerSprint,
      ].map((model) =>
        model.deleteMany(
          model === User
            ? { _id: { $in: [owner, foreign] } }
            : { userId: { $in: [owner, foreign] } },
        ),
      ),
    );
    await GitHubAnalysisCache.deleteMany({ normalizedUsername: username });
    await require('../models/sprintSchedule').deleteMany({ _id: { $in: [owner, foreign] } });
    await require('../models/sprintPreference').deleteMany({ _id: { $in: [owner, foreign] } });
    await mongoose.disconnect();
  });
  await Recommendation.createIndexes();
  const { migrate } = require('../scripts/migrateRecommendationSnapshotIndex');
  assert.equal(await migrate(Recommendation), 'recommendation_evidence_snapshot');
  assert.equal(await migrate(Recommendation), 'recommendation_evidence_snapshot');
  await SavedPreview.createIndexes();
  await User.create([
    {
      _id: owner,
      name: 'Recommendation fixture',
      email: `${owner}@recommendation.test`,
      password: 'fixture-only',
      activeGithubUsername: username,
      activeCareerStack: 'Backend',
      activeExperienceLevel: 'Intern',
    },
    {
      _id: foreign,
      name: 'Foreign fixture',
      email: `${foreign}@recommendation.test`,
      password: 'fixture-only',
      activeCareerStack: 'Backend',
      activeExperienceLevel: 'Intern',
    },
  ]);
  const files = await ResumeFile.create(
    ['a', 'b', 'unanalysed'].map((name) => ({
      userId: owner,
      fileName: `${name}.pdf`,
      fileUrl: `/recommendation-test/${name}`,
      fileSize: 1,
    })),
  );
  const analyzedAt = new Date();
  const [a, b] = await ResumeAnalysis.create(
    ['a', 'b'].map((name, index) => ({
      userId: owner,
      fileId: files[index]._id,
      fileName: `${name}.pdf`,
      fileSize: 1,
      analyzedAt,
      scoring: { score: index === 0 ? null : 0, ruleVersion: 'resume-overall-score-v1' },
      resumeSignals: {
        analysisVersion: 'resume-v3',
        skills: [index ? 'Docker' : 'SQL'],
        warnings: [
          { code: 'missing_metrics', severity: 'high', message: 'Few quantified achievements.' },
        ],
      },
    })),
  );
  await User.updateOne({ _id: owner }, { activeResumeFileId: files[0]._id });
  const github = {
    repoCount: 1,
    repositories: [{ name: 'api', hasReadme: false, hasTests: true }],
    fetchedAt: analyzedAt.toISOString(),
    scores: { healthScore: 0 },
    scoring: { score: 0, ruleVersion: 'github-health-score-v1' },
    githubSignals: {
      analyzedAt: analyzedAt.toISOString(),
      username,
      scoring: { score: 0, ruleVersion: 'github-health-score-v1' },
    },
  };
  await GitHubAnalysisCache.create({
    githubUsername: username,
    normalizedUsername: username,
    result: github,
    analysisVersion: 'github-v2',
    expiresAt: new Date(Date.now() + 3600000),
  });
  const resumeIdentity = signals.buildResumeCacheIdentity({ resumeAnalysis: a.toObject() });
  const skillGap = {
    ruleVersion: engine.SKILL_RULE,
    coverage: 0,
    calculatedAt: analyzedAt.toISOString(),
    requiredSkills: [
      { name: 'SQL', status: 'CLAIMED_ONLY', requirement: 'REQUIRED', evidenceConfidence: 'LOW' },
    ],
    skills: [
      { name: 'SQL', status: 'CLAIMED_ONLY', requirement: 'REQUIRED', evidenceConfidence: 'LOW' },
    ],
    sourceReferences: Object.values(
      engine.sourceMetadata({ username, githubData: github, resumeAnalysis: a.toObject() }),
    ),
  };
  await AnalysisCache.create({
    userId: owner,
    githubUsername: username.toUpperCase(),
    careerStack: 'Backend',
    experienceLevel: 'Intern',
    ...resumeIdentity,
    analysisVersion: 'v6-skill-intelligence',
    analysisData: skillGap,
  });
  const legacy = await Recommendation.create({
    userId: owner,
    title: 'Historical recommendation',
    careerStack: 'Backend',
  });

  await t.test('matching current sources, null/zero and persistent history', async () => {
    const out = await call('getRecommendations');
    assert.equal(out.status, 200);
    assert.equal(out.body.sourceScores.skillEvidenceCoverage, 0);
    assert.equal(out.body.sourceScores.resumeOverall, null);
    assert.equal(out.body.sourceScores.githubHealth, 0);
    assert.equal(out.body.technologies[0].evidenceStatus, 'CLAIMED_ONLY');
    assert.equal(aiCalls, 0, 'passive cold reads must not call Recommendations AI');
    assert.equal(
      await Recommendation.countDocuments({ userId: owner, snapshotVersion: engine.RULE_VERSION }),
      1,
    );
    assert.ok(await Recommendation.findById(legacy._id));
    assert.equal(JSON.stringify(out.body).includes('resumeText'), false);
  });
  await t.test('memory, Mongo and Redis outages retain deterministic recommendations', async () => {
    const first = await call('getRecommendations');
    const memory = await call('getRecommendations');
    assert.equal(memory.body.cacheMetadata.cacheLayer, 'memory');
    controller.clearRecommendationMemoryCache();
    shared.clear();
    redisFailure = true;
    const mongo = await call('getRecommendations');
    assert.equal(mongo.status, 200);
    assert.equal(mongo.body.cacheMetadata.cacheLayer, 'mongo');
    assert.equal(mongo.body.cacheMetadata.signalHash, first.body.cacheMetadata.signalHash);
    redisFailure = false;
  });
  await t.test(
    'active resume switch and unanalyzed selection never borrow another analysis',
    async () => {
      const previous = await call('getRecommendations');
      const staleUser = await User.findById(owner).lean();
      await User.updateOne({ _id: owner }, { activeResumeFileId: files[1]._id });
      let staleStatus = 200;
      const staleResponse = {
        status(code) {
          staleStatus = code;
          return this;
        },
        json() {
          return this;
        },
      };
      await controller.getRecommendations({ user: staleUser, body: {} }, staleResponse);
      assert.equal(
        staleStatus,
        409,
        'A changed canonical selection must never be combined with the earlier request context.',
      );
      const next = await call('getRecommendations');
      assert.equal(next.body.resumeInsights.analysisId, String(b._id));
      assert.equal(next.body.sourceScores.resumeOverall, 0);
      assert.equal(next.body.sourceScores.skillEvidenceCoverage, null);
      assert.notEqual(next.body.cacheMetadata.signalHash, previous.body.cacheMetadata.signalHash);
      await User.updateOne({ _id: owner }, { activeResumeFileId: files[2]._id });
      const missing = await call('getRecommendations');
      assert.equal(missing.body.resumeInsights.analyzed, false);
      assert.equal(missing.body.resumeRecommendations.length, 0);
      await User.updateOne({ _id: owner }, { activeResumeFileId: files[0]._id });
    },
  );
  await t.test('resume-only persistence, historical rows and saved preview ownership', async () => {
    await User.updateOne({ _id: owner }, { activeGithubUsername: '', githubUsername: '' });
    const onlyResume = await call('getRecommendations');
    assert.equal(onlyResume.status, 200);
    assert.equal(onlyResume.body.sourceMetadata.github.available, false);
    assert.ok(onlyResume.body.resumeRecommendations.length);
    await new Promise((resolve) => setImmediate(resolve));
    controller.clearRecommendationMemoryCache();
    shared.clear();
    const reused = await call('getRecommendations');
    assert.equal(reused.body.cacheMetadata.cacheLayer, 'mongo');
    await User.updateOne({ _id: owner }, { activeGithubUsername: username });
    const history = await call('listRecommendationHistory');
    assert.ok(history.body.snapshots.some((row) => row.legacy));
    assert.ok(
      history.body.snapshots.some(
        (row) => row.snapshotVersion === engine.RULE_VERSION && !row.legacy,
      ),
    );
    assert.equal((await call('listRecommendationHistory', {}, foreign)).body.snapshots.length, 0);
    const saved = await call('savePreview', {
      module: 'recommendations',
      githubUsername: username,
      careerStack: 'Backend',
      experienceLevel: 'Intern',
      resumeHash: 'a'.repeat(64),
      result: {
        analysisSummary: 'Fixture preview',
        resumeText: 'PRIVATE RAW TEXT',
        recommendationScores: { readinessScore: null },
        projects: [
          { title: 'Review fixture', description: 'Inspect evidence', estimatedImpact: null },
        ],
      },
    });
    assert.equal(saved.status, 200);
    const previews = await call('listSavedPreviews');
    assert.equal(JSON.stringify(previews.body).includes('PRIVATE RAW TEXT'), false);
    const row = await SavedPreview.findOne({ userId: owner }).lean();
    assert.equal(row.resultSummary.recommendationScores.readinessScore, null);
    assert.equal(row.resultSummary.projects[0].estimatedImpact, null);
    assert.equal(row.resultSummary.verified, false);
    assert.equal(
      (await call('deleteSavedPreview', {}, foreign, { id: String(row._id) })).status,
      404,
    );
    assert.ok(await SavedPreview.findById(row._id));
    assert.equal(
      (await call('deleteSavedPreview', {}, owner, { id: String(row._id) })).status,
      204,
    );
  });
  await t.test('reanalysis, current completion and career context invalidate caches', async () => {
    const before = await call('getRecommendations');
    await ResumeAnalysis.updateOne(
      { _id: a._id },
      {
        analyzedAt: new Date(Date.now() + 1000),
        'scoring.score': 70,
        'resumeSignals.warnings': [],
      },
    );
    const after = await call('getRecommendations');
    assert.notEqual(after.body.cacheMetadata.signalHash, before.body.cacheMetadata.signalHash);
    assert.equal(after.body.sourceScores.skillEvidenceCoverage, null);
    assert.equal(after.body.resumeRecommendations.length, 0);
    await GitHubAnalysisCache.updateOne(
      { normalizedUsername: username },
      {
        'result.repositories.0.hasReadme': true,
        'result.githubSignals.analyzedAt': new Date(Date.now() + 2000).toISOString(),
      },
    );
    const complete = await call('getRecommendations');
    assert.equal(
      complete.body.projects.some((project) => /^Document/.test(project.title)),
      false,
    );
    await User.updateOne({ _id: owner }, { activeExperienceLevel: 'Student' });
    const level = await call('getRecommendations');
    assert.notEqual(level.body.cacheMetadata.signalHash, complete.body.cacheMetadata.signalHash);
  });
  await t.test(
    'concurrent generation, failed/adversarial AI and authenticated ownership',
    async () => {
      // Keep provider work cached; only the Recommendations enrichment is exercised.
      const provider = require('../services/githubservice');
      const original = provider.analyzeGitHubProfile;
      provider.analyzeGitHubProfile = async () =>
        (await GitHubAnalysisCache.findOne({ normalizedUsername: username }).lean()).result;
      try {
        const before = aiCalls;
        const outputs = await Promise.all(
          Array.from({ length: 5 }, () => call('getRecommendations', { forceRefresh: true })),
        );
        assert.equal(aiCalls - before, 1);
        assert.ok(outputs.every((out) => out.status === 200 && !out.body.aiUsed));
        assert.equal(new Set(outputs.map((out) => out.body.cacheMetadata.signalHash)).size, 1);
        aiOutput = {
          ok: true,
          value: {
            recommendations: [{ title: 'Injected' }],
            projects: [{ title: 'Injected', impact: 99 }],
            readinessScore: 99,
          },
        };
        const attacked = await call('getRecommendations', { forceRefresh: true });
        assert.equal(attacked.body.aiUsed, false);
        assert.equal(JSON.stringify(attacked.body).includes('Injected'), false);
        let release;
        let markStarted;
        const started = new Promise((resolve) => {
          markStarted = resolve;
        });
        aiGate = {
          started: markStarted,
          promise: new Promise((resolve) => {
            release = resolve;
          }),
        };
        const first = call('getRecommendations', { forceRefresh: true });
        await started;
        await ResumeAnalysis.updateOne(
          { _id: a._id },
          { analyzedAt: new Date(Date.now() + 5000), 'scoring.score': 90 },
        );
        const follower = call('getRecommendations', { forceRefresh: true });
        await new Promise((resolve) => setTimeout(resolve, 30));
        release();
        aiGate = null;
        const [beforeRevision, afterRevision] = await Promise.all([first, follower]);
        assert.equal(afterRevision.body.sourceScores.resumeOverall, 90);
        assert.notEqual(
          afterRevision.body.cacheMetadata.signalHash,
          beforeRevision.body.cacheMetadata.signalHash,
          'An in-flight waiter must validate current source revisions before reusing a result.',
        );
      } finally {
        provider.analyzeGitHubProfile = original;
      }
      assert.equal((await call('generateRecommendations', {}, null)).status, 401);
      assert.equal(
        (await call('generateRecommendations', { githubUsername: 'someone-else' })).status,
        400,
      );
      const other = await call('getRecommendations', {}, foreign);
      assert.equal(other.body.sourceMetadata.resume.available, false);
      assert.equal(other.body.sourceMetadata.github.available, false);
    },
  );
  await t.test('owned, current Sprint handoff is atomic and idempotent', async () => {
    const current = await call('getRecommendations');
    const card = current.body.recommendations[0];
    const signalHash = current.body.cacheMetadata.signalHash;
    const sprint = await CareerSprint.create({
      userId: owner,
      title: 'Recommendation fixture sprint',
      tasks: [],
      weekStartDate: new Date(),
      weekEndDate: new Date(Date.now() + 7 * 86400000),
    });
    mock('../services/careerSprintService', {
      getCurrentSprint: async () => sprint.toObject(),
      invalidateCareerSprintCache: () => {},
    });
    const outputs = await Promise.all(
      Array.from({ length: 5 }, () =>
        call('handoffToCareerSprint', { signalHash }, owner, { id: card.id }),
      ),
    );
    assert.ok(outputs.every((out) => out.status === 200));
    const stored = await CareerSprint.findById(sprint._id).lean();
    assert.equal(stored.tasks.length, 1);
    assert.ok(stored.tasks[0].description.includes(card.id));
    assert.equal(
      (await call('handoffToCareerSprint', { signalHash: 'f'.repeat(64) }, owner, { id: card.id }))
        .status,
      409,
    );
    assert.equal(
      (await call('handoffToCareerSprint', { signalHash }, foreign, { id: card.id })).status,
      404,
    );
    assert.equal(
      (await call('handoffToCareerSprint', { signalHash }, null, { id: card.id })).status,
      401,
    );
  });
  await t.test('HTTP routes enforce JWT ownership and preview isolation', async () => {
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const app = express();
    app.use(express.json());
    app.use('/api/recommendations', require('../routes/recommendations.routes'));
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    try {
      const base = `http://127.0.0.1:${server.address().port}/api/recommendations`;
      const token = jwt.sign({ id: String(owner) }, process.env.JWT_SECRET, {
        algorithm: 'HS256',
        issuer: process.env.JWT_ISSUER || 'devinsight-api',
        audience: process.env.JWT_AUDIENCE || 'devinsight-web',
        expiresIn: '1m',
      });
      assert.equal((await fetch(`${base}/history`)).status, 401);
      assert.equal(
        (
          await fetch(base, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          })
        ).status,
        401,
      );
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
      const history = await fetch(`${base}/history`, { headers });
      assert.equal(history.status, 200);
      assert.ok((await history.json()).snapshots.some((row) => row.legacy));
      const before = await Recommendation.countDocuments({ userId: owner });
      const preview = await fetch(`${base}/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          isTemporary: true,
          careerStack: 'Backend',
          experienceLevel: 'Student',
          resumeText: 'Preview-only private text mentions Python.',
        }),
      });
      assert.equal(preview.status, 200);
      const result = await preview.json();
      assert.equal(result.mode, 'preview');
      assert.equal(result.savedToProfile, false);
      assert.equal(result.sourceMetadata.github.available, false);
      assert.equal(result.signalsUsed.skillGap.present, false);
      assert.equal(JSON.stringify(result).includes('Preview-only private text'), false);
      assert.equal(await Recommendation.countDocuments({ userId: owner }), before);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
