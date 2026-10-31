const test = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { fork, execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const mongoose = require('mongoose');
const { performance } = require('node:perf_hooks');
const { startMongo } = require('./fixtures/disposableRequestMongo');

test(
  'notifications: disposable replica set, atomic production and two real workers',
  { timeout: 120000 },
  async (t) => {
    const runtime = await startMongo({
      replicaSet: 'notification-acceptance',
      temporaryRoot: path.resolve(__dirname, '../../verification/notifications')
    });
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    const workers = [];
    const controllers = [];
    const evidence = {
      baseline: '2254f090c6f1c8563ad2d7149ab081eeec09fc4c',
      checks: [],
      productionDataUsed: false
    };
    t.after(async () => {
      for (const controller of controllers) controller.abort();
      for (const worker of workers) {
        if (worker.exitCode !== null || worker.signalCode !== null) continue;
        const exited = new Promise((resolve) => worker.once('exit', resolve));
        worker.send({ action: 'stop' });
        const timeout = setTimeout(() => worker.kill(), 5000);
        await exited;
        clearTimeout(timeout);
      }
      await mongoose.disconnect();
      evidence.cleanup = await runtime.stop();
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
      const report = path.resolve(
        __dirname,
        '../../verification/notifications/integration-results.json'
      );
      fs.mkdirSync(path.dirname(report), { recursive: true });
      fs.writeFileSync(report, JSON.stringify(evidence, null, 2) + '\n');
    });
    await mongoose.connect(runtime.uri, { autoIndex: false, serverSelectionTimeoutMS: 2000 });
    const User = require('../models/user');
    const Notification = require('../models/notification');
    const State = require('../models/notificationState');
    const Receipt = require('../models/notificationReceipt');
    const Ticket = require('../models/supportTicket');
    const Membership = require('../models/membership');
    const Team = require('../models/team');
    for (const Model of [
      User,
      Notification,
      State,
      Receipt,
      Ticket,
      Membership,
      Team,
      require('../models/weeklyReport'),
      require('../models/supportTicketQuota'),
      require('../models/supportTicketDedupe')
    ]) {
      await Model.createCollection();
      await Model.createIndexes();
    }
    const service = require('../services/notificationService');
    const persistence = require('../services/notificationPersistenceService');
    const owner = await User.create({
      providers: ['google'],
      authProvider: 'google',
      name: 'Notification Owner',
      email: 'owner@notifications.test',
      role: 'developer',
      notifications: { newRecommendations: false }
    });
    const other = await User.create({
      providers: ['google'],
      authProvider: 'google',
      name: 'Other Owner',
      email: 'other@notifications.test',
      role: 'developer'
    });
    const admin = await User.create({
      providers: ['google'],
      authProvider: 'google',
      name: 'Support Admin',
      email: 'admin@notifications.test',
      role: 'admin'
    });
    const payload = {
      userId: owner._id,
      type: 'info',
      title: 'Synthetic activity',
      message: 'Synthetic notification for acceptance.'
    };

    await t.test('rollback never publishes notification, receipt or revision', async () => {
      await assert.rejects(
        persistence.transaction(async (session) => {
          await service.createNotification({ ...payload, eventId: 'rollback', session });
          throw Error('abort authoritative operation');
        }),
        /abort authoritative/
      );
      assert.equal(await Notification.countDocuments({ userId: owner._id }), 0);
      assert.equal(await Receipt.countDocuments({ userId: owner._id }), 0);
      assert.equal(await State.countDocuments({ _id: owner._id }), 0);
      evidence.checks.push('rollback PASS');
    });

    await t.test('database deduplication survives concurrency and inbox deletion', async () => {
      await Promise.all(
        Array.from({ length: 8 }, () =>
          service.createNotification({ ...payload, eventId: 'same-event' })
        )
      );
      assert.equal(await Notification.countDocuments({ userId: owner._id }), 1);
      assert.equal((await State.findById(owner._id)).revision, 1);
      await Notification.deleteOne({ userId: owner._id });
      assert.equal(await service.createNotification({ ...payload, eventId: 'same-event' }), null);
      assert.equal(await Notification.countDocuments({ userId: owner._id }), 0);
      evidence.checks.push('concurrent dedupe and tombstone PASS');
    });

    await t.test(
      'preferences gate activity; security and recipient authorization remain mandatory',
      async () => {
        assert.equal(
          await service.createNotification({ ...payload, preferenceKey: 'newRecommendations' }),
          null
        );
        assert.equal(
          await service.createNotification({
            ...payload,
            preferenceKey: 'newRecommendations',
            eventId: 'suppressed-stable'
          }),
          null
        );
        const security = await service.createNotification({
          ...payload,
          security: true,
          preferenceKey: 'newRecommendations',
          eventId: 'security'
        });
        assert.ok(security.security);
        await assert.rejects(
          service.createNotification({ ...payload, userId: new mongoose.Types.ObjectId() }),
          /unavailable/
        );
        await assert.rejects(
          service.createNotification({
            ...payload,
            meta: { target: 'javascript:alert(1)' },
            organizationId: new mongoose.Types.ObjectId()
          }),
          /scope/
        );
        const safe = await service.createNotification({
          ...payload,
          meta: { target: 'https://attacker.test', token: 'do-not-store' },
          eventId: 'safe-target'
        });
        assert.equal(safe.meta.target, '/app/notifications');
        assert.equal(safe.meta.token, undefined);
        evidence.checks.push('preferences security scope metadata PASS');
      }
    );

    async function worker() {
      const child = fork(path.join(__dirname, 'fixtures/notificationWorker.js'), [], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        env: { ...process.env, NOTIFICATION_TEST_URI: runtime.uri, NODE_ENV: 'test' }
      });
      workers.push(child);
      const port = await new Promise((resolve, reject) => {
        // Allow cold Windows module loading; product transaction and delivery deadlines remain unchanged.
        const timer = setTimeout(() => reject(Error('Worker readiness timeout')), 45000);
        child.on('message', (message) => {
          if (message.ready) {
            clearTimeout(timer);
            resolve(message.port);
          } else if (message.error && !message.id) {
            clearTimeout(timer);
            reject(Error(message.error));
          }
        });
        child.once('error', reject);
      });
      return { child, url: `http://127.0.0.1:${port}/api/notifications` };
    }
    const a = await worker();
    const b = await worker();
    const sessions = require('../utils/authSessionToken');
    let token = sessions.sign(owner, '10m');
    const otherToken = sessions.sign(other, '10m');
    const request = (server, suffix = '', method = 'GET', body, credential = token) =>
      fetch(server.url + suffix, {
        method,
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10000)
      });
    async function openStream() {
      const controller = new AbortController();
      controllers.push(controller);
      const response = await fetch(a.url + '/stream', {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal
      });
      assert.equal(response.status, 200);
      const reader = response.body.getReader();
      return { controller, reader };
    }
    async function frame(reader) {
      let value = '';
      const deadline = setTimeout(() => {
        for (const controller of controllers) controller.abort();
      }, 20000);
      try {
        while (!value.includes('data:')) {
          const chunk = await reader.read();
          if (chunk.done) throw Error('Stream ended before notification');
          value += new TextDecoder().decode(chunk.value);
        }
        return value;
      } finally {
        clearTimeout(deadline);
      }
    }
    async function command(child, action, input) {
      const id = randomBytes(8).toString('hex');
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Worker production timeout')), 10000);
        const receive = (message) => {
          if (message.id !== id) return;
          clearTimeout(timer);
          child.off('message', receive);
          if (message.error) reject(Error(message.error));
          else resolve(message.result);
        };
        child.on('message', receive);
        child.send({ id, action, payload: input });
      });
    }
    const createInWorker = (child, input) => command(child, 'create', input);

    await t.test(
      'two processes deliver committed events, coalesce and reconcile after reconnect',
      async () => {
        const stream = await openStream();
        assert.match(await frame(stream.reader), /event: connected/);
        const started = performance.now();
        await createInWorker(b.child, {
          ...payload,
          userId: String(owner._id),
          eventId: 'worker-event'
        });
        const signal = await frame(stream.reader);
        assert.match(signal, /event: notification/);
        assert.doesNotMatch(signal, /Synthetic|notifications.test/);
        evidence.crossWorkerDeliveryMs = performance.now() - started;
        stream.controller.abort();
        await createInWorker(b.child, {
          ...payload,
          userId: String(owner._id),
          eventId: 'offline-event'
        });
        const reconnected = await openStream();
        assert.match(await frame(reconnected.reader), /event: connected/);
        const inbox = await (await request(a)).json();
        assert.equal(inbox.notifications.length, 4);
        reconnected.controller.abort();
        evidence.checks.push('real two-process delivery and reconnect PASS');
      }
    );

    await t.test(
      'HTTP ownership, bulk actions, counts, cursor ties and session revocation',
      async () => {
        const personal = await Notification.findOne({ userId: owner._id }).lean();
        assert.equal(
          (await request(a, '?userId=' + owner._id, 'GET', null, otherToken)).status,
          403
        );
        assert.equal(
          (await request(a, `/${personal._id}/read`, 'PUT', {}, otherToken)).status,
          404
        );
        assert.equal(
          (await request(a, '/bulk-delete', 'POST', { ids: [String(personal._id)] }, otherToken))
            .status,
          200
        );
        assert.ok(await Notification.exists({ _id: personal._id }));
        assert.equal((await request(a, '/stream?token=' + token, 'GET', null, '')).status, 401);
        assert.equal(
          (await request(a, '/bulk-delete', 'POST', { ids: Array(101).fill(String(personal._id)) }))
            .status,
          400
        );
        const before = await (await request(a)).json();
        await request(a, `/${personal._id}/read`, 'PUT', {});
        const after = await (await request(a)).json();
        assert.equal(after.unreadCount, before.unreadCount - 1);
        assert.equal(after.revision, before.revision + 1);
        const firstPage = await (await request(a, '?limit=2')).json();
        const nextPage = await (await request(a, '?limit=2&cursor=' + firstPage.nextCursor)).json();
        assert.equal(
          new Set([...firstPage.notifications, ...nextPage.notifications].map((row) => row._id))
            .size,
          4
        );
        assert.equal((await request(a, '?cursor=malformed')).status, 400);
        await request(a, '/read-all', 'PUT', {});
        assert.equal((await (await request(a)).json()).unreadCount, 0);
        await User.updateOne({ _id: owner._id }, { $inc: { sessionRevision: 1 } });
        assert.equal((await request(a)).status, 401);
        owner.sessionRevision = 1;
        token = sessions.sign(owner, '10m');
        assert.equal((await request(a)).status, 200);
        evidence.checks.push('HTTP IDOR bulk cursor counts session PASS');
      }
    );

    await t.test(
      'Help creation, status, email failure and restart receipts are durable',
      async () => {
        const support = require('../services/support.service');
        const ticket = await support.createTicket(owner, {
          category: 'bug',
          priority: 'medium',
          subject: 'Private synthetic ticket subject',
          message: 'Synthetic support test body'
        });
        const notice = await Notification.findOne({
          userId: owner._id,
          'meta.ticketId': String(ticket._id)
        }).lean();
        assert.ok(notice);
        assert.doesNotMatch(notice.message, /Private synthetic/);
        await support.updateTicketStatus(ticket._id, 'resolved', admin._id);
        const count = await Notification.countDocuments({ 'meta.ticketId': String(ticket._id) });
        await support.updateTicketStatus(ticket._id, 'resolved', admin._id);
        assert.equal(
          await Notification.countDocuments({ 'meta.ticketId': String(ticket._id) }),
          count
        );
        const originalInbox = process.env.SUPPORT_INBOX_EMAIL;
        process.env.SUPPORT_INBOX_EMAIL = 'support@notifications.test';
        try {
          await Ticket.updateOne(
            { _id: ticket._id },
            {
              $set: { 'emailDelivery.status': 'pending', 'emailDelivery.nextAttemptAt': new Date() }
            }
          );
          const delivery = require('../services/supportNotificationDeliveryService');
          await delivery.processDue(async () => {
            throw Object.assign(Error('provider offline'), { code: 'ECONNREFUSED' });
          });
          assert.equal((await Ticket.findById(ticket._id)).emailDelivery.status, 'retrying');
          await Ticket.updateOne(
            { _id: ticket._id },
            { $set: { 'emailDelivery.nextAttemptAt': new Date() } }
          );
          await delivery.processDue(async () => {
            throw Error('unknown SMTP outcome');
          });
          assert.equal((await Ticket.findById(ticket._id)).emailDelivery.status, 'uncertain');
        } finally {
          if (originalInbox === undefined) delete process.env.SUPPORT_INBOX_EMAIL;
          else process.env.SUPPORT_INBOX_EMAIL = originalInbox;
        }
        evidence.checks.push('Help atomic creation status and operational email receipts PASS');
      }
    );

    await t.test(
      'organization/team filters never expose personal or revoked organizational data',
      async () => {
        const orgId = new mongoose.Types.ObjectId();
        const teamId = new mongoose.Types.ObjectId();
        const foreignOrg = new mongoose.Types.ObjectId();
        await Team.collection.insertOne({ _id: teamId, organizationId: orgId, isActive: true });
        await Membership.collection.insertMany([
          {
            userId: owner._id,
            organizationId: orgId,
            teamId: null,
            status: 'active',
            role: 'member'
          },
          { userId: owner._id, organizationId: orgId, teamId, status: 'active', role: 'member' },
          {
            userId: other._id,
            organizationId: orgId,
            teamId: null,
            status: 'active',
            role: 'admin'
          }
        ]);
        await service.createNotification({
          ...payload,
          organizationId: orgId,
          teamId,
          eventId: 'team-event'
        });
        const scoped = await (await request(a, `?organizationId=${orgId}&teamId=${teamId}`)).json();
        assert.equal(scoped.notifications.length, 1);
        assert.equal(scoped.notifications[0].organizationId, String(orgId));
        assert.equal(
          (
            await request(
              a,
              `?organizationId=${orgId}&teamId=${teamId}&userId=${owner._id}`,
              'GET',
              null,
              otherToken
            )
          ).status,
          403
        );
        assert.equal(
          (await request(a, `?organizationId=${foreignOrg}&teamId=${teamId}`)).status,
          403
        );
        await Membership.updateMany(
          { userId: owner._id, organizationId: orgId },
          { $set: { status: 'disabled' } }
        );
        assert.equal((await request(a, `?organizationId=${orgId}`)).status, 403);
        const inbox = await (await request(a)).json();
        assert.ok(inbox.notifications.every((notice) => notice.organizationId !== String(orgId)));
        evidence.checks.push('organization team and revocation isolation PASS');
      }
    );

    await t.test(
      'Mongo transport interruption closes streams and committed data reconciles on recovery',
      async () => {
        const stream = await openStream();
        await frame(stream.reader);
        await command(a.child, 'disconnect');
        const disconnected = await stream.reader.read();
        assert.equal(disconnected.done, true);
        const missedId = await createInWorker(b.child, {
          ...payload,
          userId: String(owner._id),
          eventId: 'during-outage'
        });
        await command(a.child, 'recover');
        const recovered = await openStream();
        assert.match(await frame(recovered.reader), /connected/);
        assert.ok(
          (await (await request(a)).json()).notifications.some((notice) => notice._id === missedId)
        );
        recovered.controller.abort();
        evidence.checks.push('Mongo disconnect fail-closed and recovery PASS');
      }
    );

    await t.test('short-lived and revoked sessions terminate already-open streams', async () => {
      const previousToken = token;
      token = sessions.sign(owner, '2s');
      const short = await openStream();
      await frame(short.reader);
      const ended = await short.reader.read();
      assert.equal(ended.done, true);
      token = previousToken;
      const revoked = await openStream();
      await frame(revoked.reader);
      await User.updateOne({ _id: owner._id }, { $inc: { sessionRevision: 1 } });
      await command(a.child, 'reconcile');
      assert.equal((await revoked.reader.read()).done, true);
      owner.sessionRevision = 2;
      token = sessions.sign(owner, '10m');
      evidence.checks.push('active stream expiry and session revocation PASS');
    });

    await t.test(
      'idempotency survives a process restart and Redis is never an admission authority',
      async () => {
        const child = b.child;
        await new Promise((resolve) => {
          child.once('exit', resolve);
          child.send({ action: 'stop' });
        });
        const restarted = await worker();
        const before = await Notification.countDocuments({ userId: owner._id });
        await createInWorker(restarted.child, {
          ...payload,
          userId: String(owner._id),
          eventId: 'worker-event'
        });
        assert.equal(await Notification.countDocuments({ userId: owner._id }), before);
        const redis = require('../services/redisCacheService');
        const original = redis.getRedisCacheClient;
        const originalEnabled = redis.isRedisCacheEnabled;
        redis.isRedisCacheEnabled = () => true;
        redis.getRedisCacheClient = () => {
          throw Error('Redis unavailable');
        };
        try {
          await service.createNotification({ ...payload, eventId: 'redis-independent' });
        } finally {
          redis.getRedisCacheClient = original;
          redis.isRedisCacheEnabled = originalEnabled;
        }
        evidence.checks.push('real process restart and Redis outage independence PASS');
      }
    );

    await t.test(
      'Profile preference writes and mandatory password notices share authoritative transactions',
      async () => {
        const controller = require('../controllers/profilecontroller');
        const { response } = require('./fixtures/publicPortfolioFixture');
        const updated = response();
        await controller.updateProfile(
          { user: owner, body: { notifications: { newRecommendations: true } } },
          updated
        );
        assert.equal(updated.statusCode, 200);
        assert.equal((await User.findById(owner._id)).notifications.newRecommendations, true);
        assert.equal(
          await service.createNotification({
            ...payload,
            preferenceKey: 'newRecommendations',
            eventId: 'suppressed-stable'
          }),
          null
        );
        const fresh = await service.createNotification({
          ...payload,
          preferenceKey: 'newRecommendations',
          eventId: 'preference-updated'
        });
        assert.ok(fresh);
        const originalCreate = Notification.create;
        Notification.create = async () => {
          throw Error('Synthetic notification write failure');
        };
        try {
          const failed = response();
          await controller.updateProfile({ user: owner, body: { name: 'Must roll back' } }, failed);
          assert.equal(failed.statusCode, 500);
          assert.equal((await User.findById(owner._id)).name, 'Notification Owner');
        } finally {
          Notification.create = originalCreate;
        }
        const bcrypt = require('bcryptjs');
        await User.updateOne(
          { _id: owner._id },
          {
            $set: {
              password: await bcrypt.hash('Synthetic-before-42!', 4),
              providers: ['local'],
              'notifications.newRecommendations': false
            }
          }
        );
        const passwordResponse = response();
        passwordResponse.cookie = () => passwordResponse;
        await controller.updatePassword(
          {
            user: owner,
            body: { currentPassword: 'Synthetic-before-42!', newPassword: 'Synthetic-after-42!' }
          },
          passwordResponse
        );
        assert.equal(passwordResponse.statusCode, 200);
        assert.ok(
          await Notification.exists({
            userId: owner._id,
            title: 'Password Updated',
            security: true
          })
        );
        const secured = await User.findById(owner._id).select('+password');
        const resetToken = require('jsonwebtoken').sign(
          { id: String(owner._id), purpose: 'reset-password' },
          `${process.env.JWT_SECRET}${secured.password}`,
          { expiresIn: '2m' }
        );
        const resetResponse = response();
        await require('../controllers/authcontroller').resetPassword(
          { body: { resetToken, newPassword: 'Synthetic-reset-after-42!' } },
          resetResponse
        );
        assert.equal(resetResponse.statusCode, 200);
        assert.ok(
          await Notification.exists({ userId: owner._id, title: 'Password Reset', security: true })
        );
        const replay = response();
        await require('../controllers/authcontroller').resetPassword(
          { body: { resetToken, newPassword: 'Synthetic-replay-after-42!' } },
          replay
        );
        assert.equal(replay.statusCode, 400);
        owner.sessionRevision = 4;
        token = sessions.sign(owner, '10m');
        evidence.checks.push(
          'real Profile preference rollback, password update/reset and reset replay PASS'
        );
      }
    );

    await t.test(
      'weekly email claims prevent duplicate sends and retain ambiguous outcomes',
      async () => {
        const Report = require('../models/weeklyReport');
        const delivery = require('../services/weeklyReportDeliveryService');
        const report = await Report.create({
          userId: owner._id,
          weekStartDate: new Date('2026-10-19'),
          weekEndDate: new Date('2026-10-26'),
          score: 50,
          progressSummary: 'Synthetic summary',
          reportText: 'Synthetic report',
          meta: { reportHash: 'synthetic-hash' }
        });
        let sends = 0;
        const provider = async () => {
          sends++;
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { sent: true };
        };
        await Promise.all(
          Array.from({ length: 6 }, () => delivery.deliver(report, owner, provider))
        );
        assert.equal(sends, 1);
        await delivery.deliver(report, owner, provider);
        assert.equal(sends, 1);
        await Report.updateOne(
          { _id: report._id },
          {
            $set: {
              'emailDelivery.status': 'pending',
              'emailDelivery.contentHash': 'different-hash',
              'emailDelivery.nextAttemptAt': new Date()
            }
          }
        );
        await assert.rejects(
          delivery.deliver(report, owner, async () => {
            sends++;
            throw Error('unknown provider result');
          }),
          /unknown provider/
        );
        assert.equal((await Report.findById(report._id)).emailDelivery.status, 'uncertain');
        await delivery.deliver(report, owner, provider, { resend: true });
        assert.equal(sends, 2);
        const weekly = require('../services/weeklyReportService');
        await Report.updateOne(
          { _id: report._id },
          { $set: { 'meta.reportHash': 'newer-synthetic-hash' } }
        );
        assert.equal(
          await weekly.updateWeeklyReportEmailStatus(report._id, {
            status: 'sent',
            contentHash: 'synthetic-hash'
          }),
          null
        );
        assert.equal((await Report.findById(report._id)).emailStatus, 'skipped');
        const ai = require('../services/aiservice');
        const originalAI = ai.runAIAnalysis;
        ai.runAIAnalysis = async (_prompt, fallback) => fallback;
        try {
          const generated = await weekly.generateWeeklyReport(owner._id, { forceRefresh: true });
          await Report.updateOne(
            { _id: generated._id },
            {
              $set: {
                'emailDelivery.status': 'uncertain',
                'emailDelivery.leaseId': 'synthetic-unresolved'
              }
            }
          );
          const refreshed = await weekly.generateWeeklyReport(owner._id, { forceRefresh: true });
          assert.equal(String(refreshed._id), String(generated._id));
          assert.equal(refreshed.emailDelivery.status, 'uncertain');
          assert.equal(refreshed.emailDelivery.leaseId, 'synthetic-unresolved');
        } finally {
          ai.runAIAnalysis = originalAI;
        }
        evidence.checks.push(
          'weekly email concurrent claims, stale-outcome fencing and report availability during uncertainty PASS'
        );
      }
    );

    await t.test('account deletion removes owned inbox receipts and revision', async () => {
      const deletion = require('../services/accountDeletionService');
      const collections = [
        ...deletion.ownedModels,
        'organization',
        'publicProfile',
        'publicProfileCache',
        'publicProfileView',
        'publicPortfolioVisit',
        'accountDeletionCleanup',
        'storedAsset',
        'Candidate',
        'repository',
        'sprintPreference',
        'sprintSchedule',
        'RecruiterMatch',
        'RecruiterShortlist',
        'Job',
        'integrationConnection',
        'integrationInsight',
        'integrationSyncLog',
        'integrationLinkedProfile'
      ];
      for (const name of new Set(collections))
        await require(`../models/${name}`).createCollection();
      const retiring = await User.create({
        name: 'Disposable privacy fixture',
        email: 'retiring@notifications.test',
        providers: ['google']
      });
      await service.createNotification({
        ...payload,
        userId: retiring._id,
        eventId: 'privacy-owned-event'
      });
      const otherCount = await Notification.countDocuments({ userId: owner._id });
      await deletion.deleteAccount(retiring._id);
      assert.equal(await Notification.countDocuments({ userId: retiring._id }), 0);
      assert.equal(await Receipt.countDocuments({ userId: retiring._id }), 0);
      assert.equal(await State.countDocuments({ _id: retiring._id }), 0);
      assert.equal(await Notification.countDocuments({ userId: owner._id }), otherCount);
      await assert.rejects(
        service.createNotification({ ...payload, userId: retiring._id }),
        /unavailable/
      );
      evidence.checks.push('real account deletion receipt and cursor cleanup PASS');
    });

    await t.test(
      'indexes support ordered bounded reads and security quotas do not use Redis',
      async () => {
        const timings = [];
        const started = performance.now();
        for (let index = 0; index < 25; index++) {
          const begin = performance.now();
          await service.createNotification({ ...payload, eventId: `capacity-sample:${index}` });
          timings.push(performance.now() - begin);
        }
        timings.sort((left, right) => left - right);
        evidence.persistenceSample = {
          count: 25,
          p50Ms: timings[12],
          p95Ms: timings[23],
          eventsPerSecond: 25000 / (performance.now() - started),
          workload:
            'sequential single recipient; local disposable replica; not a production capacity claim'
        };
        const authorizedScope = await require('../controllers/notificationcontroller').scope({
          user: owner,
          query: {}
        });
        const explanation = await Notification.find(authorizedScope)
          .sort({ createdAt: -1, _id: -1 })
          .limit(2)
          .explain('executionStats');
        evidence.inboxQuery = {
          returned: explanation.executionStats.nReturned,
          examined: explanation.executionStats.totalDocsExamined,
          keys: explanation.executionStats.totalKeysExamined
        };
        assert.equal(explanation.executionStats.nReturned, 2);
        assert.ok(explanation.executionStats.totalDocsExamined <= 2);
        assert.ok(
          (await Notification.collection.indexes()).every(
            (index) => index.expireAfterSeconds === undefined
          ),
          'No notification TTL policy was introduced'
        );
        const migration = await require('../scripts/migrateNotificationIndexes').migrate();
        assert.ok(migration.results.every((result) => result.missing.length === 0));
        const auditUri = runtime.uri.replace(
          '/integration_live_acceptance?',
          '/notification_audit_only?'
        );
        assert.match(auditUri, /\/notification_audit_only\?/);
        await new Promise((resolve, reject) =>
          execFile(
            process.execPath,
            [path.resolve(__dirname, '../scripts/migrateNotificationIndexes.js')],
            {
              env: {
                ...process.env,
                NOTIFICATION_MIGRATION_URI: auditUri,
                NODE_DISABLE_COMPILE_CACHE: '1'
              },
              windowsHide: true,
              timeout: 15000
            },
            (error, stdout) => {
              if (error) return reject(error);
              try {
                assert.equal(JSON.parse(stdout).apply, false);
                resolve();
              } catch (failure) {
                reject(failure);
              }
            }
          )
        );
        assert.equal(
          (
            await mongoose.connection
              .getClient()
              .db('notification_audit_only')
              .listCollections()
              .toArray()
          ).length,
          0,
          'Audit-only CLI must not create collections'
        );
        evidence.auditOnlyMigrationPreservesEmptyDatabase = true;
        const governance = require('../services/integrationMongoGovernanceService');
        const leases = [];
        for (let index = 0; index < 6; index++)
          leases.push(await governance.notificationStream(other._id));
        await assert.rejects(
          governance.notificationStream(other._id),
          (error) => error.status === 429
        );
        for (const lease of leases) await governance.release(lease);
        const identity = 'a'.repeat(64);
        for (let index = 0; index < 3; index++)
          await governance.requestWindow(`notifications:v1:rate:read:${identity}`, 2, 60000);
        assert.equal(
          (await governance.requestWindow(`notifications:v1:rate:read:${identity}`, 2, 60000))
            .count,
          3
        );
        evidence.checks.push('index bounded reads and Mongo-only admission PASS');
      }
    );
  }
);
