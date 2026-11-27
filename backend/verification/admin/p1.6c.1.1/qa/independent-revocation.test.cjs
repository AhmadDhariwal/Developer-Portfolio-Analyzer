require("./isolate-evidence.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const { randomBytes } = require("node:crypto");
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
const settings = load("modules/super-admin/services/platformSettingsService");
const { sign } = load("modules/auth/utils/authSessionToken");
const routes = {
  id: "/api/tenant/invitations/:invitationId/accept",
  token: "/api/tenant/invitations/accept/:token",
  auth: "/api/auth/accept-invite",
  onboard: "/api/tenant/invitations/accept/:token/onboard",
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
        timer = setTimeout(() => reject(Error(`QA deadline: ${label}`)), 15000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test(
  "Independent P1.6C.1.1 four-route persisted-state and transaction acceptance",
  { timeout: 240000 },
  async (t) => {
    const mongo = await startMongo({
      replicaSet: "independent-p16c11-revocation",
    });
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = randomBytes(32).toString("hex");
    const evidence = {
      routes,
      denials: [],
      compatibility: [],
      races: [],
      network: "loopback only",
    };
    let server;
    let sequence = 0;
    let conflicts = 0;
    let serverJwtMints = 0;
    t.after(async () => {
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      settings.stopSettingsSynchronization();
      await load(
        "modules/notifications/services/notificationStreamService",
      ).stop();
      await mongoose.disconnect();
      evidence.cleanup = await mongo.stop();
      fs.writeFileSync(
        path.join(__dirname, "independent-revocation-evidence.json"),
        JSON.stringify(evidence, null, 2) + "\n",
      );
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    });
    await mongoose.connect(mongo.uri, { monitorCommands: true });
    const client = mongoose.connection.getClient();
    client.on("commandFailed", (event) => {
      if (event.failure?.code === 112) conflicts += 1;
    });
    await settings.startSettingsSynchronization();
    await settings.updateSettings({
      organization: { recruiterLimitPerOrg: 100 },
      recruiter: { enableRecruiterAccess: true },
    });
    const email = load("core/messaging/emailService");
    const tenantEmail = load("core/messaging/invitationEmailService");
    t.mock.method(email, "sendRecruiterInvitationEmail", async () => ({
      sent: false,
      reason: "QA local delivery stub",
    }));
    t.mock.method(tenantEmail, "sendInvitationEmail", async () => ({
      sent: false,
      reason: "QA local delivery stub",
    }));
    // The request helper captured the original signer above. This spy sees only
    // tokens minted by application handlers, not synthetic request credentials.
    t.mock.method(
      load("modules/auth/utils/authSessionToken"),
      "sign",
      (...args) => {
        serverJwtMints += 1;
        return sign(...args);
      },
    );
    const app = express();
    app.use(express.json());
    app.use("/api/admin", load("modules/admin/routes/admin.routes"));
    app.use(
      "/api/admin-console",
      load("modules/admin/routes/adminConsole.routes"),
    );
    app.use("/api/tenant", load("modules/admin/routes/tenant.routes"));
    app.post(
      "/api/auth/accept-invite",
      load("modules/auth/authcontroller").acceptInvite,
    );
    for (const model of Object.values(mongoose.models)) await model.init();
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    async function request(route, actor, body = {}, method = "POST") {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}${route}`,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(actor ? { Authorization: `Bearer ${sign(actor)}` } : {}),
          },
          ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(20000),
        },
      );
      const data = await response.json();
      return {
        status: response.status,
        data,
        hasCookie: Boolean(response.headers.get("set-cookie")),
      };
    }
    const user = (role = "developer", extra = {}) =>
      User.create({
        name: "Independent QA fixture",
        email: `qa-${++sequence}@independent-p16c11.test`,
        providers: ["github"],
        isActive: true,
        isVerified: true,
        role,
        ...extra,
      });
    const owner = await user("admin");
    const org = await Organization.create({
      name: "Independent QA organization",
      slug: "independent-p16c11",
      ownerId: owner._id,
      createdBy: owner._id,
    });
    owner.organizationId = org._id;
    await owner.save();
    const team = await Team.create({
      organizationId: org._id,
      name: "Independent QA team",
      slug: "independent-qa",
      createdBy: owner._id,
    });
    async function inviter() {
      const actor = await user("admin", { organizationId: org._id });
      const membership = await Membership.create({
        organizationId: org._id,
        userId: actor._id,
        teamId: null,
        role: "admin",
        status: "active",
      });
      return { actor, membership };
    }
    async function pending(kind, actor, organization = org, role) {
      const recipient = ["id", "token"].includes(kind) ? await user() : null;
      const email =
        recipient?.email || `onboard-${++sequence}@independent-p16c11.test`;
      const invitation = await Invitation.create({
        organizationId: organization._id,
        invitedBy: actor._id,
        email,
        name: "Independent QA invitation",
        role: role || (kind === "onboard" ? "member" : "recruiter"),
        token: randomBytes(24).toString("hex"),
        expiresAt: new Date(Date.now() + 300000),
      });
      return { kind, invitation, recipient, email };
    }
    async function accept(f) {
      const body =
        f.kind === "auth"
          ? { token: f.invitation.token, password: "QA-Independent-99!" }
          : f.kind === "onboard"
            ? {
                name: "Independent QA new member",
                password: "QA-Independent-99!",
              }
            : {};
      const route = routes[f.kind]
        .replace(":invitationId", f.invitation.id)
        .replace(":token", f.invitation.token);
      const mintedBefore = serverJwtMints;
      const response = await request(route, f.recipient, body);
      return { ...response, serverJwtMints: serverJwtMints - mintedBefore };
    }
    function noJwt(value) {
      if (typeof value === "string")
        assert.doesNotMatch(
          value,
          /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
        );
      else if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          assert.ok(
            !/^(token|accessToken|refreshToken|jwt)$/i.test(key),
            `Unexpected credential response field: ${key}`,
          );
          noJwt(child);
        }
      }
    }
    async function denied(f, response, phase) {
      assert.equal(
        response.status,
        403,
        `${phase} ${f.kind}: ${JSON.stringify(response.data)}`,
      );
      assert.equal(response.hasCookie, false);
      assert.equal(
        response.serverJwtMints,
        0,
        "Denied handlers must never invoke the JWT signer.",
      );
      noJwt(response.data);
      const stored = await Invitation.findById(f.invitation._id).lean();
      const account = await User.findOne({ email: f.email }).lean();
      assert.equal(stored.status, "pending");
      assert.equal(stored.acceptedBy, null);
      if (f.recipient) {
        assert.equal(account.role, "developer");
        assert.equal(account.organizationId, null);
        assert.equal(
          Number(account.sessionRevision || 0),
          Number(f.recipient.sessionRevision || 0),
        );
        assert.equal(
          await Membership.countDocuments({ userId: account._id }),
          0,
        );
      } else assert.equal(account, null);
      evidence.denials.push({
        phase,
        kind: f.kind,
        status: response.status,
        invitationStatus: stored.status,
        accountCreated: false,
        roleGranted: false,
        membershipCreated: false,
        jwtMinted: false,
        jwtReturned: false,
        cookieReturned: false,
      });
    }
    async function policy(enabled) {
      const current = await request(
        "/api/admin-console/governance",
        owner,
        {},
        "GET",
      );
      assert.equal(current.status, 200);
      const patched = await request(
        "/api/admin-console/governance",
        owner,
        {
          expectedVersion: current.data.version,
          policies: { invitationCreation: enabled },
        },
        "PATCH",
      );
      assert.equal(patched.status, 200);
      assert.equal(patched.data.version, current.data.version + 1);
    }
    await t.test(
      "all four routes deny revoked inviter before, during, and after policy disable/re-enable without grants or JWTs",
      async () => {
        const { actor, membership } = await inviter();
        const fixtures = await Promise.all(
          Object.keys(routes).map((kind) => pending(kind, actor)),
        );
        // Keep active team authority to ensure it cannot mask explicit direct revocation.
        await Membership.create({
          organizationId: org._id,
          userId: actor._id,
          teamId: team._id,
          role: "admin",
          status: "active",
        });
        await Membership.updateOne(
          { _id: membership._id },
          { $set: { status: "disabled" } },
        );
        const userCount = await User.countDocuments();
        const membershipCount = await Membership.countDocuments();
        for (const [phase, enabled] of [
          ["before-toggle", null],
          ["policy-disabled", false],
          ["policy-reenabled", true],
        ]) {
          if (enabled !== null) await policy(enabled);
          for (const fixture of fixtures)
            await denied(fixture, await accept(fixture), phase);
          assert.equal(await User.countDocuments(), userCount);
          assert.equal(await Membership.countDocuments(), membershipCount);
        }
        evidence.policyVersionAfterToggle = (
          await Organization.findById(org._id)
        ).governance.version;
      },
    );
    await t.test(
      "active direct Admin, Admin owner, exact Super Admin owner and legacy affiliation remain functional",
      async () => {
        const direct = await inviter();
        const legacy = await user("admin", { organizationId: org._id });
        const superOwner = await user("super_admin");
        const superOrg = await Organization.create({
          name: "Exact Super Admin owner",
          slug: "qa-super-owner",
          ownerId: superOwner._id,
          createdBy: superOwner._id,
        });
        for (const [label, actor, organization, kind] of [
          ["active-direct-admin", direct.actor, org, "id"],
          ["admin-owner", owner, org, "token"],
          ["super-admin-owner", superOwner, superOrg, "auth"],
          ["legacy-affiliated-admin", legacy, org, "token"],
          ["legacy-member-onboarding", owner, org, "onboard"],
        ]) {
          const fixture = await pending(kind, actor, organization);
          const response = await accept(fixture);
          assert.equal(
            response.status,
            200,
            label + ": " + JSON.stringify(response.data),
          );
          const account = await User.findOne({ email: fixture.email }).lean();
          const stored = await Invitation.findById(
            fixture.invitation._id,
          ).lean();
          assert.equal(stored.status, "accepted");
          assert.equal(String(stored.acceptedBy), String(account._id));
          assert.equal(
            String(account.organizationId),
            String(organization._id),
          );
          assert.equal(
            await Membership.countDocuments({
              userId: account._id,
              organizationId: organization._id,
              status: "active",
            }),
            1,
          );
          if (kind !== "onboard") assert.equal(account.role, "recruiter");
          else assert.notEqual(account.role, "recruiter");
          if (["auth", "onboard"].includes(kind)) {
            assert.ok(response.data.user.token);
            assert.equal(
              response.serverJwtMints,
              1,
              "Positive control must exercise the real JWT signer spy.",
            );
          }
          evidence.compatibility.push({
            label,
            status: response.status,
            role: account.role,
            membershipCount: 1,
            invitationStatus: stored.status,
            serverJwtMints: response.serverJwtMints,
          });
        }
      },
    );
    for (const kind of Object.keys(routes)) {
      await t.test(
        `${kind}: revocation commits after authority read but before membership write; acceptance retries and denies`,
        async () => {
          const { actor, membership } = await inviter();
          const fixture = await pending(kind, actor);
          const entered = deferred();
          const release = deferred();
          const original = Membership.collection.updateOne;
          let held = false;
          const conflictsBefore = conflicts;
          Membership.collection.updateOne = async function (
            filter,
            update,
            options,
          ) {
            if (
              !held &&
              String(filter._id) === membership.id &&
              update.$inc?.governanceAccessRevision
            ) {
              held = true;
              entered.resolve();
              await deadline(release.promise, "release authority read");
            }
            return original.call(this, filter, update, options);
          };
          let responsePromise;
          try {
            responsePromise = accept(fixture);
            await deadline(
              entered.promise,
              "acceptance read inviter membership",
            );
            await original.call(
              Membership.collection,
              { _id: membership._id },
              { $set: { status: "disabled" } },
            );
            release.resolve();
            const response = await responsePromise;
            await denied(fixture, response, "revocation-first-race");
            assert.ok(
              conflicts > conflictsBefore,
              "Real MongoDB write conflict must force transaction retry.",
            );
            assert.equal(
              (await Membership.findById(membership._id)).status,
              "disabled",
            );
            evidence.races.push({
              kind,
              ordering: "revocation-first",
              status: response.status,
              realWriteConflicts: conflicts - conflictsBefore,
              finalStateVerified: true,
            });
          } finally {
            release.resolve();
            if (responsePromise) await responsePromise.catch(() => {});
            Membership.collection.updateOne = original;
          }
        },
      );
      await t.test(
        `${kind}: acceptance holds membership fence; concurrent revocation follows commit and prevents later acceptance`,
        async () => {
          const { actor, membership } = await inviter();
          const fixture = await pending(kind, actor);
          const later = await pending(kind, actor);
          const entered = deferred();
          const release = deferred();
          const attempted = deferred();
          const original = Membership.collection.updateOne;
          let held = false;
          let revokeSettled = false;
          const observe = (event) => {
            if (
              event.commandName === "update" &&
              event.command.updates?.some(
                (entry) =>
                  String(entry.q._id) === membership.id &&
                  entry.u.$set?.status === "disabled",
              )
            )
              attempted.resolve();
          };
          client.on("commandStarted", observe);
          Membership.collection.updateOne = async function (
            filter,
            update,
            options,
          ) {
            const result = await original.call(this, filter, update, options);
            if (
              !held &&
              String(filter._id) === membership.id &&
              update.$inc?.governanceAccessRevision
            ) {
              held = true;
              entered.resolve();
              await deadline(
                release.promise,
                "release acquired membership fence",
              );
            }
            return result;
          };
          let responsePromise;
          let revoke;
          try {
            responsePromise = accept(fixture);
            await deadline(entered.promise, "membership fence acquired");
            revoke = original.call(
              Membership.collection,
              { _id: membership._id },
              { $set: { status: "disabled" } },
            );
            revoke.then(() => {
              revokeSettled = true;
            });
            await deadline(
              attempted.promise,
              "observe real competing membership update",
            );
            assert.equal(revokeSettled, false);
            release.resolve();
            const [response] = await Promise.all([responsePromise, revoke]);
            assert.equal(response.status, 200, JSON.stringify(response.data));
            const stored = await Invitation.findById(
              fixture.invitation._id,
            ).lean();
            const account = await User.findOne({ email: fixture.email }).lean();
            assert.equal(stored.status, "accepted");
            assert.equal(String(stored.acceptedBy), String(account._id));
            assert.equal(
              (await Membership.findById(membership._id)).status,
              "disabled",
            );
            await denied(
              later,
              await accept(later),
              "acceptance-first-followup",
            );
            evidence.races.push({
              kind,
              ordering: "acceptance-first",
              status: response.status,
              competingUpdateObserved: true,
              revocationPendingAtRelease: true,
              subsequentStatus: 403,
              finalStateVerified: true,
            });
          } finally {
            release.resolve();
            await Promise.allSettled([responsePromise, revoke].filter(Boolean));
            Membership.collection.updateOne = original;
            client.off("commandStarted", observe);
          }
        },
      );
    }
  },
);
