'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const mongoose = require('mongoose');
const { createClient } = require('redis');
const { textPDF } = require('../fixtures/b2Fixture');
const { startMongo } = require('../fixtures/disposableRequestMongo');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startWorker({ mongoUri, redisUrl, jwtSecret }) {
  const child = fork(path.join(__dirname, '../fixtures/developerFreshnessWorker.js'), [], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MONGODB_URI: mongoUri,
      MONGO_URI: mongoUri,
      REDIS_URL: redisUrl,
      JWT_SECRET: jwtSecret,
      JWT_ISSUER: 'devinsight-api',
      JWT_AUDIENCE: 'devinsight-web',
      AI_ENABLED: 'true',
      AI_DAILY_USER_LIMIT: '100',
      PORTFOLIO_SCORE_LIMIT: '100'
    },
    windowsHide: true,
    execArgv: [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });

  let logs = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      logs = (logs + chunk).slice(-4000);
    });
  }

  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Worker boot timeout: ' + logs));
    }, 60000);
    child.once('message', (msg) => {
      clearTimeout(timer);
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Worker exited early (${code}): ${logs}`));
    });
  });

  return {
    child,
    base: `http://127.0.0.1:${ready.port}`
  };
}

test(
  'real HTTP + disposable MongoDB + disposable Redis + 2 backend instances: end-to-end developer freshness',
  {
    skip:
      !fs.existsSync(
        process.env.INTEGRATION_TEST_MONGOD ||
          'C:\\Program Files\\MongoDB\\Server\\8.2\\bin\\mongod.exe'
      ) || !process.env.DPA_TEST_REDIS_URL,
    timeout: 240000
  },
  async (t) => {
    const redisTarget = new URL(process.env.DPA_TEST_REDIS_URL);
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(redisTarget.hostname));
    assert.equal(process.env.DPA_TEST_REDIS_DISPOSABLE, 'true');

    const mongo = await startMongo({ replicaSet: 'dpa-e2e-freshness' });
    const jwtSecret = randomBytes(32).toString('hex');
    const prevSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = jwtSecret;

    const redisClient = createClient({
      url: redisTarget.href,
      socket: { reconnectStrategy: false, connectTimeout: 1000 }
    });
    redisClient.on('error', () => {});
    const workers = [];

    t.after(async () => {
      for (const w of workers) {
        const done = new Promise((resolve) => w.child.once('exit', resolve));
        w.child.send('stop');
        await Promise.race([done, delay(5000)]);
        if (w.child.exitCode === null) w.child.kill();
      }
      if (redisClient.isReady) await redisClient.flushDb().catch(() => {});
      if (redisClient.isOpen) await redisClient.quit().catch(() => {});
      await mongoose.disconnect().catch(() => {});
      await mongo.stop();
      if (prevSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = prevSecret;
    });

    await redisClient.connect();
    await redisClient.flushDb();
    await mongoose.connect(mongo.uri);

    const User = require('../../modules/auth/models/user');
    const Analysis = require('../../modules/skill-gap/models/analysis');
    const AnalysisCache = require('../../modules/skill-gap/models/analysisCache');
    const Recommendation = require('../../modules/recommendations/models/recommendation');
    const Repository = require('../../modules/github/models/repository');
    const GitHubSaveLock = require('../../modules/github/models/githubSaveLock');
    const GitHubAnalysisCache = require('../../modules/github/models/githubAnalysisCache');
    const Notification = require('../../modules/notifications/models/notification');
    const NotificationState = require('../../modules/notifications/models/notificationState');
    const IntegrationGovernanceState = require('../../modules/integrations/models/integrationGovernanceState');
    const ResumeFile = require('../../modules/resume/models/resumeFile');
    const ResumeAnalysis = require('../../modules/resume/models/resumeAnalysis');
    const EmailDeliveryJob = require('../../core/messaging/models/emailDeliveryJob');
    const { sign } = require('../../modules/auth/utils/authSessionToken');

    await Promise.all(
      [
        User,
        Analysis,
        AnalysisCache,
        Recommendation,
        Repository,
        GitHubSaveLock,
        GitHubAnalysisCache,
        Notification,
        NotificationState,
        IntegrationGovernanceState,
        ResumeFile,
        ResumeAnalysis,
        EmailDeliveryJob
      ].map((m) => m.createCollection().catch(() => {}))
    );

    const owner = await User.create({
      name: 'E2E Developer',
      email: 'e2e-dev@example.invalid',
      password: randomBytes(24).toString('hex'),
      githubUsername: 'e2efixture',
      activeGithubUsername: 'e2efixture',
      careerStack: 'Backend',
      activeCareerStack: 'Backend',
      experienceLevel: 'Intern',
      activeExperienceLevel: 'Intern'
    });
    const other = await User.create({
      name: 'Other Developer',
      email: 'other-dev@example.invalid',
      password: randomBytes(24).toString('hex'),
      githubUsername: 'e2efixture',
      activeGithubUsername: 'e2efixture',
      careerStack: 'Backend',
      activeCareerStack: 'Backend',
      experienceLevel: 'Intern',
      activeExperienceLevel: 'Intern'
    });

    const ownerToken = sign(owner);
    const otherToken = sign(other);

    const [workerA, workerB] = await Promise.all([
      startWorker({ mongoUri: mongo.uri, redisUrl: redisTarget.href, jwtSecret }),
      startWorker({ mongoUri: mongo.uri, redisUrl: redisTarget.href, jwtSecret })
    ]);
    workers.push(workerA, workerB);

    const api = async (worker, method, route, body, token = ownerToken) => {
      const multipart = body instanceof FormData;
      const response = await fetch(`${worker.base}${route}`, {
        method,
        headers: {
          ...(!multipart ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        ...(body !== undefined ? { body: multipart ? body : JSON.stringify(body) } : {})
      });
      const text = await response.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
      return { status: response.status, body: json };
    };
    const counters = async (worker) =>
      (await api(worker, 'POST', '/__control/state', {}, null)).body;

    // 1. Passive read before any sync: 404, 0 GitHub calls, 0 AI calls.
    const coldSaved = await api(workerA, 'POST', '/api/github/analyze-save', { savedOnly: true });
    assert.equal(coldSaved.status, 404);
    assert.equal((await counters(workerA)).githubCalls, 0);

    // 2. Explicit Sync GitHub on Worker A -> persists accepted data and repositories.
    const sync1 = await api(workerA, 'POST', '/api/github/analyze-save', { forceRefresh: true });
    assert.equal(sync1.status, 200);
    assert.equal(sync1.body.repoCount, 1);
    const firstSyncCounts = await counters(workerA);
    assert.ok(firstSyncCounts.githubCalls > 0);
    assert.equal(firstSyncCounts.redisEnabled, true);

    // 3. Plant a superseded legacy pre-v9 historical Skill Gap doc and verify ordinary read on Worker B:
    //    must compute v9 deterministic result instead of returning the superseded 2024 historical snapshot.
    await AnalysisCache.create({
      userId: owner._id,
      githubUsername: 'e2efixture',
      careerStack: 'Backend',
      experienceLevel: 'Intern',
      resumeHash: 'no-resume',
      analysisVersion: 'v1-legacy-old',
      analysisData: {
        coverage: 11,
        missing: 89,
        yourSkills: [],
        missingSkills: [{ name: 'SQL', priority: 'High' }]
      },
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z')
    });

    await api(workerB, 'POST', '/__control/state', { resetCounters: true }, null);
    const gap1 = await api(workerB, 'POST', '/api/skillgap/skill-gap', { forceRefresh: false });
    assert.equal(gap1.status, 200);
    assert.equal(gap1.body.ruleVersion, 'skill-evidence-coverage-v1');
    assert.equal(gap1.body.isHistorical, undefined);
    assert.equal(gap1.body.aiUsed, false, 'Passive Skill Gap read must never auto-call paid AI');
    assert.equal((await counters(workerB)).aiCalls, 0);

    // 4. Explicit Recommendations refresh -> runs AI enrichment (aiUsed: true, aiRefreshRecommended: false).
    await api(workerA, 'POST', '/__control/state', { resetCounters: true }, null);
    const recExplicit = await api(workerA, 'POST', '/api/recommendations', { forceRefresh: true });
    assert.equal(recExplicit.status, 200);
    assert.equal(recExplicit.body.aiUsed, true);
    assert.equal(recExplicit.body.aiRefreshRecommended, false);
    const afterExplicitAiCount = (await counters(workerA)).aiCalls;
    assert.equal(afterExplicitAiCount, 1);

    // Compute initial Portfolio Score and read Dashboard summary.
    const port1 = await api(workerB, 'POST', '/api/analysis/portfolio-score', {});
    assert.equal(port1.status, 200);
    const dash1 = await api(workerB, 'GET', '/api/dashboard/summary');
    assert.equal(dash1.status, 200);
    assert.equal(dash1.body.repositories, 1);
    assert.deepEqual(
      dash1.body.languageSnapshot.data,
      Object.fromEntries(
        sync1.body.mainLanguageDistribution.map(({ language, percentage }) => [
          language,
          percentage
        ])
      )
    );
    assert.ok(dash1.body.languageSnapshot.data.Batchfile > 0);
    assert.ok(dash1.body.languageSnapshot.data.Batchfile < 0.01);
    assert.equal(dash1.body.languageSnapshot.data.HTML, undefined);

    // 5. Failed external provider sync on Worker A must preserve previously accepted GitHub data (returns stale fallback, never overwrites accepted).
    await api(workerA, 'POST', '/__control/state', { githubScenario: { fail: true } }, null);
    const failedSync = await api(workerA, 'POST', '/api/github/analyze-save', {
      forceRefresh: true
    });
    assert.equal(failedSync.status, 200);
    assert.equal(failedSync.body.cache?.stale, true);
    assert.equal(failedSync.body.repoCount, 1);
    const preservedRead = await api(workerB, 'POST', '/api/github/analyze-save', {
      savedOnly: true
    });
    assert.equal(preservedRead.status, 200);
    assert.equal(preservedRead.body.repoCount, 1);

    // 6. Sync updated GitHub evidence on Worker A (version 2 adds Docker repo).
    await api(
      workerA,
      'POST',
      '/__control/state',
      {
        githubScenario: {
          fail: false,
          version: 2,
          repos: [
            {
              name: 'node-api',
              description: 'Node.js TypeScript service with tests',
              language: 'TypeScript',
              stargazers_count: 15,
              forks_count: 3,
              pushed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              created_at: '2024-01-01T00:00:00.000Z',
              fork: false,
              archived: false,
              size: 1200,
              topics: ['nodejs', 'typescript']
            },
            {
              name: 'docker-infra',
              description: 'Docker Compose SQL microservice stack',
              language: 'Dockerfile',
              stargazers_count: 8,
              forks_count: 1,
              pushed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              created_at: '2025-01-01T00:00:00.000Z',
              fork: false,
              archived: false,
              size: 800,
              topics: ['docker', 'sql']
            }
          ]
        }
      },
      null
    );
    await api(workerB, 'POST', '/__control/state', { resetCounters: true }, null);

    // Wait 20ms so GitHub updatedAt is strictly newer than prior SkillGap/Rec/Portfolio docs.
    await delay(25);
    const sync2 = await api(workerA, 'POST', '/api/github/analyze-save', { forceRefresh: true });
    assert.equal(sync2.status, 200);
    assert.equal(sync2.body.repoCount, 2);

    // Dashboard immediately reports updated repos & marks invalidated/stale derived caches Refresh Recommended.
    const dashAfterSync = await api(workerB, 'GET', '/api/dashboard/summary');
    assert.equal(dashAfterSync.status, 200);
    assert.equal(dashAfterSync.body.repositories, 2);
    assert.equal(dashAfterSync.body.recommendationSnapshot.stale, true);
    assert.equal(
      dashAfterSync.body.signalMetadata.sourceFreshness.skillGap.refreshRecommended,
      true
    );
    assert.ok(dashAfterSync.body.signalMetadata.staleSources.includes('recommendations'));
    assert.ok(dashAfterSync.body.signalMetadata.staleSources.includes('portfolio'));

    // Worker B recalculates Skill Gap deterministically with ZERO paid AI calls and reflects new Docker evidence.
    const gap2 = await api(workerB, 'POST', '/api/skillgap/skill-gap', { forceRefresh: false });
    assert.equal(gap2.status, 200);
    assert.equal(Boolean(gap2.body.fromCache), false);
    assert.equal(gap2.body.cacheMetadata.loadedFromCache, false);
    assert.equal(gap2.body.aiUsed, false);
    assert.equal((await counters(workerB)).aiCalls, 0);
    assert.ok(gap2.body.yourSkills.some((s) => /docker/i.test(s.name)));

    // Worker B recalculates Recommendations deterministically with ZERO paid AI calls & marks Refresh Recommended!
    const rec2 = await api(workerB, 'POST', '/api/recommendations', { forceRefresh: false });
    assert.equal(rec2.status, 200);
    assert.equal(rec2.body.cacheMetadata.loadedFromCache, false);
    assert.equal(rec2.body.aiUsed, false);
    assert.equal(rec2.body.aiRefreshRecommended, true);
    assert.equal(rec2.body.aiStatus, 'Refresh Recommended');
    assert.equal((await counters(workerB)).aiCalls, 0);

    // Portfolio score invalidates previous input revision and updates.
    const port2 = await api(workerB, 'POST', '/api/analysis/portfolio-score', {});
    assert.equal(port2.status, 200);
    assert.notEqual(port2.body.fromCache, true);

    // 7. Unchanged-evidence Sync after expired TTL renews Analysis acceptedResult expiresAt without duplicating history.
    const beforeExpire = await Analysis.findOne({ userId: owner._id }).lean();
    const historyLen = beforeExpire.githubAnalysisHistory.length;
    await Analysis.updateOne(
      { _id: beforeExpire._id },
      {
        $set: {
          'githubSignals.acceptedResult.cache.expiresAt': new Date(Date.now() - 1000).toISOString()
        }
      }
    );
    const staleSaved = await api(workerB, 'POST', '/api/github/analyze-save', { savedOnly: true });
    assert.equal(staleSaved.body.cache.stale, true);
    const renewSync = await api(workerA, 'POST', '/api/github/analyze-save', {
      forceRefresh: true
    });
    assert.equal(renewSync.status, 200);
    const afterRenew = await api(workerB, 'POST', '/api/github/analyze-save', { savedOnly: true });
    assert.equal(afterRenew.status, 200);
    assert.equal(afterRenew.body.cache.stale, false);
    const renewedRecord = await Analysis.findOne({ userId: owner._id }).lean();
    assert.equal(renewedRecord.githubAnalysisHistory.length, historyLen);
    assert.deepEqual(renewedRecord.updatedAt, beforeExpire.updatedAt);
    assert.deepEqual(renewedRecord.githubSignals.analyzedAt, beforeExpire.githubSignals.analyzedAt);

    // 8. Owner isolation: other user cannot access owner's saved GitHub data even with same githubUsername.
    const otherSaved = await api(
      workerB,
      'POST',
      '/api/github/analyze-save',
      { savedOnly: true },
      otherToken
    );
    assert.equal(otherSaved.status, 404);

    // 9. Redis outage & recovery on Worker B: clear memory, point Worker B at closed Redis port, read from Mongo, then recover!
    await api(
      workerB,
      'POST',
      '/__control/state',
      { clearMemory: true, redisUrl: 'redis://127.0.0.1:1' },
      null
    );
    const recDuringOutage = await api(workerB, 'POST', '/api/recommendations', {
      forceRefresh: false
    });
    assert.equal(recDuringOutage.status, 200);
    assert.equal(recDuringOutage.body.cacheMetadata.cacheLayer, 'mongo');
    assert.equal(recDuringOutage.body.aiRefreshRecommended, true);

    await api(
      workerB,
      'POST',
      '/__control/state',
      { clearMemory: true, redisUrl: redisTarget.href },
      null
    );
    const recAfterRecover = await api(workerB, 'POST', '/api/recommendations', {
      forceRefresh: false
    });
    assert.equal(recAfterRecover.status, 200);

    const currentDashboard = await api(workerA, 'GET', '/api/dashboard/summary');
    assert.equal(currentDashboard.status, 200);
    assert.equal(currentDashboard.body.skillsSnapshot.coveragePercentage, gap2.body.coverage);
    assert.equal(currentDashboard.body.recommendationSnapshot.stale, false);
    assert.match(currentDashboard.body.recommendationSnapshot.message, /AI Refresh Recommended/);

    await api(workerB, 'POST', '/__control/state', { aiUnavailable: true }, null);
    const failedAi = await api(workerB, 'POST', '/api/recommendations', { forceRefresh: true });
    assert.equal(failedAi.status, 200);
    assert.equal(failedAi.body.aiRefreshRecommended, true);
    await api(workerB, 'POST', '/__control/state', { aiUnavailable: false }, null);
    const regenerated = await api(workerB, 'POST', '/api/recommendations', { forceRefresh: true });
    assert.equal(regenerated.status, 200);
    assert.equal(regenerated.body.aiUsed, true);
    assert.equal(regenerated.body.aiRefreshRecommended, false);
    await api(workerB, 'POST', '/__control/state', { aiUnavailable: true }, null);
    const preservedAi = await api(workerB, 'POST', '/api/recommendations', { forceRefresh: true });
    assert.equal(preservedAi.status, 200);
    assert.equal(preservedAi.body.aiUsed, true);
    assert.equal(preservedAi.body.aiRefreshRecommended, false);
    const dashAfterAi = await api(workerA, 'GET', '/api/dashboard/summary');
    assert.equal(dashAfterAi.status, 200);
    assert.equal(dashAfterAi.body.recommendationSnapshot.message, '');

    // 10. Resume files deterministic ordering & EmailRetryJob stale processing recovery.
    const sameUploadDate = new Date('2026-11-10T10:00:00.000Z');
    const rFile1 = await ResumeFile.create({
      userId: owner._id,
      fileName: 'older-created.pdf',
      fileUrl: '/tmp/a.pdf',
      fileSize: 10,
      uploadDate: sameUploadDate,
      createdAt: new Date('2026-11-10T10:00:00.000Z')
    });
    const rFile2 = await ResumeFile.create({
      userId: owner._id,
      fileName: 'newer-created.pdf',
      fileUrl: '/tmp/b.pdf',
      fileSize: 10,
      uploadDate: sameUploadDate,
      createdAt: new Date('2026-11-10T10:05:00.000Z')
    });
    const filesRes = await api(workerA, 'GET', '/api/resume/files');
    assert.equal(filesRes.status, 200);
    assert.equal(String(filesRes.body.files[0].fileId), String(rFile2._id));
    assert.equal(String(filesRes.body.files[1].fileId), String(rFile1._id));

    const {
      markJobInProgress,
      processDueJobs
    } = require('../../core/messaging/emailRetryQueueService');
    const stuckJob = await EmailDeliveryJob.create({
      invitationId: new mongoose.Types.ObjectId(),
      to: 'stuck@example.invalid',
      payload: { email: 'stuck@example.invalid' },
      status: 'processing',
      attempts: 0
    });
    await EmailDeliveryJob.updateOne(
      { _id: stuckJob._id },
      { $set: { updatedAt: new Date(Date.now() - 180_000) } },
      { timestamps: false }
    );
    assert.equal(await markJobInProgress(stuckJob._id), null);
    const pending = await EmailDeliveryJob.create({
      invitationId: new mongoose.Types.ObjectId(),
      to: 'pending@example.invalid',
      payload: { email: 'pending@example.invalid' }
    });
    const claims = await Promise.all([
      markJobInProgress(pending._id),
      markJobInProgress(pending._id)
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    await processDueJobs();
    const expiredJob = await EmailDeliveryJob.findById(stuckJob._id).lean();
    assert.equal(expiredJob.status, 'failed');
    assert.equal(expiredJob.attempts, 0);
    assert.match(expiredJob.lastError, /Delivery outcome unknown/);
    assert.equal((await EmailDeliveryJob.findById(pending._id).lean()).status, 'processing');
    await api(workerB, 'POST', '/__control/state', { aiUnavailable: false, aiDelayMs: 0 }, null);
    const upload = async (name) => {
      const pdf = new FormData();
      pdf.append(
        'file',
        new Blob(
          [
            textPDF(
              'Experienced backend developer using Node.js, Docker, TypeScript, SQL and automated testing to deliver measurable project results.'
            )
          ],
          { type: 'application/pdf' }
        ),
        name
      );
      const uploaded = await api(workerA, 'POST', '/api/resume/upload', pdf, otherToken);
      assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
      const file = await ResumeFile.findOne({
        _id: uploaded.body.fileId,
        userId: other._id
      }).lean();
      const uploadDir = path.resolve(__dirname, '../../../uploads');
      const ownedPath = path.resolve(file.fileUrl);
      assert.equal(path.dirname(ownedPath), uploadDir);
      assert.ok(path.basename(ownedPath).startsWith(String(other._id) + '-'));
      t.after(async () => {
        const entry = await fs.promises.lstat(ownedPath);
        assert.equal(entry.isFile(), true);
        await fs.promises.unlink(ownedPath);
      });
      return String(file._id);
    };
    const setDefault = (fileId) =>
      api(workerA, 'PUT', '/api/resume/active', { fileId, setAsDefault: true }, otherToken);
    const recommend = (worker, forceRefresh = false) =>
      api(worker, 'POST', '/api/recommendations', { forceRefresh }, otherToken);
    const saveAnalysis = (fileId, analyzedAt) =>
      ResumeAnalysis.create({
        userId: other._id,
        fileId,
        fileName: 'fixture.pdf',
        fileSize: 30,
        analyzedAt,
        scoring: { score: 81, ruleVersion: 'resume-overall-score-v1' },
        resumeSignals: { skills: ['Node.js', 'SQL', 'Docker'] }
      });

    const firstFile = await upload('default-first.pdf');
    assert.equal((await setDefault(firstFile)).status, 200);
    const firstAnalysis = await saveAnalysis(firstFile, new Date());
    const newFile = await upload('default-next.pdf');
    await api(workerA, 'POST', '/api/github/analyze-save', { forceRefresh: true }, otherToken);
    const context = await api(workerB, 'GET', '/api/resume/active', undefined, otherToken);
    assert.equal(context.body.defaultResume.fileId, firstFile);
    assert.equal(context.body.activeResume.fileId, firstFile);
    assert.equal(
      (await recommend(workerB)).body.resumeInsights.analysisId,
      String(firstAnalysis._id)
    );

    const firstEnrichment = await recommend(workerA, true);
    assert.equal(firstEnrichment.status, 200, JSON.stringify(firstEnrichment.body));
    assert.equal(firstEnrichment.body.aiUsed, true);
    assert.equal((await setDefault(newFile)).status, 200);
    const missing = await recommend(workerB);
    assert.equal(missing.status, 200);
    assert.equal(missing.body.cacheMetadata.cacheKey.resumeAnalysisId, 'no-resume');
    assert.equal(missing.body.sourceMetadata.resume.available, false);
    assert.equal(missing.body.aiRefreshRecommended, true);

    const holdAi = (worker) =>
      api(worker, 'POST', '/__control/state', { aiDelayMs: 1200, resetCounters: true }, null);
    const waitForAi = async (worker) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if ((await counters(worker)).aiCalls) return;
        await delay(20);
      }
      assert.fail('The fixture provider was never reached');
    };
    await holdAi(workerA);
    const duringAnalysis = recommend(workerA, true);
    await waitForAi(workerA);
    const accepted = await saveAnalysis(newFile, new Date());
    const lateHistorical = await saveAnalysis(newFile, new Date('2024-01-01T00:00:00.000Z'));
    assert.notEqual(String(accepted._id), String(lateHistorical._id));
    const conflict = await duringAnalysis;
    assert.equal(conflict.status, 409);
    assert.match(conflict.body.message, /Recommendation sources changed/);
    const aiBeforeRecovery = (await counters(workerA)).aiCalls + (await counters(workerB)).aiCalls;
    const recovered = await recommend(workerB);
    assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
    assert.equal(recovered.body.resumeInsights.analysisId, String(accepted._id));
    assert.equal(recovered.body.resumeInsights.fileId, newFile);
    assert.equal(recovered.body.aiRefreshRecommended, true);
    assert.equal(
      (await counters(workerA)).aiCalls + (await counters(workerB)).aiCalls,
      aiBeforeRecovery
    );
    const gapWithResume = await api(
      workerB,
      'POST',
      '/api/skillgap/skill-gap',
      { forceRefresh: false },
      otherToken
    );
    assert.equal(gapWithResume.status, 200, JSON.stringify(gapWithResume.body));
    assert.equal(gapWithResume.body.cacheMetadata.cacheKey.resumeAnalysisId, String(accepted._id));
    const portfolioWithResume = await api(
      workerB,
      'POST',
      '/api/analysis/portfolio-score',
      {},
      otherToken
    );
    assert.equal(portfolioWithResume.status, 200);
    assert.ok(
      await AnalysisCache.exists({
        userId: other._id,
        analysisVersion: 'portfolio-score-v1',
        resumeAnalysisId: String(accepted._id)
      })
    );
    const dashWithResume = await api(
      workerA,
      'GET',
      '/api/dashboard/summary',
      undefined,
      otherToken
    );
    assert.equal(dashWithResume.body.consistency.identity.resumeAnalysisId, String(accepted._id));
    assert.equal(
      dashWithResume.body.skillsSnapshot.coveragePercentage,
      gapWithResume.body.coverage
    );

    await holdAi(workerA);
    await api(workerB, 'POST', '/__control/state', { resetCounters: true }, null);
    const refresh = recommend(workerA, true);
    await waitForAi(workerA);
    const overlappingRefresh = recommend(workerB, true);
    const [enriched, joined] = await Promise.all([refresh, overlappingRefresh]);
    assert.equal(enriched.status, 200);
    assert.equal(joined.status, 200);
    assert.equal(enriched.body.aiUsed, true);
    assert.equal(enriched.body.aiRefreshRecommended, false);
    assert.equal(joined.body.aiRefreshRecommended, false);
    assert.equal((await counters(workerA)).aiCalls + (await counters(workerB)).aiCalls, 1);
    assert.equal((await recommend(workerB)).body.aiRefreshRecommended, false);
    await t.test(
      'Resume Analyzer default switch refreshes Recommendations in another tab',
      { skip: !process.env.DPA_PLAYWRIGHT_MODULE },
      async () => {
        await require('../fixtures/defaultResumeBrowser').verifyDefaultResumeTabs({
          workers,
          user: {
            _id: String(other._id),
            name: other.name,
            role: 'developer',
            activeGithubUsername: other.activeGithubUsername,
            activeCareerStack: other.activeCareerStack,
            activeExperienceLevel: other.activeExperienceLevel
          },
          token: otherToken,
          initialAnalysis: String(accepted._id),
          fileId: firstFile,
          analysisId: String(firstAnalysis._id)
        });
      }
    );
    assert.equal(
      (await api(workerB, 'PUT', '/api/resume/active', { fileId: newFile, setAsDefault: true }))
        .status,
      404
    );
  }
);
