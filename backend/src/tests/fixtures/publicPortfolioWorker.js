const mongoose = require('mongoose');
const redisService = require('../../services/redisCacheService');
process.once('message', async ({ dbName, namespace, profile }) => {
  try {
    if (
      !/^portfolio_test_[a-f0-9]{32}$/.test(dbName) ||
      !/^portfolio-test:[a-f0-9-]{36}:$/.test(namespace)
    )
      throw Error('Unsafe test scope');
    mongoose.set('autoCreate', false);
    mongoose.set('autoIndex', false);
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
      dbName,
      autoCreate: false,
      autoIndex: false,
      serverSelectionTimeoutMS: 5000
    });
    const native = await redisService.initRedisCache({ silent: true, probeOnly: true });
    if (!native) throw Error('Test Redis unavailable');
    const scope = (key) => {
      if (!key.startsWith('public-portfolio:v3:')) throw Error('Unsafe key');
      return namespace + key;
    };
    const redis = {
      get: (key) => native.get(scope(key)),
      set: (key, value, options) => native.set(scope(key), value, options),
      eval: (script, options) => native.eval(script, { ...options, keys: options.keys.map(scope) })
    };
    const { createPortfolioCache } = require('../../services/publicPortfolioCacheService');
    const cache = createPortfolioCache({ redis: { getRedisCacheClient: () => redis } });
    let builds = 0;
    const payload = await cache.get(
      { ...profile, _id: new mongoose.Types.ObjectId(profile._id) },
      {},
      async () => {
        builds++;
        await new Promise((r) => setTimeout(r, 500));
        return { headline: profile.headline };
      }
    );
    await redisService.closeRedisCache();
    await mongoose.disconnect();
    process.send({ payload, builds });
    process.disconnect();
  } catch {
    await redisService.closeRedisCache();
    await mongoose.disconnect();
    process.send({ error: 'Isolated worker verification failed' });
    process.disconnect();
    process.exitCode = 1;
  }
});
