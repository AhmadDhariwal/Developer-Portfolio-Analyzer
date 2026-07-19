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

const WINDOW_MS = 10 * 60 * 1000;
const qaPrefix = `support-redis-fallback-${Date.now()}-${crypto.randomUUID()}`;
const hash = (subject, message) => crypto.createHash('sha256')
  .update(`${subject.toLowerCase()}\n${message.toLowerCase()}`)
  .digest('hex');
const payload = (subject, message = 'A deterministic Support fallback verification message.') => ({
  category: 'bug',
  priority: 'medium',
  subject,
  message,
  sourcePage: '/app/support',
  browserInfo: 'support-redis-fallback-test'
});

test('Support uses Mongo as the durable authority when Redis fails and recovers', async (t) => {
  assert.ok(process.env.MONGODB_URI, 'MONGODB_URI is required for this focused verification');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 5000 });

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
    if (user?._id) {
      await Promise.all([
        SupportTicket.deleteMany({ userId: user._id }),
        SupportTicketDedupe.deleteMany({ userId: user._id }),
        SupportTicketQuota.deleteMany({ userId: user._id }),
        User.deleteOne({ _id: user._id })
      ]);
    }
    await mongoose.disconnect();
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
