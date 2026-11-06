'use strict';

const mongoose = require('mongoose');
const { digest, COURSE_PROVIDERS } = require('../utils/courseIdentity');
const coverage = require('./courseCatalogCoverageService');
const workersEnabled = () =>
  process.env.COURSES_MAINTENANCE_ENABLED !== 'false' &&
  process.env.COURSES_GAP_DISCOVERY_ENABLED !== 'false';

// Capabilities describe verified adapter output, never inferred course attributes.
function filterCapability(filters) {
  if (filters.rating || (filters.level && filters.level !== 'All')) return false;
  return true; // YouTube can retrieve verified durations, but no reviews or difficulty.
}

async function describeUncached({
  topic,
  matching,
  courses,
  freshness,
  revision,
  filters,
  requestDiscovery,
  catalogReadAt,
}) {
  const providers =
    filters.platform === 'All'
      ? COURSE_PROVIDERS
      : filters.platform === 'Other'
        ? ['edX', 'freeCodeCamp']
        : [filters.platform];
  const selected = matching.filter((course) => providers.includes(course.platform));
  const insufficient = courses.length < coverage.MIN_RESULTS;
  const metadataMissing = selected.some(
    (course) =>
      (filters.rating && course.rating == null) ||
      (filters.level !== 'All' && !course.level) ||
      (filters.duration !== 'All' && course.durationHours == null),
  );
  const metadataFilters = Boolean(
    filters.rating || filters.level !== 'All' || filters.duration !== 'All',
  );
  const shortageReason =
    !selected.length || (!metadataFilters && insufficient)
      ? 'missing-courses'
      : metadataMissing
        ? 'missing-verified-metadata'
        : 'filter-mismatch';
  const query = topic || 'Full Stack';
  const youtubeEligible =
    providers.includes('YouTube') &&
    filterCapability(filters) &&
    Boolean(process.env.YOUTUBE_API_KEY) &&
    workersEnabled();
  const selectedStale = selected.some((course) =>
    freshness[course.platform]
      ? freshness[course.platform] <= new Date()
      : !course.provenance?.metadataVerifiedAt ||
        new Date(course.provenance.metadataVerifiedAt).getTime() + 7 * 86400_000 <= Date.now(),
  );
  const known = require('./courseCatalogSearchService').KNOWN_TOPICS.includes(topic);
  const needsAdmission = topic && (insufficient || (!known && selectedStale));
  let admission;
  if (needsAdmission)
    admission = await requestDiscovery(query, { retrievalAllowed: youtubeEligible });
  const readJob = async () =>
    youtubeEligible
      ? (
          await mongoose.connection.db
            .collection('course_catalog_discovery')
            .findOne(
              { _id: 'topics', 'topics.key': digest(query).slice(0, 24) },
              { projection: { 'topics.$': 1 }, timeoutMS: 5000 },
            )
        )?.topics?.[0]
      : null;
  const previousJob = await readJob();
  // A lagging process must neither stop polling nor overwrite newer provider coverage.
  if (previousJob?.state === 'covered' && previousJob.completedAt > catalogReadAt)
    return {
      status: 'pending',
      revision,
      insufficient,
      reason: !selected.length ? 'missing-courses' : 'stale-coverage',
      pollAfterMs: 5000,
      retryAfterSeconds: null,
    };
  const states = topic
    ? await coverage.observe(topic, matching, {
        revision,
        freshness,
        providers,
        catalogReadAt,
        requestDiscovery: youtubeEligible ? requestDiscovery : undefined,
      })
    : [];
  const stale =
    selectedStale ||
    states.some((row) => row.quality.relevantCount > 0 && row.freshness !== 'fresh');
  const missingYouTube =
    !topic &&
    providers.includes('YouTube') &&
    !selected.some((course) => course.platform === 'YouTube');
  if ((insufficient || missingYouTube) && youtubeEligible && !admission)
    admission = await requestDiscovery(query);
  const keys = states.map((row) => row._id);
  if (keys.length && insufficient) {
    // One bounded latest-demand field per admitted technology/provider, not per user/filter.
    const signature = digest([filters.platform, filters.rating, filters.level, filters.duration]);
    await mongoose.connection.db.collection('course_catalog_coverage').updateMany(
      {
        _id: { $in: keys },
        $or: [
          { 'demand.signature': { $ne: signature } },
          { 'demand.checkedAt': { $lt: new Date(Date.now() - 15 * 60_000) } },
        ],
      },
      {
        $set: {
          demand: {
            signature,
            checkedAt: new Date(),
            matchingCount: selected.length,
            filteredCount: courses.length,
            reason: shortageReason,
          },
        },
      },
      { timeoutMS: 5000 },
    );
  }
  const job = await readJob();
  const catalogLag = job?.state === 'covered' && job.completedAt > catalogReadAt;
  const officialPending =
    workersEnabled() &&
    process.env.COURSES_OFFICIAL_CATALOG_ENABLED !== 'false' &&
    !filters.rating &&
    filters.level === 'All' &&
    filters.duration === 'All' &&
    states.some((row) => row.provider === 'freeCodeCamp' && row.state === 'queued');
  const pending =
    officialPending ||
    ((insufficient || stale || missingYouTube) &&
      youtubeEligible &&
      (['queued', 'running'].includes(job?.state) || catalogLag));
  const status = pending
    ? 'pending'
    : !insufficient && !stale
      ? 'ready'
      : job?.state === 'cooldown' || job?.state === 'covered'
        ? 'cooldown'
        : 'unavailable';
  return {
    status,
    revision,
    insufficient,
    reason: insufficient ? shortageReason : stale ? 'stale-coverage' : null,
    pollAfterMs: pending ? 5000 : null,
    retryAfterSeconds:
      status === 'cooldown'
        ? Math.max(1, Math.ceil((job.nextAttemptAt.getTime() - Date.now()) / 1000))
        : null,
  };
}

const memory = new Map();
const pending = new Map();
async function describe(input) {
  const key = digest([
    input.topic,
    input.revision,
    input.filters.platform,
    input.filters.rating,
    input.filters.level,
    input.filters.duration,
    input.courses.length,
    Boolean(process.env.YOUTUBE_API_KEY),
    workersEnabled(),
    process.env.COURSES_OFFICIAL_CATALOG_ENABLED,
  ]);
  const old = memory.get(key);
  if (old?.until > Date.now()) return old.value;
  if (pending.has(key)) return pending.get(key);
  if (pending.size >= 8) throw Error('Course coverage temporarily busy.');
  const work = describeUncached(input)
    .then((value) => {
      memory.delete(key);
      Object.freeze(value);
      memory.set(key, { value, until: Date.now() + 5000 });
      while (memory.size > 64) memory.delete(memory.keys().next().value);
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, work);
  return work;
}
module.exports = { describe, filterCapability, clearMemory: () => memory.clear() };
