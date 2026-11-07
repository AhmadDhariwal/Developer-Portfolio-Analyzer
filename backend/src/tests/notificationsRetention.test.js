const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { fork } = require('node:child_process');
const mongoose = require('mongoose');
const express = require('express');
const { startMongo } = require('./fixtures/disposableRequestMongo');

test(
  'Notifications bounded Clear All and inactive retention acceptance',
  { timeout: 180000 },
  async (t) => {
    const output = path.resolve(
      process.env.NOTIFICATION_VERIFICATION_DIRECTORY ||
        path.join(__dirname, '../../verification/notifications')
    );
    const runtime = await startMongo({
      replicaSet: 'notification-retention',
      temporaryRoot: output
    });
    const original = { ...process.env };
    const workers = [];
    let server;
    const evidence = { productionDataUsed: false, historicalDataDeleted: false, checks: [] };
    t.after(async () => {
      for (const child of workers) {
        if (child.exitCode !== null || child.signalCode !== null) continue;
        child.send({ action: 'stop' });
        await new Promise((resolve) => {
          child.once('exit', resolve);
          const timeout = setTimeout(() => {
            child.kill();
            resolve();
          }, 5000);
          timeout.unref();
        });
      }
      server?.closeAllConnections();
      if (server) await new Promise((resolve) => server.close(resolve));
      await mongoose.disconnect();
      evidence.cleanup = await runtime.stop();
      for (const name of Object.keys(process.env))
        if (!(name in original)) delete process.env[name];
      Object.assign(process.env, original);
      fs.writeFileSync(
        path.join(output, 'retention-results.json'),
        JSON.stringify(evidence, null, 2) + '\n'
      );
    });
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    for (const key of Object.keys(process.env))
      if (key.startsWith('NOTIFICATION_RETENTION_')) delete process.env[key];
    await mongoose.connect(runtime.uri, { autoIndex: false });
    const User = require('../models/user');
    const Notification = require('../models/notification');
    const State = require('../models/notificationState');
    const Receipt = require('../models/notificationReceipt');
    const Lease = require('../models/integrationGovernanceState');
    for (const Model of [
      User,
      Notification,
      State,
      Receipt,
      Lease,
      require('../models/membership')
    ]) {
      await Model.createCollection();
      await Model.createIndexes();
    }
    const owner = await User.create({
      name: 'Retention Owner',
      email: 'retention@example.test',
      providers: ['google'],
      role: 'developer'
    });
    const other = await User.create({
      name: 'Other Owner',
      email: 'other-retention@example.test',
      providers: ['google'],
      role: 'developer'
    });
    const sessions = require('../utils/authSessionToken');
    const token = sessions.sign(owner, '1h');
    const otherToken = sessions.sign(other, '1h');
    const service = require('../services/notificationService');
    const retention = require('../services/notificationRetentionService');
    const app = express();
    app.use(express.json());
    app.use('/api/notifications', require('../routes/notification.routes'));
    server = await new Promise((resolve) => {
      const handle = app.listen(0, '127.0.0.1', () => resolve(handle));
    });
    const url = `http://127.0.0.1:${server.address().port}/api/notifications`;
    const request = (suffix = '', method = 'GET', body, credential = token) =>
      fetch(url + suffix, {
        method,
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10000)
      });
    const daysAgo = (days) => new Date(Date.now() - days * 86400000);

    await t.test(
      'policy defaults inactive, requires approval and never creates notification TTL',
      async () => {
        assert.equal(retention.configuration().enabled, false);
        assert.equal(retention.configuration().readDays, 90);
        assert.equal(retention.configuration().unreadDays, 180);
        assert.throws(
          () => retention.configuration({ NOTIFICATION_RETENTION_ENABLED: 'true' }),
          /approval/
        );
        assert.throws(
          () => retention.configuration({ NOTIFICATION_RETENTION_BATCH_SIZE: '101' }),
          /Invalid/
        );
        assert.deepEqual(await retention.runOnce(), { disabled: true, deletedCount: 0 });
        assert.ok(
          (await Notification.collection.indexes()).every(
            (index) => index.expireAfterSeconds === undefined
          )
        );
        evidence.checks.push('Disabled/approval/configuration and no notification TTL PASS');
      }
    );

    await t.test(
      'notification allocation and revision roll back atomically with their source transaction',
      async () => {
        const persistence = require('../services/notificationPersistenceService');
        await assert.rejects(
          persistence.transaction(async (session) => {
            await service.createNotification({
              userId: owner._id,
              type: 'info',
              title: 'Rollback',
              message: 'Synthetic',
              eventId: 'rollback:revision',
              session
            });
            throw Error('Synthetic source failure');
          }),
          /Synthetic source failure/
        );
        assert.equal(await Notification.countDocuments({ userId: owner._id }), 0);
        assert.equal(await Receipt.countDocuments({ userId: owner._id }), 0);
        assert.equal(await State.countDocuments({ _id: owner._id }), 0);
        evidence.checks.push('Source/notification/revision/receipt atomic rollback PASS');
      }
    );

    let clearToken;
    let durable;
    await t.test(
      'Clear All is bounded, private and preserves receipts and new cross-worker revisions',
      async () => {
        await Notification.insertMany(
          Array.from({ length: 205 }, (_, index) => ({
            userId: owner._id,
            type: 'info',
            title: `Old ${index}`,
            message: 'Synthetic',
            inboxRevision: 1,
            createdAt: daysAgo(1)
          }))
        );
        await State.create({ _id: owner._id, revision: 1, changedAt: new Date() });
        durable = await service.createNotification({
          userId: owner._id,
          type: 'info',
          title: 'Durable event',
          message: 'Synthetic',
          eventId: 'retention:durable'
        });
        const foreign = await service.createNotification({
          userId: other._id,
          type: 'info',
          title: 'Other',
          message: 'Private',
          eventId: 'other:event'
        });
        assert.equal(
          (await request('/clear-all', 'POST', { userId: String(other._id) })).status,
          403
        );
        assert.equal((await request('/clear-all', 'POST', { clearToken: 'invalid' })).status, 400);
        assert.equal(
          (await request('/clear-all', 'POST', { clearToken: 'x'.repeat(2049) })).status,
          400
        );
        const first = await request('/clear-all', 'POST', {});
        assert.equal(first.status, 200);
        const result = await first.json();
        clearToken = result.clearToken;
        assert.equal(result.deletedCount, 100);
        assert.equal(result.deletedIds.length, 100);
        assert.equal(result.hasMore, true);
        assert.equal((await request('/clear-all', 'POST', { clearToken }, otherToken)).status, 403);
        assert.equal((await request('', 'GET', undefined, clearToken)).status, 401);
        const newNotice = await service.createNotification({
          userId: owner._id,
          type: 'info',
          title: 'New activity',
          message: 'Must survive',
          eventId: 'retention:new'
        });
        // A backdated creation timestamp cannot bypass the durable revision boundary.
        await Notification.collection.updateOne(
          { _id: newNotice._id },
          { $set: { createdAt: daysAgo(10) } }
        );
        let more = true;
        let requests = 0;
        while (more && requests++ < 4) {
          const response = await request('/clear-all', 'POST', { clearToken });
          assert.equal(response.status, 200);
          const batch = await response.json();
          assert.ok(batch.deletedCount <= 100);
          more = batch.hasMore;
        }
        assert.equal(more, false);
        assert.equal(await Notification.countDocuments({ userId: owner._id }), 1);
        assert.ok(await Notification.exists({ _id: newNotice._id }));
        assert.ok(await Notification.exists({ _id: foreign._id }));
        assert.equal(
          await service.createNotification({
            userId: owner._id,
            type: 'info',
            title: 'Durable event',
            message: 'Synthetic',
            eventId: 'retention:durable'
          }),
          null
        );
        assert.ok(await Receipt.exists({ notificationId: durable._id }));
        assert.equal(
          (
            await request('/clear-all', 'POST', {
              organizationId: String(new mongoose.Types.ObjectId())
            })
          ).status,
          403
        );
        evidence.checks.push(
          'Bounded Clear All, recipient/token isolation, new revision preservation and receipt tombstone PASS'
        );
      }
    );

    await t.test(
      'individual and selected deletion plus mark-read keep existing owner isolation',
      async () => {
        const one = await service.createNotification({
          userId: owner._id,
          type: 'info',
          title: 'Selected',
          message: 'Synthetic',
          eventId: 'selected:event'
        });
        const foreign = await Notification.findOne({ userId: other._id }).lean();
        assert.equal((await request(`/${one._id}/read`, 'PUT', {})).status, 200);
        const deleted = await request('/bulk-delete', 'POST', {
          ids: [String(one._id), String(foreign._id)]
        });
        assert.equal((await deleted.json()).deletedCount, 1);
        assert.equal((await request(`/${foreign._id}`, 'DELETE')).status, 200);
        assert.ok(await Notification.exists({ _id: foreign._id }));
        evidence.checks.push('Existing read/single/selected deletion and privacy PASS');
      }
    );

    const activate = () =>
      Object.assign(process.env, {
        NOTIFICATION_RETENTION_ENABLED: 'true',
        NOTIFICATION_RETENTION_POLICY_APPROVED: 'true'
      });
    await t.test(
      'expired records disappear from feed/count before physical cleanup; security and legacy survive',
      async () => {
        const rows = await Notification.insertMany([
          {
            userId: owner._id,
            type: 'info',
            title: 'Expired read',
            message: 'Synthetic',
            security: false,
            isRead: true,
            createdAt: daysAgo(91)
          },
          {
            userId: owner._id,
            type: 'info',
            title: 'Expired unread',
            message: 'Synthetic',
            security: false,
            isRead: false,
            createdAt: daysAgo(181)
          },
          {
            userId: owner._id,
            type: 'info',
            title: 'Retained read',
            message: 'Synthetic',
            security: false,
            isRead: true,
            createdAt: daysAgo(89)
          },
          {
            userId: owner._id,
            type: 'info',
            title: 'Retained unread',
            message: 'Synthetic',
            security: false,
            isRead: false,
            createdAt: daysAgo(179)
          },
          {
            userId: owner._id,
            type: 'profile_update',
            title: 'Security',
            message: 'Synthetic',
            security: true,
            createdAt: daysAgo(1000)
          }
        ]);
        const legacy = await Notification.collection.insertOne({
          userId: owner._id,
          type: 'info',
          title: 'Unclassified legacy',
          message: 'Synthetic',
          isRead: false,
          createdAt: daysAgo(1000)
        });
        const before = await (await request()).json();
        activate();
        const after = await (await request()).json();
        assert.equal(before.total - after.total, 2);
        assert.equal(before.unreadCount - after.unreadCount, 1);
        assert.ok(!after.notifications.some((item) => item.title.startsWith('Expired')));
        assert.ok(after.notifications.some((item) => item.title === 'Security'));
        assert.ok(after.notifications.some((item) => item.title === 'Unclassified legacy'));
        assert.ok(await Notification.exists({ _id: rows[0]._id }));
        assert.deepEqual(await retention.runOnce(), { disabled: true, deletedCount: 0 });
        const nowRead = await request(`/${rows[3]._id}/read`, 'PUT', {});
        assert.equal(nowRead.status, 200);
        const readFeed = await (await request()).json();
        assert.equal(readFeed.total, after.total - 1);
        assert.ok(await Notification.exists({ _id: legacy.insertedId }));
        evidence.checks.push(
          'Expiry feed/count visibility, read-state transition, explicit security/legacy exclusion PASS'
        );
      }
    );

    await t.test(
      'inactive account activity uses ordinary policy while audit history stays separate',
      async () => {
        process.env.NOTIFICATION_RETENTION_WORKER_ENABLED = 'true';
        const inactive = await User.create({
          name: 'Inactive',
          email: 'inactive@example.test',
          providers: ['google'],
          role: 'developer',
          isActive: false
        });
        const notice = await Notification.create({
          userId: inactive._id,
          type: 'info',
          title: 'Old activity',
          message: 'Synthetic',
          security: false,
          isRead: true,
          createdAt: daysAgo(100)
        });
        const audit = await mongoose.connection
          .collection('auditlogs')
          .insertOne({ marker: 'retention-policy-exclusion' });
        await retention.runOnce();
        assert.equal(await Notification.exists({ _id: notice._id }), null);
        assert.ok(
          await mongoose.connection.collection('auditlogs').findOne({ _id: audit.insertedId })
        );
        assert.ok(await User.exists({ _id: inactive._id, isActive: false }));
        evidence.checks.push(
          'Inactive account activity expires; audit history and account records remain PASS'
        );
      }
    );

    await t.test(
      'bounded scheduled cleanup preserves receipts, other policy records and supports multi-worker fencing',
      async () => {
        process.env.NOTIFICATION_RETENTION_WORKER_ENABLED = 'true';
        const expired = await service.createNotification({
          userId: owner._id,
          type: 'info',
          title: 'Receipt expiry',
          message: 'Synthetic',
          eventId: 'receipt:expired'
        });
        await Notification.collection.updateOne(
          { _id: expired._id },
          { $set: { createdAt: daysAgo(200) } }
        );
        const result = await retention.runOnce();
        assert.ok(result.deletedCount > 0 && result.deletedCount <= 100);
        assert.equal(await Notification.exists({ _id: expired._id }), null);
        assert.ok(await Receipt.exists({ notificationId: expired._id }));
        assert.equal(
          await service.createNotification({
            userId: owner._id,
            type: 'info',
            title: 'Receipt expiry',
            message: 'Synthetic',
            eventId: 'receipt:expired'
          }),
          null
        );
        assert.ok(await Notification.exists({ userId: owner._id, security: true }));
        const rawLegacy = await Notification.collection.findOne({
          userId: owner._id,
          title: 'Unclassified legacy'
        });
        assert.ok(rawLegacy);
        await Notification.insertMany(
          Array.from({ length: 220 }, (_, index) => ({
            userId: owner._id,
            type: 'info',
            title: `Batch ${index}`,
            message: 'Synthetic',
            security: false,
            isRead: true,
            createdAt: daysAgo(100)
          }))
        );
        const plan = await Notification.find({
          security: false,
          isRead: true,
          createdAt: { $lte: daysAgo(90) }
        })
          .select('_id userId createdAt')
          .sort({ createdAt: 1, _id: 1 })
          .hint('notification_retention_scan')
          .limit(100)
          .explain('executionStats');
        assert.equal(plan.executionStats.nReturned, 100);
        assert.ok(plan.executionStats.totalDocsExamined <= 100);
        assert.ok(plan.executionStats.totalKeysExamined <= 101);
        evidence.indexScan = {
          returned: plan.executionStats.nReturned,
          examined: plan.executionStats.totalDocsExamined,
          keys: plan.executionStats.totalKeysExamined
        };
        const startWorker = async () => {
          const child = fork(path.join(__dirname, 'fixtures/notificationWorker.js'), [], {
            windowsHide: true,
            stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
            env: { ...process.env, NOTIFICATION_TEST_URI: runtime.uri, NODE_ENV: 'test' }
          });
          workers.push(child);
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(Error('Worker startup timeout')), 45000);
            child.once('message', (message) => {
              clearTimeout(timer);
              message.ready ? resolve() : reject(Error('Worker startup failed'));
            });
            child.once('error', reject);
          });
          return child;
        };
        const a = await startWorker();
        const b = await startWorker();
        let sequence = 0;
        const call = (child) =>
          new Promise((resolve, reject) => {
            const id = ++sequence;
            const timer = setTimeout(() => reject(Error('Worker response timeout')), 15000);
            const receive = (message) => {
              if (message.id !== id) return;
              clearTimeout(timer);
              child.off('message', receive);
              message.error ? reject(Error(message.error)) : resolve(message.result);
            };
            child.on('message', receive);
            child.send({ id, action: 'retention' });
          });
        await Lease.create({
          _id: 'notifications:retention:v1',
          expiresAt: new Date(Date.now() + 60000),
          leases: [{ token: 'fixture-owner', until: new Date(Date.now() + 60000) }]
        });
        const blocked = await Promise.all([call(a), call(b)]);
        assert.ok(blocked.every((item) => item.busy));
        await Lease.updateOne(
          { _id: 'notifications:retention:v1', 'leases.token': 'fixture-owner' },
          { $set: { expiresAt: new Date(Date.now() - 1) } }
        );
        const before = await Notification.countDocuments(retention.expiredFilter());
        const concurrent = await Promise.all([call(a), call(b)]);
        const removed = concurrent.reduce((sum, item) => sum + (item.deletedCount || 0), 0);
        assert.ok(concurrent.every((item) => (item.deletedCount || 0) <= 100));
        assert.equal(
          before - (await Notification.countDocuments(retention.expiredFilter())),
          removed
        );
        assert.ok(await Notification.exists({ userId: other._id }));
        evidence.multiWorker = concurrent;
        evidence.checks.push(
          'Bounded worker cleanup, durable receipt non-recreation, security/legacy exclusion, two-process lease fencing PASS'
        );
      }
    );
    await t.test(
      'Mongo disconnection fails closed and reconnect recovery remains available',
      async () => {
        await mongoose.disconnect();
        await assert.rejects(retention.runOnce(), /database unavailable/);
        await mongoose.connect(runtime.uri, { autoIndex: false });
        const result = await retention.runOnce();
        assert.ok(result.deletedCount <= 100);
        evidence.checks.push('Mongo failure and recovery without fallback authority PASS');
      }
    );
  }
);
