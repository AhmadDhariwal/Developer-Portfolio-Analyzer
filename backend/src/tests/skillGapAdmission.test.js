'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const controls = require('../services/skillGapGovernanceService');
const { admit, DEADLINE_MS } = require('../middleware/skillGapAdmission');
function response() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.set = () => res;
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}
test('mandatory admission outage returns sanitized 503 with Retry-After', async (t) => {
  const original = controls.consume;
  controls.consume = async () => {
    throw Error('synthetic private driver detail');
  };
  t.after(() => {
    controls.consume = original;
  });
  const res = response();
  let called = false;
  await admit({ body: { isTemporary: true, username: 'fixture' }, ip: 'synthetic-ip' }, res, () => {
    called = true;
  });
  assert.equal(called, false);
  assert.equal(res.statusCode, 503);
  assert.doesNotMatch(res.body.message, /private|driver/);
});
test('request deadline and disconnected clients cancel the same fenced work signal', async (t) => {
  const original = controls.consume;
  controls.consume = async () => {};
  t.after(() => {
    controls.consume = original;
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const req = { body: { isTemporary: true, username: 'fixture' }, ip: 'synthetic-ip' };
  const res = response();
  await admit(req, res, () => {});
  t.mock.timers.tick(DEADLINE_MS);
  assert.equal(req.skillGapGovernance.signal.aborted, true);
  assert.equal(res.statusCode, 503);
  const other = { body: { isTemporary: true, username: 'fixture' }, ip: 'synthetic-ip' };
  const closed = response();
  await admit(other, closed, () => {});
  closed.emit('close');
  assert.equal(other.skillGapGovernance.signal.aborted, true);
});
