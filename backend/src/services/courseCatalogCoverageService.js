'use strict';

const mongoose = require('mongoose');
const { digest, COURSE_PROVIDERS, canonicalCourseKey } = require('../utils/courseIdentity');
const taxonomy = require('./courseCatalogTaxonomy');
const shared = require('./sharedCourseCatalogService');
const seed = require('../data/courseAcquisitionCatalog');
const VERSION = 'course-provider-coverage-v1';
const MIN_RESULTS = 3;
const REVIEW_MS = 7 * 86_400_000;
const CHECK_MS = 15 * 60_000;
const db = () => mongoose.connection.db.collection('course_catalog_coverage');
let initializedDb;
let initialization;

async function initialize() {
  const current = mongoose.connection.db;
  if (!current) throw Error('Course coverage storage unavailable.');
  if (initializedDb !== current || !initialization) {
    initializedDb = current;
    initialization = Promise.all([
      db().createIndex(
        { technology: 1, provider: 1 },
        { unique: true, name: 'technology_provider', timeoutMS: 5000 },
      ),
      db().createIndex(
        { state: 1, nextRetryAt: 1 },
        { name: 'coverage_refresh_due', timeoutMS: 5000 },
      ),
    ]).catch((error) => {
      initialization = null;
      throw error;
    });
  }
  await initialization;
}

function capability(provider, topic) {
  if (provider === 'YouTube')
    return {
      mode: 'authorized-search',
      supported: true,
      authorized: Boolean(process.env.YOUTUBE_API_KEY),
      source: 'https://www.googleapis.com/youtube/v3',
    };
  if (provider === 'freeCodeCamp') {
    const supported = seed.fcc.some((course) => taxonomy.matches(course, topic));
    return {
      mode: supported ? 'official-manifest' : 'controlled-curation',
      supported,
      authorized: supported,
      source:
        'https://raw.githubusercontent.com/freeCodeCamp/freeCodeCamp/main/curriculum/structure/curriculum.json',
    };
  }
  return { mode: 'controlled-curation', supported: false, authorized: false, source: provider };
}

async function admitted(topic) {
  if (taxonomy.technologies.includes(topic) || shared.STACKS.includes(topic)) return true;
  return Boolean(
    await mongoose.connection.db
      .collection('course_catalog_discovery')
      .findOne(
        { _id: 'topics', 'topics.key': digest(topic).slice(0, 24) },
        { projection: { _id: 1 }, timeoutMS: 5000 },
      ),
  );
}

// Catalog observations are shared and provider-specific. They contain no user,
// evidence, query history, scores or progress. Unknown rows require existing bounded admission.
async function observe(
  topic,
  courses,
  { revision, freshness = {}, providers = COURSE_PROVIDERS, requestDiscovery, catalogReadAt } = {},
) {
  topic = taxonomy.canonical(topic);
  if (!topic || !(await admitted(topic))) return [];
  await initialize();
  providers = providers.filter((provider) => COURSE_PROVIDERS.includes(provider));
  const official = providers.includes('freeCodeCamp')
    ? await mongoose.connection.db.collection('shared_course_catalog').findOne(
        { _id: 'official:freecodecamp' },
        {
          projection: { lastCheckedAt: 1, nextRetryAt: 1, failureReason: 1, sourceVersion: 1 },
          timeoutMS: 5000,
        },
      )
    : null;
  const keys = providers.map((provider) => digest([topic, provider]));
  const previous = await db()
    .find({ _id: { $in: keys } }, { timeoutMS: 5000 })
    .toArray();
  const now = new Date();
  const states = [];
  const writes = [];
  for (const provider of providers) {
    const key = digest([topic, provider]);
    const old = previous.find((row) => row._id === key);
    const source = capability(provider, topic);
    if (
      old?.inventoryRevision === revision &&
      old.lastCatalogCheckAt > new Date(Date.now() - CHECK_MS) &&
      old.sourceCapability.authorized === source.authorized &&
      (provider !== 'freeCodeCamp' ||
        old.providerLastCheckAt?.getTime() === official?.lastCheckedAt?.getTime()) &&
      (old.freshness !== 'fresh' || old.freshUntil > now)
    ) {
      states.push(old);
      continue;
    }
    const matching = courses.filter(
      (course) => course.platform === provider && taxonomy.matches(course, topic),
    );
    const valid = new Map();
    for (const raw of matching) {
      const course = require('./courseService').normaliseCourse(raw);
      const identity = course && canonicalCourseKey(course);
      if (identity) valid.set(identity, course);
    }
    const verifiedDates = [...valid.values()].map((course) =>
      new Date(course.provenance.metadataVerifiedAt || 0).getTime(),
    );
    const unknownFreshness =
      !freshness[provider] &&
      (!verifiedDates.length || verifiedDates.some((at) => !Number.isFinite(at) || at <= 0));
    const freshUntil =
      freshness[provider] ||
      new Date(unknownFreshness ? 0 : Math.min(...verifiedDates) + REVIEW_MS);
    const stale = unknownFreshness || new Date(freshUntil) <= now;
    const sufficient = valid.size >= MIN_RESULTS;
    const due = !old?.nextRetryAt || old.nextRetryAt <= now;
    let state =
      sufficient && !stale
        ? 'healthy'
        : !source.supported
          ? 'curation-required'
          : !source.authorized
            ? 'authorization-required'
            : 'queued';
    if (state === 'queued' && old?.state === 'cooldown' && !due) state = 'cooldown';
    let reason =
      sufficient && !stale ? null : stale ? 'stale-coverage' : 'insufficient-relevant-results';
    if (state === 'curation-required') reason = 'no-authorized-retrieval-source';
    if (state === 'authorization-required') reason = 'provider-not-configured';
    let capacityRetry = false;
    if (state === 'queued' && provider === 'YouTube' && due && requestDiscovery) {
      const admission = await requestDiscovery(topic);
      if (admission.status === 'capacity') {
        state = 'cooldown';
        reason = 'queue-capacity';
        capacityRetry = true;
      }
    }
    if (state === 'cooldown' && !capacityRetry) reason = old?.failureReason || reason;
    let sourceRetryAt;
    if (provider === 'freeCodeCamp' && source.supported && official?.lastCheckedAt) {
      if (official.failureReason && official.nextRetryAt > now) {
        state = 'cooldown';
        reason = official.failureReason;
        sourceRetryAt = official.nextRetryAt;
      } else if (!sufficient && !official.failureReason) {
        state = 'curation-required';
        reason = 'reviewed-manifest-scope-exhausted';
        sourceRetryAt = new Date(Date.now() + REVIEW_MS);
      }
    }
    const row = {
      _id: key,
      version: VERSION,
      technology: topic,
      provider,
      sourceCapability: source,
      state,
      freshness: unknownFreshness ? 'unknown' : stale ? 'stale' : 'fresh',
      freshUntil: new Date(freshUntil),
      quality: {
        basis: 'shared-catalog',
        relevantCount: valid.size,
        rejectedCount: matching.length - valid.size,
        minimum: MIN_RESULTS,
        sufficient,
      },
      lastCatalogCheckAt: now,
      inventoryRevision: revision || shared.VERSION,
      nextRetryAt:
        sourceRetryAt ||
        (capacityRetry
          ? new Date(Date.now() + 3600_000)
          : !due
            ? old.nextRetryAt
            : new Date(Date.now() + (source.supported ? CHECK_MS : REVIEW_MS))),
      failureReason: reason,
      ...(provider === 'freeCodeCamp' && official?.lastCheckedAt
        ? {
            providerLastCheckAt: official.lastCheckedAt,
            providerSourceVersion: official.sourceVersion || null,
          }
        : {}),
    };
    const { _id, ...fields } = row;
    writes.push({
      updateOne: {
        filter: { _id, technology: topic, provider },
        // A provider may finish between the snapshot read and this write. Preserve
        // its newer outcome atomically, including across separate API workers.
        update: catalogReadAt
          ? [
              {
                $replaceWith: {
                  $cond: [
                    { $gt: [{ $ifNull: ['$lastProviderCheckAt', new Date(0)] }, catalogReadAt] },
                    '$$ROOT',
                    { $mergeObjects: ['$$ROOT', { $literal: fields }] },
                  ],
                },
              },
            ]
          : { $set: fields },
        upsert: true,
      },
    });
    states.push(row);
  }
  if (writes.length) await db().bulkWrite(writes, { ordered: false, timeoutMS: 5000 });
  return states;
}

async function recordOutcome(provider, topic, result, error, { lease, session, retryAt } = {}) {
  topic = taxonomy.canonical(topic);
  if (!(await admitted(topic))) return;
  await initialize();
  const relevant = (result?.courses || []).filter((course) => taxonomy.matches(course, topic));
  const success = !error && result?.status === 'available' && !result.stale && relevant.length > 0;
  const failureReason = success
    ? null
    : !result && !error
      ? 'provider-refresh-in-progress'
      : result?.stale && !error
        ? 'stale-cached-results'
        : result?.status === 'empty' && !error
          ? 'empty-results'
          : error || (result?.status && result.status !== 'available')
            ? 'provider-unavailable'
            : result?.courses?.length
              ? 'irrelevant-results'
              : 'empty-results';
  const write = (session) =>
    db().updateOne(
      { _id: digest([topic, provider]) },
      {
        $set: {
          version: VERSION,
          technology: topic,
          provider,
          sourceCapability: capability(provider, topic),
          state: success ? (relevant.length >= MIN_RESULTS ? 'healthy' : 'cooldown') : 'cooldown',
          freshness: success ? 'fresh' : result?.courses?.length ? 'stale' : 'unknown',
          freshUntil: success
            ? result.freshUntil || new Date(Date.now() + 6 * 3600_000)
            : new Date(0),
          quality: {
            basis: 'latest-provider-check',
            relevantCount: relevant.length,
            rejectedCount: (result?.courses?.length || 0) - relevant.length,
            minimum: MIN_RESULTS,
            sufficient: relevant.length >= MIN_RESULTS,
          },
          lastProviderCheckAt: new Date(),
          nextRetryAt: retryAt || new Date(Date.now() + (success ? 6 * 3600_000 : 30 * 60_000)),
          failureReason,
        },
        $inc: { providerChecks: 1 },
      },
      { upsert: true, ...(session ? { session } : { timeoutMS: 5000 }) },
    );
  if (session) return write(session);
  if (!lease) return write();
  return require('./integrationMongoGovernanceService').transaction(async (session) => {
    if (
      !(await require('./courseGovernanceService').fencePoolLease(
        'catalog-gap-worker',
        lease.token,
        session,
      ))
    )
      return false;
    await write(session);
    return true;
  }, 5000);
}

async function inventory() {
  await shared.initialize();
  const rows = await mongoose.connection.db
    .collection('shared_course_catalog')
    .aggregate(require('./courseCatalogSearchService').pipeline(''), { maxTimeMS: 5000 })
    .toArray();
  if (rows.length > require('./courseCatalogSearchService').MAX_RESULTS)
    throw Error('Catalog bound exceeded.');
  return rows;
}
async function auditInventory({ requestDiscovery } = {}) {
  const courses = await inventory();
  const revision = await shared.revision();
  const freshness = {};
  for (const course of courses)
    if (course.catalogSourceFreshUntil)
      freshness[course.platform] = new Date(
        Math.min(
          freshness[course.platform]?.getTime() || Infinity,
          new Date(course.catalogSourceFreshUntil).getTime(),
        ),
      );
  for (const topic of taxonomy.technologies)
    await observe(topic, courses, { revision, freshness, requestDiscovery });
  return report();
}
async function report() {
  await initialize();
  const maximum =
    (taxonomy.technologies.length + shared.STACKS.length + 64) * COURSE_PROVIDERS.length;
  const states = await db()
    .find({}, { timeoutMS: 5000 })
    .sort({ technology: 1, provider: 1 })
    .limit(maximum + 1)
    .toArray();
  if (states.length > maximum) throw Error('Course coverage admission bound exceeded.');
  return {
    version: VERSION,
    technologies: taxonomy.technologies,
    aliases: Object.fromEntries(
      taxonomy.technologies.map((topic) => [topic, taxonomy.aliases(topic)]),
    ),
    states,
    maximum,
  };
}

module.exports = {
  initialize,
  observe,
  recordOutcome,
  auditInventory,
  inventory,
  report,
  capability,
  MIN_RESULTS,
  VERSION,
};
