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
  'saved snapshot operations: owner sources, stable refresh, revisions, PDF, resend quotas and uncertainty',
  { skip: process.env.WEEKLY_REPORT_TEST_MONGO !== '1', timeout: 120000 },
  async (t) => {
    const runtime = await startMongo({ replicaSet: 'weekly-refinement' });
    let server;
    const env = [
      'JWT_SECRET',
      'SENDGRID_API_KEY',
      'SENDGRID_FROM_EMAIL',
      'FRONTEND_BASE_URL',
      'WEEKLY_REPORT_TIMEZONE',
    ];
    const previous = Object.fromEntries(env.map((key) => [key, process.env[key]]));
    Object.assign(process.env, {
      JWT_SECRET: 'synthetic-local-weekly-test-secret-32-characters',
      SENDGRID_API_KEY: 'SG.synthetic-local-fixture.not-a-real-secret',
      SENDGRID_FROM_EMAIL: 'fixture@example.invalid',
      FRONTEND_BASE_URL: 'https://example.invalid',
      WEEKLY_REPORT_TIMEZONE: 'UTC',
    });
    const sendgrid = require('@sendgrid/mail');
    const originalSend = sendgrid.send;
    let messages = [];
    let ambiguous = false;
    sendgrid.send = async (message) => {
      messages.push(message);
      if (ambiguous) throw Error('Synthetic ambiguous provider result');
      return [{ statusCode: 202 }];
    };
    const ai = require('../services/aiservice');
    const originalAI = ai.runAIAnalysis;
    let aiCalls = 0;
    ai.runAIAnalysis = async (_prompt, fallback) => {
      aiCalls++;
      return fallback;
    };
    t.after(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
      sendgrid.send = originalSend;
      ai.runAIAnalysis = originalAI;
      for (const key of env)
        previous[key] === undefined ? delete process.env[key] : (process.env[key] = previous[key]);
      await mongoose.disconnect();
      await runtime.stop();
    });
    await mongoose.connect(runtime.uri);
    const User = require('../models/user');
    const Report = require('../models/weeklyReport');
    const Revision = require('../models/weeklyReportRevision');
    const State = require('../models/weeklyReportCoordination');
    const Progress = require('../models/userCourseProgress');
    const Session = require('../models/interviewPrepSession');
    await Promise.all([
      Report.init(),
      Revision.init(),
      State.init(),
      User.init(),
      require('../models/notification').init(),
      require('../models/notificationState').init(),
    ]);
    const owner = await User.create({
      name: 'Weekly owner',
      email: 'owner@example.invalid',
      providers: ['google'],
      authProvider: 'google',
      role: 'developer',
    });
    const other = await User.create({
      name: 'Other owner',
      email: 'other@example.invalid',
      providers: ['google'],
      authProvider: 'google',
      role: 'developer',
    });
    const { startOfWeek, endOfWeek } = require('../services/weeklyReportCalendar');
    const start = startOfWeek();
    const old = new Date(start.getTime() - 14 * 86400000);
    await Progress.collection.insertMany([
      {
        userId: owner._id,
        courseId: 'fixture-course',
        status: 'saved',
        course: {
          id: 'fixture-course',
          title: 'Synthetic learning',
          platform: 'coursera',
          url: 'https://example.invalid/course',
        },
        createdAt: old,
        updatedAt: old,
      },
      {
        userId: other._id,
        courseId: 'foreign-course',
        status: 'completed',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    await Session.collection.insertOne({
      userId: owner._id,
      questions: [{ question: 'Synthetic practice' }],
      status: 'practice',
      createdAt: old,
      updatedAt: old,
    });
    await require('../models/analysis').collection.insertOne({
      userId: owner._id,
      githubScore: 0,
      readinessScore: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await require('../models/repository').collection.insertOne({
      ownerId: owner._id,
      repoName: 'fixture',
      commits: 470,
      lastUpdated: old,
    });
    await Report.create({
      userId: owner._id,
      weekStartDate: old,
      weekEndDate: new Date(old.getTime() + 6 * 86400000),
      score: 90,
      progressSummary: 'Distant historical fixture',
      reportText: 'Unchanged historical snapshot',
      meta: { reportHash: 'f'.repeat(64) },
    });
    const weekly = require('../services/weeklyReportService');
    const firstStarted = performance.now();
    const first = await weekly.generateWeeklyReport(owner._id);
    const generationMs = performance.now() - firstStarted;
    assert.equal(first.meta.snapshot.learning.totalTracked, 1);
    assert.equal(first.meta.dataSourcesUsed.learning.available, true);
    assert.equal(first.meta.dataSourcesUsed.interviewPrep.analyzed, true);
    assert.equal(first.meta.dataSourcesUsed.interviewPrep.status, 'No activity this week');
    assert.equal(first.meta.interview.sessions, 0);
    assert.equal(first.meta.evidence.inputs.interview.value, 0);
    assert.equal(first.meta.evidence.inputs.github.value, 0);
    assert.equal(first.meta.evidence.inputs.resume.value, null);
    assert.equal(first.meta.evidence.measuredScore, null);
    assert.equal(first.meta.activity.commits, 470);
    assert.equal(first.meta.activity.weeklyCommitSignal, null);
    assert.equal(first.meta.activity.activeRepositories, 0);
    assert.equal(first.meta.comparison.available, false);
    assert.equal(first.meta.comparisons.scoreDelta, 0);
    assert.ok(
      first.recommendations.some((recommendation) =>
        recommendation.includes('Career Sprint before measuring weekly completion'),
      ),
    );
    assert.ok(
      first.recommendations.every((recommendation) => !recommendation.includes('70%')),
      'missing Sprint evidence must not produce a numeric completion target',
    );
    assert.equal(aiCalls, 1);
    const originalHash = first.meta.reportHash;
    const saved = await weekly.generateWeeklyReport(owner._id);
    assert.equal(saved.meta.reportHash, originalHash);
    assert.equal(aiCalls, 1);
    const refreshStarted = performance.now();
    const unchanged = await weekly.generateWeeklyReport(owner._id, {
      forceRefresh: true,
      emailIntent: false,
    });
    const unchangedRefreshMs = performance.now() - refreshStarted;
    assert.equal(unchanged.meta.reportHash, originalHash);
    assert.equal(unchanged.meta.version, 1);
    assert.equal(aiCalls, 1, 'unchanged refresh never calls AI');
    await Progress.updateOne(
      { userId: owner._id },
      { $set: { status: 'completed', completedAt: new Date() } },
    );
    const refreshed = await weekly.generateWeeklyReport(owner._id, {
      forceRefresh: true,
      emailIntent: false,
      expectedHash: originalHash,
      targetId: String(first._id),
    });
    assert.equal(String(refreshed._id), String(first._id));
    assert.equal(refreshed.meta.version, 2);
    assert.notEqual(refreshed.meta.reportHash, originalHash);
    assert.equal(aiCalls, 2);
    assert.equal(refreshed.meta.snapshot.learning.completedCount, 1);
    assert.equal(refreshed.emailDelivery.pendingContentHash, undefined);
    assert.equal(await Revision.countDocuments({ reportId: first._id }), 2);
    const archive = await require('../services/weeklyReportSnapshotService').getOwned(
      owner._id,
      String(first._id),
      originalHash,
    );
    assert.equal(archive.meta.snapshot.learning.completedCount, 0);
    assert.equal(archive.meta.version, 1);
    await assert.rejects(
      weekly.generateWeeklyReport(owner._id, {
        forceRefresh: true,
        expectedHash: originalHash,
        targetId: String(first._id),
      }),
      (error) => error.status === 409,
    );
    const find = Progress.find;
    Progress.find = () => {
      throw Error('Synthetic source unavailable');
    };
    try {
      await assert.rejects(
        weekly.generateWeeklyReport(owner._id, { forceRefresh: true }),
        /source unavailable/,
      );
    } finally {
      Progress.find = find;
    }
    assert.equal((await Report.findById(first._id)).meta.version, 2);
    const app = express();
    app.use(express.json());
    app.use('/api/weekly-reports', require('../routes/weeklyReport.routes'));
    server = await new Promise((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const token = (user) =>
      jwt.sign(
        { id: String(user._id), sv: Number(user.sessionRevision || 0) },
        process.env.JWT_SECRET,
        { issuer: 'devinsight-api', audience: 'devinsight-web', expiresIn: '1h' },
      );
    const call = (method, suffix, user = owner, body) =>
      fetch(`http://127.0.0.1:${server.address().port}/api/weekly-reports${suffix}`, {
        method,
        headers: {
          ...(user ? { Authorization: `Bearer ${token(user)}` } : {}),
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    assert.equal((await call('GET', `/${first._id}/pdf`, null)).status, 401);
    for (const suffix of [`/${first._id}`, `/${first._id}/pdf`])
      assert.equal((await call('GET', suffix, other)).status, 404);
    assert.equal((await call('POST', `/${first._id}/resend-email`, other)).status, 404);
    const oldReport = await Report.findOne({ userId: owner._id, weekStartDate: old });
    assert.equal((await call('POST', `/${oldReport._id}/refresh`, owner, {})).status, 409);
    const latestResponse = await call('GET', '/latest');
    const latestSnapshot = await latestResponse.json();
    assert.equal(latestSnapshot.meta.reportHash, refreshed.meta.reportHash);
    const detailResponse = await call('GET', `/${first._id}?version=${refreshed.meta.reportHash}`);
    const detailSnapshot = await detailResponse.json();
    assert.equal(detailSnapshot.meta.reportHash, refreshed.meta.reportHash);
    assert.equal(detailSnapshot.meta.version, 2);
    const currentPdfResponse = await call(
      'GET',
      `/${first._id}/pdf?version=${refreshed.meta.reportHash}`,
    );
    assert.equal(currentPdfResponse.status, 200);
    assert.match(currentPdfResponse.headers.get('cache-control'), /no-store/);
    const currentPdf = Buffer.from(await currentPdfResponse.arrayBuffer());
    const currentPdfText = await require('pdf-parse')(currentPdf);
    assert.ok(currentPdfText.text.includes(refreshed.meta.reportHash));
    assert.ok(currentPdfText.text.includes('Version 2'));
    assert.ok(currentPdfText.text.includes('Career Sprint before measuring weekly completion'));
    assert.ok(!currentPdfText.text.includes('70%'));
    const diagnostic = path.join(
      __dirname,
      '../../verification/weekly-reports/refinement-2026-11-11',
    );
    fs.mkdirSync(diagnostic, { recursive: true });
    fs.writeFileSync(path.join(diagnostic, 'authenticated-current-download.pdf'), currentPdf);
    const response = await call('GET', `/${first._id}/pdf?version=${originalHash}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(path.join(diagnostic, 'authenticated-download.pdf'), buffer);
    const parsed = await require('pdf-parse')(buffer);
    assert.ok(parsed.text.includes(originalHash));
    assert.ok(parsed.text.includes('Version 1'));
    assert.equal(
      (await call('POST', `/${first._id}/resend-email`, owner, { contentHash: originalHash }))
        .status,
      409,
    );
    const beforeSendAI = aiCalls;
    const successful = await call('POST', `/${first._id}/resend-email`, owner, {
      contentHash: refreshed.meta.reportHash,
    });
    assert.equal(successful.status, 200, await successful.text());
    assert.equal(aiCalls, beforeSendAI);
    assert.equal(messages.length, 1);
    assert.ok(messages[0].text.includes(refreshed.meta.reportHash));
    assert.ok(messages[0].text.includes('Career Sprint before measuring weekly completion'));
    assert.ok(!messages[0].text.includes('70%'));
    assert.ok(messages[0].html.includes(`version=${refreshed.meta.reportHash}`));
    assert.equal(
      (
        await call('POST', `/${first._id}/resend-email`, owner, {
          contentHash: refreshed.meta.reportHash,
        })
      ).status,
      429,
    );
    const quotaKey = `resend:${owner._id}:${start.toISOString()}`;
    for (let index = 0; index < 2; index++) {
      await State.updateOne({ _id: quotaKey }, { $set: { lastAttemptAt: new Date(0) } });
      assert.equal(
        (
          await call('POST', `/${first._id}/resend-email`, owner, {
            contentHash: refreshed.meta.reportHash,
          })
        ).status,
        200,
      );
    }
    await State.updateOne({ _id: quotaKey }, { $set: { lastAttemptAt: new Date(0) } });
    assert.equal(
      (
        await call('POST', `/${first._id}/resend-email`, owner, {
          contentHash: refreshed.meta.reportHash,
        })
      ).status,
      429,
    );
    assert.equal(messages.length, 3);
    await User.updateOne(
      { _id: owner._id },
      { $set: { 'notifications.weeklyScoreReport': false } },
    );
    assert.equal(
      (
        await require('../services/weeklyReportDeliveryService').deliver(
          refreshed,
          null,
          async () => {
            throw Error('preference bypass');
          },
          { resend: true },
        )
      ).sent,
      false,
    );
    await User.updateOne({ _id: owner._id }, { $set: { 'notifications.weeklyScoreReport': true } });
    await State.updateOne({ _id: quotaKey }, { $set: { count: 0, lastAttemptAt: new Date(0) } });
    ambiguous = true;
    await assert.rejects(
      weekly.sendWeeklyReportEmail(refreshed, null, { resend: true }),
      /ambiguous/,
    );
    const uncertain = await Report.findById(first._id).lean();
    assert.equal(uncertain.emailDelivery.status, 'uncertain');
    assert.equal(uncertain.emailDelivery.history.at(-1).status, 'uncertain');
    const callsBefore = messages.length;
    assert.equal(
      (await weekly.sendWeeklyReportEmail(refreshed, null, { resend: true })).sent,
      false,
    );
    assert.equal(messages.length, callsBefore);
    const output = path.join(__dirname, '../../verification/weekly-reports/refinement-2026-11-11');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(
      path.join(output, 'operations-results.json'),
      JSON.stringify(
        {
          passed: true,
          generationMs,
          unchangedRefreshMs,
          aiCalls,
          versions: await Revision.countDocuments({ reportId: first._id }),
          sentReservations: 3,
          syntheticMessages: messages.length,
          realProviderContacted: false,
          assertions: [
            'owner-scoped learning and historical interview evidence',
            'missing vs measured zero',
            'lifetime vs weekly activity',
            'no distant-week delta',
            'unchanged refresh skips AI',
            'immutable revisions and stale refresh rejection',
            'source failure preserves saved version',
            'latest dashboard, detail, authenticated PDF, and resend email share the saved hash',
            'authenticated archived PDF uses its immutable snapshot',
            'resend never invokes AI',
            'cooldown and weekly cap',
            'notification preference suppression',
            'uncertain outcome blocks retry',
          ],
        },
        null,
        2,
      ),
    );
  },
);
