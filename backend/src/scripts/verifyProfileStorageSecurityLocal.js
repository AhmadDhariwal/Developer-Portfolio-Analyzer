"use strict";
// Runs real-Mongo storage security acceptance only against a disposable replica set.
const net = require("node:net");
const { spawn } = require("node:child_process");
const { startMongo } = require("../tests/fixtures/disposableRequestMongo");

async function main() {
  const runtime = await startMongo({ replicaSet: "profileB2Security" });
  const sockets = new Set();
  let proxy;
  try {
    const port = Number(new URL(runtime.uri).port);
    proxy = net.createServer((incoming) => {
      const upstream = net.connect(port, "127.0.0.1");
      for (const socket of [incoming, upstream]) {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        socket.on("error", () => {
          incoming.destroy();
          upstream.destroy();
        });
      }
      incoming.pipe(upstream).pipe(incoming);
    });
    await new Promise((resolve, reject) => {
      proxy.once("error", reject);
      proxy.listen(27141, "127.0.0.1", resolve);
    });
    const childEnv = {};
    for (const key of ["SystemRoot", "WINDIR", "PATH", "Path", "TEMP", "TMP"])
      if (process.env[key] !== undefined) childEnv[key] = process.env[key];
    Object.assign(childEnv, {
      NODE_ENV: "test",
      STORAGE_SECURITY_MONGO:
        "mongodb://127.0.0.1:27141/?replicaSet=profileB2Security",
    });
    const child = spawn(
      process.execPath,
      [
        "--test",
        "--test-concurrency=1",
        "--test-reporter=spec",
        "src/tests/storageSecurityFinal.test.js",
      ],
      {
        cwd: require("node:path").resolve(__dirname, "../.."),
        env: childEnv,
        windowsHide: true,
        stdio: "inherit",
      },
    );
    process.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (status) => resolve(status ?? 1));
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    if (proxy?.listening) await new Promise((resolve) => proxy.close(resolve));
    console.log(
      "Disposable profile security Mongo cleanup:",
      JSON.stringify(await runtime.stop()),
    );
  }
}
main().catch(() => {
  console.error("Disposable profile storage security verification failed.");
  process.exitCode = 1;
});
