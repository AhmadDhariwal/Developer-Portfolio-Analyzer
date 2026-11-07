"use strict";
// Disposable loopback fixture only. Do not import the live-provider verifier or .env.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { MongoClient } = require("mongodb");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startMongo({
  replicaSet = "integration-live",
  temporaryRoot = os.tmpdir(),
  readinessAttempts = 50,
  port: requestedPort = 0,
} = {}) {
  assert.match(replicaSet, /^[a-zA-Z0-9_-]{1,64}$/);
  const binary =
    process.env.INTEGRATION_TEST_MONGOD ||
    "C:\\Program Files\\MongoDB\\Server\\8.2\\bin\\mongod.exe";
  assert.ok(
    fs.existsSync(binary),
    "Installed MongoDB server binary is required",
  );
  const directory = fs.mkdtempSync(
    path.join(temporaryRoot, "devinsight-real-integrations-"),
  );
  const root = fs.realpathSync(directory);
  const listener = net.createServer();
  assert.ok(
    Number.isInteger(requestedPort) &&
      requestedPort >= 0 &&
      requestedPort <= 65535,
  );
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(requestedPort, "127.0.0.1", resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const child = spawn(
    binary,
    [
      "--dbpath",
      root,
      "--bind_ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--replSet",
      replicaSet,
      "--wiredTigerCacheSizeGB",
      "0.25",
      "--quiet",
    ],
    { windowsHide: true, stdio: ["ignore", "ignore", "ignore"] },
  );
  let launchError;
  child.on("error", (error) => {
    launchError = error;
  });
  let direct;
  async function stop() {
    // Windows Mongo may take longer than five seconds to flush four replicas.
    // Request a bounded graceful shutdown before terminating only our child.
    if (direct && child.exitCode === null && child.signalCode === null) {
      await direct
        .db("admin")
        .command({ shutdown: 1, force: true }, { timeoutMS: 3000 })
        .catch(() => {});
    }
    await direct?.close();
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const stopped = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      let timer;
      try {
        await Promise.race([
          stopped,
          new Promise((resolve) => {
            timer = setTimeout(resolve, 15000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    assert.ok(
      child.exitCode !== null || child.signalCode !== null || launchError,
      "Disposable Mongo process must stop before cleanup",
    );
    const removed = [];
    function clean(directoryPath) {
      for (const entry of fs.readdirSync(directoryPath, {
        withFileTypes: true,
      })) {
        const target = path.resolve(directoryPath, entry.name);
        assert.ok(
          target.startsWith(root + path.sep) && !entry.isSymbolicLink(),
        );
        if (entry.isDirectory()) clean(target);
        else {
          fs.unlinkSync(target);
          removed.push(path.relative(root, target));
        }
      }
      fs.rmdirSync(directoryPath); // Exact, verified empty task-owned directory; never recursive removal.
    }
    clean(root);
    return {
      mongoStopped: true,
      temporaryFilesRemoved: removed.length,
      productionDataUsed: false,
    };
  }
  try {
    for (let attempt = 0; attempt < readinessAttempts; attempt++) {
      if (launchError) throw launchError;
      if (child.exitCode !== null)
        throw Error("Disposable Mongo exited before readiness");
      direct = new MongoClient(
        `mongodb://127.0.0.1:${port}/?directConnection=true`,
        {
          serverSelectionTimeoutMS: 300,
        },
      );
      try {
        await direct.connect();
        break;
      } catch {
        await direct.close();
        direct = null;
        await delay(150);
      }
    }
    assert.ok(direct, "Disposable Mongo readiness deadline");
    await direct.db("admin").command({
      replSetInitiate: {
        _id: replicaSet,
        members: [{ _id: 0, host: `127.0.0.1:${port}` }],
      },
    });
    let primary = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      primary = (await direct.db("admin").command({ hello: 1 }))
        .isWritablePrimary;
      if (primary) break;
      await delay(150);
    }
    assert.ok(primary, "Replica primary election deadline");
    return {
      uri: `mongodb://127.0.0.1:${port}/integration_live_acceptance?replicaSet=${replicaSet}`,
      pid: child.pid,
      directory: root,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

module.exports = { startMongo };
