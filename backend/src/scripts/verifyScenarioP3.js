'use strict';

// Acceptance-only orchestrator. It creates every service it uses; no .env is loaded.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, fork } = require('node:child_process');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
const { randomUUID, createHash } = require('node:crypto');
const mongoose = require('mongoose');
const { createClient } = require('redis');
const jwt = require('jsonwebtoken');
const { BSON } = require('mongodb');
const root = path.resolve(__dirname, '../../..');
const output = path.join(root, 'backend/verification/scenario-simulator');
const smoke = process.argv.includes('--smoke');
const ackOnly = process.argv.includes('--ack-only');
const focused = process.argv.includes('--focused');
const traceQuota = process.argv.includes('--trace-quota');
if (traceQuota && !focused) throw Error('Quota tracing requires focused mode.');
const lockGate = process.argv.includes('--lock-gate');
const skipFocusedMemory = process.argv.includes('--skip-memory');
const focusedProfile = process.argv.includes('--profile');
const focusedBurstOnly = process.argv.includes('--burst-only');
const focusedTransport = (
  process.argv.find((value) => value.startsWith('--transport=')) || '--transport=mongo-proxy'
).slice(12);
if (!['direct', 'mongo-proxy', 'proxy'].includes(focusedTransport))
  throw Error('Invalid focused transport.');
const focusedLabel = (
  process.argv.find((value) => value.startsWith('--label=')) || '--label=baseline'
).slice(8);
if (!/^[a-z0-9-]{1,32}$/.test(focusedLabel)) throw Error('Invalid focused evidence label.');
const runId = randomUUID();
const evidenceName = process.argv.find((value) => value.startsWith('--evidence-name='))?.slice(16);
if (evidenceName && !/^[a-z0-9-]+\.json$/.test(evidenceName))
  throw Error('Evidence name must be a plain lowercase JSON filename.');
const evidence = path.join(
  output,
  evidenceName ||
    (focused
      ? `focused-${focusedLabel}.json`
      : ackOnly
        ? 'p3-ack-recovery.json'
        : smoke
          ? 'p3-smoke.json'
          : 'p3-acceptance.json'),
);
if (evidenceName && fs.existsSync(evidence))
  throw Error('Refusing to overwrite retained evidence.');
const redisBinary = '/tmp/devinsight-scenario-redis-p3-20261025/redis-7.2.11/src/redis-server';
const report = {
  runId,
  mode: focused
    ? 'FOCUSED_NOT_FULL_ACCEPTANCE'
    : ackOnly
      ? 'NETWORK_ACK_RECOVERY_ONLY'
      : smoke
        ? 'SMOKE_NOT_EXTENDED_ACCEPTANCE'
        : 'FULL',
  startedAt: new Date().toISOString(),
  status: 'RUNNING',
  productionDataModified: false,
  traceQuota,
  sources: Object.fromEntries(
    [
      'src/scripts/verifyScenarioP3.js',
      'src/scripts/scenarioAcceptanceWorker.js',
      'src/scripts/scenarioFocusedVerification.js',
      'src/scripts/scenarioQuotaTrace.js',
      'src/scripts/scenarioRedisTrace.js',
      'src/services/redisCacheService.js',
      'src/services/scenarioContextService.js',
      'src/services/scenarioSimulatorService.js',
      'src/services/scenarioSprintExportService.js',
      'src/services/scoring/scenarioPlanningScore.js',
      'src/middleware/scenarioSimulatorMiddleware.js',
      'src/middleware/authMiddleware.js',
    ].map((file) => [
      file,
      createHash('sha256')
        .update(fs.readFileSync(path.join(root, 'backend', file)))
        .digest('hex'),
    ]),
  ),
  checks: [],
  phases: [],
  samples: [],
  failures: [],
  limitations: [],
  environment: {
    node: process.version,
    platform: process.platform,
    os: os.release(),
    logicalCpus: os.cpus().length,
    cpu: os.cpus()[0]?.model,
    totalMemory: os.totalmem(),
    mongoose: require('mongoose/package.json').version,
    mongodb: require('mongodb/package.json').version,
    redisClient: require('redis/package.json').version,
  },
};
const persist = () => fs.writeFileSync(evidence, JSON.stringify(report, null, 2) + '\n');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (condition, label, details) => {
  report.checks.push({ label, passed: !!condition, ...(details === undefined ? {} : { details }) });
  if (!condition) report.failures.push(label);
  persist();
};
const listen = async (server) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
};
const freePort = async () => {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
};
const proxies = [];
const workers = [];
let mongo;
let redis;
let redisProcess;
let redisConfig;
let checkpoint;
let redisTrace;
const input = {
  ruleVersion: 'scenario-planning-v2',
  baselineAuthority: 'user-assumption',
  baselineConfirmed: true,
  baselineHiringScore: 40,
  baselineJobMatch: 35,
  role: 'frontend',
  experienceLevel: 'mid',
  durationWeeks: 6,
  skills: ['React'],
  projects: [],
};

async function startMongo() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devinsight-p3-'));
  const port = await freePort();
  const child = spawn(
    process.env.SCENARIO_TEST_MONGOD || 'mongod',
    [
      '--dbpath',
      directory,
      '--bind_ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--wiredTigerCacheSizeGB',
      '0.25',
      '--quiet',
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let log = '';
  child.stdout.on('data', (data) => {
    log = (log + data).slice(-12000);
  });
  child.stderr.on('data', (data) => {
    log = (log + data).slice(-12000);
  });
  const uri = `mongodb://127.0.0.1:${port}/scenario_acceptance`;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw Error('Disposable Mongo failed: ' + log);
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 300 });
      return { child, directory, uri, port };
    } catch {
      await sleep(100);
    }
  }
  throw Error('Disposable Mongo startup timed out.');
}

async function startRedis() {
  const port = await freePort();
  redisConfig = path.join(output, `p3-redis-${runId}.conf`);
  const content =
    `bind 127.0.0.1\nport ${port}\nprotected-mode yes\nsave ""\nappendonly no\nmaxmemory 64mb\nmaxmemory-policy noeviction\n` +
    (traceQuota
      ? 'slowlog-log-slower-than 1000\nslowlog-max-len 1024\nlatency-monitor-threshold 1\n'
      : '');
  fs.writeFileSync(redisConfig, content);
  const linuxConfig =
    '/mnt/' + redisConfig[0].toLowerCase() + redisConfig.slice(2).replaceAll('\\', '/');
  redisProcess = spawn('wsl.exe', ['-d', 'Ubuntu', '--', redisBinary, linuxConfig], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  redisProcess.stdout.on('data', (data) => {
    log = (log + data).slice(-5000);
  });
  redisProcess.stderr.on('data', (data) => {
    log = (log + data).slice(-5000);
  });
  redis = createClient({
    url: `redis://127.0.0.1:${port}`,
    socket: { reconnectStrategy: false, connectTimeout: 1000 },
  });
  redis.on('error', () => {});
  const readyDeadline = Date.now() + 30000;
  while (Date.now() < readyDeadline) {
    if (redisProcess.exitCode !== null) throw Error('Redis startup exited: ' + log);
    const listening = await new Promise((resolve) => {
      const probe = net.connect(port, '127.0.0.1');
      probe.once('connect', () => {
        probe.destroy();
        resolve(true);
      });
      probe.once('error', () => resolve(false));
    });
    if (listening) break;
    await sleep(200);
  }
  await redis.connect().catch((error) => {
    throw Error(error.message + ' Redis startup: ' + log);
  });
  report.environment.redisInfo = (await redis.info('server'))
    .split('\r\n')
    .filter((line) => /^(redis_version|redis_mode|os|arch_bits):/.test(line));
  report.environment.redisConfig = content.replace(/port \d+/, 'port <ephemeral>');
  return port;
}

async function proxy(targetPort, kind) {
  const sockets = new Set();
  const state = {
    mode: 'pass',
    delayMs: 0,
    collection: null,
    peakSockets: 0,
    delayedFrames: 0,
    queuedBytes: 0,
    peakQueuedBytes: 0,
  };
  const server = net.createServer((downstream) => {
    const upstream = net.connect(targetPort, '127.0.0.1');
    downstream.setNoDelay(true);
    upstream.setNoDelay(true);
    sockets.add(downstream);
    sockets.add(upstream);
    state.peakSockets = Math.max(state.peakSockets, sockets.size);
    const close = () => {
      sockets.delete(downstream);
      sockets.delete(upstream);
      downstream.destroy();
      upstream.destroy();
    };
    downstream.on('error', close);
    upstream.on('error', close);
    downstream.on('close', close);
    upstream.on('close', close);
    let dropResponseTo = null;
    let responseBuffer = Buffer.alloc(0);
    upstream.on('data', (data) => {
      if (state.mode === 'blackhole') return;
      if (dropResponseTo === null) {
        downstream.write(data);
        return;
      }
      responseBuffer = Buffer.concat([responseBuffer, data]);
      while (responseBuffer.length >= 4 && responseBuffer.length >= responseBuffer.readInt32LE(0)) {
        const length = responseBuffer.readInt32LE(0);
        const frame = responseBuffer.subarray(0, length);
        responseBuffer = responseBuffer.subarray(length);
        if (frame.readInt32LE(8) === dropResponseTo) {
          state.droppedReplies = (state.droppedReplies || 0) + 1;
          close();
          return;
        }
        downstream.write(frame);
      }
    });
    let buffer = Buffer.alloc(0);
    downstream.on('data', (data) => {
      if (state.mode === 'reset') {
        close();
        return;
      }
      if (state.mode === 'blackhole') return;
      if (
        kind !== 'mongo' ||
        (state.delayMs === 0 && !state.dropCollection && buffer.length === 0)
      ) {
        upstream.write(data);
        return;
      }
      buffer = Buffer.concat([buffer, data]);
      if (buffer.length > 32 * 1024 * 1024) {
        close();
        return;
      }
      while (buffer.length >= 4 && buffer.length >= buffer.readInt32LE(0)) {
        const length = buffer.readInt32LE(0);
        if (length < 16) {
          close();
          return;
        }
        const frame = Buffer.from(buffer.subarray(0, length));
        buffer = buffer.subarray(length);
        let body;
        if (frame.readInt32LE(12) === 2013 && frame[20] === 0) {
          try {
            body = BSON.deserialize(frame.subarray(21), { allowObjectSmallerThanBufferSize: true });
          } catch {}
        }
        if (
          state.dropCollection &&
          (body?.findAndModify === state.dropCollection || body?.update === state.dropCollection)
        ) {
          dropResponseTo = frame.readInt32LE(4);
          state.dropCollection = null;
        }
        if (state.delayMs && (!state.collection || body?.find === state.collection)) {
          state.delayedFrames++;
          state.queuedBytes += frame.length;
          state.peakQueuedBytes = Math.max(state.peakQueuedBytes, state.queuedBytes);
          setTimeout(() => {
            state.queuedBytes -= frame.length;
            if (!upstream.destroyed) upstream.write(frame);
          }, state.delayMs);
        } else upstream.write(frame);
      }
    });
  });
  const port = await listen(server);
  const value = {
    port,
    state,
    reset: () => {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
    },
    close: async () => {
      value.reset();
      await new Promise((resolve) => server.close(resolve));
    },
  };
  proxies.push(value);
  return value;
}

async function worker(mongoProxy, redisProxy) {
  const child = fork(path.join(__dirname, 'scenarioAcceptanceWorker.js'), [], {
    execArgv: ['--expose-gc'],
    windowsHide: true,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      NODE_ENV: 'production',
      SCENARIO_ACCEPTANCE_REDIS_INSPECT: ackOnly || focused ? '1' : '0',
      SCENARIO_ACCEPTANCE_FOCUSED: focused ? '1' : '0',
      SCENARIO_ACCEPTANCE_TRACE: traceQuota ? '1' : '0',
      JWT_SECRET: 'isolated-p3-only',
      REDIS_URL: `redis://127.0.0.1:${redisProxy.port}`,
      SCENARIO_TEST_URI: `mongodb://127.0.0.1:${mongoProxy.port}/scenario_acceptance`,
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let diagnostics = '';
  child.stdout.on('data', (data) => {
    diagnostics = (diagnostics + data).slice(-3000);
  });
  child.stderr.on('data', (data) => {
    diagnostics = (diagnostics + data).slice(-3000);
  });
  let sequence = 0;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Worker startup timeout: ' + diagnostics)), 45000);
    child.once('error', reject);
    child.on('message', (message) => {
      if ('ready' in message) {
        clearTimeout(timer);
        message.ready ? resolve(message) : reject(Error(message.error));
      } else {
        const callback = pending.get(message.id);
        if (callback) {
          pending.delete(message.id);
          callback(message);
        }
      }
    });
  });
  const request = (action, extra = {}, timeoutMs = 60000) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error(`Worker ${action} timed out.`));
      }, timeoutMs);
      pending.set(id, (result) => {
        clearTimeout(timer);
        result.error
          ? reject(Object.assign(Error(result.error.message), result.error))
          : resolve(result.value);
      });
      child.send({ id, action, ...extra });
    });
  const info = await ready;
  return {
    child,
    request,
    origin: `http://127.0.0.1:${info.port}`,
    pid: info.pid,
    mongoProxy,
    redisProxy,
  };
}

class Histogram {
  constructor() {
    this.count = 0;
    this.maximum = 0;
    this.sum = 0;
    this.buckets = new Uint32Array(20001);
  }
  add(value) {
    this.count++;
    this.sum += value;
    this.maximum = Math.max(this.maximum, value);
    this.buckets[Math.min(20000, Math.ceil(value))]++;
  }
  percentile(fraction) {
    let total = 0;
    for (let index = 0; index < this.buckets.length; index++) {
      total += this.buckets[index];
      if (total >= this.count * fraction) return index;
    }
    return 0;
  }
  json() {
    return {
      count: this.count,
      p95Ms: this.percentile(0.95),
      p99Ms: this.percentile(0.99),
      maxMs: this.maximum,
      meanMs: this.sum / Math.max(1, this.count),
    };
  }
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  process.env.NODE_ENV = 'test';
  // Ensure inherited cloud connection settings cannot reach any shared service.
  delete process.env.REDIS_URL;
  delete process.env.UPSTASH_REDIS_TOKEN;
  mongo = await startMongo();
  const redisPort = await startRedis();
  if (traceQuota) redisTrace = await require('./scenarioRedisTrace')(redis, redisPort);
  const User = require('../models/user');
  const Scenario = require('../models/scenarioSimulation');
  const Sprint = require('../models/careerSprint');
  const engine = require('../services/scoring/scenarioPlanningScore');
  const service = require('../services/scenarioSimulatorService');
  await Promise.all([User.init(), Scenario.init(), Sprint.init()]);
  report.environment.mongoBuild = await mongoose.connection.db
    .admin()
    .command({ buildInfo: 1 })
    .then((value) => ({ version: value.version, allocator: value.allocator }));
  report.indexes = await Scenario.collection.indexes();
  check(
    report.indexes.some(
      (index) =>
        index.unique &&
        index.key.userId === 1 &&
        index.key.scenarioHash === 1 &&
        !index.partialFilterExpression &&
        !index.sparse,
    ),
    'Actual full unique user/hash index installed locally',
  );
  check(
    report.indexes.some(
      (index) =>
        JSON.stringify(index.key) === JSON.stringify({ userId: 1, createdAt: -1, _id: -1 }),
    ),
    'Actual compound history cursor index installed locally',
  );
  const users = await User.insertMany(
    Array.from({ length: 140 }, (_, index) => ({
      name: `P3 fixture ${index}`,
      email: `p3-${index}@example.invalid`,
      authProvider: 'github',
      providers: ['github'],
      activeCareerStack: 'Frontend',
      careerStack: 'Frontend',
      experienceLevel: 'Student',
      isActive: true,
    })),
  );
  const tokens = users.map((user) =>
    jwt.sign({ id: String(user._id) }, 'isolated-p3-only', {
      algorithm: 'HS256',
      issuer: 'devinsight-api',
      audience: 'devinsight-web',
      expiresIn: '4h',
    }),
  );
  const payload = { ...input, evaluation: engine.calculate(input).evaluation };
  const saved = [];
  for (const user of users) saved.push(await service.saveScenarioForUser(user._id, payload));
  const { sprintWindow } = require('../utils/sprintCalendar');
  const window = sprintWindow('Asia/Karachi');
  const sprints = await Sprint.insertMany(
    users.map((user) => ({
      userId: user._id,
      ...window,
      weekStartDate: window.sprintStartDate,
      weekEndDate: window.sprintEndDate,
    })),
  );
  // Existing healthy evidence with correct owner/profile identity; no AI/provider call.
  await require('../models/publicProfile').collection.insertMany(
    users.map((user, index) => ({
      userId: user._id,
      slug: `p3-${index}`,
      skills: [],
      projects: [],
      upcomingProjects: [
        { title: `Planned milestone ${index}`, status: 'planned', techStack: ['React'] },
      ],
      updatedAt: new Date(),
    })),
  );
  await require('../models/integrationInsight').collection.insertMany(
    users.map((user) => ({
      userId: user._id,
      mergedSkills: ['TypeScript'],
      updatedAt: new Date(),
    })),
  );
  for (let index = 0; index < 2; index++)
    workers.push(await worker(await proxy(mongo.port, 'mongo'), await proxy(redisPort, 'redis')));
  report.environment.workers = workers.map((item) => item.pid);
  report.environment.mongoClientOptions = {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    maxPoolSize: 100,
    waitQueueTimeoutMS: 0,
    directConnection: true,
    autoIndex: false,
  };
  let traceSequence = 0;
  const call = async (operation, index = 0, instance = 0, extra = {}) => {
    if (workers[instance].draining) instance = 1 - instance;
    const route = {
      context: '/context',
      refresh: '/context?forceRefresh=true',
      evaluate: '/what-if',
      history: '/history',
      save: '/save',
      export: '/create-sprint',
      delete: '/000000000000000000000001',
    }[operation];
    const body =
      operation === 'export'
        ? {
            scenarioId: String(saved[index]._id),
            sprintId: String(sprints[index]._id),
            mode: 'active-tasks',
          }
        : ['evaluate', 'save'].includes(operation)
          ? payload
          : undefined;
    const start = performance.now();
    const response = await fetch(workers[instance].origin + '/api/simulator' + route, {
      method: operation === 'delete' ? 'DELETE' : body ? 'POST' : 'GET',
      signal: AbortSignal.timeout(55000),
      headers: {
        Authorization: `Bearer ${tokens[index]}`,
        'Content-Type': 'application/json',
        ...(traceQuota ? { 'X-Scenario-Trace': String(++traceSequence) } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      ...extra,
    });
    const responseBody = await response.json();
    const result = {
      status: response.status,
      elapsedMs: performance.now() - start,
      retryAfter: response.headers.get('retry-after'),
      body: responseBody,
    };
    return result;
  };
  if (focused) {
    await require('./scenarioFocusedVerification')({
      workers,
      worker,
      call,
      report,
      check,
      persist,
      sleep,
      Histogram,
      mongoPort: mongo.port,
      redisPort,
      label: focusedLabel,
      transport: focusedTransport,
      profile: focusedProfile,
      burstOnly: focusedBurstOnly,
      lockGate,
      skipMemory: skipFocusedMemory,
      redisTrace,
    });
    if (report.failures.length) process.exitCode = 1;
    report.status = report.failures.length
      ? 'FOCUSED_FAIL'
      : traceQuota
        ? 'FOCUSED_TRACE_NOT_ACCEPTANCE'
        : focusedProfile
          ? 'FOCUSED_DIAGNOSTIC_NOT_ACCEPTANCE'
          : 'FOCUSED_PASS_NOT_FULL_ACCEPTANCE';
    return;
  }
  const concurrencyPayload = { owner: String(users[130]._id), payload };
  const sameSaves = await Promise.all(
    Array.from({ length: 100 }, (_, index) =>
      workers[index % 2].request('save', concurrencyPayload),
    ),
  );
  check(
    new Set(sameSaves.map((item) => String(item._id))).size === 1 &&
      (await Scenario.countDocuments({ userId: users[130]._id })) === 1,
    'Two instances concurrently save 100 identical plans as one immutable snapshot',
  );
  const sameExports = await Promise.all(
    Array.from({ length: 50 }, (_, index) =>
      workers[index % 2].request('export', {
        owner: String(users[130]._id),
        sprintId: String(sprints[130]._id),
        scenario: saved[130],
      }),
    ),
  );
  const exportedOnce = await Sprint.findById(sprints[130]._id).lean();
  check(
    sameExports.filter((item) => !item.replayed).length === 1 &&
      exportedOnce.scenarioReceipts.length === 1 &&
      exportedOnce.tasks.length === 1,
    'Two instances concurrently export 50 requests as one durable receipt/item set',
  );
  const foreign = await fetch(workers[1].origin + '/api/simulator/create-sprint', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokens[131]}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scenarioId: String(saved[130]._id),
      sprintId: String(sprints[130]._id),
      mode: 'active-tasks',
    }),
  });
  check(foreign.status === 404, 'Real JWT foreign scenario/Sprint export is not found');
  if (ackOnly) {
    const damaged = workers[0].mongoProxy;
    const nextInput = { ...input, baselineHiringScore: 42 };
    const nextPayload = { ...nextInput, evaluation: engine.calculate(nextInput).evaluation };
    const newHash = engine.calculate(nextInput).scenarioHash;
    damaged.state.dropCollection = 'scenariosimulations';
    let saveOutcome;
    try {
      await workers[0].request('save', { owner: String(users[132]._id), payload: nextPayload });
      saveOutcome = 'driver returned success after lost reply';
    } catch (error) {
      saveOutcome = error.message;
    }
    const committed = await Scenario.findOne({
      userId: users[132]._id,
      scenarioHash: newHash,
    }).lean();
    check(
      !!committed && damaged.state.droppedReplies === 1,
      'Server committed immutable snapshot before TCP acknowledgement was discarded',
      { saveOutcome, droppedReplies: damaged.state.droppedReplies },
    );
    await workers[1].request('save', { owner: String(users[132]._id), payload: nextPayload });
    const replayed = await Scenario.findOne({
      userId: users[132]._id,
      scenarioHash: newHash,
    }).lean();
    check(
      (await Scenario.countDocuments({ userId: users[132]._id, scenarioHash: newHash })) === 1 &&
        JSON.stringify(committed) === JSON.stringify(replayed),
      'Cross-instance retry after lost save acknowledgement preserves one original snapshot',
    );
    damaged.state.dropCollection = 'careersprints';
    let exportOutcome;
    const exportInput = {
      owner: String(users[132]._id),
      sprintId: String(sprints[132]._id),
      scenario: saved[132],
    };
    try {
      await workers[0].request('export', exportInput);
      exportOutcome = 'driver returned success after lost reply';
    } catch (error) {
      exportOutcome = error.message;
    }
    const beforeRetry = await Sprint.findById(sprints[132]._id).lean();
    const repeated = await workers[1].request('export', exportInput);
    const afterRetry = await Sprint.findById(sprints[132]._id).lean();
    check(
      damaged.state.droppedReplies === 2 &&
        beforeRetry.scenarioReceipts.length === 1 &&
        beforeRetry.tasks.length === 1 &&
        repeated.replayed &&
        JSON.stringify(beforeRetry) === JSON.stringify(afterRetry),
      'Cross-instance retry after lost export acknowledgement replays the atomic receipt without duplicate work',
      { exportOutcome, droppedReplies: damaged.state.droppedReplies },
    );
    const beforeSample = await workers[1].request('sample');
    const isolatedContext = await workers[1].request('context', { owner: String(users[133]._id) });
    const afterSample = await workers[1].request('sample');
    report.isolatedContextRead = {
      driverCommands: afterSample.pool.commands - beforeSample.pool.commands,
      sources: isolatedContext.sources.map(({ key, status }) => ({ key, status })),
      poolWaitP95Ms: afterSample.pool.waitP95Ms,
    };
    check(
      report.isolatedContextRead.driverCommands <= 10 && isolatedContext.sources.length === 8,
      'Isolated real context composition has a bounded measured command count',
      report.isolatedContextRead,
    );
    check(
      afterRetry.xpPoints === 0 && afterRetry.tasks.every((task) => !task.isCompleted),
      'Lost acknowledgement/retry grants no completion or XP',
    );
    const stalledRedis = workers[0].redisProxy;
    stalledRedis.state.mode = 'blackhole';
    const redisPressure = await workers[0].request('redis-pressure');
    report.redisPressure = redisPressure;
    const firstQueue = redisPressure.snapshots[1].queue.total,
      lastQueue = redisPressure.snapshots[2].queue.total;
    check(
      lastQueue <= Math.max(firstQueue, 2000),
      'Redis SDK queue stays bounded across repeated timed-out command batches',
      redisPressure,
    );
    const pressureAdmission = await call('evaluate', 133, 0);
    check(
      pressureAdmission.status === 503 && pressureAdmission.retryAfter === '2',
      'Pending Redis command pressure keeps actual Scenario admission fail-closed',
      { status: pressureAdmission.status, elapsedMs: pressureAdmission.elapsedMs },
    );
    stalledRedis.state.mode = 'pass';
    stalledRedis.reset();
    await sleep(1000);
    const drainedRedis = await workers[0].request('redis-queue');
    check(
      drainedRedis.queue.total === 0,
      'Redis SDK pending commands drain after actual socket reset',
      drainedRedis,
    );
    report.status = report.failures.length ? 'FAIL' : 'ACK_RECOVERY_PASS';
    if (report.failures.length) process.exitCode = 1;
    return;
  }
  report.engine = await Promise.all(
    workers.map((item) => item.request('engine', { count: smoke ? 100 : 1000, input })),
  );
  check(
    report.engine.every((value) => value.p95 <= 5 && value.p99 <= 15),
    'Pure deterministic engine at 100 evaluations/sec/instance meets p95/p99 thresholds',
    report.engine,
  );
  report.coldStartWarmup = [];
  for (let round = 0; round < 2; round++)
    for (const operation of ['context', 'evaluate', 'history', 'save', 'export']) {
      for (let instance = 0; instance < 2; instance++) {
        const value = await call(operation, 137, instance);
        report.coldStartWarmup.push({
          operation,
          instance,
          status: value.status,
          elapsedMs: value.elapsedMs,
        });
      }
    }
  // Avoid a minute-boundary split in the distributed quota assertions.
  if (Date.now() % 60000 > 45000) await sleep(60000 - (Date.now() % 60000) + 20);
  for (const [offset, operation, limit, expected] of [
    [0, 'evaluate', 60, 200],
    [1, 'context', 30, 200],
    [2, 'refresh', 6, 200],
    [3, 'history', 60, 200],
    [4, 'save', 20, 201],
    [5, 'export', 10, 200],
    [6, 'delete', 20, 404],
  ]) {
    const owner = 110 + offset;
    const responses = await Promise.all(
      Array.from({ length: limit + 5 }, (_, index) => call(operation, owner, index % 2)),
    );
    const accepted = responses.filter((value) => value.status === expected).length;
    const denied = responses.filter((value) => value.status === 429).length;
    check(
      accepted === limit &&
        denied === 5 &&
        responses
          .filter((value) => value.status === 429)
          .every((value) => value.retryAfter === '60'),
      `Two real instances share ${operation} quota ${limit}/minute`,
      { accepted, denied, statuses: responses.map((value) => value.status) },
    );
  }
  await workers[0].request('stop');
  workers[0] = await worker(workers[0].mongoProxy, workers[0].redisProxy);
  check(
    (await call('evaluate', 110, 0)).status === 429 &&
      (await call('evaluate', 117, 0)).status === 200,
    'Quota survives application restart and remains account isolated',
  );
  report.quotaKeys = { count: await redis.dbSize(), ttls: [] };
  for await (const key of redis.scanIterator({ MATCH: 'scenario:quota:*', COUNT: 100 }))
    report.quotaKeys.ttls.push(await redis.pTTL(key));
  check(
    report.quotaKeys.ttls.every((value) => value > 0 && value <= 60000),
    'Real Redis quota keys have bounded TTL',
  );
  // Actual TCP failures, no fake Redis or model results.
  for (const item of workers) item.redisProxy.state.mode = 'blackhole';
  const redisStall = await Promise.all([call('evaluate', 118, 0), call('evaluate', 118, 1)]);
  check(
    redisStall.every(
      (value) => value.status === 503 && value.elapsedMs < 1000 && value.retryAfter === '2',
    ),
    'Redis TCP blackhole fails closed on both instances within bounded time',
    redisStall.map(({ status, elapsedMs }) => ({ status, elapsedMs })),
  );
  for (const item of workers) {
    item.redisProxy.state.mode = 'pass';
    item.redisProxy.reset();
  }
  let restored = false;
  const recoveryStarted = performance.now();
  while (performance.now() - recoveryStarted < 25000) {
    await sleep(500);
    if (
      (await call('evaluate', 119, 0)).status === 200 &&
      (await call('evaluate', 119, 1)).status === 200
    ) {
      restored = true;
      break;
    }
  }
  check(
    restored,
    'Real Redis disconnect/reconnect restores both instances without local quota fallback',
    { recoveryMs: performance.now() - recoveryStarted },
  );
  const slow = workers[0].mongoProxy;
  slow.state.delayMs = 1600;
  slow.state.collection = 'publicprofiles';
  const contextStarted = performance.now();
  const degraded = await call('context', 120, 0);
  slow.state.delayMs = 0;
  check(
    degraded.status === 200 &&
      degraded.body.context.degraded &&
      degraded.body.context.sources.find((source) => source.key === 'portfolio').status ===
        'timeout' &&
      degraded.body.context.sources.find((source) => source.key === 'integrations').status ===
        'available' &&
      performance.now() - contextStarted < 2200,
    'Real Mongo wire stall affects only one source; healthy evidence survives within 2.2 sec',
    {
      status: degraded.status,
      elapsedMs: degraded.elapsedMs,
      sources: degraded.body.context?.sources.map(({ key, status }) => ({ key, status })),
      delayedFrames: slow.state.delayedFrames,
    },
  );
  await sleep(1800);
  check(
    (await call('context', 121, 0)).body.context.sources.find(
      (source) => source.key === 'portfolio',
    ).status === 'available',
    'Real Mongo aborted-source connections recover after the stall',
  );
  slow.state.delayMs = 900;
  slow.state.collection = null;
  const saturation = await Promise.all(
    Array.from({ length: 340 }, (_, index) =>
      workers[0].request('context', { owner: String(users[index % users.length]._id) }).then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, status: error.statusCode }),
      ),
    ),
  );
  slow.state.delayMs = 0;
  await sleep(2200);
  const afterFault = await workers[0].request('sample', { gc: true });
  check(
    saturation.some((value) => value.status === 503) &&
      afterFault.context.active === 0 &&
      afterFault.context.pending === 0 &&
      afterFault.context.joiners === 0 &&
      afterFault.contextPeak.active <= 32 &&
      afterFault.contextPeak.joiners <= 256,
    'Real Mongo delay flood enforces context admission bounds and drains pending work',
    { rejected: saturation.filter((value) => !value.ok).length, sample: afterFault },
  );
  slow.state.delayMs = 900;
  slow.state.collection = 'users';
  const hot = await Promise.all(
    Array.from({ length: 400 }, () =>
      workers[0].request('context', { owner: String(users[125]._id) }).then(
        () => 200,
        (error) => error.statusCode,
      ),
    ),
  );
  slow.state.delayMs = 0;
  await sleep(1200);
  const hotSample = await workers[0].request('sample', { gc: true });
  check(
    hot.filter((status) => status === 503).length >= 143 &&
      hotSample.contextPeak.joiners === 256 &&
      hotSample.context.pending === 0,
    'Hot-account singleflight caps joiners at 256 and drains after real driver abort',
    {
      statuses: hot.reduce(
        (result, status) => ((result[status] = (result[status] || 0) + 1), result),
        {},
      ),
      sample: hotSample,
    },
  );
  slow.state.delayMs = 1800;
  slow.state.collection = 'users';
  const pressure = await workers[0].request('pool-pressure');
  slow.state.delayMs = 0;
  await sleep(2000);
  const poolSample = await workers[0].request('sample', { gc: true });
  check(
    pressure.completed === 160 &&
      poolSample.pool.peakCheckedOut <= 100 &&
      poolSample.pool.peakWaiting > 0 &&
      poolSample.pool.waiting === 0 &&
      poolSample.pool.checkedOut === 0,
    'Real Mongo pool pressure queues and drains without lost queries',
    { pressure, sample: poolSample },
  );
  report.faults = {
    redisStall: redisStall.map(({ status, elapsedMs }) => ({ status, elapsedMs })),
    afterFault,
    hotSample,
    poolSample,
  };
  // 1,000 immutable evaluations owned by one heavy fixture account.
  const heavy = users[139]._id;
  await Scenario.collection.insertMany(
    Array.from({ length: 1000 }, (_, index) => ({
      userId: heavy,
      scenarioHash: `p3-heavy-${index}`,
      name: 'Heavy fixture',
      createdAt: new Date(Date.now() - index),
      result: { historicalFixture: true },
    })),
  );
  report.explain = {};
  for (const [label, query] of [
    [
      'history',
      Scenario.collection.find({ userId: heavy }).sort({ createdAt: -1, _id: -1 }).limit(20),
    ],
    ['unique', Scenario.collection.find({ userId: heavy, scenarioHash: 'p3-heavy-500' }).limit(1)],
  ]) {
    const explain = await query.explain('executionStats');
    report.explain[label] = {
      plan: explain.queryPlanner.winningPlan,
      returned: explain.executionStats.nReturned,
      keysExamined: explain.executionStats.totalKeysExamined,
      docsExamined: explain.executionStats.totalDocsExamined,
    };
    check(
      explain.executionStats.totalDocsExamined <= explain.executionStats.nReturned * 2 &&
        !JSON.stringify(explain.queryPlanner.winningPlan).includes('"stage":"SORT"'),
      `Real ${label} query uses bounded index access`,
      report.explain[label],
    );
  }
  // Fault tests need an intercepting Redis proxy. Normal capacity measurements use
  // the direct shared Redis endpoint, avoiding verifier scheduling on the quota path.
  for (let instance = 0; instance < 2; instance++) {
    const prior = workers[instance];
    await prior.request('stop');
    workers[instance] = await worker(prior.mongoProxy, { port: redisPort });
  }
  report.environment.normalTrafficRedisPath =
    'direct loopback WSL Redis; proxy used only for explicit Redis fault tests';
  const protectedBefore = createHash('sha256')
    .update(JSON.stringify(await Scenario.findOne({ userId: users[0]._id }).lean()))
    .digest('hex');
  const operations = ['context', 'evaluate', 'history', 'save', 'export'];
  const operationSequence = operations.flatMap((value, index) =>
    Array([40, 35, 15, 8, 2][index]).fill(value),
  );
  const counters = Object.fromEntries(operations.map((value) => [value, 0]));
  let sequence = 0;
  async function samples(label) {
    const values = await Promise.all(
      workers.map((item) => item.request('sample', { gc: label !== 'periodic' })),
    );
    const mongoStatus = await mongoose.connection.db.admin().serverStatus();
    report.samples.push({
      generator: { memory: process.memoryUsage(), cpu: process.cpuUsage() },
      mongo: {
        memory: mongoStatus.mem,
        connections: mongoStatus.connections,
        cursors: mongoStatus.metrics?.cursor?.open,
      },
      at: new Date().toISOString(),
      label,
      workers: values,
      phase: report.phases.at(-1)?.label,
      redisMemory: (await redis.info('memory'))
        .split('\r\n')
        .filter((line) => /^(used_memory|used_memory_peak|used_memory_rss):/.test(line)),
    });
    persist();
    return values;
  }
  async function load(label, seconds, rps) {
    const histogram = Object.fromEntries(
      operations.map((operation) => [operation, new Histogram()]),
    );
    const statuses = {};
    const pending = new Set();
    const phase = {
      label,
      seconds,
      rps,
      scheduled: seconds * rps,
      completed: 0,
      statuses,
      errors: [],
      errorClasses: {},
      healthyContexts: 0,
      degradedContexts: 0,
      peakPending: 0,
      startedAt: new Date().toISOString(),
    };
    report.phases.push(phase);
    persist();
    const start = performance.now();
    for (let index = 0; index < seconds * rps; index++) {
      const operation = operationSequence[sequence % 100];
      const owner = counters[operation]++ % 100;
      const instance = sequence++ % 2;
      if (pending.size >= 256) {
        phase.errors.push('Load generator concurrency cap reached');
        await Promise.race(pending);
      }
      const task = call(operation, owner, instance)
        .then(
          (value) => {
            if (value.status < 400) histogram[operation].add(value.elapsedMs);
            if (operation === 'context' && value.status === 200) {
              if (value.body.context?.degraded) phase.degradedContexts++;
              else phase.healthyContexts++;
            }
            if (value.status >= 500)
              phase.errorClasses[value.body?.message || String(value.status)] =
                (phase.errorClasses[value.body?.message || String(value.status)] || 0) + 1;
            statuses[value.status] = (statuses[value.status] || 0) + 1;
            phase.completed++;
            if (value.status >= 500 && phase.errors.length < 20)
              phase.errors.push(`${operation}:HTTP ${value.status}`);
          },
          (error) => {
            statuses.network = (statuses.network || 0) + 1;
            if (phase.errors.length < 20) phase.errors.push(error.message);
            phase.completed++;
          },
        )
        .finally(() => pending.delete(task));
      pending.add(task);
      phase.peakPending = Math.max(phase.peakPending, pending.size);
      const remaining = start + ((index + 1) * 1000) / rps - performance.now();
      if (remaining > 0) await sleep(remaining);
    }
    await Promise.all(pending);
    phase.elapsedMs = performance.now() - start;
    phase.admittedRequests = (statuses[200] || 0) + (statuses[201] || 0);
    phase.quotaRejected = statuses[429] || 0;
    phase.successfulThroughputRps = phase.admittedRequests / (phase.elapsedMs / 1000);
    phase.finishedAt = new Date().toISOString();
    phase.latency = Object.fromEntries(
      operations.map((operation) => [operation, histogram[operation].json()]),
    );
    check(
      phase.errors.length === 0 &&
        !statuses.network &&
        !Object.keys(statuses).some((status) => Number(status) >= 500),
      `${label}: no unexpected network/5xx failure`,
      phase,
    );
    const limits = { context: 500, evaluate: 200, history: 150, save: 500, export: 500 };
    if (label !== 'warmup')
      check(
        operations.every(
          (operation) =>
            phase.latency[operation].p95Ms <=
            (label === 'source-timeout-under-load' && operation === 'context'
              ? 2200
              : limits[operation]),
        ) && phase.latency.context.p99Ms <= (label === 'source-timeout-under-load' ? 2200 : 1000),
        `${label}: unchanged normal HTTP latency targets`,
        phase.latency,
      );
    await samples(label);
    persist();
  }
  // Keep fault injection in its own phases. The in-process Redis forwarding hop
  // competes with the HTTP generator and caused healthy Lua replies to miss 150 ms.
  // Quotas, their deadline and the real shared Redis instance are unchanged.
  for (let instance = 0; instance < workers.length; instance++) {
    const previous = workers[instance];
    await previous.request('stop');
    workers[instance] = await worker(previous.mongoProxy, { port: redisPort });
  }
  report.capacityTransport = 'Mongo fault proxy; direct shared Redis; no CPU profiler';
  await load('warmup', smoke ? 5 : 60, 20);
  let baseline = await samples('post-warmup-baseline');
  let sampleBusy = false;
  checkpoint = setInterval(async () => {
    if (sampleBusy) return;
    sampleBusy = true;
    try {
      await samples('periodic');
      console.log(
        JSON.stringify({
          at: new Date().toISOString(),
          phase: report.phases.at(-1)?.label,
          completed: report.phases.at(-1)?.completed,
          failures: report.failures.length,
        }),
      );
    } catch (error) {
      report.failures.push('Sampling: ' + error.message);
    } finally {
      sampleBusy = false;
    }
  }, 60000);
  await load('steady-15min', smoke ? 5 : 900, 20);
  await load('burst-60sec', smoke ? 5 : 60, 100);
  for (const item of workers) {
    item.mongoProxy.state.delayMs = 1600;
    item.mongoProxy.state.collection = 'publicprofiles';
  }
  await load('source-timeout-under-load', smoke ? 3 : 60, 20);
  for (const item of workers) item.mongoProxy.state.delayMs = 0;
  await sleep(1800);
  for (const item of workers) {
    item.mongoProxy.state.delayMs = 40;
    item.mongoProxy.state.collection = null;
  }
  await load('mongo-latency-under-load', smoke ? 3 : 60, 20);
  for (const item of workers) item.mongoProxy.state.delayMs = 0;
  const restarting = workers[0];
  restarting.draining = true;
  const restartDuringLoad = (async () => {
    await sleep(1000);
    await restarting.request('stop');
    workers[0] = await worker(restarting.mongoProxy, restarting.redisProxy);
    report.workerRestart = {
      oldPid: restarting.pid,
      newPid: workers[0].pid,
      at: new Date().toISOString(),
      routing:
        'verifier routes away from draining worker; real load balancer remains deployment gate',
    };
  })();
  await load('rolling-restart-under-load', smoke ? 5 : 60, 20);
  await restartDuringLoad;
  check(
    (
      await workers[0].request('export', {
        owner: String(users[130]._id),
        sprintId: String(sprints[130]._id),
        scenario: saved[130],
      })
    ).replayed,
    'Durable export receipt replays after application restart',
  );
  baseline = await samples('soak-baseline');
  await load('soak-60min', smoke ? 5 : 3600, 20);
  clearInterval(checkpoint);
  checkpoint = null;
  await sleep(2000);
  const final = await samples('drained-final');
  report.resourceChecks = final.map((value, index) => ({
    instance: index,
    heapBaseline: baseline[index].memory.heapUsed,
    heapFinal: value.memory.heapUsed,
    heapGrowth:
      (value.memory.heapUsed - baseline[index].memory.heapUsed) / baseline[index].memory.heapUsed,
    peakSampledHeap: Math.max(
      ...report.samples.map((sample) => sample.workers[index].memoryBeforeGc.heapUsed),
    ),
    cpuPercentOfOneCore:
      (100 *
        (value.cpu.user +
          value.cpu.system -
          baseline[index].cpu.user -
          baseline[index].cpu.system)) /
      (Date.parse(report.samples.at(-1).at) -
        Date.parse(report.samples.find((sample) => sample.label === 'soak-baseline').at)) /
      1000,
    context: value.context,
    pool: value.pool,
  }));
  check(
    report.resourceChecks.every(
      (value) =>
        value.peakSampledHeap < 256 * 1024 * 1024 &&
        value.heapFinal < 256 * 1024 * 1024 &&
        value.heapGrowth < 0.1 &&
        value.cpuPercentOfOneCore < 70 &&
        value.context.active === 0 &&
        value.context.joiners === 0 &&
        value.context.pending === 0 &&
        value.pool.checkedOut === 0 &&
        value.pool.waiting === 0,
    ),
    'Post-warmup heap <256 MB, soak growth <10%, context and Mongo pool queues drain',
    report.resourceChecks,
  );
  check(
    protectedBefore ===
      createHash('sha256')
        .update(JSON.stringify(await Scenario.findOne({ userId: users[0]._id }).lean()))
        .digest('hex'),
    'Existing immutable snapshot remains byte-equivalent after full workload',
  );
  const duplicates = await Scenario.aggregate([
    { $group: { _id: { owner: '$userId', hash: '$scenarioHash' }, n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $limit: 1 },
  ]);
  check(duplicates.length === 0, 'No duplicate owned evaluation snapshots after workload');
  const sprint = await Sprint.findById(sprints[0]._id).lean();
  check(
    sprint.tasks.length === 1 &&
      sprint.scenarioReceipts.length === 1 &&
      sprint.xpPoints === 0 &&
      sprint.tasks.every((task) => !task.isCompleted),
    'Export replay creates one receipt/task with no fabricated completion or XP',
  );
  check(
    (await call('history', 0, 0)).body.history.every(
      (item) => String(item.userId) === String(users[0]._id),
    ),
    'Authoritative history remains account isolated',
  );
  report.cpuIntervals = [];
  for (let index = 1; index < report.samples.length; index++) {
    const before = report.samples[index - 1],
      after = report.samples[index];
    const elapsedMs = Date.parse(after.at) - Date.parse(before.at);
    if (elapsedMs < 1000 || before.phase !== after.phase) continue;
    for (let instance = 0; instance < 2; instance++) {
      const a = before.workers[instance],
        b = after.workers[instance];
      if (a.pid !== b.pid) continue;
      report.cpuIntervals.push({
        instance,
        phase: after.phase,
        elapsedMs,
        percentOfOneCore:
          (100 * (b.cpu.user + b.cpu.system - a.cpu.user - a.cpu.system)) / (elapsedMs * 1000),
      });
    }
  }
  check(
    report.cpuIntervals
      .filter((value) => ['steady-15min', 'soak-60min'].includes(value.phase))
      .every((value) => value.percentOfOneCore < 70),
    'Sampled steady/soak worker CPU stays below 70% of one core',
    report.cpuIntervals,
  );
  report.metrics = await Promise.all(workers.map((item) => item.request('metrics')));
  if (report.failures.length) process.exitCode = 1;
  report.status = report.failures.length
    ? 'FAIL'
    : smoke
      ? 'SMOKE_PASS_NOT_EXTENDED_ACCEPTANCE'
      : 'PASS_LOCAL_WITH_DEPLOYMENT_GATES';
}

main()
  .catch((error) => {
    report.status = 'FAIL';
    report.failures.push(error.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    await redisTrace?.close();
    if (checkpoint) clearInterval(checkpoint);
    for (const item of workers) {
      try {
        if (item.child.connected) await item.request('stop', {}, 10000);
      } catch {
        item.child.kill();
      }
    }
    for (const item of proxies) await item.close();
    if (redis?.isReady) {
      try {
        await redis.sendCommand(['SHUTDOWN', 'NOSAVE']);
      } catch {}
    } else if (redis?.isOpen) redis.disconnect();
    await mongoose.disconnect();
    if (mongo?.child.exitCode === null) {
      const stopped = once(mongo.child, 'exit');
      mongo.child.kill();
      await stopped;
    }
    // Exact task-created config file; never recursive deletion or shared Redis cleanup.
    if (
      redisConfig &&
      path.dirname(redisConfig) === output &&
      path.basename(redisConfig) === `p3-redis-${runId}.conf`
    )
      fs.unlinkSync(redisConfig);
    const removedTemporaryFiles = [];
    if (mongo?.directory) {
      const owned = fs.realpathSync(mongo.directory);
      if (
        path.dirname(owned) !== fs.realpathSync(os.tmpdir()) ||
        !path.basename(owned).startsWith('devinsight-p3-')
      )
        throw Error('Unexpected temporary directory ownership.');
      for (const folder of [
        owned,
        ...['journal', 'diagnostic.data']
          .map((name) => path.join(owned, name))
          .filter((folder) => fs.existsSync(folder)),
      ]) {
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
          if (!entry.isFile()) continue;
          const candidate = fs.realpathSync(path.join(folder, entry.name));
          if (!candidate.startsWith(owned + path.sep)) throw Error('Unsafe temporary file path.');
          fs.unlinkSync(candidate);
          removedTemporaryFiles.push(candidate);
        }
      }
    }
    report.removedTemporaryFiles = removedTemporaryFiles;
    if (redisProcess?.exitCode === null)
      await Promise.race([once(redisProcess, 'exit'), sleep(3000)]);
    report.finishedAt = new Date().toISOString();
    report.runtimeDirectory = mongo?.directory;
    report.cleanup = {
      workersStopped: workers.every((item) => !item.child.connected),
      mongoStopped: mongo?.child.exitCode !== null || mongo?.child.signalCode !== null,
      redisShutdownRequested: true,
      redisProcessExitCode: redisProcess?.exitCode,
      recursiveDeletion: false,
    };
    persist();
    console.log(JSON.stringify({ status: report.status, evidence, failures: report.failures }));
  });
