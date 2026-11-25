// Dependency-free Edge/CDP client for disposable real-stack verification only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startBrowser() {
  const executable =
    process.env.DPA_BROWSER_EXECUTABLE ||
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  assert.ok(fs.existsSync(executable), 'Installed Edge or DPA_BROWSER_EXECUTABLE is required.');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-p15a-browser-'));
  const root = fs.realpathSync(directory);
  const child = spawn(
    executable,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      '--user-data-dir=' + root,
      'about:blank'
    ],
    { windowsHide: true, stdio: 'ignore' }
  );
  const pending = new Map(),
    listeners = new Map();
  let socket,
    nextId = 0,
    launchError;
  child.on('error', (error) => {
    launchError = error;
  });
  async function send(method, params = {}, sessionId) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error('CDP timeout: ' + method));
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  function on(method, callback) {
    const handlers = listeners.get(method) || [];
    handlers.push(callback);
    listeners.set(method, handlers);
  }
  async function stop() {
    if (socket?.readyState === WebSocket.OPEN) {
      await send('Browser.close').catch(() => {});
      socket.close();
    }
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      const timer = setTimeout(() => child.kill(), 3000);
      try {
        await exited;
      } finally {
        clearTimeout(timer);
      }
    }
    assert.ok(child.exitCode !== null || child.signalCode !== null || launchError);
    for (const value of pending.values()) {
      clearTimeout(value.timer);
      value.reject(Error('Disposable browser closed.'));
    }
    pending.clear();
    let removed = 0;
    function clean(current) {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const target = path.resolve(current, entry.name);
        assert.ok(target.startsWith(root + path.sep) && !entry.isSymbolicLink());
        if (entry.isDirectory()) clean(target);
        else {
          fs.unlinkSync(target);
          removed++;
        }
      }
      fs.rmdirSync(current); // Exact verified empty task-owned directory, never recursive deletion.
    }
    clean(root);
    return { browserStopped: true, temporaryFilesRemoved: removed };
  }
  try {
    const portFile = path.join(root, 'DevToolsActivePort');
    for (let i = 0; !fs.existsSync(portFile) && i < 150; i++) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw Error('Disposable browser exited during startup.');
      await delay(100);
    }
    const [port, endpoint] = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
    socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data));
      const work = pending.get(message.id);
      if (work) {
        clearTimeout(work.timer);
        pending.delete(message.id);
        if (message.error) work.reject(Error(message.error.message));
        else work.resolve(message.result);
      } else if (message.method) {
        for (const callback of listeners.get(message.method) || [])
          callback(message.params, message.sessionId);
      }
    });
    await once(socket, 'open');
    async function page({ width = 1440, height = 900, init }) {
      const { browserContextId } = await send('Target.createBrowserContext');
      const { targetId } = await send('Target.createTarget', {
        url: 'about:blank',
        browserContextId
      });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const command = (method, params) => send(method, params, sessionId);
      await command('Page.enable');
      await command('Runtime.enable');
      await command('Network.enable');
      await command('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false
      });
      await command('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-color-scheme', value: 'dark' },
          { name: 'prefers-reduced-motion', value: 'reduce' }
        ]
      });
      if (init) await command('Page.addScriptToEvaluateOnNewDocument', { source: init });
      const evaluate = async (expression) => {
        const value = await command('Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise: true
        });
        if (value.exceptionDetails)
          throw Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text);
        return value.result.value;
      };
      const wait = async (expression, label) => {
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
          try {
            if (await evaluate(expression)) return;
          } catch {
            /* New document may be loading. */
          }
          await delay(100);
        }
        throw Error('Browser state timeout: ' + label);
      };
      return {
        sessionId,
        evaluate,
        wait,
        navigate: async (url) => {
          await command('Page.navigate', { url });
        },
        screenshot: async (filename) => {
          const shot = await command('Page.captureScreenshot', { captureBeyondViewport: true });
          fs.writeFileSync(filename, Buffer.from(shot.data, 'base64'));
        },
        close: () => send('Target.disposeBrowserContext', { browserContextId })
      };
    }
    return { page, on, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

module.exports = { startBrowser };
