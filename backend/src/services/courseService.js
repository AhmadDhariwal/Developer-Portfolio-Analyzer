'use strict';
const {
  safeCourseUrl,
  canonicalCourseKey,
  digest,
  skills: canonicalSkills,
  skillAliases,
} = require('../utils/courseIdentity');
const axios = require('axios');

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const YOUTUBE_FAILURE_TTL_MS = 10 * 60 * 1000;
const YOUTUBE_CIRCUIT_TTL_MS = 30 * 60 * 1000;
const YOUTUBE_CACHE_MAX_ENTRIES = 40;
const YOUTUBE_FAILURE_THRESHOLD = 3;
const youtubeCache = new Map();
const youtubeInflight = new Map();
let youtubeFailureCount = 0;
let youtubeCircuitOpenUntil = 0;
const COURSE_POOL_SIZE = {
  All: 30,
  YouTube: 40,
};
const COURSE_LIMITS = {
  minPage: 1,
  defaultPage: 1,
  defaultLimit: 10,
  maxLimit: 20,
};

const VALID_PLATFORMS = ['All', 'Udemy', 'Coursera', 'YouTube', 'Other'];
const VALID_LEVELS = ['All', 'Beginner', 'Intermediate', 'Advanced'];
const DURATION_ALIASES = {
  '0-2': '0-2',
  short: '0-2',
  '2-10': '2-10',
  medium: '2-10',
  '10+': '10+',
  long: '10+',
  all: 'All',
  '': 'All',
};

const PLATFORM_COLORS = {
  Udemy: { bg: '#a435f0', text: '#ffffff' },
  Coursera: { bg: '#0056d2', text: '#ffffff' },
  edX: { bg: '#02262b', text: '#ffffff' },
  freeCodeCamp: { bg: '#006400', text: '#ffffff' },
  YouTube: { bg: '#ff0000', text: '#ffffff' },
};

const KNOWN_TOPICS = [
  'JavaScript',
  'TypeScript',
  'Python',
  'React',
  'Angular',
  'Vue',
  'Node.js',
  'Express',
  'MongoDB',
  'SQL',
  'PostgreSQL',
  'Docker',
  'Kubernetes',
  'AWS',
  'GCP',
  'Azure',
  'Git',
  'HTML',
  'CSS',
  'Redux',
  'GraphQL',
  'REST',
  'API',
  'Testing',
  'CI/CD',
  'Linux',
  'System Design',
  'Data Structures',
  'Algorithms',
  'Machine Learning',
  'AI',
  'Java',
  'C#',
  '.NET',
  'PHP',
  'Django',
  'FastAPI',
  'Spring',
  'Next.js',
  'Tailwind',
  'Flutter',
];

const EXPERIENCE_LEVEL_MAP = {
  Student: 'Beginner',
  Intern: 'Beginner',
  '0-1 years': 'Beginner',
  '1-2 years': 'Intermediate',
  '2-3 years': 'Intermediate',
  '3-5 years': 'Advanced',
  '5+ years': 'Advanced',
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toTrimmedString(value) {
  return String(value || '').trim();
}

function normalisePlatform(raw) {
  const value = toTrimmedString(raw).toLowerCase();
  if (value === 'all' || !value) return 'All';
  if (value.includes('udemy')) return 'Udemy';
  if (value.includes('coursera')) return 'Coursera';
  if (value.includes('youtube')) return 'YouTube';
  if (
    value.includes('edx') ||
    value.includes('freecodecamp') ||
    value.includes('free code') ||
    value === 'other'
  ) {
    return 'Other';
  }
  return 'All';
}

function normaliseLevel(raw) {
  const value = toTrimmedString(raw).toLowerCase();
  if (value === 'all' || !value) return 'All';
  if (value.includes('begin')) return 'Beginner';
  if (value.includes('inter')) return 'Intermediate';
  if (value.includes('adv')) return 'Advanced';
  return 'All';
}

function normaliseDuration(raw) {
  const value = toTrimmedString(raw).toLowerCase();
  return DURATION_ALIASES[value] || 'All';
}

function normaliseRating(raw) {
  const numeric = Number.parseFloat(raw);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  return String(clamp(Number(numeric.toFixed(1)), 0, 5));
}

function normaliseTopic(raw) {
  return toTrimmedString(raw).replace(/\s+/g, ' ').slice(0, 60);
}

function normalisePage(raw) {
  return Math.max(COURSE_LIMITS.minPage, Number.parseInt(raw, 10) || COURSE_LIMITS.defaultPage);
}

function normaliseLimit(raw) {
  return clamp(
    Number.parseInt(raw, 10) || COURSE_LIMITS.defaultLimit,
    COURSE_LIMITS.minPage,
    COURSE_LIMITS.maxLimit,
  );
}

function normaliseCourseFilters(query = {}) {
  const platform = normalisePlatform(query.platform);
  const rating = normaliseRating(query.rating);
  const level = normaliseLevel(query.level);
  const topic = normaliseTopic(query.topic || query.skill || query.search);
  const duration = normaliseDuration(query.duration);

  return {
    platform: VALID_PLATFORMS.includes(platform) ? platform : 'All',
    rating,
    level: VALID_LEVELS.includes(level) ? level : 'All',
    topic,
    duration,
    page: normalisePage(query.page),
    limit: normaliseLimit(query.limit),
  };
}

function normaliseExperienceLevel(raw) {
  const value = toTrimmedString(raw);
  return EXPERIENCE_LEVEL_MAP[value] || 'Intermediate';
}

function parseDuration(iso) {
  const match = String(iso || 'PT0S').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  const hours = Number.parseInt(match?.[1] || '0', 10);
  const minutes = Number.parseInt(match?.[2] || '0', 10);
  const seconds = Number.parseInt(match?.[3] || '0', 10);
  return {
    hours,
    minutes,
    totalHours: hours + minutes / 60 + seconds / 3600,
  };
}

// Derived engagement indicator only; never a provider review rating.
function calcYouTubeEngagementScore(views, likes) {
  const safeViews = Number.parseInt(views, 10);
  if (!Number.isFinite(safeViews) || safeViews <= 0) return null;
  const safeLikes = Math.max(0, Number.parseInt(likes, 10) || 0);
  const ratio = safeLikes > 0 ? safeLikes / Math.max(safeViews, 1) : 0;
  const engagementBoost = clamp(ratio * 12, 0, 0.45);
  const popularityBoost = clamp(Math.log10(Math.max(safeViews, 10)) * 0.12, 0, 0.35);
  return Number((4 + engagementBoost + popularityBoost).toFixed(1));
}

function extractTopics(title, description = '') {
  return getMatchedSkills({ title, description, topics: [] }, KNOWN_TOPICS).slice(0, 5);
}
function hasValidCourseUrl(url) {
  return Boolean(safeCourseUrl(url));
}

function ensureTopics(topics = [], title = '', description = '') {
  const directTopics = Array.isArray(topics) ? topics : [];
  const normalized = directTopics
    .map((topic) => toTrimmedString(topic).slice(0, 40))
    .filter(Boolean);

  if (normalized.length) {
    return Array.from(new Set(normalized)).slice(0, 5);
  }

  return extractTopics(title, description);
}

const optionalNumber = (value, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
function normaliseCourse(course = {}) {
  if (!course || typeof course !== 'object') return null;
  const title = toTrimmedString(course.title).slice(0, 200);
  const platform = ['Udemy', 'Coursera', 'YouTube', 'edX', 'freeCodeCamp'].includes(course.platform)
    ? course.platform
    : null;
  const url = platform && safeCourseUrl(course.url, platform);
  if (!title || !platform || !url) return null;
  const key = canonicalCourseKey({ platform, url });
  if (!key) return null;
  const source = ['curated-catalog', 'youtube-api', 'provider'].includes(
    course.metadataSource || course.provenance?.source,
  )
    ? course.metadataSource || course.provenance.source
    : 'provider';
  const rating =
    source === 'youtube-api' || source === 'curated-catalog'
      ? null
      : optionalNumber(course.rating, 0.1, 5);
  const durationHours = optionalNumber(course.durationHours, 0.001, 10000);
  return {
    id: toTrimmedString(course.id).slice(0, 120) || 'course_' + digest(key).slice(0, 24),
    title,
    description: toTrimmedString(course.description).slice(0, 600),
    platform,
    url,
    instructor: toTrimmedString(course.instructor).slice(0, 120) || null,
    rating,
    reviewCount: rating === null ? null : optionalNumber(course.reviewCount),
    duration: durationHours === null ? null : toTrimmedString(course.duration).slice(0, 50) || null,
    durationHours,
    level: ['Beginner', 'Intermediate', 'Advanced', 'All Levels'].includes(course.level)
      ? course.level
      : null,
    thumbnail: /^https:\/\/(?:i\.ytimg\.com|img\.youtube\.com)\//.test(course.thumbnail || '')
      ? course.thumbnail.slice(0, 500)
      : '',
    topics: canonicalSkills(ensureTopics(course.topics, title, course.description), 5),
    popularity: optionalNumber(course.popularity, 0, 100),
    engagementScore: optionalNumber(course.engagementScore, 0, 5),
    viewCount: optionalNumber(course.viewCount),
    likeCount: optionalNumber(course.likeCount),
    provenance: {
      source,
      ratingSource: rating === null ? 'unavailable' : 'provider-reviews',
      popularitySource:
        optionalNumber(course.popularity, 0, 100) === null
          ? 'unavailable'
          : source === 'youtube-api'
            ? 'derived-view-count'
            : 'provider',
      engagementSource:
        optionalNumber(course.engagementScore, 0, 5) === null
          ? 'unavailable'
          : 'derived-views-likes',
      metadataVerifiedAt:
        source === 'youtube-api'
          ? course.provenance?.metadataVerifiedAt || new Date().toISOString()
          : null,
      availability: source === 'youtube-api' ? 'observed' : 'unverified',
      durationSource: durationHours === null ? 'unavailable' : source,
    },
  };
}

function matchesDuration(course, durationFilter) {
  if (!durationFilter || durationFilter === 'All') return true;
  const hours = optionalNumber(course.durationHours, 0.001);
  if (hours === null) return false;
  if (durationFilter === '0-2') return hours <= 2;
  if (durationFilter === '2-10') return hours > 2 && hours <= 10;
  if (durationFilter === '10+') return hours > 10;
  return true;
}

function matchesPlatform(course, platformFilter) {
  if (!platformFilter || platformFilter === 'All') return true;
  if (platformFilter === 'Other') {
    return course.platform === 'edX' || course.platform === 'freeCodeCamp';
  }
  return course.platform === platformFilter;
}

function matchesTopic(course, topicFilter) {
  if (!topicFilter) return true;
  return getMatchedSkills(course, canonicalSkills([topicFilter], 1)).length > 0;
}

function matchesLevel(course, levelFilter) {
  if (!levelFilter || levelFilter === 'All') return true;
  if (course.level === levelFilter) return true;
  if (course.level === 'All Levels') return true;
  return false;
}

function applyCourseFilters(courses = [], filters = {}) {
  const minRating = Number.parseFloat(filters.rating);

  return courses.filter((course) => {
    if (!course) return false;
    if (!matchesPlatform(course, filters.platform)) return false;
    if (Number.isFinite(minRating) && Number(course.rating || 0) < minRating) return false;
    if (!matchesLevel(course, filters.level)) return false;
    if (!matchesTopic(course, filters.topic)) return false;
    if (!matchesDuration(course, filters.duration)) return false;
    return true;
  });
}

function getMatchedSkills(course, skills = []) {
  const haystack =
    `${course.title} ${course.description} ${(course.topics || []).join(' ')}`.toLowerCase();
  return skills
    .map((skill) => toTrimmedString(canonicalSkills([skill], 1)[0] || skill))
    .filter(Boolean)
    .filter((skill) => {
      return skillAliases(skill).some((alias) => {
        const escapedSkill = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const prefix = alias.length <= 2 ? '[^a-z0-9_+#.]' : '[^a-z0-9_+#]';
        return new RegExp(`(?:^|${prefix})${escapedSkill}(?:[^a-z0-9_+#]|$)`, 'i').test(haystack);
      });
    })
    .slice(0, 3);
}

const STACK_TOPICS = {
  Frontend: [
    'JavaScript',
    'TypeScript',
    'React',
    'Angular',
    'Vue',
    'HTML',
    'CSS',
    'Accessibility',
    'Next.js',
  ],
  Backend: [
    'Node.js',
    'Express',
    'SQL',
    'PostgreSQL',
    'MongoDB',
    'Java',
    'Python',
    'C#',
    '.NET',
    'PHP',
    'APIs',
    'GraphQL',
  ],
  'Full Stack': [
    'JavaScript',
    'TypeScript',
    'React',
    'Angular',
    'Vue',
    'HTML',
    'CSS',
    'Node.js',
    'Express',
    'SQL',
    'MongoDB',
    'APIs',
  ],
  'AI/ML': ['Python', 'Machine Learning', 'AI', 'Data Science', 'Statistics', 'SQL'],
};
const matchedCareerSkills = (course, context) =>
  getMatchedSkills(course, [
    ...(STACK_TOPICS[context.careerStack] || []),
    'Git',
    'Testing',
    'Docker',
    'CI/CD',
    'Linux',
  ]);

function computeRelevance(course, context = {}) {
  const missingSkills = Array.isArray(context.skillGaps) ? context.skillGaps : [];
  const knownSkills = Array.isArray(context.knownSkills) ? context.knownSkills : [];
  const stack = toTrimmedString(context.careerStack).toLowerCase();
  const requestedTopic = toTrimmedString(context.topic).toLowerCase();
  const inferredLevel = normaliseExperienceLevel(context.experienceLevel);
  const courseText =
    `${course.title} ${course.description} ${(course.topics || []).join(' ')}`.toLowerCase();

  let score = 25;
  const matchedGaps = getMatchedSkills(course, missingSkills);
  const matchedKnown = getMatchedSkills(course, knownSkills);

  score += matchedGaps.length * 18;
  score += matchedKnown.length * 4;

  if (stack && (courseText.includes(stack) || matchedCareerSkills(course, context).length))
    score += 10;
  if (requestedTopic && matchesTopic(course, requestedTopic)) score += 14;

  if (course.level === inferredLevel) score += 12;
  else if (course.level === 'All Levels') score += 6;

  if (course.durationHours > 0 && course.durationHours <= 10 && inferredLevel === 'Beginner')
    score += 6;
  if (course.durationHours > 10 && inferredLevel === 'Advanced') score += 4;

  return clamp(Math.round(score), 0, 100);
}

function buildWhyRecommended(course, context = {}) {
  const matchedGaps = getMatchedSkills(course, context.skillGaps || []);
  const requestedTopic = toTrimmedString(context.topic);
  const reasons = [];

  if (matchedGaps.length) {
    reasons.push(`Learning/evidence review targets: ${matchedGaps.join(', ')}`);
  }

  if (requestedTopic && matchesTopic(course, requestedTopic)) {
    reasons.push(`Matches your ${requestedTopic} filter`);
  }

  if (course.level === normaliseExperienceLevel(context.experienceLevel)) {
    reasons.push(`Fits your ${context.experienceLevel} learning stage`);
  }

  const careerSkills = matchedCareerSkills(course, context);
  if (careerSkills.length)
    reasons.push(`Covers ${careerSkills.join(', ')} for your ${context.careerStack} track`);

  if (!reasons.length) {
    reasons.push('Catalog option for your selected career context');
  }

  return reasons.slice(0, 2).join(' • ');
}

function scoreAndRank(courses = [], context = {}) {
  return courses
    .map((course) => {
      const relevanceScore = computeRelevance(course, context);
      const hasRating = Number.isFinite(Number(course.rating)) && Number(course.rating) > 0;
      const popularity = Number(course.popularity || 0);
      const finalScore = hasRating
        ? Math.round(
            (Number(course.rating) / 5) * 100 * 0.38 + popularity * 0.28 + relevanceScore * 0.34,
          )
        : Math.round(popularity * 0.45 + relevanceScore * 0.55);

      return {
        ...course,
        relevanceScore,
        finalScore,
        matchedCareerSkills: matchedCareerSkills(course, context),
        matchedRequiredTargets: getMatchedSkills(
          course,
          (context.targets || [])
            .filter((item) => item.requirement === 'REQUIRED' && item.status !== 'DEMONSTRATED')
            .map((item) => item.name),
        ),
        matchedTargets: getMatchedSkills(course, context.skillGaps || []),
        whyRecommended: buildWhyRecommended(course, context),
      };
    })
    .sort(
      (left, right) =>
        right.matchedRequiredTargets.length - left.matchedRequiredTargets.length ||
        right.matchedTargets.length - left.matchedTargets.length ||
        Number(right.matchedCareerSkills.length > 0) -
          Number(left.matchedCareerSkills.length > 0) ||
        right.finalScore - left.finalScore ||
        left.id.localeCompare(right.id, 'en'),
    );
}

async function requestYouTubeCourses(query, maxResults = 20, options = {}) {
  const cacheKey = `${digest(process.env.YOUTUBE_API_KEY || '')}:${toTrimmedString(query).toLowerCase()}|${Math.min(50, Math.max(1, maxResults))}`;
  const now = Date.now();
  const cached = youtubeCache.get(cacheKey);
  if (!options.forceRefresh && cached && cached.expiresAt > now) {
    youtubeCache.delete(cacheKey);
    youtubeCache.set(cacheKey, cached);
    return { ...cached.result, fromCache: true };
  }
  if (cached) youtubeCache.delete(cacheKey);

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || apiKey === 'your_youtube_api_key') {
    console.warn('[CourseService] YOUTUBE_API_KEY not set. Skipping YouTube source.');
    return {
      courses: [],
      status: 'unavailable',
      reason: 'YouTube is not configured. Showing ranked provider alternatives.',
      fromCache: false,
    };
  }

  if (youtubeCircuitOpenUntil > now) {
    return {
      courses: [],
      status: 'circuit-open',
      reason: 'YouTube is temporarily unavailable. Showing ranked provider alternatives.',
      fromCache: false,
    };
  }

  try {
    const [longResponse, mediumResponse] = await Promise.allSettled([
      axios.get(`${YOUTUBE_API_BASE}/search`, {
        params: {
          part: 'snippet',
          type: 'video',
          q: `${query} full course tutorial`,
          maxResults: Math.min(50, maxResults + 20),
          relevanceLanguage: 'en',
          videoDuration: 'long',
          key: apiKey,
        },
        timeout: 10000,
      }),
      axios.get(`${YOUTUBE_API_BASE}/search`, {
        params: {
          part: 'snippet',
          type: 'video',
          q: `${query} tutorial crash course guide`,
          maxResults: Math.min(50, maxResults + 15),
          relevanceLanguage: 'en',
          videoDuration: 'medium',
          key: apiKey,
        },
        timeout: 10000,
      }),
    ]);

    const seenIds = new Set();
    const videoIds = [];

    for (const response of [longResponse, mediumResponse]) {
      if (response.status !== 'fulfilled') continue;

      for (const item of response.value.data.items || []) {
        const videoId = item.id?.videoId;
        if (videoId && !seenIds.has(videoId)) {
          seenIds.add(videoId);
          videoIds.push(videoId);
        }
      }
    }

    if (!videoIds.length) {
      if ([longResponse, mediumResponse].some((result) => result.status === 'rejected'))
        throw new Error('YouTube search failed');
      youtubeFailureCount = 0;
      youtubeCircuitOpenUntil = 0;
      const emptyResult = {
        courses: [],
        status: 'available',
        reason: 'YouTube returned no matching courses.',
        fromCache: false,
      };
      setYouTubeCache(cacheKey, emptyResult, YOUTUBE_FAILURE_TTL_MS);
      return emptyResult;
    }

    const detailsResponse = await axios.get(`${YOUTUBE_API_BASE}/videos`, {
      params: {
        part: 'snippet,contentDetails,statistics',
        id: videoIds.slice(0, 50).join(','),
        key: apiKey,
      },
      timeout: 10000,
    });

    const courses = (detailsResponse.data.items || [])
      .map((item, index) => {
        const snippet = item.snippet || {};
        const statistics = item.statistics || {};
        const durationMeta = parseDuration(item.contentDetails?.duration || 'PT0S');

        if (durationMeta.totalHours < 0.13) return null;

        const views = Number.parseInt(statistics.viewCount || '0', 10);
        const likes = Number.parseInt(statistics.likeCount || '0', 10);
        const duration =
          durationMeta.hours > 0
            ? `${durationMeta.hours}h ${String(durationMeta.minutes).padStart(2, '0')}m`
            : `${durationMeta.minutes}m`;

        return normaliseCourse(
          {
            id: `yt_${item.id}`,
            title: snippet.title,
            description: (snippet.description || '').slice(0, 240),
            platform: 'YouTube',
            instructor: snippet.channelTitle || null,
            rating: null,
            reviewCount: null,
            engagementScore: calcYouTubeEngagementScore(views, likes),
            viewCount: optionalNumber(Number.parseInt(statistics.viewCount, 10)),
            likeCount: optionalNumber(Number.parseInt(statistics.likeCount, 10)),
            metadataSource: 'youtube-api',
            duration,
            durationHours: Number(durationMeta.totalHours.toFixed(2)),
            level: null,
            thumbnail:
              snippet.thumbnails?.medium?.url ||
              snippet.thumbnails?.high?.url ||
              snippet.thumbnails?.default?.url ||
              '',
            url: `https://www.youtube.com/watch?v=${item.id}`,
            topics: extractTopics(snippet.title, snippet.description),
            popularity: Number.isFinite(Number.parseInt(statistics.viewCount, 10))
              ? Math.min(100, Math.max(0, Math.round((views / 200000) * 100)))
              : null,
          },
          index,
        );
      })
      .filter(Boolean)
      .slice(0, maxResults);

    youtubeFailureCount = 0;
    youtubeCircuitOpenUntil = 0;
    const result = { courses, status: 'available', reason: '', fromCache: false };
    setYouTubeCache(cacheKey, result, YOUTUBE_CACHE_TTL_MS);
    return result;
  } catch (error) {
    console.warn('[CourseService] YouTube request failed; using source fallback.');
    youtubeFailureCount += 1;
    if (youtubeFailureCount >= YOUTUBE_FAILURE_THRESHOLD) {
      youtubeCircuitOpenUntil = Date.now() + YOUTUBE_CIRCUIT_TTL_MS;
      youtubeFailureCount = 0;
    }
    const result = {
      courses: [],
      status: youtubeCircuitOpenUntil > Date.now() ? 'circuit-open' : 'unavailable',
      reason: 'YouTube could not be reached. Showing ranked provider alternatives.',
      fromCache: false,
    };
    setYouTubeCache(cacheKey, result, YOUTUBE_FAILURE_TTL_MS);
    return result;
  }
}

function setYouTubeCache(key, result, ttlMs) {
  if (youtubeCache.has(key)) youtubeCache.delete(key);
  youtubeCache.set(key, { result, expiresAt: Date.now() + ttlMs });
  while (youtubeCache.size > YOUTUBE_CACHE_MAX_ENTRIES) {
    youtubeCache.delete(youtubeCache.keys().next().value);
  }
}

function buildFallbackPool(platform = 'All', count = 20) {
  const allCourses = require('../data/courseCatalog')
    .map((course) => ({
      ...course,
      rating: null,
      reviewCount: null,
      duration: null,
      durationHours: null,
      popularity: null,
      metadataSource: 'curated-catalog',
    }))
    .map((course, index) => normaliseCourse(course, index))
    .filter(Boolean);

  let pool = allCourses;
  if (platform === 'Other') {
    pool = allCourses.filter(
      (course) => course.platform === 'edX' || course.platform === 'freeCodeCamp',
    );
  } else if (platform && platform !== 'All' && platform !== 'YouTube') {
    pool = allCourses.filter((course) => course.platform === platform);
  }

  return pool.slice(0, count);
}

function dedupeCourses(courses = []) {
  const seen = new Set();
  return courses.filter((course) => {
    const key = canonicalCourseKey(course);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isPersistableCoursePool(courses = []) {
  if (!Array.isArray(courses) || !courses.length) return false;
  return courses.every(
    (course) =>
      course &&
      toTrimmedString(course.id) &&
      toTrimmedString(course.title) &&
      Boolean(safeCourseUrl(course.url, course.platform)) &&
      ['Udemy', 'Coursera', 'YouTube', 'edX', 'freeCodeCamp'].includes(course.platform),
  );
}

const sanitizeSkillList = canonicalSkills;
const fetchYouTubeCourses = (query, maxResults = 20, options = {}) => {
  const key = `${process.env.YOUTUBE_API_KEY || 'unconfigured'}:${query}:${maxResults}:${!!options.forceRefresh}`;
  if (youtubeInflight.has(key)) return youtubeInflight.get(key);
  const pending = requestYouTubeCourses(query, maxResults, options).finally(() =>
    youtubeInflight.delete(key),
  );
  youtubeInflight.set(key, pending);
  return pending;
};
const clearYouTubeCache = () => {
  youtubeCache.clear();
  youtubeFailureCount = 0;
  youtubeCircuitOpenUntil = 0;
};

async function buildCoursePoolWithMetadata(options = {}) {
  const filters = normaliseCourseFilters(options);
  const careerStack = toTrimmedString(options.careerStack) || 'Full Stack';
  const experienceLevel = toTrimmedString(options.experienceLevel) || 'Student';
  const skillGaps = sanitizeSkillList(options.skillGaps, 12);
  const knownSkills = sanitizeSkillList(options.knownSkills, 20);
  const query = filters.topic
    ? `${filters.topic} ${careerStack}`
    : `${careerStack} ${skillGaps.slice(0, 3).join(' ')} programming`.trim();

  const youtubeCount = COURSE_POOL_SIZE[filters.platform] ?? 0;
  const curatedCount = filters.platform === 'YouTube' ? 0 : 80;
  const rankingContext = {
    careerStack,
    experienceLevel,
    skillGaps,
    knownSkills,
    topic: filters.topic,
    targets: options.targets || [],
  };

  const [youtubeResult, curatedCourses] = await Promise.all([
    youtubeCount > 0
      ? fetchYouTubeCourses(query, youtubeCount, { forceRefresh: options.forceRefresh })
      : Promise.resolve({ courses: [], status: 'not-requested', reason: '', fromCache: false }),
    Promise.resolve(buildFallbackPool(filters.platform, curatedCount)),
  ]);

  let pool = dedupeCourses([...youtubeResult.courses, ...curatedCourses].filter(Boolean));
  pool = applyCourseFilters(pool, filters);
  const fallbackUsed = youtubeCount > 0 && youtubeResult.status !== 'available';

  pool = scoreAndRank(pool, rankingContext).map((course) => ({
    ...course,
    platformColor: PLATFORM_COLORS[course.platform] || PLATFORM_COLORS.Udemy,
  }));

  // Preserve global ranking across pages; platform quotas previously displaced relevant results.

  return {
    courses: pool,
    sourceMetadata: {
      source: fallbackUsed
        ? 'curated-fallback'
        : youtubeResult.courses.length
          ? 'mixed'
          : 'curated',
      youtubeStatus: youtubeResult.fromCache ? 'cached' : youtubeResult.status,
      fallbackUsed,
      sourceMessage: fallbackUsed
        ? filters.platform === 'YouTube'
          ? 'YouTube is unavailable. No courses match this platform; select All for catalog alternatives.'
          : youtubeResult.reason || 'YouTube is unavailable. Showing ranked provider alternatives.'
        : youtubeResult.fromCache
          ? 'YouTube results were reused from the provider cache.'
          : '',
    },
  };
}

// Explicit public DTO: cached Mixed documents must not leak additional fields.
function publicCourse(course) {
  const normalized = normaliseCourse(course);
  if (!normalized) return null;
  return {
    ...normalized,
    relevanceScore: optionalNumber(course.relevanceScore, 0, 100),
    finalScore: optionalNumber(course.finalScore, 0, 100),
    whyRecommended: toTrimmedString(course.whyRecommended).slice(0, 400),
    matchedRequiredTargets: canonicalSkills(course.matchedRequiredTargets, 3),
    matchedTargets: canonicalSkills(course.matchedTargets, 3),
    matchedCareerSkills: canonicalSkills(course.matchedCareerSkills, 3),
    platformColor: PLATFORM_COLORS[normalized.platform],
  };
}

async function buildCoursePool(options = {}) {
  const result = await buildCoursePoolWithMetadata(options);
  return result.courses;
}

module.exports = {
  providerConfigurationFingerprint: () => digest(process.env.YOUTUBE_API_KEY || ''),
  publicCourse,
  buildCoursePool,
  buildCoursePoolWithMetadata,
  normaliseCourseFilters,
  normaliseCourse,
  calcYouTubeEngagementScore,
  calcYouTubeRating: calcYouTubeEngagementScore, // Legacy helper export; not assigned to rating.
  scoreAndRank,
  applyCourseFilters,
  isPersistableCoursePool,
  sanitizeSkillList,
  hasValidCourseUrl,
  buildFallbackPool,
  dedupeCourses,
  fetchYouTubeCourses,
  clearYouTubeCache,
};
