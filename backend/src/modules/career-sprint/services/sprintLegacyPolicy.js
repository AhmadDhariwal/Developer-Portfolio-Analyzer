'use strict';

const { POLICY } = require('../utils/sprintCalendar');
const EXCEPTION_POLICY = 'legacy-read-only-exception-v1';

// Unknown server calendars cannot safely support further day/streak mutations.
// This guard also applies before the deployment migration has been approved.
const access = (sprint) => {
  const unknown = !sprint.calendarPolicy && !sprint.migrationCalendarTimeZone;
  const readOnly = unknown || sprint.reservationPolicy === EXCEPTION_POLICY;
  return {
    readOnly,
    calendarStatus: unknown ? 'provenance-unresolved' : 'recorded',
    reason: readOnly ? sprint.legacyException?.reason || 'timezone-provenance-unresolved' : null,
    timeZone: sprint.calendarPolicy === POLICY ? sprint.timeZone : sprint.migrationCalendarTimeZone || null
  };
};

const assertWritable = (sprint) => {
  if (access(sprint).readOnly) {
    const error = new Error('This historical Sprint is read-only pending calendar provenance review.');
    error.statusCode = 409;
    throw error;
  }
};

module.exports = { EXCEPTION_POLICY, access, assertWritable };
