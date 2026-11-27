require("./isolate-evidence.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const { randomBytes } = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
const { spawn } = require("node:child_process");
const express = require("express");
const mongoose = require("mongoose");
const src = path.resolve(__dirname, "../../../../src");
const load = (file) => require(path.join(src, file));
const { startMongo } = load("tests/fixtures/disposableRequestMongo");
const User = load("modules/auth/models/user");
const Organization = load("modules/admin/models/organization");
const Membership = load("modules/admin/models/membership");
const Team = load("modules/admin/models/team");
const Invitation = load("modules/admin/models/invitation");
const Audit = load("modules/admin/models/auditLog");
const Job = load("modules/recruiter/models/Job");
const Match = load("modules/recruiter/models/RecruiterMatch");
const Shortlist = load("modules/recruiter/models/RecruiterShortlist");
const Application = load("modules/jobs/models/jobApplication");
const Settings = load("modules/super-admin/models/platformSettings");
const settings = load("modules/super-admin/services/platformSettingsService");
const { sign } = load("modules/auth/utils/authSessionToken");
const keys = [
  "recruiterJobCreation",
  "recruiterJobPublication",
  "teamSharedJobs",
  "sharedPublicEvaluations",
  "teamManagerEvaluationManagement",
  "candidateMatching",
  "invitationCreation",
  "managerTeamAdministration",
];
const allEnabled = Object.fromEntries(keys.map((key) => [key, true]));
const jobBody = {
  title: "QA engineer",
  role: "Engineer",
  description: "Synthetic local acceptance fixture",
  requiredSkills: ["JavaScript"],
  stack: "Full Stack",
  location: "Remote",
  status: "draft",
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
async function deadline(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`QA deadline: ${label}`)),
          15000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test(
  "Independent P1.6C.1 acceptance on an isolated replica set",
  { timeout: 600000 },
  async (t) => {
    const mongo = await startMongo({ replicaSet: "p16c1-independent-qa" });
    const oldSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = randomBytes(32).toString("hex");
    const metrics = {
      assertions: [],
      races: [],
      directories: [],
      contention: null,
      restart: null,
      responseContracts: [],
    };
    const pendingAudits = new Set();
    const auditErrors = [];
    let failAudit = false;
    let server;
    let sequence = 0;
    const local = new AsyncLocalStorage();
    const originalAudit = Audit.create;
    Audit.create = function (...args) {
      if (
        failAudit &&
        args[0]?.[0]?.action === "ORGANIZATION_CONFIGURATION_UPDATED"
      )
        return Promise.reject(new Error("QA injected audit outage"));
      const promise = originalAudit.apply(this, args);
      pendingAudits.add(promise);
      promise.then(
        () => pendingAudits.delete(promise),
        (error) => {
          pendingAudits.delete(promise);
          auditErrors.push(error.message);
        },
      );
      return promise;
    };
    t.after(async () => {
      failAudit = false;
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      await Promise.allSettled([...pendingAudits]);
      Audit.create = originalAudit;
      settings.stopSettingsSynchronization();
      await load(
        "modules/notifications/services/notificationStreamService",
      ).stop();
      await mongoose.disconnect();
      metrics.cleanup = await mongo.stop();
      metrics.unexpectedAuditErrors = auditErrors;
      fs.writeFileSync(
        path.join(__dirname, "independent-metrics.json"),
        JSON.stringify(metrics, null, 2) + "\n",
      );
      if (oldSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = oldSecret;
    });
    await mongoose.connect(mongo.uri);
    await settings.startSettingsSynchronization();
    await settings.updateSettings({
      organization: {
        recruiterLimitPerOrg: 100,
        maxTeamsPerOrganization: 100,
        adminInvitesRequireApproval: true,
      },
    });
    const email = load("core/messaging/emailService");
    t.mock.method(email, "sendRecruiterInvitationEmail", async () => ({
      sent: false,
      reason: "QA local delivery stub",
    }));
    const invitationEmail = load("core/messaging/invitationEmailService");
    t.mock.method(invitationEmail, "getEmailProviderStatus", () => ({
      configured: false,
      reason: "QA local delivery stub",
    }));
    t.mock.method(invitationEmail, "sendInvitationEmail", async () => ({
      sent: false,
      provider: null,
      reason: "QA local delivery stub",
    }));
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) =>
      local.run(req.headers["x-qa-operation"] || "", next),
    );
    app.use(load("core/middleware/auditLogMiddleware").auditLogMiddleware);
    app.use(
      "/api/admin-console",
      load("modules/admin/routes/adminConsole.routes"),
    );
    app.use("/api/admin", load("modules/admin/routes/admin.routes"));
    app.use("/api/tenant", load("modules/admin/routes/tenant.routes"));
    app.use(
      "/api/recruiter-hub",
      load("modules/recruiter/routes/hub/recruiterHubRoutes"),
    );
    app.use(
      "/api/recruiter",
      load("modules/recruiter/routes/recruiter.routes"),
    );
    app.post(
      "/api/auth/accept-invite",
      load("modules/auth/authcontroller").acceptInvite,
    );
    const { protect } = load("core/middleware/authmiddleware");
    const applications = load("modules/jobs/jobApplicationController");
    app.patch(
      "/qa/applications/:applicationId/withdraw",
      protect,
      applications.developerOnly,
      applications.withdraw,
    );
    for (const model of Object.values(mongoose.models)) await model.init();
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = async (
      route,
      actor,
      body,
      method = body === undefined ? "GET" : "POST",
      tag = "",
      token,
    ) => {
      const started = performance.now();
      const response = await fetch(origin + route, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(actor || token
            ? { Authorization: `Bearer ${token || sign(actor)}` }
            : {}),
          "x-qa-operation": tag,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const json = response.headers
        .get("content-type")
        ?.includes("application/json");
      const data = json
        ? await response.json()
        : Buffer.from(await response.arrayBuffer());
      return {
        status: response.status,
        data,
        milliseconds: performance.now() - started,
        bytes: json ? Buffer.byteLength(JSON.stringify(data)) : data.length,
      };
    };
    const expectStatus = (result, status) =>
      assert.equal(result.status, status, JSON.stringify(result.data));
    async function fixture({ legacy = false } = {}) {
      const serial = ++sequence;
      const account = (name, role, extra = {}) =>
        User.create({
          name,
          email: `qa-${serial}-${name}@fixture.test`,
          role,
          providers: ["github"],
          isVerified: true,
          ...extra,
        });
      const admin = await account("owner", "admin");
      const raw = {
        name: `QA organization ${serial}`,
        slug: `qa-org-${serial}`,
        description: "Keep this description",
        ownerId: admin._id,
        createdBy: admin._id,
      };
      const org = legacy
        ? await Organization.collection
            .insertOne({ ...raw, createdAt: new Date(), updatedAt: new Date() })
            .then((result) => ({
              ...raw,
              _id: result.insertedId,
              id: String(result.insertedId),
            }))
        : await Organization.create(raw);
      admin.organizationId = org._id;
      await admin.save();
      const a = { admin };
      for (const [name, role] of [
        ["delegate", "admin"],
        ["affiliated", "admin"],
        ["disabled", "admin"],
        ["orgManager", "developer"],
        ["ownerRecruiter", "recruiter"],
        ["manager", "recruiter"],
        ["teamAdmin", "recruiter"],
        ["member", "recruiter"],
        ["developer", "developer"],
        ["platform", "super_admin"],
      ])
        a[name] = await account(name, role, { organizationId: org._id });
      a.public = await account("public", "developer", { isPublic: true });
      a.publicTwo = await account("public-two", "developer", {
        isPublic: true,
      });
      const team = await Team.create({
        organizationId: org._id,
        name: "QA team",
        slug: "qa-team",
        createdBy: admin._id,
      });
      await Membership.create([
        { organizationId: org._id, userId: a.delegate._id, role: "admin" },
        {
          organizationId: org._id,
          userId: a.disabled._id,
          role: "admin",
          status: "disabled",
        },
        { organizationId: org._id, userId: a.orgManager._id, role: "manager" },
        ...["ownerRecruiter", "manager", "teamAdmin", "member"].flatMap(
          (key) => [
            { organizationId: org._id, userId: a[key]._id, role: "member" },
            {
              organizationId: org._id,
              userId: a[key]._id,
              teamId: team._id,
              role:
                key === "manager"
                  ? "manager"
                  : key === "teamAdmin"
                    ? "admin"
                    : "member",
            },
          ],
        ),
      ]);
      const job = await Job.create({
        ...jobBody,
        organizationId: org._id,
        recruiterId: a.ownerRecruiter._id,
        teamId: team._id,
        teamShared: true,
        evaluationShared: true,
      });
      const match = await Match.create({
        organizationId: org._id,
        recruiterId: a.ownerRecruiter._id,
        teamId: team._id,
        jobId: job._id,
        candidateId: a.public._id,
        matchScore: 72,
      });
      const shortlist = await Shortlist.create({
        organizationId: org._id,
        recruiterId: a.ownerRecruiter._id,
        teamId: team._id,
        jobId: job._id,
        candidateId: a.public._id,
        notes: "QA retained notes",
      });
      const invite = (extra = {}) =>
        Invitation.create({
          organizationId: org._id,
          email: a.developer.email,
          role: "recruiter",
          invitedBy: admin._id,
          token: randomBytes(24).toString("hex"),
          status: "pending",
          expiresAt: new Date(Date.now() + 3600000),
          ...extra,
        });
      return { org, a, team, job, match, shortlist, invite, account };
    }
    async function change(f, policies, general) {
      const before = await Organization.findById(f.org._id).lean();
      const result = await request(
        "/api/admin-console/governance",
        f.a.admin,
        {
          expectedVersion: before.governance?.version || 0,
          ...(policies ? { policies } : {}),
          ...(general ? { general } : {}),
        },
        "PATCH",
      );
      expectStatus(result, 200);
      for (const [key, value] of Object.entries(policies || {}))
        assert.equal(result.data.policies[key], value);
      return result;
    }
    const version = async (f) =>
      Number(
        (await Organization.findById(f.org._id).lean()).governance?.version ||
          0,
      );
    const configAudits = (f) =>
      Audit.find({
        organizationId: f.org._id,
        action: "ORGANIZATION_CONFIGURATION_UPDATED",
      }).lean();

    await t.test(
      "legacy first update and concurrent first updates preserve defaults and unrelated fields",
      async () => {
        for (const simultaneous of [false, true]) {
          const f = await fixture({ legacy: true });
          const read = await request(
            "/api/admin-console/governance",
            f.a.admin,
          );
          expectStatus(read, 200);
          assert.equal(read.data.version, 0);
          assert.deepEqual(read.data.policies, allEnabled);
          const patches = [
            { expectedVersion: 0, policies: { candidateMatching: false } },
            { expectedVersion: 0, general: { industry: "QA industry" } },
          ];
          const results = simultaneous
            ? await Promise.all(
                patches.map((body) =>
                  request(
                    "/api/admin-console/governance",
                    f.a.admin,
                    body,
                    "PATCH",
                  ),
                ),
              )
            : [
                await request(
                  "/api/admin-console/governance",
                  f.a.admin,
                  patches[0],
                  "PATCH",
                ),
              ];
          assert.deepEqual(
            results.map((r) => r.status).sort(),
            simultaneous ? [200, 409] : [200],
          );
          const stored = await Organization.findById(f.org._id).lean();
          assert.equal(stored.governance.version, 1);
          assert.equal(stored.description, "Keep this description");
          assert.equal(stored.slug, f.org.slug);
          assert.equal(String(stored.ownerId), f.a.admin.id);
          assert.equal((await configAudits(f)).length, 1);
          const flags = (
            await request("/api/admin-console/governance", f.a.admin)
          ).data.policies;
          assert.equal(Object.keys(flags).length, 8);
          if (!simultaneous || results[0].status === 200)
            assert.equal(flags.candidateMatching, false);
        }
      },
    );
    await t.test(
      "partial legacy policies, explicit false and new defaults survive restart-style reconnect",
      async () => {
        const f = await fixture();
        await Organization.collection.updateOne(
          { _id: f.org._id },
          { $set: { governance: { policies: { candidateMatching: false } } } },
        );
        let current = await request("/api/admin-console/governance", f.a.admin);
        assert.equal(current.data.version, 0);
        assert.equal(current.data.policies.candidateMatching, false);
        assert.equal(current.data.policies.recruiterJobCreation, true);
        await change(f, { teamSharedJobs: false });
        await Promise.allSettled([...pendingAudits]);
        settings.stopSettingsSynchronization();
        await mongoose.disconnect();
        await mongoose.connect(mongo.uri);
        await settings.startSettingsSynchronization();
        current = await request("/api/admin-console/governance", f.a.admin);
        assert.equal(current.data.version, 1);
        assert.equal(current.data.policies.candidateMatching, false);
        assert.equal(current.data.policies.teamSharedJobs, false);
        const fresh = await fixture();
        assert.deepEqual(
          (await request("/api/admin-console/governance", fresh.a.admin)).data
            .policies,
          allEnabled,
        );
        const child = await new Promise((resolve) => {
          const reader = spawn(
            process.execPath,
            [
              "-e",
              `
            const mongoose = require(${JSON.stringify(path.resolve(__dirname, "../../../../node_modules/mongoose"))});
            const governance = require(${JSON.stringify(path.join(src, "modules/admin/services/organizationGovernanceService"))});
            mongoose.connect(process.env.QA_MONGO_URI, { serverSelectionTimeoutMS: 4000 }).then(async () => {
              await Promise.all(Object.values(mongoose.models).map(model => model.init()));
              const result = await governance.getGovernance(JSON.parse(process.env.QA_GOVERNANCE_SCOPE));
              console.log(JSON.stringify({ version: result.version, policies: result.policies }));
              await mongoose.disconnect();
            }).catch(async error => { console.error(error.message); await mongoose.disconnect(); process.exitCode = 1; });
          `,
            ],
            {
              windowsHide: true,
              env: {
                ...process.env,
                QA_MONGO_URI: mongo.uri,
                QA_GOVERNANCE_SCOPE: JSON.stringify({
                  actorId: f.a.admin.id,
                  organizationId: f.org.id,
                  sessionRevision: 0,
                }),
              },
            },
          );
          let stdout = "",
            stderr = "";
          const timer = setTimeout(() => {
            stderr += "QA child-process deadline";
            reader.kill();
          }, 30000);
          reader.stdout.on("data", (chunk) => {
            stdout += chunk;
          });
          reader.stderr.on("data", (chunk) => {
            stderr += chunk;
          });
          reader.on("error", (error) => {
            stderr += error.message;
          });
          reader.on("close", (status) => {
            clearTimeout(timer);
            resolve({ status, stdout, stderr });
          });
        });
        metrics.restartDiagnostic = child;
        assert.equal(child.status, 0, child.stderr);
        const restarted = JSON.parse(child.stdout.trim());
        assert.equal(restarted.version, 1);
        assert.equal(restarted.policies.candidateMatching, false);
        assert.equal(restarted.policies.teamSharedJobs, false);
        metrics.restart = {
          separateNodeProcessVerified: true,
          disconnectedAndReconnected: true,
          persistedVersion: 1,
          falseValuesRetained: true,
        };
      },
    );
    await t.test(
      "configuration authority matrix and preferences mutation boundary",
      async () => {
        const f = await fixture();
        const endpoints = [
          "/api/admin-console/governance",
          "/api/admin-console/members",
          "/api/admin-console/invitations",
        ];
        for (const name of Object.keys(f.a).filter(
          (key) => !["public", "publicTwo"].includes(key),
        )) {
          const actor = f.a[name];
          const authorized = ["admin", "delegate"].includes(name);
          for (const route of endpoints)
            expectStatus(await request(route, actor), authorized ? 200 : 403);
          expectStatus(
            await request(
              "/api/admin-console/governance",
              actor,
              {
                expectedVersion: await version(f),
                policies: { candidateMatching: true },
              },
              "PATCH",
            ),
            authorized ? 200 : 403,
          );
          expectStatus(
            await request(
              "/api/admin-console/preferences",
              actor,
              { expectedVersion: await version(f), name: "QA preferences" },
              "PATCH",
            ),
            authorized ? 200 : 403,
          );
          const preferences = await request(
            "/api/admin-console/preferences",
            actor,
          );
          const capabilities = await request(
            "/api/admin-console/capabilities",
            actor,
          );
          metrics.responseContracts.push({
            case: name,
            preferencesGet: preferences.status,
            capabilitiesGet: capabilities.status,
          });
        }
        const stale = sign(f.a.admin);
        await User.updateOne(
          { _id: f.a.admin._id },
          { $inc: { sessionRevision: 1 } },
        );
        expectStatus(
          await request(
            "/api/admin-console/governance",
            null,
            undefined,
            "GET",
            "",
            stale,
          ),
          401,
        );
        await Organization.updateOne(
          { _id: f.org._id },
          { $set: { isSuspended: true } },
        );
        expectStatus(
          await request("/api/admin-console/governance", f.a.delegate),
          403,
        );
        expectStatus(await request("/api/admin-console/governance"), 401);
      },
    );
    await t.test(
      "spoofed scope, protected fields and metadata validation reject atomically",
      async () => {
        const f = await fixture();
        const other = await fixture();
        const start = await version(f);
        for (const general of [
          { name: "a" },
          { name: false },
          { description: "x".repeat(501) },
          { industry: "x".repeat(101) },
          { timezone: "Invalid/Zone" },
          { timezone: [] },
          { website: "http://example.test" },
          { website: "https://u:p@example.test" },
          { website: "https://example.test/?token=synthetic" },
          { website: "https://example.test/#fragment" },
          { branding: { logoUrl: "javascript:alert(1)" } },
          { branding: { logoUrl: "x".repeat(501) } },
        ])
          expectStatus(
            await request(
              "/api/admin-console/governance",
              f.a.admin,
              { expectedVersion: start, general },
              "PATCH",
            ),
            400,
          );
        for (const field of [
          "_id",
          "organizationId",
          "slug",
          "ownerId",
          "createdBy",
          "isSuspended",
          "role",
          "limits",
          "PlatformSettings",
          "providerApiKey",
          "permissions",
        ]) {
          expectStatus(
            await request(
              "/api/admin-console/governance",
              f.a.admin,
              { expectedVersion: start, general: { [field]: other.org.id } },
              "PATCH",
            ),
            400,
          );
          expectStatus(
            await request(
              "/api/admin-console/preferences",
              f.a.admin,
              { expectedVersion: start, name: "QA", [field]: other.org.id },
              "PATCH",
            ),
            400,
          );
        }
        expectStatus(
          await request(
            "/api/admin-console/governance?organizationId=" + other.org.id,
            f.a.admin,
          ),
          200,
        );
        assert.equal(
          (
            await request(
              "/api/admin-console/governance?organizationId=" + other.org.id,
              f.a.admin,
            )
          ).data.organization._id,
          f.org.id,
        );
        assert.equal(await version(f), start);
        assert.equal(await version(other), 0);
        await change(f, null, {
          name: "Validated metadata",
          description: "",
          industry: "Technology",
          website: "https://example.test",
          timezone: "UTC",
          branding: { logoUrl: "https://example.test/logo.png" },
        });
        assert.equal(
          (await Organization.findById(f.org._id)).website,
          "https://example.test",
        );
      },
    );
    for (const pairing of [
      "general-policy",
      "governance-preferences",
      "policy-policy",
    ])
      await t.test(`configuration CAS: ${pairing}`, async () => {
        const f = await fixture();
        const left =
          pairing === "general-policy"
            ? { general: { name: "QA rival name" } }
            : { policies: { candidateMatching: false } };
        const right =
          pairing === "governance-preferences"
            ? {
                name: "QA rival preferences",
                dashboardConfig: { showKpiCards: false },
              }
            : { policies: { teamSharedJobs: false } };
        const results = await Promise.all([
          request(
            "/api/admin-console/governance",
            f.a.admin,
            { expectedVersion: 0, ...left },
            "PATCH",
          ),
          request(
            pairing === "governance-preferences"
              ? "/api/admin-console/preferences"
              : "/api/admin-console/governance",
            f.a.delegate,
            { expectedVersion: 0, ...right },
            "PATCH",
          ),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
        assert.equal(await version(f), 1);
        assert.equal((await configAudits(f)).length, 1);
        for (const expectedVersion of [undefined, null, -1, 0.5, "1", true])
          expectStatus(
            await request(
              "/api/admin-console/governance",
              f.a.admin,
              { expectedVersion, policies: { candidateMatching: false } },
              "PATCH",
            ),
            400,
          );
      });
    await t.test(
      "audit exactly once with middleware, safe values, and outage rollback",
      async () => {
        const f = await fixture();
        const canary = "QA-synthetic-secret-canary";
        await change(
          f,
          { candidateMatching: false },
          { name: canary, website: "https://example.test" },
        );
        const events = await configAudits(f);
        assert.equal(events.length, 1);
        assert.equal(events[0].before.values.candidateMatching, true);
        assert.equal(events[0].after.values.candidateMatching, false);
        assert.equal(events[0].before.version, 0);
        assert.equal(events[0].after.version, 1);
        assert.equal(String(events[0].actor), f.a.admin.id);
        assert.equal(String(events[0].organizationId), f.org.id);
        assert.equal(events[0].after.values.general.name, "[REDACTED]");
        await Promise.allSettled([...pendingAudits]);
        const raw = await Audit.find({ organizationId: f.org._id }).lean();
        assert.equal(
          raw.filter(
            (row) =>
              row.statusCode < 400 &&
              row.route === "/api/admin-console/governance",
          ).length,
          1,
        );
        assert.ok(!JSON.stringify(raw).includes(canary));
        failAudit = true;
        try {
          expectStatus(
            await request(
              "/api/admin-console/governance",
              f.a.admin,
              {
                expectedVersion: 1,
                policies: { candidateMatching: true },
                general: { name: "Must roll back" },
              },
              "PATCH",
            ),
            500,
          );
        } finally {
          failAudit = false;
        }
        const stored = await Organization.findById(f.org._id).lean();
        assert.equal(stored.governance.version, 1);
        assert.equal(stored.governance.policies.candidateMatching, false);
        assert.equal(stored.name, canary);
        assert.equal((await configAudits(f)).length, 1);
      },
    );

    for (const policy of keys)
      await t.test(
        `policy ${policy}: HTTP enforcement, isolation, allowed transitions and re-enable`,
        async () => {
          const f = await fixture();
          const foreign = await fixture();
          await change(f, { [policy]: false });
          const checks = [];
          const call = async (
            route,
            actor,
            body,
            method = body === undefined ? "GET" : "POST",
            expected = 403,
          ) => {
            const result = await request(route, actor, body, method);
            expectStatus(result, expected);
            checks.push({ route, method, status: result.status });
            return result;
          };
          if (policy === "recruiterJobCreation") {
            for (const route of [
              "/api/recruiter-hub/jobs",
              "/api/recruiter/job",
            ])
              for (const actor of [f.a.ownerRecruiter, f.a.manager])
                await call(route, actor, jobBody);
            await call("/api/admin/jobs", f.a.admin, jobBody, "POST", 201);
            await call(
              `/api/recruiter-hub/jobs/${f.job.id}`,
              f.a.ownerRecruiter,
              { title: "Owner editing remains" },
              "PATCH",
              200,
            );
            await call(
              "/api/recruiter-hub/jobs",
              foreign.a.ownerRecruiter,
              jobBody,
              "POST",
              201,
            );
          }
          if (policy === "recruiterJobPublication") {
            await call("/api/recruiter-hub/jobs", f.a.ownerRecruiter, {
              ...jobBody,
              published: true,
            });
            await call(
              `/api/recruiter-hub/jobs/${f.job.id}`,
              f.a.ownerRecruiter,
              { published: true },
              "PATCH",
            );
            await Job.updateOne(
              { _id: f.job._id },
              { $set: { published: true, status: "closed" } },
            );
            for (const [route, method] of [
              [`/api/recruiter-hub/jobs/${f.job.id}`, "PATCH"],
              [`/api/recruiter/job/${f.job.id}`, "PUT"],
            ])
              await call(route, f.a.ownerRecruiter, { status: "open" }, method);
            assert.equal((await Job.findById(f.job._id)).published, true);
            await call(
              `/api/recruiter-hub/jobs/${f.job.id}`,
              f.a.ownerRecruiter,
              { title: "Ordinary editing", published: false },
              "PATCH",
              200,
            );
            await call(
              `/api/recruiter-hub/jobs/${f.job.id}/archive`,
              f.a.ownerRecruiter,
              {},
              "POST",
              200,
            );
          }
          if (policy === "teamSharedJobs") {
            await call(
              `/api/recruiter-hub/jobs/${f.job.id}`,
              f.a.ownerRecruiter,
              { teamShared: true, expectedVersion: 0 },
              "PATCH",
            );
            for (const actor of [f.a.member, f.a.manager, f.a.teamAdmin]) {
              await call(
                `/api/recruiter-hub/jobs/${f.job.id}`,
                actor,
                undefined,
                "GET",
                404,
              );
              await call(
                `/api/recruiter-hub/jobs/${f.job.id}`,
                actor,
                { title: "Forbidden shared mutation" },
                "PATCH",
                404,
              );
            }
            await call(
              `/api/recruiter-hub/matches/${f.match.id}`,
              f.a.manager,
              undefined,
              "GET",
              404,
            );
            await call(
              `/api/recruiter-hub/jobs/${f.job.id}`,
              f.a.ownerRecruiter,
              undefined,
              "GET",
              200,
            );
            assert.equal((await Job.findById(f.job._id)).teamShared, true);
            await Membership.updateOne(
              {
                organizationId: f.org._id,
                userId: f.a.member._id,
                teamId: f.team._id,
              },
              { $set: { status: "disabled" } },
            );
          }
          if (policy === "sharedPublicEvaluations") {
            for (const route of [
              `/api/recruiter-hub/matches?jobId=${f.job.id}`,
              `/api/recruiter-hub/matches/${f.match.id}`,
              `/api/recruiter-hub/shortlists?jobId=${f.job.id}`,
            ])
              await call(route, f.a.manager, undefined, "GET", 404);
            await call(
              `/api/recruiter-hub/shortlists/${f.shortlist.id}`,
              f.a.manager,
              { notes: "Forbidden" },
              "PATCH",
              404,
            );
            await call(
              `/api/recruiter-hub/matches/${f.match.id}/status`,
              f.a.manager,
              { status: "rejected" },
              "PATCH",
              404,
            );
            await call(
              "/api/recruiter-hub/matches/generate",
              f.a.manager,
              { jobId: f.job.id, candidateIds: [f.a.public.id] },
              "POST",
              404,
            );
            await call(
              `/api/recruiter-hub/jobs/${f.job.id}`,
              f.a.manager,
              undefined,
              "GET",
              200,
            );
            await call(
              `/api/recruiter-hub/jobs/${f.job.id}`,
              f.a.ownerRecruiter,
              { evaluationShared: true, expectedVersion: 0 },
              "PATCH",
            );
          }
          if (policy === "teamManagerEvaluationManagement") {
            for (const actor of [f.a.manager, f.a.teamAdmin, f.a.member]) {
              await call(
                `/api/recruiter-hub/matches/${f.match.id}`,
                actor,
                undefined,
                "GET",
                200,
              );
              await call(
                `/api/recruiter-hub/matches/${f.match.id}/status`,
                actor,
                { status: "rejected" },
                "PATCH",
              );
              await call(
                `/api/recruiter-hub/shortlists/${f.shortlist.id}`,
                actor,
                { notes: "Forbidden" },
                "PATCH",
              );
              await call(
                `/api/recruiter-hub/shortlists/${f.shortlist.id}`,
                actor,
                undefined,
                "DELETE",
              );
              await call("/api/recruiter-hub/matches/generate", actor, {
                jobId: f.job.id,
                candidateIds: [f.a.public.id],
              });
            }
            await call(
              `/api/recruiter-hub/matches/${f.match.id}/status`,
              f.a.ownerRecruiter,
              { status: "rejected" },
              "PATCH",
              200,
            );
          }
          if (policy === "candidateMatching") {
            for (const [route, body] of [
              [
                "/api/recruiter-hub/matches/generate",
                { jobId: f.job.id, candidateIds: [f.a.public.id] },
              ],
              ["/api/recruiter/match", { jobId: f.job.id }],
              ["/api/recruiter/ai-rank", { jobId: f.job.id }],
              [
                "/api/recruiter/ai-rank",
                { job: jobBody, candidates: [{ id: f.a.public.id }] },
              ],
              [
                "/api/recruiter-hub/comparison",
                {
                  jobId: f.job.id,
                  candidateIds: [f.a.public.id, f.a.publicTwo.id],
                },
              ],
            ])
              await call(route, f.a.ownerRecruiter, body);
            await call(
              "/api/recruiter-hub/comparison",
              f.a.ownerRecruiter,
              { candidateIds: [f.a.public.id, f.a.publicTwo.id] },
              "POST",
              200,
            );
            await call(
              "/api/recruiter-hub/candidates",
              f.a.ownerRecruiter,
              undefined,
              "GET",
              200,
            );
            await call(
              `/api/recruiter-hub/candidates/${f.a.public.id}/analyze`,
              f.a.ownerRecruiter,
              {},
              "POST",
              200,
            );
            await call(
              `/api/recruiter-hub/matches/${f.match.id}`,
              f.a.ownerRecruiter,
              undefined,
              "GET",
              200,
            );
            await call(
              "/api/admin/ai-rank",
              f.a.admin,
              { jobId: f.job.id, candidates: [{ id: f.a.public.id }] },
              "POST",
              200,
            );
          }
          if (policy === "invitationCreation") {
            const pending = await f.invite();
            for (const route of [
              "/api/admin/invite-recruiter",
              "/api/admin/recruiter",
            ])
              await call(route, f.a.admin, {
                name: "QA pending",
                email: `pending-${sequence}@fixture.test`,
              });
            await call(
              `/api/tenant/organizations/${f.org.id}/invitations`,
              f.a.orgManager,
              { email: `member-${sequence}@fixture.test`, role: "member" },
            );
            await call(
              `/api/admin/invitations/${pending.id}/resend`,
              f.a.admin,
              {},
            );
            await call(
              `/api/tenant/invitations/${pending.id}/accept`,
              f.a.developer,
              {},
            );
            await call(
              `/api/tenant/invitations/accept/${pending.token}`,
              f.a.developer,
              {},
            );
            const onboarding = await f.invite({
              role: "member",
              email: `onboarding-${sequence}@fixture.test`,
            });
            await call(
              `/api/tenant/invitations/accept/${onboarding.token}/onboard`,
              null,
              { name: "QA recipient", password: "QA-Strong-91!" },
            );
            await call("/api/auth/accept-invite", null, {
              token: pending.token,
              password: "QA-Strong-91!",
            });
            assert.equal(
              (await Invitation.findById(pending._id)).status,
              "pending",
            );
            await call(
              `/api/admin/invitations/${pending.id}/expire`,
              f.a.admin,
              {},
              "PATCH",
              200,
            );
            await call(
              `/api/admin/invitations/${onboarding.id}/revoke`,
              f.a.admin,
              {},
              "PATCH",
              404,
            );
            await call(
              `/api/tenant/organizations/${f.org.id}/invitations/${onboarding.id}/revoke`,
              f.a.orgManager,
              {},
              "PATCH",
              200,
            );
            await call(
              "/api/admin/recruiters/direct",
              f.a.admin,
              {
                name: "QA direct",
                email: `direct-${sequence}@fixture.test`,
                password: "QA-Strong-91!",
              },
              "POST",
              201,
            );
          }
          if (policy === "managerTeamAdministration") {
            await call(
              `/api/tenant/organizations/${f.org.id}/teams`,
              f.a.orgManager,
              { name: "Denied team" },
            );
            const row = await Membership.findOne({
              userId: f.a.member._id,
              teamId: f.team._id,
            });
            for (const actor of [f.a.orgManager, f.a.manager, f.a.teamAdmin])
              await call(
                `/api/tenant/memberships/${row.id}/role`,
                actor,
                { role: "member" },
                "PATCH",
              );
            await call(
              "/api/admin-console/teams",
              f.a.admin,
              { name: "Admin recovery" },
              "POST",
              201,
            );
          }
          assert.equal(
            (await request("/api/admin-console/governance", foreign.a.admin))
              .data.policies[policy],
            true,
          );
          const enabledCalls = {
            recruiterJobCreation: [
              "/api/recruiter-hub/jobs",
              f.a.ownerRecruiter,
              jobBody,
              "POST",
              201,
            ],
            recruiterJobPublication: [
              `/api/recruiter-hub/jobs/${f.job.id}`,
              f.a.ownerRecruiter,
              { published: true },
              "PATCH",
              200,
            ],
            teamSharedJobs: [
              `/api/recruiter-hub/jobs/${f.job.id}`,
              f.a.manager,
              undefined,
              "GET",
              200,
            ],
            sharedPublicEvaluations: [
              `/api/recruiter-hub/matches/${f.match.id}`,
              f.a.manager,
              undefined,
              "GET",
              200,
            ],
            teamManagerEvaluationManagement: [
              `/api/recruiter-hub/matches/${f.match.id}/status`,
              f.a.manager,
              { status: "generated" },
              "PATCH",
              200,
            ],
            candidateMatching: [
              "/api/recruiter-hub/matches/generate",
              f.a.ownerRecruiter,
              { jobId: f.job.id, candidateIds: [f.a.public.id] },
              "POST",
              200,
            ],
            invitationCreation: [
              "/api/admin/invite-recruiter",
              f.a.admin,
              {
                name: "Enabled QA invitation",
                email: `enabled-${sequence}@fixture.test`,
              },
              "POST",
              201,
            ],
            managerTeamAdministration: [
              `/api/tenant/organizations/${f.org.id}/teams`,
              f.a.orgManager,
              { name: "Enabled manager team" },
              "POST",
              201,
            ],
          };
          const foreignCalls = {
            recruiterJobCreation: [
              "/api/recruiter-hub/jobs",
              foreign.a.ownerRecruiter,
              jobBody,
              "POST",
              201,
            ],
            recruiterJobPublication: [
              `/api/recruiter-hub/jobs/${foreign.job.id}`,
              foreign.a.ownerRecruiter,
              { published: true },
              "PATCH",
              200,
            ],
            teamSharedJobs: [
              `/api/recruiter-hub/jobs/${foreign.job.id}`,
              foreign.a.manager,
              undefined,
              "GET",
              200,
            ],
            sharedPublicEvaluations: [
              `/api/recruiter-hub/matches/${foreign.match.id}`,
              foreign.a.manager,
              undefined,
              "GET",
              200,
            ],
            teamManagerEvaluationManagement: [
              `/api/recruiter-hub/matches/${foreign.match.id}/status`,
              foreign.a.manager,
              { status: "rejected" },
              "PATCH",
              200,
            ],
            candidateMatching: [
              "/api/recruiter-hub/matches/generate",
              foreign.a.ownerRecruiter,
              { jobId: foreign.job.id, candidateIds: [foreign.a.public.id] },
              "POST",
              200,
            ],
            invitationCreation: [
              "/api/admin/invite-recruiter",
              foreign.a.admin,
              {
                name: "Other QA invitation",
                email: `other-${sequence}@fixture.test`,
              },
              "POST",
              201,
            ],
            managerTeamAdministration: [
              `/api/tenant/organizations/${foreign.org.id}/teams`,
              foreign.a.orgManager,
              { name: "Other manager team" },
              "POST",
              201,
            ],
          };
          await call(...foreignCalls[policy]);
          await change(f, { [policy]: true });
          await call(...enabledCalls[policy]);
          const restored = await request(
            "/api/recruiter-hub/jobs/" + f.job.id,
            f.a.manager,
          );
          expectStatus(restored, 200);
          if (policy === "teamSharedJobs")
            expectStatus(
              await request("/api/recruiter-hub/jobs/" + f.job.id, f.a.member),
              404,
            );
          assert.equal(await Match.countDocuments({ _id: f.match._id }), 1);
          assert.equal(
            await Shortlist.countDocuments({ _id: f.shortlist._id }),
            1,
          );
          metrics.assertions.push({
            policy,
            checks,
            otherOrganizationUnaffected: true,
            reenabled: true,
          });
        },
      );

    await t.test(
      "invitation re-enable retains expiry/revocation, capacity and inviter validation",
      async () => {
        const f = await fixture();
        const valid = await f.invite();
        const expired = await f.invite({
          expiresAt: new Date(Date.now() - 1000),
        });
        const revoked = await f.invite({ status: "revoked" });
        const untrusted = await f.invite({ invitedBy: f.a.member._id });
        await change(f, { invitationCreation: false });
        await change(f, { invitationCreation: true });
        for (const invite of [expired, revoked])
          expectStatus(
            await request(
              `/api/tenant/invitations/${invite.id}/accept`,
              f.a.developer,
              {},
            ),
            400,
          );

        expectStatus(
          await request(
            `/api/tenant/invitations/${untrusted.id}/accept`,
            f.a.developer,
            {},
          ),
          403,
        );
        const seats = await User.countDocuments({
          organizationId: f.org._id,
          role: "recruiter",
          isActive: { $ne: false },
        });
        await settings.updateSettings({
          organization: { recruiterLimitPerOrg: seats },
        });
        expectStatus(
          await request(
            `/api/tenant/invitations/${valid.id}/accept`,
            f.a.developer,
            {},
          ),
          400,
        );
        assert.equal((await Invitation.findById(valid._id)).status, "pending");
        await settings.updateSettings({
          organization: { recruiterLimitPerOrg: 100 },
        });
        expectStatus(
          await request(
            `/api/tenant/invitations/${valid.id}/accept`,
            f.a.developer,
            {},
          ),
          200,
        );
      },
    );

    await t.test(
      "disabled direct Admin inviter cannot consume a pending invitation after policy re-enable",
      async () => {
        const f = await fixture();
        await Membership.updateOne(
          {
            organizationId: f.org._id,
            userId: f.a.disabled._id,
            teamId: null,
          },
          { $set: { status: "active" } },
        );
        const created = await request(
          "/api/admin/invite-recruiter",
          f.a.disabled,
          { name: "QA revoked inviter", email: f.a.developer.email },
        );
        expectStatus(created, 201);
        const pending = await Invitation.findOne({
          organizationId: f.org._id,
          email: f.a.developer.email,
          status: "pending",
        });
        await Membership.updateOne(
          {
            organizationId: f.org._id,
            userId: f.a.disabled._id,
            teamId: null,
          },
          { $set: { status: "disabled" } },
        );
        await change(f, { invitationCreation: false });
        expectStatus(
          await request(
            `/api/tenant/invitations/${pending.id}/accept`,
            f.a.developer,
            {},
          ),
          403,
        );
        await change(f, { invitationCreation: true });
        const createAfterRevocation = await request(
          "/api/admin/invite-recruiter",
          f.a.disabled,
          { name: "Must deny", email: `revoked-${sequence}@fixture.test` },
        );
        const resendAfterRevocation = await request(
          `/api/admin/invitations/${pending.id}/resend`,
          f.a.disabled,
          {},
        );
        expectStatus(createAfterRevocation, 403);
        expectStatus(resendAfterRevocation, 403);
        const accepted = await request(
          `/api/tenant/invitations/${pending.id}/accept`,
          f.a.developer,
          {},
        );
        metrics.revokedInviter = {
          creationStatus: created.status,
          disabledMembership: true,
          createAfterRevocation: createAfterRevocation.status,
          resendAfterRevocation: resendAfterRevocation.status,
          expectedAcceptanceStatus: 403,
          actualAcceptanceStatus: accepted.status,
          invitationStatusAfter: (await Invitation.findById(pending._id))
            .status,
          recipientRoleAfter: (await User.findById(f.a.developer._id)).role,
        };
        expectStatus(accepted, 403);
      },
    );

    const operations = [
      "creation",
      "publication",
      "evaluation",
      "acceptance",
      "matching",
      "team-creation",
    ];
    for (const operation of operations)
      for (const first of ["policy", "operation"])
        await t.test(
          `serialized race: ${operation}, ${first} first`,
          async () => {
            const f = await fixture();
            const policy = {
              creation: "recruiterJobCreation",
              publication: "recruiterJobPublication",
              evaluation: "teamManagerEvaluationManagement",
              acceptance: "invitationCreation",
              matching: "candidateMatching",
              "team-creation": "managerTeamAdministration",
            }[operation];
            const invitation =
              operation === "acceptance" ? await f.invite() : null;
            const routes = {
              creation: [
                "/api/recruiter-hub/jobs",
                f.a.ownerRecruiter,
                jobBody,
                "POST",
              ],
              publication: [
                `/api/recruiter-hub/jobs/${f.job.id}`,
                f.a.ownerRecruiter,
                { published: true },
                "PATCH",
              ],
              evaluation: [
                `/api/recruiter-hub/matches/${f.match.id}/status`,
                f.a.manager,
                { status: "rejected" },
                "PATCH",
              ],
              acceptance: [
                `/api/tenant/invitations/${invitation?.id}/accept`,
                f.a.developer,
                {},
                "POST",
              ],
              matching: [
                "/api/recruiter-hub/matches/generate",
                f.a.ownerRecruiter,
                { jobId: f.job.id, candidateIds: [f.a.publicTwo.id] },
                "POST",
              ],
              "team-creation": [
                `/api/tenant/organizations/${f.org.id}/teams`,
                f.a.orgManager,
                { name: "Racing QA team" },
                "POST",
              ],
            };
            const entered = deferred();
            const released = deferred();
            const rivalAttempted = deferred();
            const original = Organization.collection.updateOne;
            let held = false;
            let attempts = 0;
            Organization.collection.updateOne = async function (...args) {
              if (String(args[0]?._id) === f.org.id) {
                attempts++;
                const tag = local.getStore();
                if (tag && tag !== first) rivalAttempted.resolve();
                const result = await original.apply(this, args);
                if (tag === first && !held) {
                  held = true;
                  entered.resolve();
                  await released.promise;
                }
                return result;
              }
              return original.apply(this, args);
            };
            const policyRequest = () =>
              request(
                "/api/admin-console/governance",
                f.a.admin,
                { expectedVersion: 0, policies: { [policy]: false } },
                "PATCH",
                "policy",
              );
            const operationRequest = () =>
              request(...routes[operation], "operation");
            const started = performance.now();
            let policyResult;
            let operationResult;
            try {
              const firstPromise =
                first === "policy" ? policyRequest() : operationRequest();
              await deadline(entered.promise, "first organization fence");
              const secondPromise =
                first === "policy" ? operationRequest() : policyRequest();
              await deadline(
                rivalAttempted.promise,
                "rival transaction attempt",
              );
              released.resolve();
              const firstResult = await deadline(
                firstPromise,
                "first operation result",
              );
              const secondResult = await deadline(
                secondPromise,
                "second operation result",
              );
              [policyResult, operationResult] =
                first === "policy"
                  ? [firstResult, secondResult]
                  : [secondResult, firstResult];
            } finally {
              released.resolve();
              Organization.collection.updateOne = original;
            }
            expectStatus(policyResult, 200);
            expectStatus(
              operationResult,
              first === "policy"
                ? 403
                : ["creation", "team-creation"].includes(operation)
                  ? 201
                  : 200,
            );
            if (operation === "creation")
              assert.equal(
                await Job.countDocuments({ organizationId: f.org._id }),
                first === "policy" ? 1 : 2,
              );
            if (operation === "publication")
              assert.equal(
                (await Job.findById(f.job._id)).published,
                first !== "policy",
              );
            if (operation === "evaluation")
              assert.equal(
                (await Match.findById(f.match._id)).status,
                first === "policy" ? "generated" : "rejected",
              );
            if (operation === "acceptance")
              assert.equal(
                (await Invitation.findById(invitation._id)).status,
                first === "policy" ? "pending" : "accepted",
              );
            if (operation === "matching")
              assert.equal(
                await Match.countDocuments({
                  organizationId: f.org._id,
                  candidateId: f.a.publicTwo._id,
                }),
                first === "policy" ? 0 : 1,
              );
            if (operation === "team-creation")
              assert.equal(
                await Team.countDocuments({ organizationId: f.org._id }),
                first === "policy" ? 1 : 2,
              );
            assert.equal(await version(f), 1);
            assert.equal((await configAudits(f)).length, 1);
            metrics.races.push({
              operation,
              first,
              attempts,
              policyStatus: policyResult.status,
              protectedStatus: operationResult.status,
              milliseconds: performance.now() - started,
              finalStateVerified: true,
            });
          },
        );

    for (const first of ["platform", "operation"])
      await t.test(
        `platform settings document serialization: ${first} first`,
        async () => {
          const f = await fixture();
          const entered = deferred();
          const released = deferred();
          const rivalAttempted = deferred();
          const update = Settings.collection.updateOne;
          const findAndUpdate = Settings.collection.findOneAndUpdate;
          let held = false;
          async function intercept(original, self, args, tag) {
            const current = local.getStore();
            if (current && current !== first) rivalAttempted.resolve();
            const result = await original.apply(self, args);
            if (current === first && current === tag && !held) {
              held = true;
              entered.resolve();
              await released.promise;
            }
            return result;
          }
          Settings.collection.updateOne = function (...args) {
            return intercept(update, this, args, "operation");
          };
          Settings.collection.findOneAndUpdate = function (...args) {
            return intercept(findAndUpdate, this, args, "platform");
          };
          const mutatePlatform = () =>
            local.run("platform", () =>
              settings.updateSettings({
                recruiter: { enableRecruiterAccess: false },
              }),
            );
          const mutateJob = () =>
            request(
              "/api/recruiter-hub/jobs",
              f.a.ownerRecruiter,
              jobBody,
              "POST",
              "operation",
            );
          let operationResult;
          try {
            const firstPromise =
              first === "platform" ? mutatePlatform() : mutateJob();
            await deadline(entered.promise, "settings document fence");
            const secondPromise =
              first === "platform" ? mutateJob() : mutatePlatform();
            await deadline(rivalAttempted.promise, "rival settings write");
            released.resolve();
            const a = await deadline(firstPromise, "first settings ordering");
            const b = await deadline(secondPromise, "second settings ordering");
            operationResult = first === "platform" ? b : a;
          } finally {
            released.resolve();
            Settings.collection.updateOne = update;
            Settings.collection.findOneAndUpdate = findAndUpdate;
          }
          expectStatus(operationResult, first === "platform" ? 403 : 201);
          assert.equal(
            await Job.countDocuments({ organizationId: f.org._id }),
            first === "platform" ? 1 : 2,
          );
          metrics.races.push({
            operation: "platform-versus-creation",
            first,
            protectedStatus: operationResult.status,
            initializedPlatformDocument: true,
          });
          await settings.updateSettings({
            recruiter: { enableRecruiterAccess: true },
          });
        },
      );

    await t.test(
      "capability reasons, platform precedence, and resource ownership remain independent",
      async () => {
        const f = await fixture();
        await change(f, { candidateMatching: false });
        for (const route of [
          "/api/recruiter-hub/capabilities",
          "/api/recruiter/capabilities",
        ]) {
          const result = await request(route, f.a.ownerRecruiter);
          expectStatus(result, 200);
          assert.equal(result.data.version, 1);
          assert.equal(
            result.data.capabilities.candidateMatching.reason,
            "organization_policy",
          );
          assert.equal(
            result.data.capabilities.invitationCreation.reason,
            "role_or_ownership",
          );
          assert.equal(
            result.data.capabilities.candidateMatching.resourceChecksRequired,
            true,
          );
          assert.ok(!JSON.stringify(result.data).includes(f.job.id));
        }
        await settings.updateSettings({
          recruiter: { enableRecruiterAccess: false },
        });
        const result = await request(
          "/api/recruiter-hub/capabilities",
          f.a.ownerRecruiter,
        );
        expectStatus(result, 200);
        assert.equal(
          result.data.capabilities.candidateMatching.reason,
          "platform_policy",
        );
        await change(f, { candidateMatching: true });
        expectStatus(
          await request("/api/recruiter-hub/jobs", f.a.ownerRecruiter, jobBody),
          403,
        );
        await settings.updateSettings({
          recruiter: {
            enableRecruiterAccess: true,
            candidateVisibility: "private",
          },
        });
        expectStatus(
          await request("/api/recruiter/ai-rank", f.a.ownerRecruiter, {
            job: jobBody,
          }),
          403,
        );
        await settings.updateSettings({
          recruiter: { candidateVisibility: "public" },
        });
        const job = await request(
          `/api/recruiter-hub/jobs/${f.job.id}`,
          f.a.member,
        );
        expectStatus(job, 200);
        assert.equal(job.data.job.access.privateEvidence, false);
        assert.equal(job.data.job.access.evaluationManage, false);
        await change(f, { candidateMatching: false });
        metrics.responseContracts.push({
          case: "matching-disabled-job-flags",
          jobAccess: (
            await request(`/api/recruiter-hub/jobs/${f.job.id}`, f.a.manager)
          ).data.job.access,
        });
      },
    );
    await t.test(
      "directory population, lifecycle filters and representative response sizes",
      async () => {
        const f = await fixture();
        const foreign = await fixture();
        const teamTwo = await Team.create({
          organizationId: f.org._id,
          name: "Second QA team",
          slug: "second",
          createdBy: f.a.admin._id,
          isActive: false,
        });
        await Membership.create({
          organizationId: f.org._id,
          userId: f.a.member._id,
          teamId: teamTwo._id,
          role: "member",
          status: "disabled",
        });
        const inactive = await f.account("inactive-internal", "developer", {
          organizationId: f.org._id,
          isActive: false,
        });
        await Membership.create({
          organizationId: f.org._id,
          userId: inactive._id,
          status: "disabled",
        });
        const rows = await request("/api/admin-console/members", f.a.admin);
        expectStatus(rows, 200);
        assert.equal(
          new Set(rows.data.members.map((row) => row._id)).size,
          rows.data.total,
        );
        for (const excluded of [
          f.a.public.id,
          f.a.publicTwo.id,
          foreign.a.admin.id,
        ])
          assert.ok(!rows.data.members.some((row) => row._id === excluded));
        const member = rows.data.members.find(
          (row) => row._id === f.a.member.id,
        );
        assert.equal(member.teams.length, 2);
        assert.equal(member.organizationMembership.role, "member");
        assert.equal(member.accountRole, "recruiter");
        assert.equal(
          rows.data.members.find((row) => row._id === inactive.id).isActive,
          false,
        );
        assert.equal(
          rows.data.members.find((row) => row._id === f.a.admin.id).isOwner,
          true,
        );
        const pending = await f.invite({ teamId: f.team._id });
        const expired = await f.invite({
          expiresAt: new Date(Date.now() - 1000),
        });
        await f.invite({ status: "accepted", acceptedBy: f.a.developer._id });
        await f.invite({ status: "revoked" });
        const invites = await request(
          "/api/admin-console/invitations",
          f.a.admin,
        );
        expectStatus(invites, 200);
        assert.equal(invites.data.invitations.length, 4);
        assert.ok(!JSON.stringify(invites.data).includes(pending.token));
        for (const status of ["pending", "expired", "accepted", "revoked"])
          assert.equal(
            (
              await request(
                "/api/admin-console/invitations?status=" + status,
                f.a.admin,
              )
            ).data.invitations.length,
            1,
          );
        assert.equal(
          (await Invitation.findById(expired._id)).status,
          "pending",
        );
        assert.equal(
          invites.data.invitations.find((row) => row._id === pending.id).teamId,
          f.team.id,
        );
        metrics.directories.push({
          members: rows.data.total,
          membersBytes: rows.bytes,
          invitations: 4,
          invitationsBytes: invites.bytes,
          milliseconds: rows.milliseconds,
          paginated: false,
        });
        const bulk = await User.insertMany(
          Array.from({ length: 200 }, (_, index) => ({
            name: `QA internal ${index}`,
            email: `qa-directory-${sequence}-${index}@fixture.test`,
            role: "developer",
            providers: ["github"],
            isVerified: true,
            organizationId: f.org._id,
          })),
        );
        await Membership.insertMany(
          bulk.map((user) => ({
            organizationId: f.org._id,
            userId: user._id,
            role: "member",
          })),
        );
        const large = await request("/api/admin-console/members", f.a.admin);
        expectStatus(large, 200);
        assert.equal(large.data.total, rows.data.total + 200);
        metrics.directories.push({
          members: large.data.total,
          membersBytes: large.bytes,
          milliseconds: large.milliseconds,
          paginated: false,
        });
      },
    );
    await t.test(
      "over-capacity reads are accurate and never deactivate or delete existing resources",
      async () => {
        const f = await fixture();
        const active = await User.countDocuments({
          organizationId: f.org._id,
          role: "recruiter",
          isActive: { $ne: false },
        });
        await settings.updateSettings({
          organization: {
            recruiterLimitPerOrg: active - 1,
            maxTeamsPerOrganization: 0,
          },
        });
        const result = await request(
          "/api/admin-console/governance",
          f.a.admin,
        );
        expectStatus(result, 200);
        assert.equal(result.data.resources.usage.activeRecruiters, active);
        assert.equal(result.data.resources.usage.teams, 1);
        assert.equal(result.data.resources.usage.activeTeams, 1);
        assert.equal(result.data.resources.editable, false);
        expectStatus(
          await request("/api/admin-console/teams", f.a.admin, {
            name: "Over limit",
          }),
          400,
        );
        assert.equal(
          await User.countDocuments({
            organizationId: f.org._id,
            role: "recruiter",
            isActive: { $ne: false },
          }),
          active,
        );
        assert.equal(
          await Team.countDocuments({ organizationId: f.org._id }),
          1,
        );
        await settings.updateSettings({
          organization: {
            recruiterLimitPerOrg: 100,
            maxTeamsPerOrganization: 100,
          },
        });
        assert.equal(await version(f), 0);
      },
    );
    await t.test(
      "private application bytes, snapshots, status and withdrawal survive governance transitions",
      async () => {
        const f = await fixture();
        const service = load("modules/jobs/services/jobApplicationService");
        const appId = service.canonicalApplicationId(
          f.job._id,
          f.a.developer._id,
        );
        const bytes = Buffer.from("QA immutable submitted evidence");
        await Application.create({
          _id: appId,
          organizationId: f.org._id,
          organizationName: f.org.name,
          recruiterId: f.a.ownerRecruiter._id,
          jobId: f.job._id,
          applicantId: f.a.developer._id,
          applicantName: f.a.developer.name,
          jobTitle: f.job.title,
          resume: { fileName: "qa.pdf" },
          resumeBytes: bytes,
          portfolio: { headline: "QA immutable snapshot" },
          consent: {
            version: "direct-apply-v1",
            submittedAt: new Date(),
            sharePortfolio: true,
          },
        });
        await change(f, {
          teamSharedJobs: false,
          sharedPublicEvaluations: false,
          candidateMatching: false,
        });
        const route = `/api/recruiter-hub/jobs/${f.job.id}/applications/${appId}/resume`;
        const owner = await request(route, f.a.ownerRecruiter);
        expectStatus(owner, 200);
        assert.deepEqual(owner.data, bytes);
        expectStatus(await request(route, f.a.manager), 404);
        expectStatus(await request(route, f.a.admin), 403);
        expectStatus(
          await request(
            `/qa/applications/${appId}/withdraw`,
            f.a.developer,
            { expectedStatus: "submitted" },
            "PATCH",
          ),
          200,
        );
        const stored = await Application.findById(appId)
          .select("+resumeBytes")
          .lean();
        assert.equal(stored.status, "withdrawn");
        assert.equal(stored.portfolio.headline, "QA immutable snapshot");
        assert.equal(String(stored.recruiterId), f.a.ownerRecruiter.id);
        assert.deepEqual(Buffer.from(stored.resumeBytes.buffer), bytes);
      },
    );
    await t.test(
      "bounded representative contention and public version stability",
      async () => {
        const f = await fixture();
        const started = performance.now();
        const results = await deadline(
          Promise.all(
            Array.from({ length: 8 }, () =>
              request("/api/recruiter-hub/jobs", f.a.ownerRecruiter, jobBody),
            ),
          ),
          "eight concurrent job mutations",
        );
        for (const result of results) expectStatus(result, 201);
        assert.equal(await version(f), 0);
        const durations = results
          .map((r) => r.milliseconds)
          .sort((a, b) => a - b);
        metrics.contention = {
          operations: 8,
          elapsedMilliseconds: performance.now() - started,
          p95Milliseconds: durations[Math.ceil(durations.length * 0.95) - 1],
          maxMilliseconds: durations.at(-1),
          unboundedRetryObserved: false,
        };
      },
    );
  },
);
