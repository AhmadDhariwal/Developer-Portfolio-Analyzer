const bucketByDay = (items = [], dateSelector) => {
  const map = new Map();
  items.forEach((item) => {
    const date = new Date(dateSelector(item));
    if (Number.isNaN(date.getTime())) return;
    const key = date.toISOString().slice(0, 10);
    map.set(key, (map.get(key) || 0) + 1);
  });

  return Array.from(map.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([date, count]) => ({ date, count }));
};

const topCounts = (items = [], selector, limit = 6) => {
  const map = new Map();
  items.forEach((item) => {
    const value = String(selector(item) || '').trim();
    if (!value) return;
    map.set(value, (map.get(value) || 0) + 1);
  });

  return Array.from(map.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
};

module.exports = {
  bucketByDay,
  topCounts
};
