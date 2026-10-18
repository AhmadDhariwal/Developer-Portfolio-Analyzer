'use strict';

// Separate OS process for database/Redis consistency verification; fixture owner only.
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });
const mongoose = require('mongoose');
mongoose.set('bufferCommands', false);
const {
  initRedisCache,
  getRedisCacheClient,
  closeRedisCache,
  isRedisCacheEnabled
} = require('../../services/redisCacheService');
const owner = process.env.CAREER_SPRINT_TEST_OWNER;
if (!/^[a-f0-9]{24}$/.test(owner || '')) throw new Error('An isolated fixture owner is required.');
const prefix = `career-sprint-test:${owner}:`;
const writtenKeys = new Set();
let redis;
let releaseWrite;
let holdNextWrite = false;
const mock = (request, exports) => {
  const file = require.resolve(request);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
mock('../../services/aiservice', {
  getSharedCache: async (key, namespace) => {
    if (!isRedisCacheEnabled()) throw new Error('Redis unavailable');
    const value = await redis.get(prefix + namespace + ':' + key);
    return value ? JSON.parse(value) : null;
  },
  setSharedCache: async (key, value, ttl, namespace) => {
    if (holdNextWrite) {
      holdNextWrite = false;
      await new Promise((resolve) => {
        releaseWrite = resolve;
      });
    }
    if (!isRedisCacheEnabled()) throw new Error('Redis unavailable');
    const ownedKey = prefix + namespace + ':' + key;
    writtenKeys.add(ownedKey);
    await redis.set(ownedKey, JSON.stringify(value), { EX: ttl });
  }
});
mock('../../services/developerSignalService', { getDeveloperSignals: async () => ({}) });
const sprint = require('../../services/careerSprintService');
const ready = (async () => {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    autoIndex: false,
    autoCreate: false
  });
  await initRedisCache({ silent: true });
  redis = getRedisCacheClient();
  process.send({ ready: true, redis: Boolean(isRedisCacheEnabled()) });
})();
process.on('message', async (message) => {
  try {
    await ready;
    let value;
    if (message.action === 'read')
      value = await sprint.getCurrentSprint(owner, { forceRefresh: Boolean(message.forceRefresh) });
    else if (message.action === 'complete')
      value = await sprint.toggleTaskCompletion(owner, message.sprintId, message.taskId, true);
    else if (message.action === 'create')
      value = await sprint.createSprint({ userId: owner, ...message.payload });
    else if (message.action === 'hold') {
      holdNextWrite = true;
      value = true;
    } else if (message.action === 'release') {
      releaseWrite?.();
      releaseWrite = null;
      await new Promise((resolve) => setTimeout(resolve, 30));
      value = true;
    } else if (message.action === 'offline') {
      await closeRedisCache();
      value = true;
    } else if (message.action === 'databaseOffline') {
      await mongoose.disconnect();
      value = true;
    } else if (message.action === 'stop') {
      let cleanupError;
      try {
        releaseWrite?.();
        if (isRedisCacheEnabled() && writtenKeys.size) {
          // Fixture teardown is not a measured cache operation. Use one exact-key
          // transaction so remote latency cannot leave the process or keys behind.
          const transaction = await redis.multi();
          let cleanupTimer;
          try {
            await Promise.race([
              transaction.del([...writtenKeys]).exec(),
              new Promise((_, reject) => {
                cleanupTimer = setTimeout(() => reject(new Error('Fixture cleanup timed out.')), 3000);
              })
            ]);
          } finally {
            clearTimeout(cleanupTimer);
          }
        }
      } catch (error) {
        cleanupError = { statusCode: 500, message: `Fixture cleanup failed: ${error.code || error.message}` };
      } finally {
        await closeRedisCache();
        await mongoose.disconnect();
        // Flush the final IPC reply before exiting, including cleanup failures.
        process.send({ id: message.id, ...(cleanupError ? { error: cleanupError } : { value: true }) }, () =>
          process.exit(cleanupError ? 1 : 0)
        );
      }
      return;
    } else throw new Error('Unknown test action');
    process.send({
      id: message.id,
      value: value?._id
        ? {
            _id: String(value._id),
            xpPoints: value.xpPoints,
            level: value.level,
            tasks: value.tasks,
            cacheMetadata: value.cacheMetadata
          }
        : value
    });
  } catch (error) {
    process.send({
      id: message.id,
      error: { statusCode: error.statusCode || 500, message: 'Fixture operation failed' }
    });
  }
});
ready.catch((error) => {
  process.send({
    ready: false,
    error: 'Fixture worker could not initialize.',
    errorType: error.name,
    codes: [...(error.reason?.servers?.values() || [])].map(
      (server) => server.error?.cause?.code || server.error?.code || null
    )
  });
  process.exit(1);
});
