const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawn, execFile } = require("node:child_process");
const { MongoClient } = require("mongodb");
const util = require("node:util");
const execFilePromise = util.promisify(execFile);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const binary =
  process.env.INTEGRATION_TEST_MONGOD ||
  "C:\\Program Files\\MongoDB\\Server\\8.2\\bin\\mongod.exe";

async function startFixedMongo({ port, replicaSet }) {
  assert.ok(fs.existsSync(binary), `mongod binary not found at ${binary}`);
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), `devinsight-fixture-${port}-`),
  );
  const root = fs.realpathSync(directory);

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
  child.on("error", (err) => {
    launchError = err;
  });

  let direct;
  async function stop() {
    await direct?.close();
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const stopped = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await Promise.race([stopped, delay(5000)]);
    }
    const removed = [];
    function clean(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const target = path.resolve(dir, entry.name);
        if (entry.isDirectory()) clean(target);
        else {
          fs.unlinkSync(target);
          removed.push(target);
        }
      }
      fs.rmdirSync(dir);
    }
    clean(root);
    return { stopped: true, removedCount: removed.length };
  }

  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (launchError) throw launchError;
      if (child.exitCode !== null)
        throw Error(
          `mongod on ${port} exited prematurely with code ${child.exitCode}`,
        );
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
        await direct.close().catch(() => {});
        direct = null;
        await delay(150);
      }
    }
    assert.ok(direct, `mongod readiness deadline on port ${port}`);

    await direct.db("admin").command({
      replSetInitiate: {
        _id: replicaSet,
        members: [{ _id: 0, host: `127.0.0.1:${port}` }],
      },
    });

    let primary = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      const res = await direct.db("admin").command({ hello: 1 });
      primary = res.isWritablePrimary;
      if (primary) break;
      await delay(150);
    }
    assert.ok(primary, `Primary election deadline on port ${port}`);

    return {
      uri: `mongodb://127.0.0.1:${port}/?replicaSet=${replicaSet}`,
      stop,
    };
  } catch (err) {
    await stop();
    throw err;
  }
}

async function run() {
  const report = {
    gate: "Gate 6: Previously Skipped Tests",
    timestamp: new Date().toISOString(),
    suites: {},
    passed: false,
  };

  // Suite 1: B2_ACCEPTANCE_MONGO on port 27140
  console.log(
    "[1/2] Starting disposable MongoDB on port 27140 for B2_ACCEPTANCE_MONGO...",
  );
  const mongo27140 = await startFixedMongo({
    port: 27140,
    replicaSet: "profileB2Acceptance",
  });
  console.log(`Disposable Mongo 27140 active at ${mongo27140.uri}`);

  try {
    const started = Date.now();
    const testResult = await execFilePromise(
      process.execPath,
      ["--test", path.join(__dirname, "../src/tests/b2Storage.test.js")],
      {
        env: {
          ...process.env,
          B2_ACCEPTANCE_MONGO: mongo27140.uri,
          STORAGE_DRIVER: "filesystem",
        },
        timeout: 120000,
      },
    );
    const duration = Date.now() - started;
    report.suites.b2Storage = {
      passed: true,
      durationMs: duration,
      outputSummary: testResult.stdout
        .split("\n")
        .filter(
          (l) =>
            l.includes("pass") ||
            l.includes("fail") ||
            l.includes("tests") ||
            l.includes("✔"),
        )
        .join("; "),
    };
    console.log(`[1/2] B2_ACCEPTANCE_MONGO suite PASSED in ${duration}ms!`);
  } catch (err) {
    report.suites.b2Storage = {
      passed: false,
      error: err.message,
      stdout: err.stdout?.slice(-2000),
      stderr: err.stderr?.slice(-2000),
    };
    console.error("[1/2] B2_ACCEPTANCE_MONGO suite FAILED:", err.message);
  } finally {
    await mongo27140.stop();
    console.log("Tore down disposable Mongo 27140.");
  }

  // Suite 2: STORAGE_SECURITY_MONGO on port 27141
  console.log(
    "\n[2/2] Starting disposable MongoDB on port 27141 for STORAGE_SECURITY_MONGO...",
  );
  const mongo27141 = await startFixedMongo({
    port: 27141,
    replicaSet: "profileB2Security",
  });
  console.log(`Disposable Mongo 27141 active at ${mongo27141.uri}`);

  try {
    const started = Date.now();
    const testResult = await execFilePromise(
      process.execPath,
      [
        "--test",
        path.join(__dirname, "../src/tests/storageSecurityFinal.test.js"),
      ],
      {
        env: {
          ...process.env,
          STORAGE_SECURITY_MONGO:
            "mongodb://127.0.0.1:27141/?replicaSet=profileB2Security",
          STORAGE_DRIVER: "filesystem",
        },
        timeout: 120000,
      },
    );
    const duration = Date.now() - started;
    report.suites.storageSecurityFinal = {
      passed: true,
      durationMs: duration,
      outputSummary: testResult.stdout
        .split("\n")
        .filter(
          (l) =>
            l.includes("pass") ||
            l.includes("fail") ||
            l.includes("tests") ||
            l.includes("✔"),
        )
        .join("; "),
    };
    console.log(`[2/2] STORAGE_SECURITY_MONGO suite PASSED in ${duration}ms!`);
  } catch (err) {
    report.suites.storageSecurityFinal = {
      passed: false,
      error: err.message,
      stdout: err.stdout?.slice(-2000),
      stderr: err.stderr?.slice(-2000),
    };
    console.error("[2/2] STORAGE_SECURITY_MONGO suite FAILED:", err.message);
  } finally {
    await mongo27141.stop();
    console.log("Tore down disposable Mongo 27141.");
  }

  report.passed =
    report.suites.b2Storage?.passed &&
    report.suites.storageSecurityFinal?.passed;

  const outPath = path.join(
    __dirname,
    "../verification/resume/previously-skipped-results.json",
  );
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log("\n--- PREVIOUSLY SKIPPED TESTS SUMMARY ---");
  console.log("Result:", report.passed ? "PASSED" : "FAILED");
  console.log(JSON.stringify(report, null, 2));
}

run().catch((err) => {
  console.error("Runner error:", err);
  process.exit(1);
});
