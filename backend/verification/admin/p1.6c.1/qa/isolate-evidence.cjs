// QA-only preload. Existing tests and historical reports remain untouched.
const fs = require("node:fs");
const path = require("node:path");
const backend = path.resolve(__dirname, "../../../..");
const redirects = new Map(
  [
    [
      "verification/admin/p1.6a.2/raw-audit-inspection.json",
      "admin-audit.json",
    ],
    [
      "verification/jobs-hub/p1.4a-linkage-tests.json",
      "application-linkage.json",
    ],
    [
      "verification/jobs-hub/p1.4b-workflow-tests.json",
      "application-workflow.json",
    ],
    [
      "verification/jobs-hub/p1.5b/concurrency-tests.json",
      "application-concurrency.json",
    ],
  ].map(([source, target]) => [
    path.resolve(backend, source),
    path.join(__dirname, target),
  ]),
);
const target = (file) =>
  typeof file === "string" ? redirects.get(path.resolve(file)) || file : file;
const writeSync = fs.writeFileSync;
fs.writeFileSync = function (file, ...args) {
  return writeSync.call(this, target(file), ...args);
};
const writeAsync = fs.promises.writeFile;
fs.promises.writeFile = function (file, ...args) {
  return writeAsync.call(this, target(file), ...args);
};

// Local HTTP fixtures and local MongoDB only; fail before any external request.
const allowed = (value) => {
  const host = value.hostname || value.host || "localhost";
  return (
    ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
      String(host).split(":")[0],
    ) || host === "::1"
  );
};
for (const name of ["node:http", "node:https"]) {
  const module = require(name);
  const request = module.request;
  module.request = function (value, ...args) {
    const options =
      typeof value === "string" || value instanceof URL
        ? new URL(value)
        : value;
    if (!allowed(options))
      throw new Error("QA blocked an external HTTP request.");
    return request.call(this, value, ...args);
  };
}
const fetch = global.fetch;
global.fetch = function (value, ...args) {
  const url = new URL(
    typeof value === "string" || value instanceof URL ? value : value.url,
  );
  if (!allowed(url)) throw new Error("QA blocked an external fetch request.");
  return fetch.call(this, value, ...args);
};
