'use strict';

const { createHash } = require('node:crypto');
const aiService = require('./aiservice');
const { calendar } = require('../utils/sprintCalendar');
const legacyPolicy = require('./sprintLegacyPolicy');
const NAMESPACE = 'career_sprint:overview-v4';
const cache = new Map();
const pending = new Map();
const clone = (value) => JSON.parse(JSON.stringify(value));
const budget = async (work) => {
  let timer;
  try {
    return await Promise.race([
      work.catch(() => null),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), 120);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
};
const identity = (sprint, previous, now = new Date(), context = null) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        sprint,
        previous,
        context,
        day: legacyPolicy.access(sprint).calendarStatus === 'provenance-unresolved' ? null : calendar(sprint).key(now),
        overdue: (sprint.tasks || []).map(
          (task) =>
            !task.isCompleted &&
            Boolean(task.endDate || task.deadline || task.dueDate) &&
            new Date(task.endDate || task.deadline || task.dueDate) < now
        )
      })
    )
    .digest('hex');
const load = async (sprint, previous, build, counters, forceRefresh = false, context = null) => {
  // Caller MUST supply freshly read Mongo snapshots. No user-only or TTL-only hit.
  const revision = identity(sprint, previous, new Date(), context);
  const key = `${sprint.userId}:${revision}`;
  const valid = (entry) =>
    entry?.revision === revision &&
    String(entry.value?.userId) === String(sprint.userId) &&
    String(entry.value?._id) === String(sprint._id);
  if (!forceRefresh) {
    const entry = cache.get(key);
    if (entry?.expiresAt > Date.now() && valid(entry)) {
      counters.memoryHits++;
      return clone(entry.value);
    }
    const shared = await budget(aiService.getSharedCache(key, NAMESPACE));
    if (valid(shared)) {
      counters.redisHits++;
      remember(key, shared);
      return clone(shared.value);
    }
  }
  // In-flight work is shared only AFTER the database snapshots are known equal.
  if (pending.has(key)) return clone(await pending.get(key));
  const request = (async () => {
    counters.pipelineExecutions++;
    const value = await build();
    const entry = { revision, value: clone(value) };
    remember(key, entry);
    // Older writers can only populate their own immutable revision key.
    counters.redisWrites++;
    void aiService.setSharedCache(key, entry, 120, NAMESPACE).catch(() => {});
    return value;
  })();
  pending.set(key, request);
  try {
    return clone(await request);
  } finally {
    if (pending.get(key) === request) pending.delete(key);
  }
};
const remember = (key, entry) => {
  cache.delete(key);
  cache.set(key, { ...entry, expiresAt: Date.now() + 60000 });
  while (cache.size > 500) cache.delete(cache.keys().next().value);
};
const invalidate = (userId) => {
  for (const key of cache.keys()) if (key.startsWith(`${userId}:`)) cache.delete(key);
};
const clear = () => {
  cache.clear();
  pending.clear();
};
module.exports = { load, identity, invalidate, clear, NAMESPACE };
