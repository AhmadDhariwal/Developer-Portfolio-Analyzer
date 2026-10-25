'use strict';

// Test-only production-mode HTTP worker. No .env, external provider or production URI.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const inspector = require('node:inspector');
const mongoose = require('mongoose');
const express = require('express');
if (
  !/^mongodb:\/\/127\.0\.0\.1:\d+\/scenario_acceptance$/.test(
    process.env.SCENARIO_TEST_URI || '',
  ) ||
  !/^redis:\/\/127\.0\.0\.1:\d+$/.test(process.env.REDIS_URL || '') ||
  process.env.NODE_ENV !== 'production'
) {
  throw Error('Acceptance worker requires isolated loopback services and production policies.');
}
// Read-only closure introspection exists only in this verifier's module cache.
// The application module on disk and its execution paths are unchanged.
const filename = require.resolve('../services/scenarioContextService');
const observed = new Module(filename, module);
observed.filename = filename;
observed.paths = Module._nodeModulePaths(path.dirname(filename));
require.cache[filename] = observed;
observed._compile(
  fs.readFileSync(filename, 'utf8') +
    '\nmodule.exports.acceptanceState = () => ({active, joiners, pending: pending.size});\n',
  filename,
);
observed.loaded = true;
const contextService = require('../services/scenarioContextService');
let queueInspector;
let clientInspector;
let socketInspector;
if (process.env.SCENARIO_ACCEPTANCE_REDIS_INSPECT === '1') {
  const observeModule = (name, suffix) => {
    const filename = require.resolve(name),
      instance = new Module(filename, module);
    instance.filename = filename;
    instance.paths = Module._nodeModulePaths(path.dirname(filename));
    require.cache[filename] = instance;
    instance._compile(fs.readFileSync(filename, 'utf8') + '\n' + suffix, filename);
    instance.loaded = true;
    return instance.exports;
  };
  queueInspector = observeModule(
    '@redis/client/dist/lib/client/commands-queue',
    'module.exports.acceptanceLengths = queue => ({toSend:_RedisCommandsQueue_waitingToBeSent.get(queue).length,waitingForReply:_RedisCommandsQueue_waitingForReply.get(queue).length});',
  );
  if (process.env.SCENARIO_ACCEPTANCE_TRACE === '1')
    socketInspector = observeModule(
      '@redis/client/dist/lib/client/socket',
      'module.exports.acceptanceSocket = socket => _RedisSocket_socket.get(socket);',
    );
  clientInspector = observeModule(
    '@redis/client/dist/lib/client/index',
    'module.exports.acceptanceQueue = client => _RedisClient_queue.get(client); module.exports.acceptanceSocket = client => _RedisClient_socket.get(client);',
  );
  observeModule(
    '../services/redisCacheService',
    'module.exports.acceptanceRawClient = () => client;',
  );
}
const cache = require('../services/redisCacheService');
let pressureClient;
const redisQueue = () => {
  const raw = pressureClient || cache.acceptanceRawClient?.();
  if (!raw) return null;
  const value = queueInspector.acceptanceLengths(clientInspector.acceptanceQueue(raw));
  return { ...value, total: value.toSend + value.waitingForReply };
};
const engine = require('../services/scoring/scenarioPlanningScore');
const { registry } = require('../services/metricsService');
let server;
let client;
let profileSession;
let quotaTrace;
const quotaBuckets = new Uint32Array(2001);
let quotaCount = 0,
  quotaFailures = 0;
const quotaLatency = () => {
  let total = 0,
    p95 = null,
    p99 = 0;
  for (let i = 0; i < quotaBuckets.length; i++) {
    total += quotaBuckets[i];
    if (p95 === null && total >= quotaCount * 0.95) p95 = i;
    if (total >= quotaCount * 0.99) {
      p99 = i;
      break;
    }
  }
  return { count: quotaCount, failures: quotaFailures, p95Ms: p95, p99Ms: p99 };
};
const post = (session, method, params = {}) =>
  new Promise((resolve, reject) =>
    session.post(method, params, (error, result) => (error ? reject(error) : resolve(result))),
  );

const pool = {
  connections: 0,
  peakConnections: 0,
  checkedOut: 0,
  peakCheckedOut: 0,
  waiting: 0,
  peakWaiting: 0,
  checkOutFailures: 0,
  commands: 0,
  commandsInFlight: 0,
  peakCommands: 0,
};
const contextPeak = { active: 0, joiners: 0, pending: 0 };
// Fixed-size observer storage: sample collection must not manufacture heap growth.
const waitBuckets = new Uint32Array(20001);
let waitCount = 0;
const waitP95 = () => {
  if (!waitCount) return 0;
  let count = 0;
  for (let bucket = 0; bucket < waitBuckets.length; bucket++) {
    count += waitBuckets[bucket];
    if (count >= waitCount * 0.95) return bucket;
  }
  return 20000;
};
const delay = monitorEventLoopDelay({ resolution: 20 });
delay.enable();
const sample = setInterval(() => {
  const state = contextService.acceptanceState();
  for (const key of Object.keys(contextPeak))
    contextPeak[key] = Math.max(contextPeak[key], state[key]);
  const servers = client?.topology?.s?.servers;
  if (servers)
    pool.peakWaiting = Math.max(
      pool.peakWaiting,
      [...servers.values()].reduce((total, server) => total + server.pool.waitQueueSize, 0),
    );
}, 5);
sample.unref();

async function main() {
  mongoose.set('bufferCommands', false);
  await mongoose.connect(process.env.SCENARIO_TEST_URI, {
    directConnection: true,
    autoIndex: false,
    monitorCommands: true,
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
  });
  client = mongoose.connection.getClient();
  client.on('connectionCreated', () => {
    pool.connections++;
    pool.peakConnections = Math.max(pool.peakConnections, pool.connections);
  });
  client.on('connectionClosed', () => pool.connections--);
  client.on('connectionCheckedOut', (event) => {
    pool.checkedOut++;
    pool.peakCheckedOut = Math.max(pool.peakCheckedOut, pool.checkedOut);
    waitBuckets[Math.min(20000, Math.max(0, Math.ceil(event.durationMS)))]++;
    waitCount++;
  });
  client.on('connectionCheckOutFailed', () => {
    pool.checkOutFailures++;
  });
  client.on('connectionCheckedIn', () => pool.checkedOut--);
  client.on('commandStarted', () => {
    pool.commands++;
    pool.commandsInFlight++;
    pool.peakCommands = Math.max(pool.peakCommands, pool.commandsInFlight);
  });
  const finish = () => {
    pool.commandsInFlight--;
  };
  client.on('commandSucceeded', finish);
  client.on('commandFailed', finish);
  await cache.initRedisCache({ silent: true, probeOnly: true });
  if (!cache.isRedisCacheEnabled()) throw Error('Real Redis initialization failed.');
  if (process.env.SCENARIO_ACCEPTANCE_FOCUSED === '1') {
    const raw = cache.acceptanceRawClient();
    const evalCommand = raw.eval.bind(raw);
    raw.eval = async (...args) => {
      const start = performance.now();
      try {
        return await evalCommand(...args);
      } catch (error) {
        quotaFailures++;
        throw error;
      } finally {
        quotaCount++;
        quotaBuckets[Math.min(2000, Math.ceil(performance.now() - start))]++;
      }
    };
  }

  if (process.env.SCENARIO_ACCEPTANCE_TRACE === '1')
    quotaTrace = require('./scenarioQuotaTrace')({
      raw: cache.acceptanceRawClient(),
      socket: socketInspector.acceptanceSocket(
        clientInspector.acceptanceSocket(cache.acceptanceRawClient()),
      ),
      cache,
      queue: redisQueue,
    });
  const app = express();
  if (quotaTrace) app.use(quotaTrace.middleware);
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/simulator', require('../routes/scenarioSimulator.routes'));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  process.send({ ready: true, port: server.address().port, pid: process.pid });
}

process.on('message', async (message) => {
  try {
    let value;
    if (message.action === 'sample') {
      const memoryBeforeGc = process.memoryUsage();
      if (message.gc) global.gc?.();
      const nativePools = [...client.topology.s.servers.values()].map((server) => server.pool);
      const nativePool = {
        connections: nativePools.reduce((sum, item) => sum + item.totalConnectionCount, 0),
        checkedOut: nativePools.reduce((sum, item) => sum + item.currentCheckedOutCount, 0),
        waiting: nativePools.reduce((sum, item) => sum + item.waitQueueSize, 0),
      };
      value = {
        memoryBeforeGc,
        pid: process.pid,
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        eventLoopP99Ms: delay.percentile(99) / 1e6,
        pool: {
          ...pool,
          ...nativePool,
          waitP95Ms: waitP95(),
        },
        context: contextService.acceptanceState(),
        contextPeak: { ...contextPeak },
        redisReady: cache.isRedisCacheEnabled(),
        observer: {
          checkoutBytes: waitBuckets.byteLength,
          quotaBytes: quotaBuckets.byteLength,
          cpuProfilerActive: Boolean(profileSession),
        },
      };
    } else if (message.action === 'diagnostic-reset') {
      quotaTrace?.reset();
      delay.reset();
      quotaBuckets.fill(0);
      quotaCount = 0;
      quotaFailures = 0;
      value = { pid: process.pid, cpu: process.cpuUsage(), memory: process.memoryUsage() };
    } else if (message.action === 'diagnostic') {
      value = {
        pid: process.pid,
        quota: quotaLatency(),
        loop: { p99Ms: delay.percentile(99) / 1e6, maxMs: delay.max / 1e6 },
        cpu: process.cpuUsage(),
        memory: process.memoryUsage(),
        queue: redisQueue(),
        trace: quotaTrace?.snapshot(),
      };
    } else if (message.action === 'profile-start') {
      profileSession = new inspector.Session();
      profileSession.connect();
      await post(profileSession, 'Profiler.enable');
      await post(profileSession, 'Profiler.start');
      value = true;
    } else if (message.action === 'profile-stop') {
      const { profile } = await post(profileSession, 'Profiler.stop');
      profileSession.disconnect();
      profileSession = null;
      const counts = new Map();
      for (let i = 0; i < (profile.samples || []).length; i++)
        counts.set(
          profile.samples[i],
          (counts.get(profile.samples[i]) || 0) + (profile.timeDeltas?.[i] || 1),
        );
      value = {
        durationUs: profile.endTime - profile.startTime,
        top: profile.nodes
          .map((node) => ({
            function: node.callFrame.functionName,
            url: node.callFrame.url,
            line: node.callFrame.lineNumber + 1,
            selfUs: counts.get(node.id) || 0,
          }))
          .sort((a, b) => b.selfUs - a.selfUs)
          .slice(0, 35),
      };
    } else if (message.action === 'context') {
      value = await contextService.getScenarioContext(message.owner);
    } else if (message.action === 'save') {
      value = await require('../services/scenarioSimulatorService').saveScenarioForUser(
        message.owner,
        message.payload,
      );
    } else if (message.action === 'export') {
      const result = await require('../services/scenarioSprintExportService').exportScenario(
        message.owner,
        message.sprintId,
        message.scenario,
        'active-tasks',
      );
      value = { replayed: result.replayed, receipt: result.receipt };
    } else if (message.action === 'redis-pressure') {
      pressureClient = cache.acceptanceRawClient();
      const snapshots = [];
      global.gc?.();
      snapshots.push({ queue: redisQueue(), heap: process.memoryUsage().heapUsed });
      for (let batch = 0; batch < 2; batch++) {
        const counts = await (async () => {
          const responses = await Promise.allSettled(
            Array.from({ length: 4000 }, () =>
              cache.getRedisCacheClient().eval('return 1', { keys: [], arguments: [] }),
            ),
          );
          return {
            fulfilled: responses.filter((item) => item.status === 'fulfilled').length,
            rejected: responses.filter((item) => item.status === 'rejected').length,
          };
        })();
        await new Promise((resolve) => setTimeout(resolve, 50));
        global.gc?.();
        snapshots.push({
          batch,
          queue: redisQueue(),
          heap: process.memoryUsage().heapUsed,
          ...counts,
        });
      }
      value = { snapshots };
    } else if (message.action === 'redis-queue') {
      global.gc?.();
      value = { queue: redisQueue(), heap: process.memoryUsage().heapUsed };
    } else if (message.action === 'pool-pressure') {
      const results = await Promise.allSettled(
        Array.from({ length: 160 }, () =>
          mongoose.connection.collection('users').findOne({}, { maxTimeMS: 2000 }),
        ),
      );
      value = {
        completed: results.filter((result) => result.status === 'fulfilled').length,
        failed: results.filter((result) => result.status === 'rejected').length,
      };
    } else if (message.action === 'metrics') {
      value = await registry.getMetricsAsJSON();
    } else if (message.action === 'engine') {
      const durations = [];
      for (let i = 0; i < 100; i++) engine.calculate(message.input);
      const started = performance.now();
      let canonical;
      for (let i = 0; i < message.count; i++) {
        const before = performance.now();
        const result = engine.calculate(message.input);
        durations.push(performance.now() - before);
        const serialized = JSON.stringify(result);
        if (canonical && canonical !== serialized) throw Error('Nondeterministic calculation.');
        canonical = serialized;
        const remaining = started + (i + 1) * 10 - performance.now();
        if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
      }
      durations.sort((a, b) => a - b);
      value = {
        count: message.count,
        elapsedMs: performance.now() - started,
        p95: durations[Math.floor(durations.length * 0.95)],
        p99: durations[Math.floor(durations.length * 0.99)],
      };
    } else if (message.action === 'stop') {
      quotaTrace?.close();
      clearInterval(sample);
      if (server) await new Promise((resolve) => server.close(resolve));
      await cache.closeRedisCache();
      await mongoose.disconnect();
      delay.disable();
      process.send({ id: message.id, value: true }, () => process.exit(0));
      return;
    } else throw Error('Unknown verifier action.');
    process.send({ id: message.id, value });
  } catch (error) {
    process.send({
      id: message.id,
      error: { message: error.message, statusCode: error.statusCode },
    });
  }
});
main().catch((error) => {
  process.send({ ready: false, error: error.message });
  process.exitCode = 1;
});
