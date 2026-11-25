const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const mongoose = require('mongoose');
const { startMongo } = require('../fixtures/disposableRequestMongo');
const settings = require('../../modules/super-admin/services/platformSettingsService');
const User = require('../../modules/auth/models/user');
const AuditLog = require('../../modules/admin/models/auditLog');
const { auditLogMiddleware } = require('../../core/middleware/auditLogMiddleware');
const { sign } = require('../../modules/auth/utils/authSessionToken');

test(
  'organization creation retains a scoped, redacted audit record for Mongoose responses',
  { timeout: 60000 },
  async (t) => {
    const mongo = await startMongo({
      replicaSet: 'tenant-audit',
      temporaryRoot: path.resolve(__dirname, '../../../verification')
    });
    let server;
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'disposable-tenant-audit-regression-secret';
    t.after(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
      settings.stopSettingsSynchronization();
      await mongoose.disconnect();
      await mongo.stop();
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    });
    await mongoose.connect(mongo.uri);
    await settings.startSettingsSynchronization();
    await settings.updateSettings({ organization: { allowOrgCreation: true } });
    await AuditLog.init();
    const user = await User.create({
      name: 'Tenant fixture',
      email: 'tenant@fixture.test',
      role: 'developer',
      providers: ['github']
    });
    const app = express();
    app.use(express.json());
    app.use(auditLogMiddleware);
    app.use('/api/tenant', require('../../modules/admin/routes/tenant.routes'));
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/tenant/organizations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sign(user)}`,
        'Content-Type': 'application/json',
        'User-Agent': 'TenantAuditRegression/1.0',
        'X-Forwarded-For': '192.0.2.10'
      },
      body: JSON.stringify({
        name: 'Audited Organization',
        organizationId: String(new mongoose.Types.ObjectId()),
        teamId: String(new mongoose.Types.ObjectId()),
        credentials: {
          password: 'fixture-sensitive',
          nested: [{ refreshToken: 'fixture-sensitive' }]
        }
      })
    });
    assert.equal(response.status, 201);
    const payload = await response.json();
    let records = [];
    for (let i = 0; i < 40 && !records.length; i++) {
      records = await AuditLog.find({ actor: user._id, route: '/api/tenant/organizations' }).lean();
      if (!records.length) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(records.length, 1, 'Successful organization creation must not lose its audit event');
    const record = records[0];
    assert.equal(String(record.organizationId), payload.organization._id);
    assert.equal(record.teamId, null);
    assert.equal(record.statusCode, 201);
    assert.equal(record.method, 'POST');
    assert.equal(record.action, 'POST /api/tenant/organizations');
    assert.equal(record.ipAddress, '192.0.2.10');
    assert.equal(record.userAgent, 'TenantAuditRegression/1.0');
    assert.deepEqual(record.after, payload, 'Audit uses public JSON values, not Mongoose internals');
    assert.equal(record.before.body.credentials, '***MASKED***');

    assert.equal(JSON.stringify(record).includes('fixture-sensitive'), false);
    const updated = await User.findById(user._id).lean();
    assert.equal(updated.role, 'admin');
    assert.equal(String(updated.organizationId), payload.organization._id);
  }
);
