'use strict';

const cron = require('node-cron');
const mongoose = require('mongoose');
const axios = require('axios');
const catalog = require('./sharedCourseCatalogService');
const { safeCourseUrl, digest } = require('../utils/courseIdentity');
const { acquirePoolLease, releasePoolLease } = require('./courseGovernanceService');
let task;
let running = false;

// Only public allowlisted destinations; no page content is downloaded or republished.
// Redirects are checked manually so an approved host cannot redirect a probe to a private IP.
async function probe(url, platform) {
  let current = safeCourseUrl(url, platform);
  if (!current) return { status: 'invalid' };
  for (let hop = 0; hop < 5; hop++) {
    const response = await axios.head(current, {
      timeout: 5000,
      maxRedirects: 0,
      validateStatus: () => true,
    });
    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      const next = safeCourseUrl(new URL(response.headers.location, current).href, platform);
      if (!next) return { status: 'redirect-review', url: current };
      current = next;
      continue;
    }
    return { status: response.status, url: current, redirected: current !== url };
  }
  return { status: 'redirect-review', url: current };
}

async function maintain({ probeCourse = probe } = {}) {
  if (running || mongoose.connection.readyState !== 1) return;
  running = true;
  let lease;
  try {
    await catalog.initialize();
    lease = await acquirePoolLease('catalog-maintenance', 180_000);
    if (!lease.acquired) return;
    const courses = require('./courseService');
    const source = [...require('../data/courseCatalog'), ...require('../data/openLearningCatalog')];
    await catalog.getCurated(courses.buildFallbackPool('All', 200), digest(source));
    const db = mongoose.connection.db.collection('shared_course_catalog');
    const row = await db.findOne({ _id: 'curated' }, { timeoutMS: 5000 });
    const due = row.courses
      .filter(
        (course) =>
          !row.audits?.[course.id]?.checkedAt ||
          Date.now() - new Date(row.audits[course.id].checkedAt).getTime() > 7 * 86_400_000,
      )
      .slice(0, 4);
    for (const course of due) {
      let audit;
      try {
        audit = await probeCourse(course.url, course.platform);
      } catch {
        audit = { status: 'unreachable' };
      }
      const previous = row.audits?.[course.id];
      const missing = [404, 410].includes(audit.status);
      const failures = missing ? Number(previous?.missingCount || 0) + 1 : 0;
      // Two scheduled observations separated by a week; authentication/429/5xx never retire a course.
      const archived = missing
        ? failures >= 2
        : audit.status === 200
          ? false
          : previous?.archived === true;
      await db.updateOne(
        { _id: 'curated', version: row.version },
        {
          $set: {
            auditRevision: new Date().toISOString(),
            [`audits.${course.id}`]: {
              ...audit,
              missingCount: failures,
              archived,
              checkedAt: new Date(),
            },
          },
        },
        { timeoutMS: 5000 },
      );
    }
    catalog.clearMemory();
    if (process.env.COURSES_BACKGROUND_INGESTION === 'true' && process.env.YOUTUBE_API_KEY) {
      // Two existing stale coverages per tick; no speculative crawling or unbounded queue.
      const stale = await db
        .find({ version: catalog.VERSION, freshUntil: { $lte: new Date() } })
        .sort({ freshUntil: 1, _id: 1 })
        .limit(2)
        .maxTimeMS(5000)
        .toArray();
      for (const item of stale) {
        await catalog
          .getYouTube({
            topic: item.topic,
            fingerprint: courses.providerConfigurationFingerprint(),
            fetchProvider: courses.fetchYouTubeCourses,
            background: true,
          })
          .catch(() => {});
      }
    }
  } finally {
    if (lease?.token) await releasePoolLease('catalog-maintenance', lease.token);
    running = false;
  }
}

function start() {
  if (task || process.env.COURSES_MAINTENANCE_ENABLED === 'false') return;
  task = cron.schedule('17 * * * *', () =>
    maintain().catch(() => console.warn('[Courses] Catalog maintenance deferred.')),
  );
}
function stop() {
  task?.stop();
  task = null;
}
async function coverageReport() {
  await catalog.initialize();
  const rows = await mongoose.connection.db
    .collection('shared_course_catalog')
    .find({ courses: { $exists: true } })
    .limit(catalog.TOPICS.length + catalog.STACKS.length + 1)
    .maxTimeMS(5000)
    .toArray();
  const unique = new Map();
  let duplicateRows = 0;
  for (const row of rows)
    for (const course of row.courses) {
      if (unique.has(course.id)) duplicateRows++;
      unique.set(course.id, course);
    }
  const providers = {};
  const topics = {};
  for (const course of unique.values()) {
    providers[course.platform] = (providers[course.platform] || 0) + 1;
    for (const topic of course.topics || []) topics[topic] = (topics[topic] || 0) + 1;
  }
  return {
    generatedAt: new Date().toISOString(),
    catalogVersion: catalog.VERSION,
    coverageDocuments: rows.length,
    uniqueCourses: unique.size,
    overlappingCoverageRows: duplicateRows,
    providers,
    topics,
    uncoveredTopics: catalog.TOPICS.filter((topic) => !topics[topic]),
    coverage: rows.map((row) => ({
      key: row._id,
      version: row.version,
      count: row.courses.length,
      freshUntil: row.freshUntil || null,
      staleUntil: row.staleUntil || null,
    })),
    urlAudits: rows.find((row) => row._id === 'curated')?.audits || {},
  };
}
module.exports = { start, stop, maintain, probe, coverageReport };
