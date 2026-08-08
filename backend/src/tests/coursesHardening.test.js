'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const controllerSource = read('backend', 'src', 'controllers', 'courseController.js');
const serviceSource = read('backend', 'src', 'services', 'courseService.js');
const routesSource = read('backend', 'src', 'routes', 'courseRoutes.js');
const promptSource = read('backend', 'src', 'prompts', 'coursePrompt.js');
const componentSource = read('frontend', 'src', 'app', 'pages', 'courses', 'courses.component.ts');
const componentHtml = read('frontend', 'src', 'app', 'pages', 'courses', 'courses.component.html');
const clientSource = read('frontend', 'src', 'app', 'shared', 'services', 'course.service.ts');

const {
  normaliseCourse,
  normaliseCourseFilters,
  calcYouTubeRating,
  scoreAndRank,
  isPersistableCoursePool,
  sanitizeSkillList,
  buildCoursePoolWithMetadata,
  hasValidCourseUrl
} = require('../services/courseService');

const {
  resolveCareerStack,
  resolveExperienceLevel,
  buildPoolCacheKey,
  buildOrShareCoursePool,
  COURSE_POOL_VERSION,
  SKILL_GAP_ANALYSIS_VERSION
} = require('../controllers/courseController');

test('Learning Hub route requires JWT protect middleware', () => {
  assert.match(routesSource, /router\.get\('\/', protect, fetchCourses\)/);
});

test('controller never returns provider tokens, stack traces, or raw error.message', () => {
  assert.doesNotMatch(controllerSource, /error:\s*error\.message/);
  assert.doesNotMatch(controllerSource, /stack:/);
  assert.doesNotMatch(controllerSource, /YOUTUBE_API_KEY/);
  assert.match(controllerSource, /Failed to fetch course recommendations\. Please try again\./);
  assert.match(controllerSource, /Authentication required\./);
});

test('skill signals are scoped to user, active stack, experience, and skill-gap version', () => {
  assert.match(controllerSource, /analysisVersion:\s*SKILL_GAP_ANALYSIS_VERSION/);
  assert.match(controllerSource, /careerStack,\s*experienceLevel/);
  assert.equal(SKILL_GAP_ANALYSIS_VERSION, 'v6-skill-intelligence');
  assert.match(controllerSource, /resolveSkillSignals\(userId, careerStack, experienceLevel/);
});

test('pool cache keys remain user-owned and versioned', () => {
  const keyA = buildPoolCacheKey({
    userId: 'user-a',
    careerStack: 'Backend',
    experienceLevel: 'Intern',
    skillGaps: ['SQL'],
    knownSkills: ['Node.js'],
    filters: normaliseCourseFilters({ platform: 'All' })
  });
  const keyB = buildPoolCacheKey({
    userId: 'user-b',
    careerStack: 'Backend',
    experienceLevel: 'Intern',
    skillGaps: ['SQL'],
    knownSkills: ['Node.js'],
    filters: normaliseCourseFilters({ platform: 'All' })
  });
  const keyC = buildPoolCacheKey({
    userId: 'user-a',
    careerStack: 'Frontend',
    experienceLevel: 'Intern',
    skillGaps: ['SQL'],
    knownSkills: ['Node.js'],
    filters: normaliseCourseFilters({ platform: 'All' })
  });

  assert.equal(keyA.cacheLookup.userId, 'user-a');
  assert.equal(keyA.cacheLookup.analysisVersion, COURSE_POOL_VERSION);
  assert.equal(COURSE_POOL_VERSION, 'courses_pool_v5');
  assert.notEqual(keyA.cacheLookup.userId, keyB.cacheLookup.userId);
  assert.notEqual(keyA.poolHash, keyC.poolHash);
});

test('career stack and experience resolve to allowed enums only', () => {
  assert.equal(resolveCareerStack({ careerStack: 'Backend' }), 'Backend');
  assert.equal(resolveCareerStack({ careerStack: 'Unknown' }, { stack: 'Frontend' }), 'Full Stack');
  assert.equal(resolveExperienceLevel({ experienceLevel: 'Intern' }), 'Intern');
  assert.equal(resolveExperienceLevel({ experienceLevel: 'wizard' }), 'Student');
});

test('invalid and empty courses are rejected before ranking or persistence', () => {
  assert.equal(normaliseCourse({ title: '', platform: 'Udemy', url: 'https://www.udemy.com/course/x/' }), null);
  assert.equal(normaliseCourse({ title: 'No URL', platform: 'Udemy' }), null);
  assert.equal(normaliseCourse({ title: 'Bad platform', platform: 'FakeSchool', url: 'https://example.com/x' }), null);
  assert.equal(hasValidCourseUrl('not-a-url'), false);

  const valid = normaliseCourse({
    id: 'c1',
    title: 'Node APIs',
    platform: 'Udemy',
    url: 'https://www.udemy.com/course/node-apis/',
    rating: 4.6,
    popularity: 80,
    topics: ['Node.js']
  });
  assert.ok(valid);
  assert.equal(isPersistableCoursePool([valid]), true);
  assert.equal(isPersistableCoursePool([]), false);
  assert.equal(isPersistableCoursePool([{ title: 'x' }]), false);
});

test('missing YouTube engagement does not invent a rating', () => {
  assert.equal(calcYouTubeRating(0, 0), null);
  assert.equal(calcYouTubeRating(undefined, 10), null);
  assert.ok(Number.isFinite(calcYouTubeRating(1000, 50)));
  assert.ok(calcYouTubeRating(1000, 50) >= 4);
});

test('ranking is deterministic and does not invent ratings for unscored courses', () => {
  const courses = [
    normaliseCourse({
      id: 'a',
      title: 'SQL for Backend Engineers',
      platform: 'Coursera',
      url: 'https://www.coursera.org/learn/sql',
      topics: ['SQL'],
      popularity: 70
    }),
    normaliseCourse({
      id: 'b',
      title: 'SQL Masterclass',
      platform: 'Udemy',
      url: 'https://www.udemy.com/course/sql-masterclass/',
      rating: 4.8,
      topics: ['SQL'],
      popularity: 70
    })
  ].filter(Boolean);

  const rankedOnce = scoreAndRank(courses, {
    careerStack: 'Backend',
    experienceLevel: 'Intern',
    skillGaps: ['SQL'],
    knownSkills: ['Node.js']
  });
  const rankedTwice = scoreAndRank(courses, {
    careerStack: 'Backend',
    experienceLevel: 'Intern',
    skillGaps: ['SQL'],
    knownSkills: ['Node.js']
  });

  assert.deepEqual(
    rankedOnce.map((course) => ({ id: course.id, finalScore: course.finalScore, relevanceScore: course.relevanceScore })),
    rankedTwice.map((course) => ({ id: course.id, finalScore: course.finalScore, relevanceScore: course.relevanceScore }))
  );
  assert.equal(rankedOnce.find((course) => course.id === 'a')?.rating, undefined);
  assert.equal(rankedOnce.find((course) => course.id === 'b')?.rating, 4.8);
});

test('skill list sanitization truncates length and dedupes', () => {
  const skills = sanitizeSkillList(['SQL', 'sql', `${'A'.repeat(80)}`, '', 'Node.js'], 3);
  assert.deepEqual(skills, ['SQL', 'A'.repeat(40), 'Node.js']);
});

test('filter normalisation clamps paging and rejects unknown enums', () => {
  const filters = normaliseCourseFilters({
    platform: 'UnknownPlatform',
    level: 'Expert',
    duration: 'forever',
    rating: '9',
    topic: ` ${'x'.repeat(100)} `,
    page: '-3',
    limit: '999'
  });
  assert.equal(filters.platform, 'All');
  assert.equal(filters.level, 'All');
  assert.equal(filters.duration, 'All');
  assert.equal(filters.rating, '5');
  assert.equal(filters.topic.length, 60);
  assert.equal(filters.page, 1);
  assert.equal(filters.limit, 20);
});

test('concurrent pool builds share one inflight promise', async () => {
  let runs = 0;
  const buildFn = async () => {
    runs += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { courses: [{ id: 'shared' }], sourceMetadata: { source: 'curated' } };
  };

  const [first, second] = await Promise.all([
    buildOrShareCoursePool('inflight-test-key', buildFn),
    buildOrShareCoursePool('inflight-test-key', buildFn)
  ]);

  assert.equal(runs, 1);
  assert.equal(first.courses[0].id, 'shared');
  assert.equal(second.courses[0].id, 'shared');
});

test('empty or unsafe pools are never marked persistable', async () => {
  const previousKey = process.env.YOUTUBE_API_KEY;
  process.env.YOUTUBE_API_KEY = '';
  try {
    const built = await buildCoursePoolWithMetadata({
      careerStack: 'Backend',
      experienceLevel: 'Intern',
      platform: 'Coursera',
      skillGaps: ['SQL']
    });
    assert.ok(built.courses.length > 0);
    assert.equal(isPersistableCoursePool(built.courses), true);
    assert.equal(isPersistableCoursePool([]), false);
  } finally {
    process.env.YOUTUBE_API_KEY = previousKey;
  }
});

test('live Learning Hub path owns facts without calling Gemini AI', () => {
  assert.doesNotMatch(serviceSource, /getCoursePrompt|generateContent|gemini/i);
  assert.doesNotMatch(controllerSource, /getCoursePrompt|generateContent|gemini|runAIAnalysis/i);
  assert.match(controllerSource, /require\('\.\.\/services\/aiservice'\)/);
  assert.match(serviceSource, /scoreAndRank/);
  assert.match(serviceSource, /buildFallbackPool/);
  assert.match(promptSource, /Return ONLY a valid JSON object/);
});

test('unsafe work is never cached: controller requires persistable pool before upsert', () => {
  assert.match(controllerSource, /isPersistableCoursePool\(allCourses\)/);
  assert.match(controllerSource, /buildOrShareCoursePool/);
  assert.match(controllerSource, /coursePoolInflight/);
  assert.match(controllerSource, /persistCoursePoolAsync/);
  assert.match(controllerSource, /setImmediate\(/);
  assert.match(controllerSource, /withBudget\(/);
  assert.match(controllerSource, /COURSE_REDIS_LOOKUP_BUDGET_MS/);
  assert.match(controllerSource, /readCourseMemory|writeCourseMemory/);
});

test('frontend failed refresh preserves previous valid result', () => {
  assert.match(componentSource, /preserveOnFailure/);
  assert.match(componentSource, /previousResult/);
  assert.match(componentSource, /isRefreshing/);
  assert.match(componentSource, /preservePrevious && options\.previousResult/);
  assert.match(componentHtml, /Previous recommendations are still shown/);
  assert.match(componentHtml, /errorMessage && allCourses\.length === 0/);
});

test('skill-gap deep links apply skill/topic query into Learning Hub filters once', () => {
  assert.match(componentSource, /ActivatedRoute/);
  assert.match(componentSource, /applyTopicFromQuery/);
  assert.match(componentSource, /params\.get\('skill'\) \|\| params\.get\('topic'\)/);
  assert.match(componentSource, /refreshLockUntil/);
  assert.match(componentSource, /now < this\.refreshLockUntil/);
});

test('frontend cache evicts failures and rejects incomplete course payloads', () => {
  assert.match(clientSource, /this\.cache\.delete\(key\)/);
  assert.match(clientSource, /shareReplay\(\{ bufferSize: 1, refCount: false \}\)/);
  assert.match(clientSource, /validPlatforms\.includes\(platform\)/);
  assert.ok(clientSource.includes('return null;'));
  assert.ok(clientSource.includes('https?:'));
});
