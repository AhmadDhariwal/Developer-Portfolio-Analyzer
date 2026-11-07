'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { preflight } = require('../services/sprintReservationMigrationService');
const { access, assertWritable, EXCEPTION_POLICY } = require('../services/sprintLegacyPolicy');
const { POLICY } = require('../utils/sprintCalendar');

const records = ['a', 'b'].map((_id) => ({
  _id,
  userId: 'owner',
  weekStartDate: new Date('2026-07-05T19:00Z'),
  weekEndDate: new Date('2026-07-12T18:59:59.999Z'),
  tasks: [{ title: 'History' }],
  xpPoints: 12
}));
const exceptions = () =>
  Object.fromEntries(
    records.map((record) => [
      record._id,
      {
        owner: 'owner',
        start: record.weekStartDate.toISOString(),
        end: record.weekEndDate.toISOString(),
        reason: 'timezone-provenance-unresolved',
        evidence: 'Fixture has no deployment provenance.'
      }
    ])
  );

test('grandfathering is bound to each original owner/window and cannot silently pin UTC', () => {
  const original = JSON.stringify(records);
  const legacyExceptions = exceptions();
  const result = preflight(records, { legacyExceptions });
  assert.equal(result.safe, true);
  assert.equal(result.conflicts[0].grandfathered, true);
  assert.ok(result.proposals.every((proposal) => !proposal.occupiedDays && !proposal.timeZone));
  assert.equal(preflight(records, { legacyExceptions: { a: legacyExceptions.a } }).safe, false);
  for (const field of ['owner', 'start', 'end', 'reason', 'evidence']) {
    const invalid = exceptions();
    invalid.a[field] = '';
    assert.equal(preflight(records, { legacyExceptions: invalid }).safe, false);
  }
  assert.equal(
    preflight([{ ...records[0], calendarPolicy: POLICY, timeZone: 'UTC' }], { legacyExceptions }).safe,
    false
  );
  assert.equal(preflight([{ ...records[0], occupiedDays: ['existing'] }], { legacyExceptions }).safe, false);
  assert.equal(preflight([{ ...records[0], weekEndDate: new Date('invalid') }], { legacyExceptions }).safe, false);
  assert.equal(JSON.stringify(records), original);
});

test('unknown legacy records are read-only before migration and new policy remains writable', () => {
  assert.equal(access(records[0]).timeZone, null);
  assert.throws(() => assertWritable(records[0]), { statusCode: 409 });
  assert.doesNotThrow(() => assertWritable({ calendarPolicy: POLICY, timeZone: 'UTC' }));
  assert.throws(
    () => assertWritable({ migrationCalendarTimeZone: 'Asia/Karachi', reservationPolicy: EXCEPTION_POLICY }),
    { statusCode: 409 }
  );
});
