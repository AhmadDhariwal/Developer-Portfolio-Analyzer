"use strict";
// Fixture-only runner. Never load application .env or start the application workers.
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { startMongo } = require("../tests/fixtures/disposableRequestMongo");

async function main() {
  const runtime = await startMongo();
  const proxies = [];
  const sockets = new Set();
  try {
    const port = Number(new URL(runtime.uri).port);
    // Existing baseline suites intentionally allow only these loopback fixture ports.
    for (const fixturePort of [27139, 27140]) {
      const proxy = net.createServer((incoming) => {
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
      proxies.push(proxy);
      await new Promise((resolve, reject) => {
        proxy.once("error", reject);
        proxy.listen(fixturePort, "127.0.0.1", resolve);
      });
    }
    const directory = path.resolve(
      process.env.REQUEST_FLOW_VERIFICATION_OUTPUT ||
        path.resolve(__dirname, "../../verification/architecture"),
    );
    fs.mkdirSync(directory, { recursive: true });
    // Allow only operating-system settings and explicit disposable fixture settings.
    // Blacklisting credential names can accidentally retain deployment policy flags.
    const childEnv = Object.fromEntries(
      [
        "SystemRoot",
        "WINDIR",
        "PATH",
        "Path",
        "TEMP",
        "TMP",
        "APPDATA",
        "LOCALAPPDATA",
        "USERPROFILE",
      ]
        .filter((key) => process.env[key] !== undefined)
        .map((key) => [key, process.env[key]]),
    );
    Object.assign(childEnv, {
      NODE_ENV: "test",
      REQUEST_FLOW_VERIFICATION_OUTPUT: directory,
      INTEGRATION_GOVERNANCE_EVIDENCE_FILE: path.join(
        directory,
        "integration-governance-regression.json",
      ),
      PROFILE_ACCEPTANCE_MONGO:
        "mongodb://127.0.0.1:27139/?replicaSet=integration-live",
      B2_ACCEPTANCE_MONGO:
        "mongodb://127.0.0.1:27140/?replicaSet=integration-live",
    });
    if (process.env.INTEGRATION_TEST_MONGOD)
      childEnv.INTEGRATION_TEST_MONGOD = process.env.INTEGRATION_TEST_MONGOD;
    const suites = [
      "requestFlowGovernance",
      "publicPortfolioHardening",
      "profileAccountSecurity",
      "profileSettingsProduction",
      "b2Storage",
      "resumePipelineFinalization",
      "developerContextService",
      "careerSprintPlanningFinalization",
      "newsHubHardening",
      "newsFlow",
      "integrationsGovernance",
      "integrationsLifecycle",
      "integrationMongoGovernance",
    ];
    const child = spawn(
      process.execPath,
      [
        "--test",
        "--test-concurrency=1",
        "--test-reporter=spec",
        "--test-reporter-destination=stdout",
        "--test-reporter=tap",
        `--test-reporter-destination=${path.join(directory, "request-flow-tests.tap")}`,
        ...suites.map((name) =>
          path.resolve(__dirname, `../tests/${name}.test.js`),
        ),
      ],
      { env: childEnv, windowsHide: true, stdio: "inherit" },
    );
    process.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    for (const proxy of proxies)
      if (proxy.listening) await new Promise((resolve) => proxy.close(resolve));
    console.log(
      "Request-flow fixture cleanup:",
      JSON.stringify(await runtime.stop()),
    );
  }
}

main().catch(() => {
  console.error(
    "Request-flow fixture verification failed; inspect the retained TAP evidence.",
  );
  process.exitCode = 1;
});
