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

function parseResp(buffer) {
  const line = (offset) => {
    const end = buffer.indexOf('\r\n', offset);
    return end < 0 ? null : { value: buffer.toString('utf8', offset, end), next: end + 2 };
  };
  const header = line(0);
  if (!header) return null;
  if (!header.value.startsWith('*')) throw Error('RESP array required');
  const count = Number(header.value.slice(1));
  let offset = header.next;
  const parts = [];
  for (let index = 0; index < count; index++) {
    const size = line(offset);
    if (!size) return null;
    if (!size.value.startsWith('$')) throw Error('RESP bulk string required');
    const length = Number(size.value.slice(1));
    if (buffer.length < size.next + length + 2) return null;
    parts.push(buffer.toString('utf8', size.next, size.next + length));
    offset = size.next + length + 2;
  }
  return { parts, bytes: offset };
}

async function startLoopbackRedis(redisPort) {
  const sockets = new Set();
  const values = new Map();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let pending = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      try {
        let parsed;
        while ((parsed = parseResp(pending))) {
          pending = pending.subarray(parsed.bytes);
          const [command, key, value, ...options] = parsed.parts;
          const name = command.toUpperCase();
          switch (name) {
            case 'CLIENT':
            case 'AUTH':
            case 'SELECT':
              socket.write('+OK\r\n');
              break;
            case 'PING':
              socket.write('+PONG\r\n');
              break;
            case 'SET': {
              const index = options.findIndex((part) => ['EX', 'PX'].includes(part.toUpperCase()));
              const ttl =
                index < 0
                  ? 60000
                  : Number(options[index + 1]) * (options[index].toUpperCase() === 'EX' ? 1000 : 1);
              values.set(key, { value, expiresAt: Date.now() + ttl });
              socket.write('+OK\r\n');
              break;
            }
            case 'GET': {
              const entry = values.get(key);
              socket.write(
                entry && entry.expiresAt > Date.now()
                  ? `$${Buffer.byteLength(entry.value)}\r\n${entry.value}\r\n`
                  : '$-1\r\n',
              );
              break;
            }
            case 'DEL': {
              let count = 0;
              for (const k of [key, value, ...options].filter(Boolean)) {
                if (values.delete(k)) count++;
              }
              socket.write(`:${count}\r\n`);
              break;
            }
            case 'MGET': {
              const keys = [key, value, ...options].filter(Boolean);
              let resp = `*${keys.length}\r\n`;
              for (const k of keys) {
                const entry = values.get(k);
                if (entry && entry.expiresAt > Date.now()) {
                  resp += `$${Buffer.byteLength(entry.value)}\r\n${entry.value}\r\n`;
                } else {
                  resp += '$-1\r\n';
                }
              }
              socket.write(resp);
              break;
            }
            case 'SCAN': {
              const patternIndex = options.findIndex((opt) => opt.toUpperCase() === 'MATCH');
              const pattern = patternIndex >= 0 ? options[patternIndex + 1] : null;
              const regex = pattern ? new RegExp('^' + pattern.replace(/\*/g, '.*') + '$') : null;
              const matched = [];
              for (const k of values.keys()) {
                if (!regex || regex.test(k)) matched.push(k);
              }
              let resp = `*2\r\n$1\r\n0\r\n*${matched.length}\r\n`;
              for (const k of matched) resp += `$${Buffer.byteLength(k)}\r\n${k}\r\n`;
              socket.write(resp);
              break;
            }
            case 'PTTL': {
              const entry = values.get(key);
              if (!entry) socket.write(':-2\r\n');
              else socket.write(`:${Math.max(0, entry.expiresAt - Date.now())}\r\n`);
              break;
            }
            case 'TTL': {
              const entry = values.get(key);
              if (!entry) socket.write(':-2\r\n');
              else
                socket.write(
                  `:${Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000))}\r\n`,
                );
              break;
            }
            case 'EXPIRE': {
              const entry = values.get(key);
              if (entry) {
                entry.expiresAt = Date.now() + Number(options[0] || value) * 1000;
                socket.write(':1\r\n');
              } else {
                socket.write(':0\r\n');
              }
              break;
            }
            case 'EVAL': {
              const script = key;
              const numKeys = Number(value);
              const evalKeys = options.slice(0, numKeys);
              const evalArgs = options.slice(numKeys);
              if (script.includes('PTTL')) {
                const k = evalKeys[0];
                const entry = values.get(k);
                if (!entry || entry.expiresAt <= Date.now()) {
                  socket.write('*2\r\n$-1\r\n:-2\r\n');
                } else {
                  const remaining = Math.max(0, entry.expiresAt - Date.now());
                  socket.write(
                    `*2\r\n$${Buffer.byteLength(entry.value)}\r\n${entry.value}\r\n:${remaining}\r\n`,
                  );
                }
              } else if (script.includes("redis.call('GET', KEYS[1]) == ARGV[1]")) {
                const k = evalKeys[0];
                const expected = evalArgs[0];
                const entry = values.get(k);
                if (entry && entry.value === expected) {
                  values.delete(k);
                  socket.write(':1\r\n');
                } else {
                  socket.write(':0\r\n');
                }
              } else {
                socket.write('$-1\r\n');
              }
              break;
            }
            case 'FLUSHDB':
            case 'FLUSHALL':
              values.clear();
              socket.write('+OK\r\n');
              break;
            case 'SHUTDOWN':
            case 'QUIT':
              socket.end('+OK\r\n');
              break;
            default:
              socket.write('+OK\r\n');
          }
        }
      } catch {
        socket.destroy();
      }
    });
  });
  await new Promise((resolve) => server.listen(redisPort, '127.0.0.1', resolve));
  return {
    server,
    async stop() {
      for (const s of sockets) s.destroy();
      if (server.listening) await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function start() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devinsight-integrations-'));
  const mongoPort = await port();
  const redisPort = await port();
  const mongoBinary =
    process.env.INTEGRATION_TEST_MONGOD ||
    (fs.existsSync('C:\\Program Files\\MongoDB\\Server\\8.2\\bin\\mongod.exe')
      ? 'C:\\Program Files\\MongoDB\\Server\\8.2\\bin\\mongod.exe'
      : 'mongod');
  const mongo = spawn(
    mongoBinary,
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
      '--quiet',
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] },
  );

  let redisChild = null;
  let redisServer = null;
  let redisDiagnostic = '';
  let launchError;

  if (process.platform === 'win32' || process.env.USE_LOOPBACK_REDIS === 'true') {
    redisServer = await startLoopbackRedis(redisPort);
  } else {
    const redisBinary = '/tmp/devinsight-scenario-redis-p3-20261025/redis-7.2.11/src/redis-server';
    redisChild = spawn(
      'wsl',
      [
        '-d',
        'Ubuntu',
        '--exec',
        'sh',
        '-c',
        `exec ${redisBinary} --bind 127.0.0.1 --port ${redisPort} --save '' --appendonly no --maxmemory 64mb --maxmemory-policy noeviction`,
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    for (const stream of [redisChild.stdout, redisChild.stderr])
      stream?.on('data', (data) => {
        redisDiagnostic = (redisDiagnostic + data).slice(-4000);
      });
    redisChild.on('error', (error) => {
      launchError = error;
    });
  }

  mongo.on('error', (error) => {
    launchError = error;
  });

  const redisUrl = `redis://127.0.0.1:${redisPort}`;
  const directUri = `mongodb://127.0.0.1:${mongoPort}/integration_acceptance?directConnection=true`;
  let client;
  let redisClient;
  const waitExit = async (child) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
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
    await Promise.all([waitExit(mongo), waitExit(redisChild)]);
    if (redisChild && redisChild.exitCode === null && redisChild.signalCode === null)
      redisChild.kill();
    if (redisServer) await redisServer.stop();
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
    if (redisChild && redisChild.exitCode === null && redisChild.signalCode === null) {
      await waitExit(redisChild);
      if (redisChild.exitCode === null && redisChild.signalCode === null)
        throw Error('Disposable Redis did not stop.');
    }
    return {
      mongoStopped: true,
      redisStopped: true,
      filesRemoved,
      applicationDatabasesUsed: false,
      quotaResets: 0,
      recursiveDeletion: false,
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
        members: [{ _id: 0, host: `127.0.0.1:${mongoPort}` }],
      },
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
      if (redisChild && redisChild.exitCode !== null)
        throw Error('Disposable Redis exited before readiness: ' + redisDiagnostic);
      await delay(100);
    }
    if (!redisReady) throw Error('Disposable Redis readiness timed out.');
    redisClient = createClient({
      url: redisUrl,
      socket: { reconnectStrategy: false, connectTimeout: 3000 },
    });
    redisClient.on('error', () => {});
    await redisClient.connect();
    return {
      uri: `mongodb://127.0.0.1:${mongoPort}/integration_acceptance?replicaSet=integration-test`,
      redisUrl,
      redisClient,
      stop,
      directory,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
module.exports = { start };
