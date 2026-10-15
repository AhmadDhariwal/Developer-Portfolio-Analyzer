// Synthetic HTTP fixtures for browser verification, never production learning evidence.
const {
  buildFallbackPool,
  scoreAndRank,
  applyCourseFilters,
} = require('../../backend/src/services/courseService');
const { profile } = require('./skill-gap-browser-fixture.cjs');
const targets = [{ name: 'SQL', requirement: 'REQUIRED', status: 'NOT_EVIDENCED' }];
const catalog = scoreAndRank(
  [
    {
      id: 'yt_abcdefghijk',
      title:
        'SQL tutorial: a deliberately long video title to verify readable wrapping on narrow mobile screens',
      platform: 'YouTube',
      instructor: 'Synthetic instructor',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
      topics: ['SQL'],
      description: 'Synthetic provider example for browser verification.',
      rating: null,
      reviewCount: null,
      engagementScore: 4.2,
      viewCount: 0,
      likeCount: 0,
      duration: '1h 20m',
      durationHours: 1.33,
      level: null,
      thumbnail: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
      provenance: {
        source: 'youtube-api',
        availability: 'observed',
        metadataVerifiedAt: '2026-10-14T00:00:00Z',
        ratingSource: 'unavailable',
        engagementSource: 'derived-views-likes',
      },
    },
    {
      id: 'course_123456789012345678901234',
      title: 'SQL provider-reviewed course (synthetic)',
      platform: 'Udemy',
      url: 'https://www.udemy.com/course/sql-browser-fixture/',
      topics: ['SQL'],
      rating: 4.7,
      reviewCount: 25,
      level: 'Beginner',
      duration: '12h',
      durationHours: 12,
      provenance: {
        source: 'provider',
        availability: 'unverified',
        ratingSource: 'provider-reviews',
        metadataVerifiedAt: null,
      },
    },
    ...buildFallbackPool('All', 100),
  ],
  {
    careerStack: profile.careerStack,
    experienceLevel: profile.experienceLevel,
    skillGaps: ['SQL'],
    targets,
  },
);
const personalization = {
  status: 'evidence-informed',
  ruleVersion: 'skill-evidence-coverage-v1',
  targets,
  limitation:
    'Available evidence may be incomplete. Missing evidence does not establish inability.',
};
function discover(params, mode) {
  const filters = Object.fromEntries(params);
  const page = Number(params.get('page') || 1),
    limit = Number(params.get('limit') || 10);
  const pool =
    mode === 'empty'
      ? []
      : applyCourseFilters(
          catalog.filter((course) => mode !== 'fallback' || course.platform !== 'YouTube'),
          filters,
        );
  return {
    courses: pool.slice((page - 1) * limit, page * limit),
    total: pool.length,
    page,
    totalPages: Math.max(1, Math.ceil(pool.length / limit)),
    hasMore: page * limit < pool.length,
    fromCache: mode === 'cached',
    personalization:
      mode === 'evidence-unavailable'
        ? {
            ...personalization,
            status: 'career-context-only',
            targets: [],
            limitation: 'Skill evidence is unavailable or incompatible; using career context only.',
          }
        : personalization,
    recommendedBasedOn: {
      careerStack: profile.careerStack,
      experienceLevel: profile.experienceLevel,
      skillGapsUsed: ['SQL'],
      activeFilters: filters,
      summary: 'Courses align with your Backend career context and recorded SQL target.',
      source: mode === 'fallback' ? 'curated-fallback' : 'mixed',
      fallbackUsed: mode === 'fallback',
      youtubeStatus: mode === 'fallback' ? 'unavailable' : 'available',
      sourceMessage:
        mode === 'fallback' ? 'YouTube is unavailable. Showing ranked provider alternatives.' : '',
      fromCache: mode === 'cached',
    },
    cacheMetadata: {
      cacheLayer: mode === 'cached' ? 'mongo' : 'miss',
      loadedFromCache: mode === 'cached',
    },
  };
}
module.exports = { catalog, profile, discover };
