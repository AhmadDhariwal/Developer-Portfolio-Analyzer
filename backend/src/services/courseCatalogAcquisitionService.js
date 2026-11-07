'use strict';

const mongoose = require('mongoose');
const axios = require('axios');
const { randomUUID } = require('node:crypto');
const { digest, canonicalCourseKey } = require('../utils/courseIdentity');
const shared = require('./sharedCourseCatalogService');
const governance = require('./courseGovernanceService');
const seed = require('../data/courseAcquisitionCatalog');
const PREFIX = 'https://raw.githubusercontent.com/freeCodeCamp/freeCodeCamp/main/';
const SOURCES = [
  PREFIX + 'curriculum/structure/curriculum.json',
  PREFIX + 'client/i18n/locales/english/intro.json',
];
const KEY = 'official:freecodecamp';
const DAY = 86_400_000;
const LEASE_MS = 60_000;

async function getJson(url) {
  // Only these two public, BSD-licensed structured resources. Never follow redirects,
  // accept arbitrary endpoints, forward credentials, or download course content.
  if (!SOURCES.includes(url)) throw Error('Unapproved catalog source.');
  const budget = await governance.window('official-catalog-http', 'freeCodeCamp', 4, DAY);
  if (!budget.allowed)
    throw Object.assign(Error('Official catalog daily budget exhausted.'), { code: 'BUDGET' });
  return (
    await axios.get(url, {
      timeout: 8000,
      maxRedirects: 0,
      maxContentLength: 2 * 1024 * 1024,
      responseType: 'json',
      headers: { Accept: 'application/json', Authorization: null, Cookie: null },
      auth: null,
      withCredentials: false,
    })
  ).data;
}

function parse(structure, titles) {
  if (
    !Array.isArray(structure?.superblocks) ||
    structure.superblocks.length > 256 ||
    !titles ||
    typeof titles !== 'object' ||
    Array.isArray(titles)
  )
    throw Error('Invalid official catalog schema.');
  const allowed = new Set(structure.superblocks);
  // New unreviewed slugs are never guessed into titles/taxonomy or public URLs.
  // The reviewed mapping bounds acquisition and is extended through controlled curation.
  return seed.fcc
    .filter((entry) => allowed.has(entry.manifestSlug || entry.slug))
    .map(({ slug, manifestSlug, ...entry }) => {
      const title = titles[slug]?.title;
      if (typeof title !== 'string' || !title.trim() || title.length > 200) return null;
      return require('./courseService').normaliseCourse({
        ...entry,
        title,
        platform: 'freeCodeCamp',
        metadataSource: 'provider',
        url: `https://www.freecodecamp.org/learn/${slug}/`,
        courseType: 'curriculum',
        language: 'en',
        provenance: { metadataVerifiedAt: new Date().toISOString() },
      });
    })
    .filter(Boolean);
}

async function refresh({ fetchJson = getJson } = {}) {
  if (
    mongoose.connection.readyState !== 1 ||
    process.env.COURSES_OFFICIAL_CATALOG_ENABLED === 'false'
  )
    return { status: 'disabled' };
  await shared.initialize();
  const raw = mongoose.connection.db.collection('shared_course_catalog');
  await raw
    .updateOne(
      { _id: KEY },
      {
        $setOnInsert: { nextRetryAt: new Date(0), leaseUntil: new Date(0) },
      },
      { upsert: true, timeoutMS: 5000 },
    )
    .catch((error) => {
      if (error.code !== 11000) throw error;
    });
  const token = randomUUID();
  const row = await raw.findOneAndUpdate(
    {
      _id: KEY,
      $expr: { $and: [{ $lte: ['$leaseUntil', '$$NOW'] }, { $lte: ['$nextRetryAt', '$$NOW'] }] },
    },
    [
      {
        $set: {
          leaseToken: token,
          leaseUntil: { $add: ['$$NOW', LEASE_MS] },
          lastAttemptAt: '$$NOW',
          attempts: { $add: [{ $ifNull: ['$attempts', 0] }, 1] },
        },
      },
    ],
    { returnDocument: 'after', timeoutMS: 5000 },
  );
  if (!row) return { status: 'reused-or-leased' };
  const fence = { _id: KEY, leaseToken: token, $expr: { $gt: ['$leaseUntil', '$$NOW'] } };
  try {
    const structure = await fetchJson(SOURCES[0]);
    const titles = await fetchJson(SOURCES[1]);
    const courses = parse(structure, titles);
    if (!courses.length) throw Error('Official catalog returned no reviewed relevant courses.');
    // Missing entries do not delete historical identities. Link audits/curation
    // determine retirement; last-good records are retained and separately disclosed.
    const merged = new Map(
      (row.courses || []).map((course) => [canonicalCourseKey(course), course]),
    );
    for (const course of courses)
      merged.set(canonicalCourseKey(course), {
        ...course,
        catalogMetadataFreshUntil: new Date(Date.now() + 7 * DAY),
      });
    for (const [key, course] of merged)
      if (!course.catalogMetadataFreshUntil)
        merged.set(key, { ...course, catalogMetadataFreshUntil: row.freshUntil || new Date(0) });
    if (merged.size > 40) throw Error('Official catalog course bound exceeded.');
    const now = new Date();
    const published = await raw.updateOne(
      fence,
      {
        $set: {
          version: shared.VERSION,
          sourceVersion: digest([structure, courses.map((course) => [course.id, course.title])]),
          provider: 'freeCodeCamp',
          sourceCapability: 'official-manifest',
          sources: SOURCES,
          license: 'BSD-3-Clause',
          attribution: 'freeCodeCamp contributors',
          licenseUrl: PREFIX + 'LICENSE.md',
          courses: [...merged.values()],
          status: 'available',
          failureReason: null,
          lastCheckedAt: now,
          updatedAt: now,
          freshUntil: new Date(Date.now() + 7 * DAY),
          staleUntil: new Date(Date.now() + 30 * DAY),
          nextRetryAt: new Date(Date.now() + DAY),
          leaseUntil: new Date(0),
          failures: 0,
          quality: {
            received: courses.length,
            retainedLastGood: merged.size - courses.length,
            unknownSlugs: structure.superblocks.filter(
              (slug) => !seed.fcc.some((entry) => (entry.manifestSlug || entry.slug) === slug),
            ).length,
          },
        },
      },
      { timeoutMS: 5000 },
    );
    if (!published.matchedCount) return { status: 'fenced' };
    shared.clearMemory();
    require('./courseCatalogSearchService').clearMemory();
    return { status: 'published', count: merged.size };
  } catch (error) {
    const failures = Math.min(8, Number(row.failures || 0) + 1);
    const delay = error.code === 'BUDGET' ? DAY : Math.min(DAY, 3600_000 * 2 ** (failures - 1));
    await raw.updateOne(
      fence,
      {
        $set: {
          failureReason:
            error.code === 'BUDGET'
              ? 'daily-budget-exhausted'
              : error.response?.status === 429
                ? 'provider-rate-limited'
                : 'source-unavailable-or-invalid',
          lastCheckedAt: new Date(),
          nextRetryAt: new Date(Date.now() + delay),
          leaseUntil: new Date(0),
          failures,
        },
      },
      { timeoutMS: 5000 },
    );
    return { status: 'deferred' };
  }
}

module.exports = { refresh, parse, SOURCES, KEY };
