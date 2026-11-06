'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const service = require('../services/courseService');
const { safeCourseUrl, skills } = require('../utils/courseIdentity');
const course = (id, platform = 'Udemy', extra = {}) =>
  service.normaliseCourse({
    id,
    title: 'JavaScript course',
    platform,
    url:
      platform === 'Coursera'
        ? `https://www.coursera.org/learn/${id}`
        : `https://www.udemy.com/course/${id}/`,
    topics: ['JavaScript'],
    ...extra,
  });

test('course topic aliases deduplicate without conflating distinct languages', () => {
  assert.deepEqual(skills(['nodejs', 'Node.js', 'JavaScript', 'Java', 'C++', 'C#']), [
    'Node.js',
    'JavaScript',
    'Java',
    'C++',
    'C#',
  ]);
  assert.deepEqual(skills(['C#', '.NET', 'PostgreSQL', 'SQL']), [
    'C#',
    '.NET',
    'PostgreSQL',
    'SQL',
  ]);
  const js = course('fb_u1');
  assert.equal(
    service.applyCourseFilters([js], service.normaliseCourseFilters({ skill: 'Java' })).length,
    0,
  );
  assert.equal(
    service.applyCourseFilters([js], service.normaliseCourseFilters({ skill: 'javascript' }))
      .length,
    1,
  );
  assert.equal(
    service.applyCourseFilters(
      [course('fb_u3', 'Udemy', { title: 'nodejs tutorial', topics: ['nodejs'] })],
      { topic: 'Node.js' },
    ).length,
    1,
  );
  const cpp = course('fb_u2', 'Udemy', { title: 'C++ course', topics: ['C++'] });
  assert.equal(service.applyCourseFilters([cpp], { topic: 'C' }).length, 0);
});
test('course links reject unsafe schemes, credentials, local hosts, mismatched providers and tracking duplicates', () => {
  for (const value of [
    'javascript:alert(1)',
    'http://www.udemy.com/x',
    'https://localhost/x',
    'https://www.udemy.com.evil.test/x',
    'https://user:secret@www.udemy.com/x',
    'https://www.udemy.com:444/x',
    'https://www.udemy.com\\evil.test/x',
  ])
    assert.equal(safeCourseUrl(value, 'Udemy'), null);
  assert.equal(
    service.normaliseCourse({
      title: 'X',
      platform: 'Coursera',
      url: 'https://www.udemy.com/course/x',
    }),
    null,
  );
  const first = course('fb_u1');
  assert.equal(
    service.dedupeCourses([
      first,
      { ...first, id: 'other', title: 'Another title', url: first.url + '?utm_source=x' },
    ]).length,
    1,
  );
  const yt = {
    platform: 'YouTube',
    id: 'yt_abcdefghijk',
    title: 'Course',
    url: 'https://www.youtube.com/watch?v=abcdefghijk',
  };
  assert.equal(
    service.dedupeCourses([yt, { ...yt, url: 'https://youtu.be/abcdefghijk' }]).length,
    1,
  );
});
test('missing metadata stays null; provider review scores and curated history remain distinguishable', () => {
  const unknown = course('fb_u1');
  assert.equal(unknown.level, null);
  assert.equal(service.applyCourseFilters([unknown], { level: 'Beginner' }).length, 0);
  for (const field of [
    'rating',
    'reviewCount',
    'popularity',
    'durationHours',
    'duration',
    'instructor',
  ])
    assert.equal(unknown[field], null, field);
  assert.equal(service.applyCourseFilters([unknown], { duration: '0-2' }).length, 0);
  const provider = course('fb_u2', 'Udemy', {
    rating: 4.6,
    reviewCount: 0,
    durationHours: 2,
    duration: '2h',
  });
  assert.equal(provider.rating, 4.6);
  assert.equal(provider.reviewCount, 0);
  assert.equal(provider.provenance.ratingSource, 'provider-reviews');
  const curated = service.buildFallbackPool('All', 100);
  const inventory = require('../data/courseCatalog');
  assert.equal(inventory.length, 36);
  assert.equal(curated.length, 61);
  assert.deepEqual(
    inventory
      .filter((item) => item.discoveryUnavailable)
      .map((item) => item.id)
      .sort(),
    ['fb_e3', 'fb_e5', 'fb_e6', 'fb_u9'],
  );
  assert.ok(
    curated.every((item) => !inventory.find((row) => row.id === item.id)?.discoveryUnavailable),
  );
  assert.ok(
    curated.every(
      (item) =>
        item.rating === null &&
        item.durationHours === null &&
        item.provenance.source === 'curated-catalog',
    ),
  );
  assert.ok(
    require('../data/courseCatalog').some((item) => item.rating > 0),
    'historical catalog records are preserved',
  );
});
test('required evidence targets rank before optional/known context without replacement score weights', () => {
  const required = course('required', 'Udemy', { title: 'SQL practice', topics: ['SQL'] });
  const popular = course('popular', 'Coursera', {
    title: 'React course',
    topics: ['React'],
    rating: 5,
    popularity: 100,
  });
  const context = {
    careerStack: 'Backend',
    experienceLevel: 'Intern',
    skillGaps: ['SQL', 'React'],
    targets: [
      { name: 'SQL', requirement: 'REQUIRED', status: 'CLAIMED_ONLY' },
      { name: 'React', requirement: 'OPTIONAL', status: 'PARTIAL' },
    ],
  };
  const ranked = service.scoreAndRank([popular, required], context);
  assert.equal(ranked[0].id, 'required');
  assert.deepEqual(ranked[0].matchedRequiredTargets, ['SQL']);
  assert.doesNotMatch(ranked[0].whyRecommended, /missing ability|proficient|guarantee/i);
  const tiedA = course('a');
  const tiedB = course('b');
  assert.deepEqual(
    service.scoreAndRank([tiedB, tiedA], {}).map((item) => item.id),
    ['a', 'b'],
  );
});

test('soft provider diversity breaks exact ties without displacing relevance or imposing quotas', () => {
  const a = course('a', 'Udemy');
  const b = course('b', 'Udemy');
  const c = course('c', 'Coursera');
  const ranked = service.scoreAndRank([a, b, c]);
  assert.deepEqual(
    ranked.map((item) => item.id),
    ['a', 'c', 'b'],
  );
  assert.equal(new Set(ranked.map((item) => item.finalScore)).size, 1);
  const relevant = service.scoreAndRank([a, b, c], { skillGaps: ['SQL'] });
  assert.equal(relevant.length, 3);
  const higher = course('d', 'Udemy', { topics: ['SQL'] });
  assert.equal(service.scoreAndRank([a, b, c, higher], { skillGaps: ['SQL'] })[0].id, 'd');
});
test('edX and freeCodeCamp are directly filterable while Other preserves combined compatibility', () => {
  assert.equal(service.normaliseCourseFilters({ platform: 'edX' }).platform, 'edX');
  assert.equal(
    service.normaliseCourseFilters({ platform: 'freeCodeCamp' }).platform,
    'freeCodeCamp',
  );
  const edxPool = service.buildFallbackPool('edX', 50);
  const fccPool = service.buildFallbackPool('freeCodeCamp', 50);
  const otherPool = service.buildFallbackPool('Other', 50);
  assert.equal(edxPool.length, 7);
  assert.ok(edxPool.every((item) => item.platform === 'edX'));
  assert.equal(fccPool.length, 17);
  assert.ok(fccPool.every((item) => item.platform === 'freeCodeCamp'));
  assert.equal(otherPool.length, edxPool.length + fccPool.length);
  assert.equal(service.applyCourseFilters(otherPool, { platform: 'edX' }).length, edxPool.length);
  assert.equal(
    service.applyCourseFilters(otherPool, { platform: 'freeCodeCamp' }).length,
    fccPool.length,
  );
});
test('YouTube derived view counts do not inflate finalScore above equally relevant curated courses', () => {
  const curatedCourse = course('fb_u2', 'Udemy', {
    title: 'Node.js, Express, MongoDB & More: The Complete Bootcamp',
    topics: ['Node.js', 'Express', 'MongoDB'],
    level: 'Intermediate',
  });
  const youtubeCourse = service.normaliseCourse({
    id: 'yt_nodebootcamp',
    title: 'Node.js and Express Tutorial',
    platform: 'YouTube',
    url: 'https://www.youtube.com/watch?v=nodeboot123',
    topics: ['Node.js', 'Express', 'MongoDB'],
    popularity: 100,
    engagementScore: 95,
    provenance: {
      source: 'youtube-api',
      ratingSource: 'unavailable',
      popularitySource: 'derived-view-count',
      engagementSource: 'derived-views-likes',
      durationSource: 'youtube-content-details',
    },
  });
  const ranked = service.scoreAndRank([youtubeCourse, curatedCourse], {
    careerStack: 'Backend',
    experienceLevel: 'Intermediate',
    skillGaps: ['Node.js'],
  });
  assert.equal(ranked[0].id, 'fb_u2');
  assert.ok(ranked[0].finalScore >= ranked[1].finalScore);
  const intern = { careerStack: 'Backend', experienceLevel: 'Intern', skillGaps: ['Node.js'] };
  const unknownLevel = { ...youtubeCourse, durationHours: 3 };
  const [withDuration] = service.scoreAndRank([unknownLevel], intern);
  const [withoutDuration] = service.scoreAndRank([youtubeCourse], intern);
  assert.equal(withDuration.relevanceScore, withoutDuration.relevanceScore);
  const [beginner] = service.scoreAndRank([{ ...unknownLevel, level: 'Beginner' }], intern);
  assert.equal(beginner.relevanceScore - withDuration.relevanceScore, 18);
});
test('All platform order follows ranking across page boundaries, without quota displacement', async () => {
  const previous = process.env.YOUTUBE_API_KEY;
  process.env.YOUTUBE_API_KEY = '';
  try {
    const pool = await service.buildCoursePoolWithMetadata({
      platform: 'All',
      skillGaps: ['JavaScript'],
    });
    const expected = service.scoreAndRank(pool.courses, {
      careerStack: 'Full Stack',
      experienceLevel: 'Student',
      skillGaps: ['JavaScript'],
    });
    assert.deepEqual(
      pool.courses.map((item) => item.id),
      expected.map((item) => item.id),
    );
    const filtered = await service.buildCoursePoolWithMetadata({
      platform: 'Coursera',
      topic: 'Python',
    });
    assert.ok(filtered.courses.every((item) => item.platform === 'Coursera'));
    const missing = await service.buildCoursePoolWithMetadata({ platform: 'YouTube' });
    assert.equal(missing.courses.length, 0);
    assert.equal(missing.sourceMetadata.youtubeStatus, 'unavailable');
  } finally {
    if (previous === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = previous;
  }
});
test('YouTube successful requests coalesce; engagement and likes are never review ratings', async () => {
  const previous = process.env.YOUTUBE_API_KEY;
  const get = axios.get;
  process.env.YOUTUBE_API_KEY = 'test-only';
  service.clearYouTubeCache();
  let searches = 0;
  let details = 0;
  axios.get = async (url) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (url.endsWith('/search')) {
      searches++;
      return { data: { items: [{ id: { videoId: 'abcdefghijk' } }] } };
    }
    details++;
    return {
      data: {
        items: [
          {
            id: 'abcdefghijk',
            snippet: { title: 'TypeScript complete tutorial', channelTitle: 'Fixture channel' },
            contentDetails: { duration: 'PT2H10M' },
            statistics: { viewCount: '200000', likeCount: '12000' },
          },
        ],
      },
    };
  };
  try {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.fetchYouTubeCourses('typescript', 10)),
    );
    assert.equal(searches, 2);
    assert.equal(details, 1);
    const video = results[0].courses[0];
    assert.equal(video.level, null);
    assert.equal(video.provenance.popularitySource, 'derived-view-count');
    assert.equal(video.provenance.engagementSource, 'derived-views-likes');
    assert.equal(video.rating, null);
    assert.equal(video.reviewCount, null);
    assert.equal(video.likeCount, 12000);
    assert.ok(video.engagementScore > 0);
    assert.equal(video.provenance.source, 'youtube-api');
    assert.equal(video.instructor, 'Fixture channel');
    assert.equal(video.durationHours, 2.17);
    await service.fetchYouTubeCourses('typescript', 10);
    assert.equal(searches, 2);
    await service.fetchYouTubeCourses('typescript', 10, { forceRefresh: true });
    assert.equal(searches, 4);
  } finally {
    axios.get = get;
    if (previous === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = previous;
    service.clearYouTubeCache();
  }
});
test('YouTube authentication/quota failures open the breaker after three errors and recover after cooldown', async () => {
  const previous = process.env.YOUTUBE_API_KEY;
  const get = axios.get;
  const now = Date.now;
  process.env.YOUTUBE_API_KEY = 'test-only';
  service.clearYouTubeCache();
  let calls = 0;
  let offset = 0;
  Date.now = () => now() + offset;
  axios.get = async () => {
    calls++;
    const error = new Error('provider secret must not escape');
    error.response = { status: 403 };
    throw error;
  };
  try {
    for (let i = 0; i < 3; i++) await service.fetchYouTubeCourses('quota-' + i, 5);
    const before = calls;
    const blocked = await service.fetchYouTubeCourses('another-query', 5);
    assert.equal(blocked.status, 'circuit-open');
    assert.equal(calls, before);
    assert.doesNotMatch(JSON.stringify(blocked), /test-only|secret/);
    offset = 31 * 60 * 1000;
    await service.fetchYouTubeCourses('after-cooldown', 5);
    assert.ok(calls > before);
  } finally {
    axios.get = get;
    Date.now = now;
    if (previous === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = previous;
    service.clearYouTubeCache();
  }
});

test('public course DTO bounds cached metadata and strips private or provider fields', () => {
  const source = course('fb_u1', 'Udemy', { title: 'x'.repeat(500), rating: 4.5 });
  const dto = service.publicCourse({
    ...source,
    resumeText: 'private',
    apiKey: 'secret',
    whyRecommended: 'w'.repeat(1000),
    finalScore: 200,
    matchedTargets: ['SQL', 'sql'],
    provenance: { source: 'provider', secret: 'hidden' },
  });
  assert.equal(dto.title.length, 200);
  assert.equal(dto.whyRecommended.length, 400);
  assert.equal(dto.finalScore, null);
  assert.deepEqual(dto.matchedTargets, ['SQL']);
  assert.doesNotMatch(JSON.stringify(dto), /private|secret|hidden/);
});

test('career-only fallback ranks actual track topics ahead of unrelated subjects', () => {
  const frontend = course('react', 'Udemy', {
    title: 'React application architecture',
    topics: ['React'],
    level: 'Intermediate',
  });
  const unrelated = course('physics', 'Coursera', {
    title: 'Physics fundamentals',
    topics: ['Physics'],
    level: 'Beginner',
  });
  const ranked = service.scoreAndRank([unrelated, frontend], {
    careerStack: 'Frontend',
    experienceLevel: 'Student',
  });
  assert.equal(ranked[0].id, 'react');
  assert.deepEqual(ranked[0].matchedCareerSkills, ['React']);
  assert.match(ranked[0].whyRecommended, /React.*Frontend/);
});

test('weekly report learning snapshot summarizes self-reported progress without altering readiness score', () => {
  const weeklyReportService = require('../services/weeklyReportService');
  const now = new Date();
  const weekStart = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const weekEnd = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  const snapshot = weeklyReportService.__test.buildLearningSnapshot(
    [
      {
        courseId: 'fb_u2',
        status: 'completed',
        completedAt: now,
        updatedAt: now,
        course: { title: 'Node.js Bootcamp', platform: 'Udemy' },
      },
      {
        courseId: 'fb_c5',
        status: 'in_progress',
        updatedAt: now,
        course: { title: 'SQL for Data Science', platform: 'Coursera' },
      },
    ],
    weekStart,
    weekEnd,
  );
  assert.equal(snapshot.totalTracked, 2);
  assert.equal(snapshot.completedCount, 1);
  assert.equal(snapshot.inProgressCount, 1);
  assert.equal(snapshot.completedThisWeek, 1);
  assert.equal(snapshot.completionSource, 'self-reported');
});

test('course migration creates indexes on a fresh namespace and remains idempotent', async () => {
  const { migrateCourseIndexes } = require('../scripts/migrateCourseIndexes');
  const indexes = [];
  const collection = {
    indexes: async () => {
      if (!indexes.length) {
        const error = new Error('namespace missing');
        error.code = 26;
        throw error;
      }
      return indexes;
    },
    createIndex: async (key, options) => indexes.push({ key, ...options }),
    dropIndex: async () => assert.fail('Fresh migration must not drop indexes'),
  };
  const first = await migrateCourseIndexes({ collection });
  assert.ok(first.results.every((item) => item.action === 'created'));
  const repeated = await migrateCourseIndexes({ collection });
  assert.ok(repeated.results.every((item) => item.action === 'exists'));
  assert.equal(indexes.length, 2);
});

test('course migration does not conceal genuine index-read failures', async () => {
  const { migrateCourseIndexes } = require('../scripts/migrateCourseIndexes');
  await assert.rejects(
    migrateCourseIndexes({
      collection: {
        indexes: async () => {
          const error = new Error('not authorized');
          error.code = 13;
          throw error;
        },
      },
    }),
    /not authorized/,
  );
});
