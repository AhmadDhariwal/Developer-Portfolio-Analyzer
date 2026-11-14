const { Temporal } = require('@js-temporal/polyfill');

const zone = () => process.env.WEEKLY_REPORT_TIMEZONE || Temporal.Now.timeZoneId();
const startOfWeek = (date = new Date()) => {
  const local = Temporal.Instant.fromEpochMilliseconds(date.getTime()).toZonedDateTimeISO(zone());
  return new Date(local.subtract({ days: local.dayOfWeek - 1 }).startOfDay().epochMilliseconds);
};
const endOfWeek = (start) =>
  new Date(
    Temporal.Instant.fromEpochMilliseconds(start.getTime())
      .toZonedDateTimeISO(zone())
      .add({ days: 7 })
      .startOfDay().epochMilliseconds - 1,
  );
const previousWeekRange = (start) => {
  const previous = new Date(
    Temporal.Instant.fromEpochMilliseconds(start.getTime())
      .toZonedDateTimeISO(zone())
      .subtract({ days: 7 }).epochMilliseconds,
  );
  return { start: previous, end: endOfWeek(previous) };
};
module.exports = { startOfWeek, endOfWeek, previousWeekRange };
