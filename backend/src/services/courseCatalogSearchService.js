'use strict';

const mongoose = require('mongoose');
const { skills, skillAliases, digest, canonicalCourseKey } = require('../utils/courseIdentity');
const shared = require('./sharedCourseCatalogService');
const { acquirePoolLease, releasePoolLease } = require('./courseGovernanceService');

const MAX_GAPS = 64;
const MAX_RESULTS = 200 + (shared.TOPICS.length + shared.STACKS.length + MAX_GAPS) * 40;
const CACHE_BYTES = 16 * 1024 * 1024;
const cache = new Map();
const pending = new Map();
let cachedBytes = 0;
let reviewedInventory;
const collection = () => mongoose.connection.db.collection('shared_course_catalog');
const queue = () => mongoose.connection.db.collection('course_catalog_discovery');
const busy = () => Object.assign(Error('Course catalog temporarily unavailable.'), { status: 503 });
const immutable = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
};
const canonicalQuery = (value) => {
  const normalized = String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 60);
  const canonical = skills([normalized], 1)[0] || '';
  return (
    [...shared.TOPICS, ...shared.STACKS].find(
      (topic) => topic.toLowerCase() === canonical.toLowerCase(),
    ) || canonical.toLowerCase()
  );
};
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const aliases = (topic) => [...new Set(skillAliases(topic))].slice(0, 12);
const pattern = (term) => new RegExp(`(?:^|[^a-z0-9_+#])${escaped(term)}(?:[^a-z0-9_+#]|$)`, 'i');
const queryTerms = (topic) =>
  shared.TOPICS.includes(topic) ? aliases(topic) : topic.split(/\s+/).filter(Boolean).slice(0, 8);
const matchScore = (course, topic) => {
  if (!topic) return 0;
  return queryTerms(topic).reduce((score, term) => {
    const re = pattern(term);
    return (
      score +
      (re.test(course.title) ? 6 : 0) +
      (re.test((course.topics || []).join(' ')) ? 4 : 0) +
      (re.test(course.description || '') ? 1 : 0)
    );
  }, 0);
};

async function ensureInventory() {
  if (!reviewedInventory)
    reviewedInventory = {
      courses: require('./courseService').buildFallbackPool('All', 200),
      version: digest([
        ...require('../data/courseCatalog'),
        ...require('../data/openLearningCatalog'),
      ]),
    };
  return shared.getCurated(reviewedInventory.courses, reviewedInventory.version, {
    returnCourses: false,
  });
}

function pipeline(topic, platform = 'All') {
  const match = {
    $or: [{ _id: 'curated' }, { version: shared.VERSION, staleUntil: { $gt: new Date() } }],
  };
  if (topic)
    match.$text = {
      $search: queryTerms(topic)
        .map((term) => term.replace(/["\\]/g, ' '))
        .join(' '),
    };
  if (platform !== 'All' && platform !== 'Other') match['courses.platform'] = platform;
  return [
    { $match: match },
    {
      $project: {
        courses: 1,
        catalogFreshUntil: '$freshUntil',
        catalogStaleUntil: '$staleUntil',
        archived: {
          $map: {
            input: {
              $filter: {
                input: { $objectToArray: { $ifNull: ['$audits', {}] } },
                as: 'audit',
                cond: { $eq: ['$$audit.v.archived', true] },
              },
            },
            as: 'audit',
            in: '$$audit.k',
          },
        },
      },
    },
    { $unwind: '$courses' },
    { $match: { $expr: { $not: [{ $in: ['$courses.id', '$archived'] }] } } },
    {
      $replaceRoot: {
        newRoot: {
          $mergeObjects: [
            '$courses',
            {
              catalogSourceFreshUntil: '$catalogFreshUntil',
              catalogSourceStaleUntil: '$catalogStaleUntil',
            },
          ],
        },
      },
    },
    { $limit: MAX_RESULTS + 1 },
  ];
}

async function recordGap(topic) {
  if (!topic || !/^[\p{L}\p{N}+#. /-]{2,60}$/u.test(topic)) return { status: 'unsupported' };
  const key = digest(topic).slice(0, 24);
  await queue()
    .updateOne(
      { _id: 'topics' },
      { $setOnInsert: { topics: [] } },
      { upsert: true, timeoutMS: 5000 },
    )
    .catch((error) => {
      if (error.code !== 11000) throw error;
    });
  const now = new Date();
  const admitted = await queue().updateOne(
    { _id: 'topics', 'topics.key': { $ne: key }, $expr: { $lt: [{ $size: '$topics' }, MAX_GAPS] } },
    {
      $push: {
        topics: { key, topic, state: 'queued', nextAttemptAt: now, firstSeenAt: now, attempts: 0 },
      },
    },
    { timeoutMS: 5000 },
  );
  const row = await queue().findOne(
    { _id: 'topics', 'topics.key': key },
    { projection: { 'topics.$': 1 }, timeoutMS: 5000 },
  );
  const entry = row?.topics?.[0];
  if (!entry) return { status: 'capacity', retryAfterSeconds: 3600 };
  if (['covered', 'cooldown'].includes(entry.state) && entry.nextAttemptAt <= now) {
    await queue().updateOne(
      {
        _id: 'topics',
        topics: {
          $elemMatch: {
            key,
            nextAttemptAt: { $lte: now },
            state: { $in: ['covered', 'cooldown'] },
          },
        },
      },
      { $set: { 'topics.$.state': 'queued' } },
      { timeoutMS: 5000 },
    );
  }
  return { status: admitted.modifiedCount ? 'queued' : entry.state, topic };
}

async function load(filters) {
  await ensureInventory();
  const revision = await shared.revision();
  const topic = canonicalQuery(filters.topic);
  const key = digest({
    revision,
    topic,
    platform: filters.platform,
    rating: filters.rating,
    level: filters.level,
    duration: filters.duration,
  });
  const old = cache.get(key);
  if (old?.until > Date.now()) return { ...old.value, fromCache: true };
  if (pending.has(key)) return pending.get(key);
  if (pending.size >= 8) throw busy();
  const work = (async () => {
    // The text index chooses coverage documents; per-course matching then prevents
    // unrelated siblings in the same coverage document from becoming false matches.
    const rows = await collection().aggregate(pipeline(topic), { maxTimeMS: 5000 }).toArray();
    if (rows.length > MAX_RESULTS) throw busy();
    const service = require('./courseService');
    const unique = new Map();
    let sourceDeadline = Infinity;
    let stale = false;
    for (const raw of rows) {
      const course = service.normaliseCourse(raw);
      if (!course || (topic && !matchScore(course, topic))) continue;
      if (raw.catalogSourceStaleUntil)
        sourceDeadline = Math.min(sourceDeadline, new Date(raw.catalogSourceStaleUntil).getTime());
      if (raw.catalogSourceFreshUntil && raw.catalogSourceFreshUntil <= new Date()) stale = true;
      const identity = canonicalCourseKey(course);
      if (!unique.has(identity) || course.id.localeCompare(unique.get(identity).id) < 0)
        unique.set(identity, course);
    }
    const matching = [...unique.values()];
    if (
      !topic &&
      ['All', 'YouTube'].includes(filters.platform) &&
      !matching.some((course) => course.platform === 'YouTube')
    ) {
      await recordGap('Full Stack');
    }
    const coverage = topic && !matching.length ? await recordGap(topic) : null;
    const courses = service.applyCourseFilters(matching, { ...filters, topic: '' });
    if (topic && stale && matching.length) await recordGap(topic);
    courses.sort(
      (a, b) => matchScore(b, topic) - matchScore(a, topic) || a.id.localeCompare(b.id, 'en'),
    );
    // Diversity breaks only exact search-relevance ties and is global across pages.
    for (let i = 1; i < courses.length; i++) {
      if (courses[i].platform !== courses[i - 1].platform) continue;
      const score = matchScore(courses[i], topic);
      const next = courses.findIndex(
        (course, index) =>
          index > i &&
          matchScore(course, topic) === score &&
          course.platform !== courses[i - 1].platform,
      );
      if (next > i) courses.splice(i, 0, courses.splice(next, 1)[0]);
    }
    const value = {
      courses,
      coverage,
      revision,
      fromCache: false,
      sourceMetadata: {
        source: courses.some((course) => course.platform === 'YouTube') ? 'mixed' : 'curated',
        youtubeStatus: courses.some((course) => course.platform === 'YouTube')
          ? 'cached'
          : 'not-requested',
        fallbackUsed: false,
        sourceMessage: coverage
          ? ['capacity', 'unsupported'].includes(coverage.status)
            ? 'No verified course matches yet. Try a broader topic or check again later.'
            : 'No verified course matches yet. Shared catalog discovery has been requested.'
          : '',
        catalogStale: stale,
        catalogStaleUntil: Number.isFinite(sourceDeadline)
          ? new Date(sourceDeadline).toISOString()
          : null,
      },
    };
    immutable(value);
    const bytes = Buffer.byteLength(JSON.stringify(value));
    if (old) {
      cachedBytes -= old.bytes;
      cache.delete(key);
    }
    if (bytes <= CACHE_BYTES) {
      cache.set(key, { value, bytes, until: Math.min(Date.now() + 30_000, sourceDeadline) });
      cachedBytes += bytes;
    }
    while (cache.size > 32 || cachedBytes > CACHE_BYTES) {
      const first = cache.keys().next().value;
      cachedBytes -= cache.get(first).bytes;
      cache.delete(first);
    }
    return value;
  })().finally(() => pending.delete(key));
  pending.set(key, work);
  return work;
}

async function processDiscoveryQueue({
  fetchProvider = require('./courseService').fetchYouTubeCourses,
} = {}) {
  if (mongoose.connection.readyState !== 1 || !process.env.YOUTUBE_API_KEY) return;
  const lease = await acquirePoolLease('catalog-gap-worker', 60_000);
  if (!lease.acquired) return;
  try {
    const row = await queue().findOne({ _id: 'topics' }, { timeoutMS: 5000 });
    const entry = row?.topics?.find(
      (item) =>
        item.nextAttemptAt <= new Date() && ['queued', 'running', 'cooldown'].includes(item.state),
    );
    if (!entry) return;
    const claimed = await queue().updateOne(
      {
        _id: 'topics',
        topics: {
          $elemMatch: { key: entry.key, state: entry.state, nextAttemptAt: entry.nextAttemptAt },
        },
      },
      {
        $set: {
          'topics.$.state': 'running',
          'topics.$.nextAttemptAt': new Date(Date.now() + 60_000),
          'topics.$.workerToken': lease.token,
        },
        $inc: { 'topics.$.attempts': 1 },
      },
      { timeoutMS: 5000 },
    );
    // A paused lease holder must not overwrite a successor's newer queue state.
    if (!claimed.modifiedCount) return;
    let state = 'cooldown';
    let until = 15 * 60_000;
    try {
      const result = await shared.getYouTube({
        topic: entry.topic,
        admittedTopic: true,
        background: true,
        fingerprint: require('./courseService').providerConfigurationFingerprint(),
        fetchProvider,
      });
      if (result?.courses.some((course) => matchScore(course, entry.topic))) {
        state = 'covered';
        until = 6 * 60 * 60_000;
      } else until = Math.min(6 * 60 * 60_000, 10 * 60_000 * 2 ** Math.min(entry.attempts, 5));
    } finally {
      await queue().updateOne(
        { _id: 'topics', topics: { $elemMatch: { key: entry.key, workerToken: lease.token } } },
        {
          $set: {
            'topics.$.state': state,
            'topics.$.nextAttemptAt': new Date(Date.now() + until),
          },
        },
        { timeoutMS: 5000 },
      );
      shared.clearMemory();
      cache.clear();
      cachedBytes = 0;
    }
  } finally {
    await releasePoolLease('catalog-gap-worker', lease.token);
  }
}

module.exports = {
  load: async (filters) => {
    try {
      return await load(filters);
    } catch {
      throw busy();
    }
  },
  recordGap,
  processDiscoveryQueue,
  canonicalQuery,
  pipeline,
  MAX_GAPS,
  MAX_RESULTS,
  clearMemory: () => {
    cache.clear();
    cachedBytes = 0;
  },
  metrics: () => ({ entries: cache.size, bytes: cachedBytes, pending: pending.size }),
};
