const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startAngular(apiOrigin) {
  assert.match(apiOrigin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const frontend = path.resolve(__dirname, '../../../../frontend');
  const child = spawn(
    process.execPath,
    [
      path.join(frontend, 'node_modules/@angular/cli/bin/ng.js'),
      'serve',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--proxy-config',
      path.join(__dirname, 'recruiterAngularProxy.cjs')
    ],
    {
      cwd: frontend,
      windowsHide: true,
      env: { ...process.env, DPA_TEST_API_ORIGIN: apiOrigin },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  let output = '',
    launchError;
  const record = (chunk) => {
    output = (output + chunk).slice(-20000);
  };
  child.stdout.on('data', record);
  child.stderr.on('data', record);
  child.on('error', (error) => {
    launchError = error;
  });
  const exited = new Promise((resolve) => child.once('close', resolve));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null && child.pid) child.kill();
    await exited;
    return { angularStopped: true, output };
  };
  const origin = `http://127.0.0.1:${port}`;
  try {
    // Cold Angular compilation exceeded five minutes in this environment. This
    // fixture readiness allowance does not change any application/transaction timeout.
    const deadline = Date.now() + 600000;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw Error('Angular exited during startup: ' + output);
      try {
        if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok)
          return { origin, stop };
      } catch {
        /* Await the task-owned listener. */
      }
      await delay(250);
    }
    throw Error('Angular readiness deadline: ' + output);
  } catch (error) {
    await stop();
    throw error;
  }
}

module.exports = { startAngular };
