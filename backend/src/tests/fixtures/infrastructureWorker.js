const mongoose = require('mongoose');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
if (process.env.P02_BASELINE === 'true') {
  for (const relative of [
    'core/cache/redisCacheService.js',
    'core/middleware/securityMiddleware.js',
    'modules/auth/services/oauthAuthService.js'
  ]) {
    const filename = path.resolve(__dirname, '../../', relative);
    const unit = new Module(filename, module);
    unit.filename = filename;
    unit.paths = Module._nodeModulePaths(path.dirname(filename));
    unit._compile(
      execFileSync('git', ['show', `HEAD:backend/src/${relative}`]).toString(),
      filename
    );
    require.cache[filename] = unit;
  }
}
const express = require('express');
const redis = require('../../core/cache/redisCacheService');
const settings = require('../../modules/super-admin/services/platformSettingsService');
const oauth = require('../../modules/auth/services/oauthAuthService');
const security = require('../../core/middleware/securityMiddleware');
let server;
let mongoUri;
process.on('message', async ({ id, op, uri, payload }) => {
  try {
    let result;
    if (op === 'connect') {
      if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri))
        throw Error('Disposable loopback Mongo required');
      if (!/^redis:\/\/127\.0\.0\.1:27392$/.test(process.env.REDIS_URL))
        throw Error('Disposable Redis required');
      mongoUri = uri;
      await mongoose.connect(uri);
      if (!(await redis.initRedisCache({ silent: true }))) throw Error('Actual Redis required');
      await settings.startSettingsSynchronization();
      const app = express();
      app.use(express.json());
      app.post('/rate', security.authRateLimiter, (_req, res) => res.json({ ok: true }));
      app.post('/api/global', security.globalRateLimiter, (_req, res) => res.json({ ok: true }));
      app.post('/guard', security.bruteForceGuard, (_req, res) => res.json({ ok: true }));
      app.post('/failure', security.bruteForceGuard, async (req, res) => {
        try {
          await security.registerAuthFailure(req);
          res.status(401).json({ message: 'Invalid credentials' });
        } catch {
          res.status(503).json({ message: 'Unavailable' });
        }
      });
      server = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      result = `http://127.0.0.1:${server.address().port}`;
    } else if (op === 'state') result = oauth.createAuthorization('google');
    else if (op === 'consume')
      await oauth.validateState(
        'google',
        payload.state,
        `${payload.cookieName}=${encodeURIComponent(payload.state)}`
      );
    else if (op === 'revision')
      result = await redis.getRedisCacheClient().get('interview:revision:global');
    else if (op === 'replayRevision')
      await require('../../core/cache/interviewRevisionStore').publish(
        redis.getRedisCacheClient(),
        'interview:revision:global',
        payload
      );
    else if (op === 'seedInterview') {
      const key = await redis.resolveInterviewCacheKey(
        'interview:questions:topic=p02:page=1',
        'p02'
      );
      await redis.setCacheJson(key, { marker: 'bank-v1' }, 60);
      result = { key, ttlMs: await redis.getRedisCacheClient().pTTL(key) };
    } else if (op === 'readInterview') {
      const key = await redis.resolveInterviewCacheKey(
        'interview:questions:topic=p02:page=1',
        'p02'
      );
      result = await redis.getCacheJson(key);
    } else if (op === 'cacheTtl') result = await redis.getRedisCacheClient().pTTL(payload);
    else if (op === 'reconnect') {
      await redis.closeRedisCache();
      await redis.initRedisCache({ silent: true });
    } else if (op === 'invalidate') await redis.invalidateInterviewPrepCache();
    else if (op === 'clearFailures')
      await security.clearAuthFailures({
        ip: '127.0.0.1',
        body: { email: 'fixture@example.test' }
      });
    else if (op === 'redisOff') await redis.closeRedisCache();
    else if (op === 'mongoOff') await mongoose.disconnect();
    else if (op === 'mongoOn') await mongoose.connect(mongoUri);
    else if (op === 'configure') await settings.updateSettings(payload);
    else if (op === 'relativeWindow')
      result =
        await require('../../modules/integrations/services/integrationMongoGovernanceService').authWindow(
          `auth:v1:rate:relative-test:${'f'.repeat(64)}`,
          60000
        );
    else if (op === 'stress') {
      const Cache = require('../../core/cache/boundedMemoryCache');
      global.gc?.();
      const before = process.memoryUsage().heapUsed;
      const cache = new Cache(256);
      for (let index = 0; index < 50000; index++)
        cache.set(`owner-${index}`, {
          source: index,
          payload: `${index}:${'x'.repeat(2048)}`,
          expiresAt: Date.now() + 60000
        });
      global.gc?.();
      result = { entries: cache.size, heapDeltaBytes: process.memoryUsage().heapUsed - before };
    } else if (op === 'ttl') {
      const service = require('../../modules/github/services/githubservice');
      const username = `p02-ttl-${process.pid}`;
      const key = `github:analysis:github-v2:${username}`;
      await redis.getRedisCacheClient().set(
        key,
        JSON.stringify({
          result: { dataVersion: 'github-normalized-v2', marker: 'source' },
          expiresAt: new Date(Date.now() + 60000)
        }),
        { PX: 250 }
      );
      const first = await service.getCachedGitHubAnalysis(username, { allowStale: false });
      await new Promise((resolve) => setTimeout(resolve, 350));
      const after = await service.getCachedGitHubAnalysis(username, { allowStale: false });
      result = { first: first.status, after: after.status };
    } else if (op === 'githubStress') {
      const Model = require('../../modules/github/models/githubAnalysisCache');
      const service = require('../../modules/github/services/githubservice');
      const prefix = `p02-${process.pid}-`;
      await Model.insertMany(
        Array.from({ length: 512 }, (_, index) => ({
          githubUsername: `${prefix}${index}`,
          normalizedUsername: `${prefix}${index}`,
          analysisVersion: 'github-v2',
          result: { dataVersion: 'github-normalized-v2', marker: index },
          expiresAt: new Date(Date.now() + 120000)
        }))
      );
      for (let index = 0; index < 512; index++) {
        const cached = await service.getCachedGitHubAnalysis(`${prefix}${index}`);
        if (cached.data.marker !== index) throw Error('Cache identity mismatch');
      }
      result = { entries: service.getGitHubAnalysisMemoryCacheSize() };
    } else if (op === 'close') {
      settings.stopSettingsSynchronization();
      await new Promise((resolve) => server.close(resolve));
      await redis.closeRedisCache();
      await mongoose.disconnect();
    }
    process.send({ id, result });
    if (op === 'close') process.disconnect();
  } catch (error) {
    process.send({
      id,
      error: `${op}: ${error.message}`,
      status: error.status || error.statusCode
    });
  }
});
