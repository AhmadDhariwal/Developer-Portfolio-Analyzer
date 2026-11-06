'use strict';

const mongoose = require('mongoose');
const { digest, canonicalCourseKey } = require('../utils/courseIdentity');
const shared = require('./sharedCourseCatalogService');
const taxonomy = require('./courseCatalogTaxonomy');
const { acquirePoolLease, releasePoolLease } = require('./courseGovernanceService');

const MAX_GAPS = 64;
const KNOWN_TOPICS = [...new Set([...taxonomy.technologies, ...shared.STACKS])];
const MAX_QUEUE_TOPICS = KNOWN_TOPICS.length + MAX_GAPS;
const MAX_COVERAGE_DOCUMENTS = MAX_QUEUE_TOPICS + 2; // curated inventory + official manifest
const MAX_RESULTS = 200 + (MAX_COVERAGE_DOCUMENTS - 1) * 40;
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
const canonicalQuery = taxonomy.canonical;
const escaped = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const aliases = taxonomy.aliases;
const pattern = (term) => new RegExp(`(?:^|[^a-z0-9_+#])${escaped(term)}(?:[^a-z0-9_+#]|$)`, 'i');
const queryTerms = (topic) =>
  taxonomy.technologies.includes(topic)
    ? aliases(topic)
    : topic.split(/\s+/).filter(Boolean).slice(0, 8);
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
      $lookup: {
        from: 'shared_course_catalog',
        pipeline: [{ $match: { _id: 'curated' } }, { $project: { audits: 1 } }],
        as: 'catalogAudit',
      },
    },
    {
      $project: {
        courses: 1,
        catalogFreshUntil: '$freshUntil',
        catalogStaleUntil: '$staleUntil',
        archived: {
          $map: {
            input: {
              $filter: {
                input: {
                  $objectToArray: {
                    $mergeObjects: [
                      { $ifNull: ['$audits', {}] },
                      { $ifNull: [{ $arrayElemAt: ['$catalogAudit.audits', 0] }, {}] },
                    ],
                  },
                },
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
              catalogSourceFreshUntil: {
                $ifNull: ['$courses.catalogMetadataFreshUntil', '$catalogFreshUntil'],
              },
              catalogSourceStaleUntil: '$catalogStaleUntil',
            },
          ],
        },
      },
    },
    { $limit: MAX_RESULTS + 1 },
  ];
}

async function recordGap(topic, { retrievalAllowed = true } = {}) {
  topic = canonicalQuery(topic);
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
    {
      _id: 'topics',
      'topics.key': { $ne: key },
      $expr: {
        $and: [
          { $lt: [{ $size: '$topics' }, MAX_QUEUE_TOPICS] },
          KNOWN_TOPICS.includes(topic)
            ? true
            : {
                $lt: [
                  {
                    $size: {
                      $filter: {
                        input: '$topics',
                        as: 'entry',
                        cond: { $not: [{ $in: ['$$entry.topic', KNOWN_TOPICS] }] },
                      },
                    },
                  },
                  MAX_GAPS,
                ],
              },
        ],
      },
    },
    {
      $push: {
        topics: {
          key,
          topic,
          state: retrievalAllowed ? 'queued' : 'curation-required',
          nextAttemptAt: now,
          firstSeenAt: now,
          attempts: 0,
        },
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
  if (retrievalAllowed && entry.state === 'curation-required') {
    await queue().updateOne(
      { _id: 'topics', topics: { $elemMatch: { key, state: 'curation-required' } } },
      { $set: { 'topics.$.state': 'queued', 'topics.$.nextAttemptAt': now } },
      { timeoutMS: 5000 },
    );
    return { status: 'queued', topic };
  }
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
  return {
    status: admitted.modifiedCount
      ? retrievalAllowed
        ? 'queued'
        : 'curation-required'
      : entry.state,
    topic,
  };
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
    const freshness = {};
    for (const raw of rows) {
      const course = service.normaliseCourse(raw);
      if (!course || (topic && !matchScore(course, topic))) continue;
      if (raw.catalogSourceStaleUntil)
        sourceDeadline = Math.min(sourceDeadline, new Date(raw.catalogSourceStaleUntil).getTime());
      if (raw.catalogSourceFreshUntil && raw.catalogSourceFreshUntil <= new Date()) stale = true;
      if (raw.catalogSourceFreshUntil)
        freshness[course.platform] = new Date(
          Math.min(
            freshness[course.platform]?.getTime() || Infinity,
            raw.catalogSourceFreshUntil.getTime(),
          ),
        );
      const identity = canonicalCourseKey(course);
      if (
        !unique.has(identity) ||
        course.id.localeCompare(unique.get(identity).id) < 0 ||
        (course.id === unique.get(identity).id &&
          new Date(course.provenance.metadataVerifiedAt || 0) >
            new Date(unique.get(identity).provenance.metadataVerifiedAt || 0))
      )
        unique.set(identity, course);
    }
    const matching = [...unique.values()];
    if (
      !topic &&
      ['All', 'YouTube'].includes(filters.platform) &&
      !matching.some((course) => course.platform === 'YouTube')
    ) {
      await recordGap('Full Stack', { retrievalAllowed: Boolean(process.env.YOUTUBE_API_KEY) });
    }
    const providers =
      filters.platform === 'All'
        ? undefined
        : filters.platform === 'Other'
          ? ['edX', 'freeCodeCamp']
          : [filters.platform];
    const selected = matching.filter((course) => !providers || providers.includes(course.platform));
    const coverage =
      topic && !selected.length
        ? await recordGap(topic, {
            retrievalAllowed:
              ['All', 'YouTube'].includes(filters.platform) && Boolean(process.env.YOUTUBE_API_KEY),
          })
        : null;
    if (topic)
      await require('./courseCatalogCoverageService').observe(topic, matching, {
        revision,
        freshness,
        providers,
        requestDiscovery: recordGap,
      });
    const courses = service.applyCourseFilters(matching, { ...filters, topic: '' });
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
          ? ['capacity', 'unsupported', 'curation-required'].includes(coverage.status)
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
    const entry = row?.topics
      ?.filter(
        (item) =>
          item.nextAttemptAt <= new Date() &&
          ['queued', 'running', 'cooldown'].includes(item.state),
      )
      .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt || a.firstSeenAt - b.firstSeenAt)[0];
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
    await require('./courseCatalogCoverageService').initialize();
    let state = 'cooldown';
    let until = 15 * 60_000;
    let providerResult;
    let providerError;
    try {
      const result = await shared.getYouTube({
        topic: entry.topic,
        admittedTopic: true,
        background: true,
        fingerprint: require('./courseService').providerConfigurationFingerprint(),
        fetchProvider,
      });
      providerResult = result;
      if (
        result?.status === 'available' &&
        !result.stale &&
        result.courses.some((course) => matchScore(course, entry.topic))
      ) {
        state = 'covered';
        until = 6 * 60 * 60_000;
      } else until = Math.min(6 * 60 * 60_000, 10 * 60_000 * 2 ** Math.min(entry.attempts, 5));
    } catch (error) {
      providerError = error;
      throw error;
    } finally {
      const retryAt = new Date(Date.now() + until);
      await require('./integrationMongoGovernanceService').transaction(async (session) => {
        if (
          !(await require('./courseGovernanceService').fencePoolLease(
            'catalog-gap-worker',
            lease.token,
            session,
          ))
        )
          return;
        await require('./courseCatalogCoverageService').recordOutcome(
          'YouTube',
          entry.topic,
          providerResult,
          providerError,
          { session, retryAt },
        );
        await queue().updateOne(
          { _id: 'topics', topics: { $elemMatch: { key: entry.key, workerToken: lease.token } } },
          {
            $set: {
              'topics.$.state': state,
              'topics.$.nextAttemptAt': retryAt,
            },
          },
          { session },
        );
      }, 5000);
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
  KNOWN_TOPICS,
  MAX_QUEUE_TOPICS,
  MAX_COVERAGE_DOCUMENTS,
  MAX_RESULTS,
  clearMemory: () => {
    cache.clear();
    cachedBytes = 0;
  },
  metrics: () => ({ entries: cache.size, bytes: cachedBytes, pending: pending.size }),
};
