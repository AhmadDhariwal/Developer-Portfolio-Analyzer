'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const start = async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devinsight-scenario-'));
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
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
  let failure;
  let diagnostic = '';
  child.on('error', (error) => {
    failure = error;
  });
  child.stdout.on('data', (data) => {
    diagnostic = (diagnostic + data).slice(0, 16000);
  });
  child.stderr.on('data', (data) => {
    diagnostic = (diagnostic + data).slice(0, 16000);
  });
  const stop = async () => {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'exit');
      child.kill();
      await closed;
    }
    const root = fs.realpathSync(os.tmpdir());
    const owned = fs.realpathSync(directory);
    if (path.dirname(owned) !== root || !path.basename(owned).startsWith('devinsight-scenario-'))
      throw Error('Unsafe fixture cleanup path.');
    fs.rmSync(owned, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  try {
    const until = Date.now() + 15000;
    while (Date.now() < until) {
      if (failure) throw failure;
      if (child.exitCode !== null) throw Error('Disposable Mongo process exited: ' + diagnostic);
      const available = await new Promise((resolve) => {
        const socket = net.connect(port, '127.0.0.1');
        socket.once('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.once('error', () => resolve(false));
      });
      if (available) return { uri: `mongodb://127.0.0.1:${port}/scenario_acceptance`, stop };
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw Error('Disposable Mongo startup timed out.');
  } catch (error) {
    await stop();
    throw error;
  }
};
module.exports = { start };
