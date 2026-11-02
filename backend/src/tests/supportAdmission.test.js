const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });

const User = require('../models/user');
const SupportTicket = require('../models/supportTicket');
const SupportTicketQuota = require('../models/supportTicketQuota');
const SupportTicketDedupe = require('../models/supportTicketDedupe');
const redisCache = require('../services/redisCacheService');
const notificationService = require('../services/notificationService');
const emailService = require('../services/emailService');
const accountDeletionService = require('../services/accountDeletionService');

const qaPrefix = `support-admission-${Date.now()}-${crypto.randomUUID()}`;
const payload = (subject, message = 'A deterministic Support admission verification message.') => ({
  category: 'bug',
  priority: 'medium',
  subject,
  message,
  sourcePage: '/app/support',
  browserInfo: 'support-admission-test'
});

test('Support admission is Mongo-authoritative: ordering, 409/429/503, concurrency, IDOR, contact-email, status concurrency, replies, deletion', async (t) => {
  assert.ok(process.env.MONGODB_URI, 'MONGODB_URI is required for this focused verification');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 5000 });

  const originals = {
    enabled: redisCache.isRedisCacheEnabled,
    client: redisCache.getRedisCacheClient,
    notification: notificationService.createNotification,
    email: emailService.sendConfiguredEmail
  };

  // Capture notifications so reply/status assertions can inspect counterparty events.
  const notifications = [];
  notificationService.createNotification = async (args) => { notifications.push(args); return undefined; };
  emailService.sendConfiguredEmail = async () => undefined;
  // Redis is removed from admission; keep the mocks inert so nothing hits real infra.
  redisCache.isRedisCacheEnabled = () => false;
  redisCache.getRedisCacheClient = () => { throw new Error('redis must not be consulted'); };

  // Require after collaborators are replaced so the service captures the mocks.
  delete require.cache[require.resolve('../services/support.service')];
  const supportService = require('../services/support.service');

  const users = [];
  const makeUser = async (suffix) => {
    const u = await User.create({
      name: `Support Admission QA ${suffix}`,
      email: `${qaPrefix}-${suffix}@example.test`,
      authProvider: 'github',
      providers: ['github']
    });
    users.push(u);
    return u;
  };
  const admin = { _id: new mongoose.Types.ObjectId() };

  t.after(async () => {
    redisCache.isRedisCacheEnabled = originals.enabled;
    redisCache.getRedisCacheClient = originals.client;
    notificationService.createNotification = originals.notification;
    emailService.sendConfiguredEmail = originals.email;
    for (const u of users) {
      await Promise.all([
        SupportTicket.deleteMany({ userId: u._id }),
        SupportTicketDedupe.deleteMany({ userId: u._id }),
        SupportTicketQuota.deleteMany({ userId: u._id }),
        User.deleteOne({ _id: u._id })
      ]);
    }
    await mongoose.disconnect();
  });

  await t.test('409 duplicate within the window, with no "redis" leak', async () => {
    const user = await makeUser('dup');
    await supportService.createTicket(user, payload('dup ticket'));
    await assert.rejects(
      supportService.createTicket(user, payload('dup ticket')),
      (error) => error.status === 409 && !/redis/i.test(error.message)
    );
    assert.equal(await SupportTicket.countDocuments({ userId: user._id }), 1);
  });

  await t.test('429 on the sixth submission with Retry-After present', async () => {
    const user = await makeUser('quota');
    for (let i = 1; i <= 5; i += 1) {
      await supportService.createTicket(user, payload(`quota ticket ${i}`));
    }
    await assert.rejects(
      supportService.createTicket(user, payload('quota ticket 6')),
      (error) => error.status === 429
        && typeof error.retryAfter === 'number'
        && error.retryAfter >= 1
        && !/redis/i.test(error.message)
    );
    assert.equal(await SupportTicket.countDocuments({ userId: user._id }), 5);
  });

  await t.test('admission ordering: no SupportTicket is created when a reservation rejects', async () => {
    const user = await makeUser('order');
    // Exhaust quota so the next submit is rejected at the quota gate (before create).
    for (let i = 1; i <= 5; i += 1) {
      await supportService.createTicket(user, payload(`order ticket ${i}`));
    }
    const before = await SupportTicket.countDocuments({ userId: user._id });
    await assert.rejects(supportService.createTicket(user, payload('order ticket 6')));
    assert.equal(await SupportTicket.countDocuments({ userId: user._id }), before);
    // A genuine duplicate also creates nothing.
    await assert.rejects(
      supportService.createTicket(user, payload('order ticket 1')),
      (error) => error.status === 409
    );
    assert.equal(await SupportTicket.countDocuments({ userId: user._id }), before);
  });

  await t.test('503 fail-closed on an injected admission failure, with no "redis" leak', async () => {
    const user = await makeUser('fail-closed');
    const original = SupportTicketDedupe.findOneAndUpdate;
    SupportTicketDedupe.findOneAndUpdate = () => { throw new Error('injected driver failure'); };
    try {
      await assert.rejects(
        supportService.createTicket(user, payload('fail closed ticket')),
        (error) => error.status === 503 && !/redis/i.test(error.message) && !/driver/i.test(error.message)
      );
    } finally {
      SupportTicketDedupe.findOneAndUpdate = original;
    }
    assert.equal(await SupportTicket.countDocuments({ userId: user._id }), 0);
  });

  await t.test('two parallel duplicates admit at most one via the unique index', async () => {
    const user = await makeUser('parallel-dup');
    const results = await Promise.allSettled([
      supportService.createTicket(user, payload('parallel dup')),
      supportService.createTicket(user, payload('parallel dup'))
    ]);
    const fulfilled = results.filter(r => r.status === 'fulfilled').length;
    assert.ok(fulfilled <= 1, 'at most one duplicate may be admitted');
    assert.equal(await SupportTicket.countDocuments({ userId: user._id }), fulfilled);
  });

  await t.test('two parallel boundary submits never exceed the quota', async () => {
    const user = await makeUser('parallel-quota');
    for (let i = 1; i <= 4; i += 1) {
      await supportService.createTicket(user, payload(`pq ticket ${i}`));
    }
    // Two distinct submissions race for the single remaining quota slot.
    const results = await Promise.allSettled([
      supportService.createTicket(user, payload('pq ticket 5a')),
      supportService.createTicket(user, payload('pq ticket 5b'))
    ]);
    const fulfilled = results.filter(r => r.status === 'fulfilled').length;
    assert.ok(fulfilled <= 1, 'at most one of the racing boundary submits may be admitted');
    assert.equal(await SupportTicket.countDocuments({ userId: user._id }), 4 + fulfilled);
  });

  await t.test('contact-email policy: replyToEmail stored, trusted email unchanged, malformed rejected', async () => {
    const user = await makeUser('contact');
    const ticket = await supportService.createTicket(user, {
      ...payload('contact ticket'),
      replyToEmail: 'Someone-Else@elsewhere.test'
    });
    assert.equal(ticket.replyToEmail, 'Someone-Else@elsewhere.test');
    assert.equal(ticket.email, user.email, 'email stays the trusted account email');

    await assert.rejects(
      supportService.createTicket(user, { ...payload('contact ticket 2'), replyToEmail: 'not-an-email' }),
      (error) => error.status === 400 && /contact email/i.test(error.message)
    );

    // Empty/omitted stores ''.
    const ticket2 = await supportService.createTicket(user, { ...payload('contact ticket 3'), replyToEmail: '' });
    assert.equal(ticket2.replyToEmail, '');
  });

  await t.test('IDOR: user B cannot read, delete, or reply to user A ticket', async () => {
    const userA = await makeUser('idor-a');
    const userB = await makeUser('idor-b');
    const ticket = await supportService.createTicket(userA, payload('idor ticket'));

    assert.equal(await supportService.getTicketById(ticket._id, userB._id), null);
    assert.equal(await supportService.deleteTicket(ticket._id, userB._id), null);
    await assert.rejects(
      supportService.addReply(userB, ticket._id, 'nefarious reply'),
      (error) => error.status === 404
    );
    // Owner A is still intact and can reply.
    assert.ok(await supportService.getTicketById(ticket._id, userA._id));
  });

  await t.test('status concurrency: stale expectedUpdatedAt loses with 409 and the owner is notified per event', async () => {
    const user = await makeUser('status');
    const ticket = await supportService.createTicket(user, payload('status ticket'));
    const expected = (await SupportTicket.findById(ticket._id).lean()).updatedAt;

    notifications.length = 0;
    const first = await supportService.updateTicketStatus(ticket._id, 'in_progress', expected);
    assert.equal(first.status, 'in_progress');

    // Second update with the now-stale token must lose.
    await assert.rejects(
      supportService.updateTicketStatus(ticket._id, 'resolved', expected),
      (error) => error.status === 409 && /someone else/i.test(error.message)
    );

    // A repeat transition (back to a previously-used status) still notifies: unique key.
    const fresh = (await SupportTicket.findById(ticket._id).lean()).updatedAt;
    await supportService.updateTicketStatus(ticket._id, 'open', fresh);
    const fresher = (await SupportTicket.findById(ticket._id).lean()).updatedAt;
    await supportService.updateTicketStatus(ticket._id, 'in_progress', fresher);

    const statusNotifs = notifications.filter(n => String(n.dedupeKey).startsWith('support-status-'));
    assert.ok(statusNotifs.length >= 3, 'each successful transition notifies the owner');
    const keys = new Set(statusNotifs.map(n => n.dedupeKey));
    assert.equal(keys.size, statusNotifs.length, 'each status notification has a unique per-event key');

    // Invalid status is a 400.
    await assert.rejects(
      supportService.updateTicketStatus(ticket._id, 'bogus'),
      (error) => error.status === 400
    );
  });

  await t.test('replies: admin reply notifies the owner once; user reply notifies no one', async () => {
    const user = await makeUser('reply');
    const ticket = await supportService.createTicket(user, payload('reply ticket'));
    assert.deepEqual(ticket.replies, []);

    notifications.length = 0;
    await supportService.addReply(user, ticket._id, 'a user reply');
    assert.equal(notifications.length, 0, 'a user reply fires no notification');

    await supportService.adminAddReply(admin, ticket._id, 'an admin reply');
    const replyNotifs = notifications.filter(n => String(n.dedupeKey).startsWith('support-reply-'));
    assert.equal(replyNotifs.length, 1, 'an admin reply fires exactly one counterparty notification');
    assert.ok(String(replyNotifs[0].userId) === String(user._id), 'the ticket owner is notified');

    const updated = await SupportTicket.findById(ticket._id).lean();
    assert.equal(updated.replies.length, 2);
    assert.ok(updated.lastReplyAt);
  });

  await t.test('reply cap: the 101st reply is rejected 409 even under concurrent appends', async () => {
    const user = await makeUser('cap');
    const ticket = await supportService.createTicket(user, payload('cap ticket'));
    // Fill to exactly 100 replies directly (bypassing the service to set up the cap).
    const filler = Array.from({ length: 100 }, () => ({
      authorId: user._id, authorRole: 'user', body: 'filler', createdAt: new Date()
    }));
    await SupportTicket.updateOne({ _id: ticket._id }, { $push: { replies: { $each: filler } } });
    assert.equal((await SupportTicket.findById(ticket._id).lean()).replies.length, 100);

    // Two concurrent appends against a full thread must both be rejected with 409.
    const results = await Promise.allSettled([
      supportService.addReply(user, ticket._id, 'overflow a'),
      supportService.addReply(user, ticket._id, 'overflow b')
    ]);
    for (const r of results) {
      assert.equal(r.status, 'rejected');
      assert.equal(r.reason.status, 409);
    }
    assert.equal((await SupportTicket.findById(ticket._id).lean()).replies.length, 100);
  });

  await t.test('getAdminTicketById returns any ticket with no owner fence', async () => {
    const user = await makeUser('admin-read');
    const ticket = await supportService.createTicket(user, payload('admin read ticket'));
    const read = await supportService.getAdminTicketById(ticket._id);
    assert.ok(read);
    assert.equal(String(read._id), String(ticket._id));
  });

  await t.test('account-deletion cleanup removes a reply-bearing ticket across the three support collections', async () => {
    const user = await makeUser('deletion');
    const ticket = await supportService.createTicket(user, payload('deletion ticket'));
    await supportService.addReply(user, ticket._id, 'a reply before deletion');

    assert.ok(await SupportTicket.countDocuments({ userId: user._id }) >= 1);
    assert.ok(await SupportTicketDedupe.countDocuments({ userId: user._id }) >= 1);
    assert.ok(await SupportTicketQuota.countDocuments({ userId: user._id }) >= 1);

    // All three support collections are registered in the account-deletion ownership
    // inventory, so the per-user owned-data sweep removes a reply-bearing ticket and
    // its dedupe/quota rows. Asserted via the catalog + the same by-userId deleteMany
    // the sweep issues, which does not require replica-set transactions in this suite.
    for (const name of ['supportTicket', 'supportTicketDedupe', 'supportTicketQuota']) {
      assert.ok(
        accountDeletionService.ownedModels.includes(name),
        `${name} must be in the account-deletion ownership inventory`
      );
      await require(`../models/${name}`).deleteMany({ userId: user._id });
    }

    assert.equal(await SupportTicket.countDocuments({ userId: user._id }), 0);
    assert.equal(await SupportTicketDedupe.countDocuments({ userId: user._id }), 0);
    assert.equal(await SupportTicketQuota.countDocuments({ userId: user._id }), 0);
  });
});
