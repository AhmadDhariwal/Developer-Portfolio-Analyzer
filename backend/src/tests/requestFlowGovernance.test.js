"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");
const { fork } = require("node:child_process");
const mongoose = require("mongoose");
const express = require("express");
const jwt = require("jsonwebtoken");
const { load, response } = require("./fixtures/publicPortfolioFixture");
const { env, fixture, textPDF } = require("./fixtures/b2Fixture");

test(
  "shared request authority: failures, windows, workers and authenticated upload flows",
  { timeout: 90000 },
  async (t) => {
    const { startMongo } = require("./fixtures/disposableRequestMongo");
    const runtime = await startMongo();
    const originalEnv = { ...process.env };
    Object.assign(process.env, {
      NODE_ENV: "test",
      STORAGE_DRIVER: "b2",
      JWT_SECRET: crypto.randomBytes(32).toString("hex"),
    });
    const workers = [];
    let server;
    const timings = [];
    const evidence = {
      baseline: "c612ae80c466f47ab7def651da6537d8cf330b0a",
      checks: [],
    };
    t.after(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
      for (const child of workers)
        if (child.exitCode === null && child.signalCode === null) {
          const stopped = new Promise((resolve) => child.once("exit", resolve));
          child.kill();
          await stopped;
        }
      await mongoose.disconnect();
      evidence.cleanup = await runtime.stop();
      evidence.admissionMs = timings.sort((a, b) => a - b);
      evidence.completed = evidence.checks.length;
      const report = path.resolve(
        __dirname,
        process.env.REQUEST_FLOW_VERIFICATION_OUTPUT
          ? path.join(
              process.env.REQUEST_FLOW_VERIFICATION_OUTPUT,
              "request-flow-governance-results.json",
            )
          : "../../verification/architecture/request-flow-governance-results.json",
      );
      fs.mkdirSync(path.dirname(report), { recursive: true });
      fs.writeFileSync(report, JSON.stringify(evidence, null, 2) + "\n");
      for (const key of Object.keys(process.env))
        if (!(key in originalEnv)) delete process.env[key];
      Object.assign(process.env, originalEnv);
    });
    await mongoose.connect(runtime.uri, {
      autoIndex: false,
      serverSelectionTimeoutMS: 500,
    });
    const store = require("../services/integrationMongoGovernanceService");
    const State = require("../models/integrationGovernanceState");
    await store.initialize();
    evidence.indexes = await State.collection.indexes();
    assert.ok(
      evidence.indexes.some(
        (index) => index.name === "_id_" && index.key._id === 1,
      ),
    );
    assert.ok(
      evidence.indexes.some(
        (index) => index.expireAfterSeconds === 0 && index.key.expiresAt === 1,
      ),
    );
    const prefix = (kind, subject) =>
      `public-portfolio:v3:rate:${kind}:${crypto.createHash("sha256").update(String(subject)).digest("hex")}`;
    const limit = require("../middleware/publicPortfolioRateLimit");
    const cache = require("../services/redisCacheService");
    let redisCalls = 0;
    const redisMock = t.mock.method(cache, "getRedisCacheClient", () => {
      redisCalls++;
      throw Error("Redis unavailable");
    });

    await t.test(
      "Redis state never resets quota; boundaries and logical expiry are independent of TTL sweep",
      async () => {
        let index = 0;
        for (const healthy of [true, false, true]) {
          redisMock.mock.mockImplementation(() => {
            redisCalls++;
            if (!healthy) throw Error("Redis down");
            return { eval: () => assert.fail("Redis must not own admission") };
          });
          const res = response();
          let allowed = false;
          await limit.limiter("test", 2, 3600000)(
            { user: { _id: "stable" } },
            res,
            () => {
              allowed = true;
            },
          );
          assert.equal(res.statusCode, index < 2 ? 200 : 429);
          assert.equal(allowed, index < 2);
          index++;
        }
        const res = response();
        await limit.limiter("test", 2, 3600000)(
          { user: { _id: "stable" } },
          res,
          () => assert.fail(),
        );
        assert.equal(res.statusCode, 429);
        assert.ok(Number(res.headers["Retry-After"]) > 0);
        const key = prefix("expiry", "fixture");
        const bucket = Math.floor(Date.now() / 3600000);
        await State.collection.insertOne({
          _id: `${key}:${bucket}`,
          count: 99,
          expiresAt: new Date(0),
        });
        assert.equal((await store.requestWindow(key, 1, 3600000)).count, 1);
        assert.equal(redisCalls, 0);
        evidence.checks.push("redis-toggle-and-logical-expiry");
      },
    );

    let requestId = 0;
    async function worker() {
      const child = fork(
        path.resolve(__dirname, "fixtures/requestAdmissionWorker.js"),
        [],
        {
          windowsHide: true,
          stdio: ["ignore", "ignore", "ignore", "ipc"],
          env: { ...process.env, REQUEST_ADMISSION_TEST_URI: runtime.uri },
        },
      );
      workers.push(child);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Worker readiness deadline")),
          6000,
        );
        child.once("message", (message) => {
          clearTimeout(timer);
          assert.equal(message.ready, true);
          resolve();
        });
      });
      return {
        child,
        request: (data) =>
          new Promise((resolve, reject) => {
            const id = ++requestId;
            const timer = setTimeout(() => {
              child.off("message", receive);
              reject(Error("Worker command deadline"));
            }, 6000);
            function receive(message) {
              if (message.id !== id) return;
              clearTimeout(timer);
              child.off("message", receive);
              if (message.error)
                reject(Object.assign(Error("Admission failed"), message.error));
              else resolve(message.value);
            }
            child.on("message", receive);
            child.send({ id, ...data });
          }),
      };
    }
    await t.test(
      "two independent workers race at the quota boundary and a restarted worker retains exhaustion",
      async () => {
        const a = await worker();
        const b = await worker();
        const data = {
          prefix: prefix("race", "worker-fixture"),
          maximum: 5,
          windowMs: 86400000,
        };
        const results = await Promise.all(
          Array.from({ length: 12 }, (_, index) =>
            (index % 2 ? a : b).request(data),
          ),
        );
        assert.equal(results.filter((result) => result.count <= 5).length, 5);
        const stopped = new Promise((resolve) => a.child.once("exit", resolve));
        a.child.kill();
        await stopped;
        const restarted = await worker();
        assert.equal((await restarted.request(data)).count, 6);
        evidence.checks.push("two-process-concurrency-and-restart");
      },
    );

    const User = require("../models/user");
    const Asset = require("../models/storedAsset");
    const Resume = require("../models/resumeFile");
    const Profile = require("../models/publicProfile");
    for (const model of [User, Asset, Resume, Profile])
      await model.createCollection();
    await Asset.createIndexes();
    const owner = await User.create({
      name: "Request Fixture",
      email: "request-fixture@example.test",
      providers: ["google"],
    });
    const recruiter = await User.create({
      name: "Recruiter Fixture",
      email: "recruiter-fixture@example.test",
      role: "recruiter",
      isVerified: true,
      providers: ["google"],
    });
    await Profile.create({
      userId: owner._id,
      slug: "request-fixture",
      isPublic: true,
    });
    const fake = fixture();
    const adapter = require("../services/b2ObjectStorageService").createAdapter(
      {
        env,
        clientFactory: fake.clientFactory,
      },
    );
    t.mock.method(
      require("../services/b2ObjectStorageService"),
      "getAdapter",
      () => adapter,
    );
    let sent = 0;
    t.mock.method(
      require("../services/emailService"),
      "sendConfiguredEmail",
      async () => {
        sent++;
        return { accepted: ["request-fixture@example.test"] };
      },
    );
    t.mock.method(
      require("../services/publicPortfolioVisibilityService"),
      "isPortfolioEnabled",
      async () => true,
    );
    const notifications = { createNotification: async () => null };
    const profileController = load("controllers/profilecontroller.js", {
      "../services/notificationService": notifications,
      "../services/newsService": { invalidateNewsSignalCache: () => {} },
      "./dashboardcontroller": { invalidateDashboardSummaryCache: () => {} },
      "../services/platformSettingsService": {
        getDeveloperSettingsSync: () => ({}),
      },
    });
    const resumeController = load("controllers/resumecontoller.js", {
      "../services/notificationService": notifications,
      "./dashboardcontroller": { invalidateDashboardSummaryCache: () => {} },
    });
    const app = express();
    app.use(express.json({ limit: "100kb" }));
    app.post(
      "/ip-fixture",
      limit.limiter("ip-fixture", 1, 60000),
      (_req, res) => res.json({ admitted: true }),
    );
    app.use(
      "/api/profile",
      load("routes/profile.routes.js", {
        "../controllers/profilecontroller": profileController,
      }),
    );
    app.use(
      "/api/resume",
      load("routes/resume.routes.js", {
        "../controllers/resumecontoller": resumeController,
      }),
    );
    app.use("/api/public-profiles", require("../routes/publicProfile.routes"));
    app.use(
      "/api/preview",
      load("routes/preview.routes.js", {
        "../controllers/resumecontoller": resumeController,
      }),
    );
    server = await new Promise((resolve) => {
      const handle = app.listen(0, "127.0.0.1", () => resolve(handle));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhbcAAAAASUVORK5CYII=",
      "base64",
    );
    const form = (field, bytes, filename, type) => {
      const data = new FormData();
      data.append(field, new Blob([bytes], { type }), filename);
      return data;
    };
    const request = (route, body, user = owner) =>
      fetch(base + route, {
        method: "POST",
        headers: {
          ...(user
            ? {
                Authorization:
                  "Bearer " +
                  jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, {
                    issuer: "devinsight-api",
                    audience: "devinsight-web",
                    expiresIn: "10m",
                  }),
              }
            : {}),
          ...(body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body: body instanceof FormData ? body : JSON.stringify(body),
      });
    const uploads = [
      [
        "/api/profile/avatar",
        () => form("avatar", png, "fixture.png", "image/png"),
        200,
      ],
      [
        "/api/public-profiles/me/project-image",
        () => form("image", png, "fixture.png", "image/png"),
        201,
      ],
      [
        "/api/resume/upload",
        () =>
          form(
            "file",
            textPDF(
              "Alex Developer. Software engineer building accessible web applications with JavaScript TypeScript Node MongoDB and React. Experience delivering production applications, collaborating with teams and improving performance. Education Bachelor of Computer Science. Skills JavaScript TypeScript React SQL MongoDB Docker Git. Projects include a tested full stack application with documented APIs.",
            ),
            "fixture.pdf",
            "application/pdf",
          ),
        200,
      ],
    ];
    await t.test(
      "untrusted forwarded headers cannot rotate anonymous admission identities",
      async () => {
        const one = await fetch(base + "/ip-fixture", {
          method: "POST",
          headers: { "X-Forwarded-For": "192.0.2.1" },
        });
        const two = await fetch(base + "/ip-fixture", {
          method: "POST",
          headers: { "X-Forwarded-For": "192.0.2.2" },
        });
        assert.equal(one.status, 200);
        assert.equal(two.status, 429);
        evidence.checks.push("forwarded-header-spoofing-rejected");
      },
    );
    await t.test(
      "actual JWT, Mongo admission, multipart parsing, fixture B2 and ledger transactions succeed without Redis",
      async () => {
        for (const [route, body, status] of uploads) {
          const result = await request(route, body());
          assert.equal(
            result.status,
            status,
            `${route}: ${await result.text()}`,
          );
        }
        assert.equal(
          fake.calls.filter((call) => call.op === "PutObjectCommand").length,
          3,
        );
        assert.equal(await Asset.countDocuments({ ownerId: owner._id }), 3);
        assert.equal(
          await Asset.countDocuments({ ownerId: owner._id, state: "ready" }),
          2,
        );
        const row = await State.collection.findOne({
          _id: `${prefix("upload", owner._id)}:${Math.floor(Date.now() / 3600000)}`,
        });
        assert.equal(row.count, 3);
        assert.equal(redisCalls, 0);
        evidence.checks.push(
          "authenticated-avatar-portfolio-resume-real-admission",
        );
      },
    );
    await t.test(
      "Mongo admission failure blocks every parser/storage/delivery path; validation runs first",
      async () => {
        const puts = fake.calls.length;
        const failure = t.mock.method(store, "requestWindow", async () => {
          throw Error("Fixture admission outage");
        });
        for (const [route] of uploads) {
          const result = await request(
            route,
            form("unexpected", png, "bad.png", "image/png"),
          );
          assert.equal(result.status, 503);
          assert.equal(result.headers.get("retry-after"), "30");
          assert.equal(
            (
              await request(
                route,
                form("unexpected", png, "bad.png", "image/png"),
                null,
              )
            ).status,
            401,
          );
        }
        assert.equal(
          (
            await request(
              "/api/preview/resume/parse-text",
              form("unexpected", png, "bad.png", "image/png"),
              null,
            )
          ).status,
          503,
        );
        assert.equal(
          (
            await request(
              "/api/public-profiles/request-fixture/contact",
              { message: "Interested in discussing your work." },
              recruiter,
            )
          ).status,
          503,
        );
        assert.equal(
          (
            await request(
              "/api/public-profiles/request-fixture/contact",
              { message: "invalid" },
              recruiter,
            )
          ).status,
          400,
        );
        assert.equal(fake.calls.length, puts);
        assert.equal(sent, 0);
        failure.mock.restore();
        evidence.checks.push("mongo-failure-before-parsing-storage-mail");
      },
    );
    await t.test(
      "shared upload cap prevents B2 and filesystem bypasses; contact caps prevent delivery",
      async () => {
        const key = `${prefix("upload", owner._id)}:${Math.floor(Date.now() / 3600000)}`;
        await State.collection.updateOne({ _id: key }, { $set: { count: 10 } });
        const puts = fake.calls.length;
        for (const [route, body] of uploads)
          assert.equal((await request(route, body())).status, 429);
        process.env.STORAGE_DRIVER = "filesystem";
        assert.equal(
          (await request("/api/resume/upload", uploads[2][1]())).status,
          429,
        );
        process.env.STORAGE_DRIVER = "b2";
        assert.equal(fake.calls.length, puts);
        for (let index = 0; index < 3; index++)
          assert.equal(
            (
              await request(
                "/api/public-profiles/request-fixture/contact",
                { message: "Interested in discussing your work." },
                recruiter,
              )
            ).status,
            200,
          );
        assert.equal(
          (
            await request(
              "/api/public-profiles/request-fixture/contact",
              { message: "Interested in discussing your work." },
              recruiter,
            )
          ).status,
          429,
        );
        assert.equal(sent, 3);
        const recipientKey = `${prefix("contact-recipient", "request-fixture")}:${Math.floor(Date.now() / 86400000)}`;
        await State.collection.updateOne(
          { _id: recipientKey },
          { $set: { count: 20 } },
        );
        const another = await User.create({
          name: "Second Recruiter",
          email: "second-fixture@example.test",
          role: "recruiter",
          isVerified: true,
          providers: ["google"],
        });
        assert.equal(
          (
            await request(
              "/api/public-profiles/request-fixture/contact",
              { message: "Interested in discussing your work." },
              another,
            )
          ).status,
          429,
        );
        assert.equal(sent, 3);
        evidence.checks.push("upload-and-contact-no-bypass");
      },
    );
    await t.test(
      "disconnected shared store fails closed and recovery retains committed budgets",
      async () => {
        for (let index = 0; index < 12; index++) {
          const started = performance.now();
          await store.requestWindow(
            prefix("measure", "fixture"),
            100,
            86400000,
          );
          timings.push(Number((performance.now() - started).toFixed(2)));
        }
        await mongoose.disconnect();
        await assert.rejects(
          store.requestWindow(prefix("measure", "fixture"), 100, 86400000),
          {
            status: 503,
          },
        );
        await mongoose.connect(runtime.uri, {
          autoIndex: false,
          serverSelectionTimeoutMS: 500,
        });
        assert.equal(
          (
            await store.requestWindow(
              prefix("measure", "fixture"),
              100,
              86400000,
            )
          ).count,
          13,
        );
        evidence.checks.push("disconnect-recovery-retains-budget");
      },
    );
  },
);
