const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const { startMongo } = require('./fixtures/disposableRequestMongo');

const User = require('../models/user');
const SupportTicket = require('../models/supportTicket');
const SupportTicketQuota = require('../models/supportTicketQuota');
const SupportTicketDedupe = require('../models/supportTicketDedupe');
const redisCache = require('../services/redisCacheService');
const notificationService = require('../services/notificationService');
const emailService = require('../services/emailService');

const qaPrefix = `support-redis-fallback-${Date.now()}-${crypto.randomUUID()}`;
const payload = (subject, message = 'A deterministic Support fallback verification message.') => ({
  category: 'bug',
  priority: 'medium',
  subject,
  message,
  sourcePage: '/app/support',
  browserInfo: 'support-redis-fallback-test'
});

test('Support uses Mongo as the durable authority when Redis fails and recovers', async (t) => {
  const runtime = await startMongo({ replicaSet: 'support-merge-test' });
  t.after(async () => {
    await mongoose.disconnect();
    await runtime.stop();
  });
  await mongoose.connect(runtime.uri, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 5000 });
  for (const Model of [User, SupportTicket, SupportTicketQuota, SupportTicketDedupe]) {
    await Model.init();
  }

  let user;
  const originals = {
    enabled: redisCache.isRedisCacheEnabled,
    client: redisCache.getRedisCacheClient,
    notification: notificationService.createNotification,
    email: emailService.sendConfiguredEmail
  };
  const redisValues = new Map();
  let redisHealthy = true;
  const redis = {
    async set(key, value, options) {
      if (!redisHealthy) throw new Error('redis test transport failure');
      if (options?.NX && redisValues.has(key)) return null;
      redisValues.set(key, value);
      return 'OK';
    },
    async incr(key) {
      if (!redisHealthy) throw new Error('redis test transport failure');
      const next = Number(redisValues.get(key) || 0) + 1;
      redisValues.set(key, String(next));
      return next;
    },
    async expire() {
      if (!redisHealthy) throw new Error('redis test transport failure');
      return 1;
    },
    async del(key) {
      if (!redisHealthy) throw new Error('redis test transport failure');
      return Number(redisValues.delete(key));
    }
  };

  t.after(async () => {
    redisCache.isRedisCacheEnabled = originals.enabled;
    redisCache.getRedisCacheClient = originals.client;
    notificationService.createNotification = originals.notification;
    emailService.sendConfiguredEmail = originals.email;
    // The isolated database and all test data are removed by the runtime cleanup.
  });

  redisCache.isRedisCacheEnabled = () => true;
  redisCache.getRedisCacheClient = () => redis;
  notificationService.createNotification = async () => undefined;
  emailService.sendConfiguredEmail = async () => undefined;
  // Require after dependencies are replaced: the service captures its collaborators.
  delete require.cache[require.resolve('../services/support.service')];
  const supportService = require('../services/support.service');

  user = await User.create({
    name: 'Support Redis QA',
    email: `${qaPrefix}@example.test`,
    authProvider: 'github',
    providers: ['github']
  });

  // Establish five accepted records while Redis is healthy; Mongo receives the
  // dedupe reservation and quota increment for every accepted ticket.
  for (let index = 1; index <= 5; index += 1) {
    await supportService.createTicket(user, payload(`${qaPrefix} ticket ${index}`));
  }
  assert.equal(await SupportTicket.countDocuments({ userId: user._id }), 5);
  assert.equal((await SupportTicketQuota.findOne({ userId: user._id }).lean()).count, 5);

  const duplicate = payload(`${qaPrefix} ticket 1`);
  redisHealthy = false;
  await assert.rejects(
    supportService.createTicket(user, duplicate),
    (error) => error.status === 409 && !/redis/i.test(error.message)
  );
  await assert.rejects(
    supportService.createTicket(user, payload(`${qaPrefix} sixth ticket`)),
    (error) => error.status === 429 && !/redis/i.test(error.message)
  );

  redisHealthy = true;
  await assert.rejects(
    supportService.createTicket(user, duplicate),
    (error) => error.status === 409 && !/redis/i.test(error.message)
  );
  await assert.rejects(
    supportService.createTicket(user, payload(`${qaPrefix} seventh ticket`)),
    (error) => error.status === 429 && !/redis/i.test(error.message)
  );

  assert.equal(await SupportTicket.countDocuments({ userId: user._id }), 5);
  assert.equal(await SupportTicketDedupe.countDocuments({ userId: user._id }), 5);
  assert.equal(await SupportTicketQuota.countDocuments({ userId: user._id }), 1);
});
