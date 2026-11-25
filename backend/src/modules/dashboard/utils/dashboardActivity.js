// Read existing saved month buckets without inventing dates or treating missing counts as zero.
const normalizeDashboardActivity = (value) =>
  (Array.isArray(value) ? value : [])
    .filter(
      (item) =>
        typeof item?.month === 'string' &&
        /^\d{4}-(0[1-9]|1[0-2])$/.test(item.month.trim()) &&
        typeof item.count === 'number' &&
        Number.isSafeInteger(item.count) &&
        item.count >= 0,
    )
    .map(({ month, count }) => ({ month: month.trim(), count }));

module.exports = { normalizeDashboardActivity };
