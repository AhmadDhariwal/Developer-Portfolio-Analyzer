'use strict';

// Explicitly scoped to a disposable Mongo and optionally the two approved public
// JSON resources/new reviewed links. Never reads .env, credentials or existing users.
const mongoose = require('mongoose');
const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
const { startMongo } = require('../tests/fixtures/disposableRequestMongo');
const service = require('../services/courseService');
const shared = require('../services/sharedCourseCatalogService');
const coverage = require('../services/courseCatalogCoverageService');
const taxonomy = require('../services/courseCatalogTaxonomy');
const acquisition = require('../services/courseCatalogAcquisitionService');
const maintenance = require('../services/courseCatalogMaintenanceService');
const { digest, COURSE_PROVIDERS } = require('../utils/courseIdentity');
const seed = require('../data/courseAcquisitionCatalog');
const output = path.resolve(__dirname, '../../verification/courses/acquisition-2026-11-06');
const summarize = (courses) => ({
  total: courses.length,
  providers: Object.fromEntries(
    COURSE_PROVIDERS.map((provider) => [
      provider,
      courses.filter((course) => course.platform === provider).length,
    ]),
  ),
  topics: Object.fromEntries(
    taxonomy.technologies.map((topic) => [
      topic,
      courses.filter((course) => taxonomy.matches(course, topic)).length,
    ]),
  ),
});

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const runtime = await startMongo({ replicaSet: 'catalog-source-verification' });
  const prior = {
    key: process.env.YOUTUBE_API_KEY,
    flag: process.env.COURSES_OFFICIAL_CATALOG_ENABLED,
  };
  process.env.YOUTUBE_API_KEY = '';
  process.env.COURSES_OFFICIAL_CATALOG_ENABLED = 'true';
  const originalGet = axios.get;
  const originalHead = axios.head;
  let sourceHttpCalls = 0;
  let linkHttpCalls = 0;
  axios.get = async (url, options) => {
    if (!acquisition.SOURCES.includes(url) || ++sourceHttpCalls > 2)
      throw Error('Verification source bound exceeded.');
    return originalGet(url, options);
  };
  axios.head = async (url, options) => {
    if (++linkHttpCalls > 80) throw Error('Verification link bound exceeded.');
    return originalHead(url, options);
  };
  try {
    await mongoose.connect(runtime.uri);
    const expanded = service.buildFallbackPool('All', 200);
    const old = expanded.filter((course) => !seed.courses.some((added) => added.id === course.id));
    await shared.ingestCurated(old, 'verification-before');
    const before = summarize(await coverage.inventory());
    await shared.getCurated(
      expanded,
      digest([...require('../data/courseCatalog'), ...require('../data/openLearningCatalog')]),
    );
    const seeded = summarize(expanded);
    let refresh = { status: 'not-requested' };
    const links = [];
    if (process.argv.includes('--live-public-sources')) {
      refresh = await acquisition.refresh();
      // One probe per new record, in batches of two. Authentication/429/5xx and
      // transport errors remain unverified; no automatic retirement or retries.
      for (let index = 0; index < seed.courses.length; index += 2)
        links.push(
          ...(await Promise.all(
            seed.courses.slice(index, index + 2).map(async (course) => {
              try {
                return { id: course.id, ...(await maintenance.probe(course.url, course.platform)) };
              } catch (error) {
                return { id: course.id, status: 'unverified', reason: error.code || error.name };
              }
            }),
          )),
        );
      await acquisition.refresh(); // Must reuse the durable source check without another HTTP call.
    }
    const providerCoverage = await coverage.auditInventory();
    const after = summarize(
      service.dedupeCourses(
        (await coverage.inventory()).map(service.normaliseCourse).filter(Boolean),
      ),
    );
    const source = await mongoose.connection.db
      .collection('shared_course_catalog')
      .findOne({ _id: acquisition.KEY });
    fs.writeFileSync(
      path.join(output, 'catalog-verification.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          scope: 'Disposable local Mongo; no users, paid provider APIs or AI calls',
          before,
          seeded,
          after,
          refresh,
          sourceHttpCalls,
          linkHttpCalls,
          realYouTubeCalls: 0,
          source: source
            ? {
                version: source.sourceVersion,
                count: source.courses?.length || 0,
                lastCheckedAt: source.lastCheckedAt,
                nextRetryAt: source.nextRetryAt,
                failureReason: source.failureReason || null,
                quality: source.quality,
              }
            : null,
          providerCoverage,
          links,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        before: before.total,
        seeded: seeded.total,
        after: after.total,
        refresh,
        sourceHttpCalls,
        linkHttpCalls,
      }),
    );
  } finally {
    axios.get = originalGet;
    axios.head = originalHead;
    if (prior.key === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = prior.key;
    if (prior.flag === undefined) delete process.env.COURSES_OFFICIAL_CATALOG_ENABLED;
    else process.env.COURSES_OFFICIAL_CATALOG_ENABLED = prior.flag;
    await mongoose.disconnect();
    fs.writeFileSync(
      path.join(output, 'verification-cleanup.json'),
      JSON.stringify(await runtime.stop(), null, 2),
    );
  }
})().catch((error) => {
  console.error(error.name, error.message);
  process.exitCode = 1;
});
