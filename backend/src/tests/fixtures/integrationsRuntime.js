'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { MongoClient } = require('mongodb');
const { createClient } = require('redis');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function port() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
async function start() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devinsight-integrations-'));
  const mongoPort = await port();
  const redisPort = await port();
  const mongo = spawn(
    process.env.INTEGRATION_TEST_MONGOD || 'mongod',
    [
      '--dbpath',
      directory,
      '--bind_ip',
      '127.0.0.1',
      '--port',
      String(mongoPort),
      '--replSet',
      'integration-test',
      '--wiredTigerCacheSizeGB',
      '0.25',
      '--quiet'
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] }
  );
  const redisBinary = '/tmp/devinsight-scenario-redis-p3-20261025/redis-7.2.11/src/redis-server';
  const redis = spawn(
    'wsl',
    [
      '-d',
      'Ubuntu',
      '--exec',
      'sh',
      '-c',
      `exec ${redisBinary} --bind 127.0.0.1 --port ${redisPort} --save '' --appendonly no --maxmemory 64mb --maxmemory-policy noeviction`
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let redisDiagnostic = '';
  for (const stream of [redis.stdout, redis.stderr])
    stream?.on('data', (data) => {
      redisDiagnostic = (redisDiagnostic + data).slice(-4000);
    });
  let launchError;
  for (const child of [mongo, redis])
    child.on('error', (error) => {
      launchError = error;
    });
  const redisUrl = `redis://127.0.0.1:${redisPort}`;
  const directUri = `mongodb://127.0.0.1:${mongoPort}/integration_acceptance?directConnection=true`;
  let client;
  let redisClient;
  const waitExit = async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(5000)]);
  };
  async function stop() {
    if (redisClient?.isOpen) {
      try {
        await redisClient.sendCommand(['SHUTDOWN', 'NOSAVE']);
      } catch {
        /* Shutdown closes its own socket. */
      }
      if (redisClient.isOpen) await redisClient.disconnect();
    }
    await client?.close();
    if (mongo.exitCode === null && mongo.signalCode === null) mongo.kill();
    await Promise.all([waitExit(mongo), waitExit(redis)]);
    if (redis.exitCode === null && redis.signalCode === null) redis.kill();
    // Only this fixture's files; verify containment for each exact path. No recursive deletion.
    const root = fs.realpathSync(directory);
    let filesRemoved = 0;
    const clean = (dir) => {
      for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const target = path.join(dir, item.name);
        if (!target.startsWith(root + path.sep)) throw Error('Unsafe fixture path.');
        if (item.isDirectory()) clean(target);
        else {
          fs.unlinkSync(target);
          filesRemoved++;
        }
      }
    };
    if (mongo.exitCode !== null || mongo.signalCode !== null) clean(root);
    if (mongo.exitCode === null && mongo.signalCode === null)
      throw Error('Disposable Mongo did not stop.');
    if (redis.exitCode === null && redis.signalCode === null) {
      await waitExit(redis);
      if (redis.exitCode === null && redis.signalCode === null)
        throw Error('Disposable Redis did not stop.');
    }
    return {
      mongoStopped: true,
      redisStopped: true,
      filesRemoved,
      applicationDatabasesUsed: false,
      quotaResets: 0,
      recursiveDeletion: false
    };
  }
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (launchError) throw launchError;
      try {
        client = new MongoClient(directUri, { serverSelectionTimeoutMS: 300 });
        await client.connect();
        break;
      } catch {
        await client?.close();
        client = null;
        await delay(100);
      }
    }
    if (!client) throw Error('Disposable Mongo startup failed.');
    await client.db('admin').command({
      replSetInitiate: {
        _id: 'integration-test',
        members: [{ _id: 0, host: `127.0.0.1:${mongoPort}` }]
      }
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await client.db('admin').command({ hello: 1 })).isWritablePrimary) break;
      await delay(100);
    }
    // WSL may accept its port after Mongo has already elected its primary.
    let redisReady = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      redisReady = await new Promise((resolve) => {
        const socket = net.connect(redisPort, '127.0.0.1');
        socket.setTimeout(300);
        const finish = (ready) => {
          socket.destroy();
          resolve(ready);
        };
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
        socket.once('timeout', () => finish(false));
      });
      if (redisReady) break;
      if (redis.exitCode !== null)
        throw Error('Disposable Redis exited before readiness: ' + redisDiagnostic);
      await delay(100);
    }
    if (!redisReady) throw Error('Disposable Redis readiness timed out.');
    redisClient = createClient({
      url: redisUrl,
      socket: { reconnectStrategy: false, connectTimeout: 3000 }
    });
    redisClient.on('error', () => {});
    await redisClient.connect();
    return {
      uri: `mongodb://127.0.0.1:${mongoPort}/integration_acceptance?replicaSet=integration-test`,
      redisUrl,
      redisClient,
      stop,
      directory
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
module.exports = { start };
