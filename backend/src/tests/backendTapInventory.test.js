const test = require('node:test');
const assert = require('node:assert/strict');
const { inventory } = require('../scripts/reconcileBackendTap.cjs');

test('TAP inventory preserves nested diagnostics and distinguishes cancellation from parent summaries', () => {
  const tap = `TAP version 13
# Subtest: parent
    # Subtest: assertion child
    not ok 1 - assertion child
      ---
      failureType: 'testCodeFailure'
      error: |-
        Expected equality
        1 !== 2
      stack: |-
        first frame
        second frame
      ...
    # Subtest: cancelled child
    not ok 2 - cancelled child
      ---
      failureType: 'cancelledByParent'
      error: 'Parent ended'
      ...
not ok 1 - parent
  ---
  failureType: 'subtestsFailed'
  error: '2 subtests failed'
  ...
# tests 3
# pass 0
# fail 2
# cancelled 1
# skipped 0
`;
  const result = inventory(tap);
  assert.deepEqual(
    result.records.map((record) => record.kind),
    ['failure', 'cancellation', 'parent-summary']
  );
  assert.deepEqual(result.records[0].parents, ['parent']);
  assert.equal(result.records[0].error, 'Expected equality\n1 !== 2');
  assert.equal(result.records[0].stack, 'first frame\nsecond frame');
  assert.match(result.records[0].rawDiagnostics, /failureType: 'testCodeFailure'/);
  assert.equal(result.counts.cancelled, 1);
});

test('TAP inventory retains explicit and bare skips as blocked and excludes passing tests', () => {
  const result = inventory(`TAP version 13
# Subtest: passed
ok 1 - passed
# Subtest: offline
ok 2 - offline # SKIP isolated Redis required
  ---
  duration_ms: 0
  ...
# Subtest: opted out
ok 3 - opted out # SKIP
`);
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].status, 'BLOCKED');
  assert.equal(result.records[0].skipReason, 'isolated Redis required');
  assert.equal(result.records[1].skipReason, null);
});
