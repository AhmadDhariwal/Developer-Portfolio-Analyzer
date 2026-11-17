import {
  calendarKey,
  formatSprintDate,
  nextSprintWindow,
  restoreEligible,
  sprintError,
  sprintReadOnly,
  sprintZone,
  sprintWindowConflict,
} from './sprint-presentation';
import { legacyFixture, sprintFixture } from '../testing/sprint.fixture';

describe('Sprint calendar and preservation contracts', () => {
  it('uses IANA calendar dates across local midnight and DST without browser-zone assumptions', () => {
    expect(calendarKey('2026-10-15T19:00:00Z', 'Asia/Karachi')).toBe('2026-10-16');
    expect(calendarKey('2026-03-08T06:59:00Z', 'America/New_York')).toBe('2026-03-08');
    expect(calendarKey('2026-03-08T07:01:00Z', 'America/New_York')).toBe('2026-03-08');
    expect(calendarKey('2026-11-01T05:30:00Z', 'America/New_York')).toBe('2026-11-01');
    expect(calendarKey('2026-10-16', 'Asia/Karachi')).toBe('2026-10-16');
    expect(calendarKey('invalid', 'UTC')).toBe('');
  });
  it('preserves exact legacy instants and never invents a calendar timezone', () => {
    const sprint = legacyFixture();
    expect(sprintZone(sprint)).toBeNull();
    expect(sprintReadOnly(sprint)).toBe(true);
    expect(calendarKey(sprint.weekStartDate, sprintZone(sprint))).toBe('');
    expect(formatSprintDate(sprint.weekStartDate, sprint)).toBe('2026-10-11 19:00:00.000 UTC');
    expect(formatSprintDate(null, sprint)).toBe('Not scheduled');
    expect(sprintReadOnly({ ...sprint, legacyAccess: undefined })).toBe(true);
  });
  it('closes restoration at exact expiry and obeys server eligibility and read-only access', () => {
    const expiry = '2026-03-10T05:00:00Z';
    const sprint = sprintFixture({
      restoreMeta: {
        policy: 'sprint-calendar-48h-v1',
        canRestore: true,
        breakAt: '2026-03-08T05:00:00Z',
        expiresAt: expiry,
      },
    });
    expect(restoreEligible(sprint, +new Date(expiry) - 1)).toBe(true);
    expect(restoreEligible(sprint, +new Date(expiry))).toBe(false);
    expect(
      restoreEligible({ ...sprint, restoreMeta: { ...sprint.restoreMeta!, canRestore: false } }, 0),
    ).toBe(false);
    expect(restoreEligible({ ...legacyFixture(), restoreMeta: sprint.restoreMeta }, 0)).toBe(false);
  });
  it('explains 409 conflicts and network failures without discarding saved data', () => {
    expect(sprintError({ status: 409, error: { message: 'Window overlaps.' } }, 'Failed')).toMatch(
      /Window overlaps.*preserved.*Choose dates/,
    );
    expect(sprintError({ status: 0 }, 'Failed')).toMatch(/Reconnect and retry/);
  });
  it('finds available whole-day windows across DST and preserves unresolved legacy instants', () => {
    const record = {
      ...legacyFixture(),
      weekStartDate: '2026-03-06T05:00:00Z',
      weekEndDate: '2026-03-09T03:59:59.999Z',
    };
    const original = structuredClone(record);
    expect(sprintWindowConflict([record], '2026-03-08', '2026-03-14', 'America/New_York')).toBe(
      record,
    );
    expect(
      nextSprintWindow([record], 'America/New_York', +new Date('2026-03-08T12:00:00Z')),
    ).toEqual({ start: '2026-03-09', end: '2026-03-15' });
    expect(
      sprintWindowConflict([record], '2026-03-09', '2026-03-15', 'America/New_York'),
    ).toBeUndefined();
    expect(record).toEqual(original);
    expect(nextSprintWindow([], '', Date.now())).toBeNull();
  });
});
