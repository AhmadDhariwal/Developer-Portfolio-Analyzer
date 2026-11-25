const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const AuditLog = require('../../modules/admin/models/auditLog');
const { auditLogMiddleware } = require('../../core/middleware/auditLogMiddleware');

test('audit serialization redacts JSON values and safely records unserializable payloads', async (t) => {
  const records = [];
  t.mock.method(AuditLog, 'create', async (record) => {
    records.push(record);
  });
  const organizationId = new mongoose.Types.ObjectId();
  async function capture(payload) {
    let finish;
    const req = {
      method: 'POST',
      originalUrl: '/api/tenant/test',
      path: '/api/tenant/test',
      body: {},
      headers: {},
      organizationId,
      user: { _id: new mongoose.Types.ObjectId() }
    };
    const res = {
      statusCode: 200,
      json() {},
      on(_event, callback) {
        finish = callback;
      }
    };
    auditLogMiddleware(req, res, () => {});
    res.json(payload);
    await finish();
    return records.at(-1);
  }
  const at = new Date('2026-11-22T00:00:00Z');
  const record = await capture({
    id: organizationId,
    at,
    nested: [{ privateKey: 'fixture-sensitive', ordinary: 'kept' }]
  });
  assert.deepEqual(record.after, {
    id: String(organizationId),
    at: at.toISOString(),
    nested: [{ privateKey: '***MASKED***', ordinary: 'kept' }]
  });
  assert.equal(record.organizationId, String(organizationId));
  const circular = {};
  circular.self = circular;
  assert.deepEqual((await capture(circular)).after, { __nonSerializable: true });
  const truncated = (await capture({ password: 'fixture-sensitive', text: 'x'.repeat(6000) }))
    .after;
  assert.equal(truncated.__truncated, true);
  assert.equal(truncated.preview.includes('fixture-sensitive'), false);
  assert.ok(truncated.preview.includes('***MASKED***'));
});
