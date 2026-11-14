// Activate the existing optional Profile/B2 integration suites against a fresh
// loopback replica set. No .env, production provider or live database is used.
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { startMongo } = require('../tests/fixtures/disposableRequestMongo');

async function main() {
  const output = path.resolve(__dirname, '../../verification/notifications');
  const runtime = await startMongo({ temporaryRoot: output });
  const proxies = [];
  const sockets = new Set();
  try {
    const port = Number(new URL(runtime.uri).port);
    for (const fixturePort of [27139, 27140]) {
      const proxy = net.createServer((incoming) => {
        const upstream = net.connect(port, '127.0.0.1');
        for (const socket of [incoming, upstream]) {
          sockets.add(socket);
          socket.on('close', () => sockets.delete(socket));
          socket.on('error', () => {
            incoming.destroy();
            upstream.destroy();
          });
        }
        incoming.pipe(upstream).pipe(incoming);
      });
      proxies.push(proxy);
      await new Promise((resolve, reject) => {
        proxy.once('error', reject);
        proxy.listen(fixturePort, '127.0.0.1', resolve);
      });
    }
    const env = Object.fromEntries(
      ['SystemRoot', 'WINDIR', 'PATH', 'Path', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE']
        .filter((key) => process.env[key] !== undefined)
        .map((key) => [key, process.env[key]])
    );
    Object.assign(env, {
      NODE_ENV: 'test',
      TEMP: output,
      TMP: output,
      NODE_DISABLE_COMPILE_CACHE: '1',
      PROFILE_ACCEPTANCE_MONGO: 'mongodb://127.0.0.1:27139/?replicaSet=integration-live',
      B2_ACCEPTANCE_MONGO: 'mongodb://127.0.0.1:27140/?replicaSet=integration-live'
    });
    const child = spawn(
      process.execPath,
      [
        '--test',
        '--test-concurrency=1',
        'backend/src/tests/profileSettingsProduction.test.js',
        'backend/src/tests/b2Storage.test.js'
      ],
      { cwd: path.resolve(__dirname, '../../..'), env, windowsHide: true, stdio: 'inherit' }
    );
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code === 0 ? 0 : code || 1));
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    for (const proxy of proxies)
      if (proxy.listening) await new Promise((resolve) => proxy.close(resolve));
    await runtime.stop();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
