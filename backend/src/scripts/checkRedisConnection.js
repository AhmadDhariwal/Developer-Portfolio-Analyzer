require('dotenv').config({ quiet: true });

const {
  initRedisCache,
  pingRedisCache,
  closeRedisCache
} = require('../services/redisCacheService');

const CHECK_TIMEOUT_MS = 5000;

const timeout = new Promise((resolve) => {
  const timer = setTimeout(() => resolve(null), CHECK_TIMEOUT_MS);
  timer.unref?.();
});

const main = async () => {
  try {
    const redis = await Promise.race([initRedisCache({ silent: true }), timeout]);
    if (!redis) {
      console.log('Redis: unavailable');
      return;
    }
    const result = await pingRedisCache();
    console.log(result === 'PONG' ? 'Redis: PONG' : 'Redis: unavailable');
  } catch {
    console.log('Redis: unavailable');
  } finally {
    await closeRedisCache();
  }
};

main().catch(() => {
  console.log('Redis: unavailable');
  process.exitCode = 1;
});
