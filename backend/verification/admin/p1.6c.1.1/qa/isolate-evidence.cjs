// QA-only preload. Redirect evidence before writes; prohibit external delivery.
const fs = require("node:fs");
const path = require("node:path");
const backend = path.resolve(__dirname, "../../../..");
const writeSync = fs.writeFileSync;
const writeAsync = fs.promises.writeFile;
function target(file) {
  if (typeof file !== "string") return file;
  const absolute = path.resolve(file);
  const verification = path.join(backend, "verification") + path.sep;
  if (
    absolute.startsWith(verification) &&
    !absolute.startsWith(__dirname + path.sep)
  ) {
    return path.join(
      __dirname,
      "redirected-" +
        path.relative(verification, absolute).replaceAll(path.sep, "__"),
    );
  }
  return file;
}
fs.writeFileSync = function (file, ...args) {
  return writeSync.call(this, target(file), ...args);
};
fs.promises.writeFile = function (file, ...args) {
  return writeAsync.call(this, target(file), ...args);
};
const local = (value) =>
  ["127.0.0.1", "localhost", "::1", "[::1]"].includes(new URL(value).hostname);
for (const name of ["node:http", "node:https"]) {
  const module = require(name);
  const request = module.request;
  module.request = function (value, ...args) {
    const host =
      typeof value === "string" || value instanceof URL
        ? new URL(value).hostname
        : value.hostname || value.host || "localhost";
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host))
      throw Error("QA blocked external HTTP.");
    return request.call(this, value, ...args);
  };
}
const fetch = global.fetch;
global.fetch = function (value, ...args) {
  if (
    !local(
      typeof value === "string" || value instanceof URL ? value : value.url,
    )
  )
    throw Error("QA blocked external fetch.");
  return fetch.call(this, value, ...args);
};
const dotenv = require("dotenv");
dotenv.config = () => ({ parsed: {} });
const nodemailer = require("nodemailer");
nodemailer.createTransport = () => ({
  sendMail: async () => {
    throw Error("QA blocked SMTP delivery.");
  },
});
require("@sendgrid/mail").send = async () => {
  throw Error("QA blocked external email.");
};
const mongoose = require("mongoose");
const connect = mongoose.connect;
mongoose.connect = function (uri, ...args) {
  if (!local(uri) || !new URL(uri).searchParams.has("replicaSet"))
    throw Error("QA requires a loopback disposable replica set.");
  return connect.call(this, uri, ...args);
};
const fixture = require(
  path.join(backend, "src/tests/fixtures/disposableRequestMongo"),
);
const start = fixture.startMongo;
fixture.startMongo = async function (...args) {
  const mongo = await start(...args);
  const stop = mongo.stop;
  fs.appendFileSync(
    path.join(__dirname, "fixture-lifecycle.ndjson"),
    JSON.stringify({
      event: "started",
      pid: mongo.pid,
      directory: mongo.directory,
      uri: mongo.uri,
    }) + "\n",
  );
  mongo.stop = async function () {
    const result = await stop();
    fs.appendFileSync(
      path.join(__dirname, "fixture-lifecycle.ndjson"),
      JSON.stringify({
        event: "stopped",
        pid: mongo.pid,
        directory: mongo.directory,
        ...result,
      }) + "\n",
    );
    return result;
  };
  return mongo;
};
