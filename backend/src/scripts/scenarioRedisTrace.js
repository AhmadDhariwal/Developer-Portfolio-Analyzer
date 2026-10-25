'use strict';

// Isolated Redis observer. No forwarding hop is inserted in application traffic.
const net = require('node:net');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
const stamp = () => performance.timeOrigin + performance.now();
module.exports = async (redis, port) => {
  const socket = net.connect(port, '127.0.0.1');
  socket.setNoDelay(true);
  let buffer = '',
    phaseStart = stamp(),
    probeTimer,
    heartbeat,
    busy = false,
    lastTick = stamp();
  const counts = new Map(),
    commands = [],
    probes = [],
    pauses = [];
  const limit = (array, value, maximum) => {
    if (array.length >= maximum) throw Error('Redis trace storage bound exceeded.');
    array.push(value);
  };
  const ready = new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (buffer.length > 65536) throw Error('MONITOR parser buffer bound exceeded.');
      let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (line === '+OK') {
          resolve();
          continue;
        }
        const match = /^\+(\d+\.\d+) .*?"INCR" "(scenario:quota:[^"]+)"$/i.exec(line);
        if (!match) continue;
        const key = match[2],
          counter = (counts.get(key) || 0) + 1;
        if (!counts.has(key) && counts.size >= 4096) throw Error('Monitor key bound exceeded.');
        counts.set(key, counter);
        if (stamp() >= phaseStart)
          limit(commands, { serverAt: Number(match[1]) * 1000, key, counter }, 8192);
      }
    });
  });
  await once(socket, 'connect');
  socket.write('*1\r\n$7\r\nMONITOR\r\n');
  await ready;
  const probe = redis.duplicate({ commandsQueueMaxLength: 8 });
  probe.on('error', () => {});
  await probe.connect();
  async function calibrate() {
    const samples = [];
    for (let index = 0; index < 10; index++) {
      const from = stamp();
      const result = await probe.sendCommand(['TIME']);
      const to = stamp(),
        serverAt = Number(result[0]) * 1000 + Number(result[1]) / 1000;
      samples.push({ rttMs: to - from, offsetMs: serverAt - (from + to) / 2 });
    }
    const best = samples.sort((a, b) => a.rttMs - b.rttMs)[0];
    return { ...best, uncertaintyMs: best.rttMs / 2 };
  }
  const calibration = await calibrate();
  return {
    async start() {
      phaseStart = lastTick = stamp();
      commands.length = probes.length = pauses.length = 0;
      heartbeat = setInterval(() => {
        const now = stamp();
        if (now - lastTick > 40)
          limit(pauses, { from: lastTick, to: now, lagMs: now - lastTick - 10 }, 2048);
        lastTick = now;
      }, 10);
      probeTimer = setInterval(async () => {
        if (busy) return;
        busy = true;
        const from = stamp();
        try {
          await probe.ping();
          limit(probes, { from, to: stamp() }, 2048);
        } finally {
          busy = false;
        }
      }, 50);
    },
    async finish() {
      clearInterval(probeTimer);
      clearInterval(heartbeat);
      // Let the independent monitor catch up before copying its bounded records.
      await new Promise((resolve) => setTimeout(resolve, 100));
      const slow = await redis.sendCommand(['SLOWLOG', 'GET', '1024']);
      return {
        calibration,
        finalCalibration: await calibrate(),
        commands: commands.slice(),
        probes: probes.slice(),
        pauses: pauses.slice(),
        commandStats: await redis.info('commandstats'),
        slowlog: slow.map((item) => ({
          id: item[0],
          at: item[1],
          durationUs: item[2],
          command: String(item[3][0]),
        })),
        latency: await redis.sendCommand(['LATENCY', 'LATEST']),
        capacities: { commands: 8192, keys: 4096, probes: 2048, pauses: 2048, parserBytes: 65536 },
      };
    },
    async close() {
      clearInterval(probeTimer);
      clearInterval(heartbeat);
      socket.destroy();
      if (probe.isOpen) await probe.disconnect();
    },
  };
};
