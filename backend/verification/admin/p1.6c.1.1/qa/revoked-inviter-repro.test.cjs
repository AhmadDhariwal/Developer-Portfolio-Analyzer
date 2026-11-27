require("./isolate-evidence.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { once } = require("node:events");
const express = require("express");
const mongoose = require("mongoose");
const src = path.resolve(__dirname, "../../../../src");
const load = (file) => require(path.join(src, file));
const { startMongo } = load("tests/fixtures/disposableRequestMongo");
const User = load("modules/auth/models/user");
const Organization = load("modules/admin/models/organization");
const Membership = load("modules/admin/models/membership");
const Invitation = load("modules/admin/models/invitation");
const settings = load("modules/super-admin/services/platformSettingsService");
const { sign } = load("modules/auth/utils/authSessionToken");

test(
  "security invariant: disabled Admin inviter cannot authorize pending Recruiter acceptance",
  { timeout: 90000 },
  async (t) => {
    const mongo = await startMongo({ replicaSet: "qa-revoked-inviter-repro" });
    const oldSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = randomBytes(32).toString("hex");
    let server;
    const evidence = {};
    t.after(async () => {
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      settings.stopSettingsSynchronization();
      await mongoose.disconnect();
      evidence.cleanup = await mongo.stop();
      fs.writeFileSync(
        path.join(__dirname, "revoked-inviter-reproduction.json"),
        JSON.stringify(evidence, null, 2) + "\n",
      );
      if (oldSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = oldSecret;
    });
    await mongoose.connect(mongo.uri);
    await settings.startSettingsSynchronization();
    await settings.updateSettings({
      organization: { recruiterLimitPerOrg: 10 },
    });
    const email = load("core/messaging/emailService");
    t.mock.method(email, "sendRecruiterInvitationEmail", async () => ({
      sent: false,
      reason: "QA local stub",
    }));
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
    const owner = await User.create({
      name: "QA owner",
      email: "owner@revocation.test",
      role: "admin",
      providers: ["github"],
      isVerified: true,
    });
    const org = await Organization.create({
      name: "QA revocation",
      slug: "qa-revocation",
      ownerId: owner._id,
      createdBy: owner._id,
    });
    owner.organizationId = org._id;
    await owner.save();
    const inviter = await User.create({
      name: "QA inviter",
      email: "inviter@revocation.test",
      role: "admin",
      organizationId: org._id,
      providers: ["github"],
      isVerified: true,
    });
    const recipient = await User.create({
      name: "QA recipient",
      email: "recipient@revocation.test",
      role: "developer",
      providers: ["github"],
      isVerified: true,
    });
    const membership = await Membership.create({
      organizationId: org._id,
      userId: inviter._id,
      role: "admin",
      status: "active",
    });
    const secondRecipient = await User.create({
      name: "QA token recipient",
      email: "token-recipient@revocation.test",
      role: "developer",
      providers: ["github"],
      isVerified: true,
    });
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const request = async (route, actor, body, method = "POST") => {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}${route}`,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(actor && { Authorization: `Bearer ${sign(actor)}` }),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
        },
      );
      return { status: response.status, data: await response.json() };
    };
    const created = await request("/api/admin/invite-recruiter", inviter, {
      name: "QA recipient",
      email: recipient.email,
    });
    assert.equal(created.status, 201);
    assert.equal(
      (
        await request("/api/admin/invite-recruiter", inviter, {
          name: "QA token recipient",
          email: secondRecipient.email,
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await request("/api/admin/invite-recruiter", inviter, {
          name: "QA compatibility recipient",
          email: "new-recipient@revocation.test",
        })
      ).status,
      201,
    );
    const pending = await Invitation.findOne({
      organizationId: org._id,
      email: recipient.email,
      status: "pending",
    });
    await Membership.updateOne(
      { _id: membership._id },
      { $set: { status: "disabled" } },
    );
    for (const [expectedVersion, enabled] of [
      [0, false],
      [1, true],
    ]) {
      const updated = await request(
        "/api/admin-console/governance",
        owner,
        { expectedVersion, policies: { invitationCreation: enabled } },
        "PATCH",
      );
      assert.equal(updated.status, 200);
    }
    const deniedCreate = await request("/api/admin/invite-recruiter", inviter, {
      name: "Must deny",
      email: "new@revocation.test",
    });
    const deniedResend = await request(
      `/api/admin/invitations/${pending.id}/resend`,
      inviter,
      {},
    );
    const accepted = await request(
      `/api/tenant/invitations/${pending.id}/accept`,
      recipient,
      {},
    );
    const tokenInvitation = await Invitation.findOne({
      organizationId: org._id,
      email: secondRecipient.email,
    });
    const compatibilityInvitation = await Invitation.findOne({
      organizationId: org._id,
      email: "new-recipient@revocation.test",
    });
    const tokenAcceptance = await request(
      `/api/tenant/invitations/accept/${tokenInvitation.token}`,
      secondRecipient,
      {},
    );
    const compatibilityAcceptance = await request(
      "/api/auth/accept-invite",
      null,
      { token: compatibilityInvitation.token, password: "QA-Strong-91!" },
    );
    Object.assign(evidence, {
      isolatedReplicaSet: true,
      sourceModified: false,
      inviterAccountRole: inviter.role,
      inviterAccountActive: inviter.isActive,
      inviterDirectMembershipStatus: (await Membership.findById(membership._id))
        .status,
      createdStatus: created.status,
      createAfterRevocationStatus: deniedCreate.status,
      resendAfterRevocationStatus: deniedResend.status,
      acceptanceExpectedStatus: 403,
      acceptanceActualStatus: accepted.status,
      invitationStoredStatus: (await Invitation.findById(pending._id)).status,
      recipientStoredRole: (await User.findById(recipient._id)).role,
      acceptanceRoutes: [
        {
          route: "/api/tenant/invitations/:id/accept",
          expectedStatus: 403,
          actualStatus: accepted.status,
          recipientRole: (await User.findById(recipient._id)).role,
        },
        {
          route: "/api/tenant/invitations/accept/:token",
          expectedStatus: 403,
          actualStatus: tokenAcceptance.status,
          recipientRole: (await User.findById(secondRecipient._id)).role,
        },
        {
          route: "/api/auth/accept-invite",
          expectedStatus: 403,
          actualStatus: compatibilityAcceptance.status,
          recipientRole:
            (await User.findOne({ email: "new-recipient@revocation.test" }))
              ?.role || null,
        },
      ],
      governanceVersion: (await Organization.findById(org._id)).governance
        .version,
    });
    assert.equal(deniedCreate.status, 403);
    assert.equal(deniedResend.status, 403);
    assert.equal(
      accepted.status,
      403,
      "A disabled direct Admin inviter must not authorize a pending account-role invitation.",
    );
  },
);
