const axios = require('axios');

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const COURSE_POOL_SIZE = {
  All: 30,
  YouTube: 40
};
const COURSE_LIMITS = {
  minPage: 1,
  defaultPage: 1,
  defaultLimit: 10,
  maxLimit: 20
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
  '': 'All'
};

const PLATFORM_COLORS = {
  Udemy: { bg: '#a435f0', text: '#ffffff' },
  Coursera: { bg: '#0056d2', text: '#ffffff' },
  edX: { bg: '#02262b', text: '#ffffff' },
  freeCodeCamp: { bg: '#006400', text: '#ffffff' },
  YouTube: { bg: '#ff0000', text: '#ffffff' }
};

const KNOWN_TOPICS = [
  'JavaScript', 'TypeScript', 'Python', 'React', 'Angular', 'Vue', 'Node.js', 'Express',
  'MongoDB', 'SQL', 'PostgreSQL', 'Docker', 'Kubernetes', 'AWS', 'GCP', 'Azure', 'Git',
  'HTML', 'CSS', 'Redux', 'GraphQL', 'REST', 'API', 'Testing', 'CI/CD', 'Linux',
  'System Design', 'Data Structures', 'Algorithms', 'Machine Learning', 'AI', 'Java',
  'C#', '.NET', 'PHP', 'Django', 'FastAPI', 'Spring', 'Next.js', 'Tailwind', 'Flutter'
];

const EXPERIENCE_LEVEL_MAP = {
  Student: 'Beginner',
  Intern: 'Beginner',
  '0-1 years': 'Beginner',
  '1-2 years': 'Intermediate',
  '2-3 years': 'Intermediate',
  '3-5 years': 'Advanced',
  '5+ years': 'Advanced'
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
  if (value.includes('edx') || value.includes('freecodecamp') || value.includes('free code') || value === 'other') {
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
    COURSE_LIMITS.maxLimit
  );
}

function normaliseCourseFilters(query = {}) {
  const platform = normalisePlatform(query.platform);
  const rating = normaliseRating(query.rating);
  const level = normaliseLevel(query.level);
  const topic = normaliseTopic(query.topic);
  const duration = normaliseDuration(query.duration);

  return {
    platform: VALID_PLATFORMS.includes(platform) ? platform : 'All',
    rating,
    level: VALID_LEVELS.includes(level) ? level : 'All',
    topic,
    duration,
    page: normalisePage(query.page),
    limit: normaliseLimit(query.limit)
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
    totalHours: hours + (minutes / 60) + (seconds / 3600)
  };
}

function calcYouTubeRating(views, likes) {
  if (!views) return 4.1;
  const ratio = likes > 0 ? likes / Math.max(views, 1) : 0;
  const engagementBoost = clamp(ratio * 12, 0, 0.45);
  const popularityBoost = clamp(Math.log10(Math.max(views, 10)) * 0.12, 0, 0.35);
  return Number((4 + engagementBoost + popularityBoost).toFixed(1));
}

function extractTopics(title, description = '') {
  const haystack = `${title} ${description}`.toLowerCase();
  return KNOWN_TOPICS.filter((topic) => haystack.includes(topic.toLowerCase())).slice(0, 5);
}

function buildFallbackUrl(course = {}) {
  const query = `${course.title || 'software engineering course'} ${course.platform || ''}`.trim();
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function ensureTopics(topics = [], title = '', description = '') {
  const directTopics = Array.isArray(topics) ? topics : [];
  const normalized = directTopics
    .map((topic) => toTrimmedString(topic))
    .filter(Boolean);

  if (normalized.length) {
    return Array.from(new Set(normalized)).slice(0, 5);
  }

  return extractTopics(title, description);
}

function normaliseCourse(course = {}, index = 0) {
  const title = toTrimmedString(course.title) || `Recommended Course ${index + 1}`;
  const description = toTrimmedString(course.description) || 'Strengthen your developer profile with guided learning and hands-on practice.';
  const platform = course.platform === 'edX' || course.platform === 'freeCodeCamp'
    ? course.platform
    : normalisePlatform(course.platform) === 'Other'
      ? 'edX'
      : normalisePlatform(course.platform);
  const safePlatform = ['Udemy', 'Coursera', 'YouTube', 'edX', 'freeCodeCamp'].includes(platform)
    ? platform
    : 'Udemy';
  const rating = clamp(Number.parseFloat(course.rating) || 4.1, 0, 5);
  const reviewCount = Math.max(0, Number.parseInt(course.reviewCount, 10) || 0);
  const durationHours = Math.max(0, Number(course.durationHours) || 0);
  const duration = toTrimmedString(course.duration)
    || (durationHours ? `${durationHours.toFixed(durationHours >= 10 ? 0 : 1)}h` : 'Self-paced');
  const level = ['Beginner', 'Intermediate', 'Advanced'].includes(course.level)
    ? course.level
    : 'All Levels';
  const url = /^https?:\/\//i.test(toTrimmedString(course.url)) ? toTrimmedString(course.url) : buildFallbackUrl({ title, platform: safePlatform });
  const topics = ensureTopics(course.topics, title, description);
  const popularity = clamp(Number(course.popularity) || 50, 10, 100);

  return {
    id: toTrimmedString(course.id) || `course_${safePlatform.toLowerCase()}_${index + 1}`,
    title,
    description,
    platform: safePlatform,
    instructor: toTrimmedString(course.instructor) || safePlatform,
    rating: Number(rating.toFixed(1)),
    reviewCount,
    duration,
    durationHours: Number(durationHours.toFixed(2)),
    level,
    thumbnail: toTrimmedString(course.thumbnail),
    url,
    topics,
    popularity
  };
}

function matchesDuration(course, durationFilter) {
  if (!durationFilter || durationFilter === 'All') return true;
  const hours = Number(course.durationHours || 0);
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
  const topic = topicFilter.toLowerCase();
  return [course.title, course.description, ...(course.topics || [])]
    .some((value) => String(value || '').toLowerCase().includes(topic));
}

function applyCourseFilters(courses = [], filters = {}) {
  const minRating = Number.parseFloat(filters.rating);

  return courses.filter((course) => {
    if (!course) return false;
    if (!matchesPlatform(course, filters.platform)) return false;
    if (Number.isFinite(minRating) && Number(course.rating || 0) < minRating) return false;
    if (filters.level && filters.level !== 'All' && course.level !== filters.level) return false;
    if (!matchesTopic(course, filters.topic)) return false;
    if (!matchesDuration(course, filters.duration)) return false;
    return true;
  });
}

function getMatchedSkills(course, skills = []) {
  const haystack = `${course.title} ${course.description} ${(course.topics || []).join(' ')}`.toLowerCase();
  return skills
    .map((skill) => toTrimmedString(skill))
    .filter(Boolean)
    .filter((skill) => haystack.includes(skill.toLowerCase()))
    .slice(0, 3);
}

function computeRelevance(course, context = {}) {
  const missingSkills = Array.isArray(context.skillGaps) ? context.skillGaps : [];
  const knownSkills = Array.isArray(context.knownSkills) ? context.knownSkills : [];
  const stack = toTrimmedString(context.careerStack).toLowerCase();
  const requestedTopic = toTrimmedString(context.topic).toLowerCase();
  const inferredLevel = normaliseExperienceLevel(context.experienceLevel);
  const courseText = `${course.title} ${course.description} ${(course.topics || []).join(' ')}`.toLowerCase();

  let score = 25;
  const matchedGaps = getMatchedSkills(course, missingSkills);
  const matchedKnown = getMatchedSkills(course, knownSkills);

  score += matchedGaps.length * 18;
  score += matchedKnown.length * 4;

  if (stack && courseText.includes(stack)) score += 10;
  if (requestedTopic && courseText.includes(requestedTopic)) score += 14;

  if (course.level === inferredLevel) score += 12;
  else if (course.level === 'All Levels') score += 6;

  if (course.durationHours > 0 && course.durationHours <= 10 && inferredLevel === 'Beginner') score += 6;
  if (course.durationHours > 10 && inferredLevel === 'Advanced') score += 4;

  return clamp(Math.round(score), 0, 100);
}

function buildWhyRecommended(course, context = {}) {
  const matchedGaps = getMatchedSkills(course, context.skillGaps || []);
  const requestedTopic = toTrimmedString(context.topic);
  const reasons = [];

  if (matchedGaps.length) {
    reasons.push(`Targets ${matchedGaps.join(', ')}`);
  }

  if (requestedTopic && matchesTopic(course, requestedTopic)) {
    reasons.push(`Matches your ${requestedTopic} filter`);
  }

  if (course.level === normaliseExperienceLevel(context.experienceLevel)) {
    reasons.push(`Fits your ${context.experienceLevel} learning stage`);
  }

  if (toTrimmedString(context.careerStack) && `${course.title} ${(course.topics || []).join(' ')}`.toLowerCase().includes(toTrimmedString(context.careerStack).toLowerCase())) {
    reasons.push(`Aligned with your ${context.careerStack} track`);
  }

  if (!reasons.length) {
    reasons.push('Supports your current career path with practical skill coverage');
  }

  return reasons.slice(0, 2).join(' • ');
}

function scoreAndRank(courses = [], context = {}) {
  return courses
    .map((course) => {
      const relevanceScore = computeRelevance(course, context);
      const finalScore = Math.round(
        ((Number(course.rating || 0) / 5) * 100 * 0.38)
        + (Number(course.popularity || 0) * 0.28)
        + (relevanceScore * 0.34)
      );

      return {
        ...course,
        relevanceScore,
        finalScore,
        whyRecommended: buildWhyRecommended(course, context)
      };
    })
    .sort((left, right) => Number(right.finalScore || 0) - Number(left.finalScore || 0));
}

function toMixBucket(course) {
  if (course.platform === 'Udemy') return 'Udemy';
  if (course.platform === 'YouTube') return 'YouTube';
  if (course.platform === 'Coursera') return 'Coursera';
  return 'Other';
}

function blendDefaultPlatformPages(courses = []) {
  const quotas = { Udemy: 3, YouTube: 3, Coursera: 2, Other: 2 };
  const buckets = { Udemy: [], YouTube: [], Coursera: [], Other: [] };

  for (const course of courses) {
    buckets[toMixBucket(course)].push(course);
  }

  const takeFromBucket = (bucketName, count) => {
    const output = [];
    while (output.length < count && buckets[bucketName].length) {
      output.push(buckets[bucketName].shift());
    }
    return output;
  };

  const takeBestRemaining = () => {
    const bucketNames = ['Udemy', 'YouTube', 'Coursera', 'Other'];
    let bestBucket = null;
    let bestScore = -1;

    for (const bucketName of bucketNames) {
      const candidate = buckets[bucketName][0];
      if (!candidate) continue;
      const score = Number(candidate.finalScore || 0);
      if (score > bestScore) {
        bestScore = score;
        bestBucket = bucketName;
      }
    }

    return bestBucket ? buckets[bestBucket].shift() : null;
  };

  const mixed = [];
  while (mixed.length < courses.length) {
    const page = [
      ...takeFromBucket('Udemy', quotas.Udemy),
      ...takeFromBucket('YouTube', quotas.YouTube),
      ...takeFromBucket('Coursera', quotas.Coursera),
      ...takeFromBucket('Other', quotas.Other)
    ];

    while (page.length < 10) {
      const extra = takeBestRemaining();
      if (!extra) break;
      page.push(extra);
    }

    if (!page.length) break;
    mixed.push(...page);
  }

  return mixed;
}

async function fetchYouTubeCourses(query, maxResults = 20) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || apiKey === 'your_youtube_api_key') {
    console.warn('[CourseService] YOUTUBE_API_KEY not set. Skipping YouTube source.');
    return [];
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
          key: apiKey
        },
        timeout: 10000
      }),
      axios.get(`${YOUTUBE_API_BASE}/search`, {
        params: {
          part: 'snippet',
          type: 'video',
          q: `${query} tutorial crash course guide`,
          maxResults: Math.min(50, maxResults + 15),
          relevanceLanguage: 'en',
          videoDuration: 'medium',
          key: apiKey
        },
        timeout: 10000
      })
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

    if (!videoIds.length) return [];

    const detailsResponse = await axios.get(`${YOUTUBE_API_BASE}/videos`, {
      params: {
        part: 'snippet,contentDetails,statistics',
        id: videoIds.slice(0, 50).join(','),
        key: apiKey
      },
      timeout: 10000
    });

    return (detailsResponse.data.items || [])
      .map((item, index) => {
        const snippet = item.snippet || {};
        const statistics = item.statistics || {};
        const durationMeta = parseDuration(item.contentDetails?.duration || 'PT0S');

        if (durationMeta.totalHours < 0.13) return null;

        const views = Number.parseInt(statistics.viewCount || '0', 10);
        const likes = Number.parseInt(statistics.likeCount || '0', 10);
        const duration = durationMeta.hours > 0
          ? `${durationMeta.hours}h ${String(durationMeta.minutes).padStart(2, '0')}m`
          : `${durationMeta.minutes}m`;

        return normaliseCourse({
          id: `yt_${item.id}`,
          title: snippet.title,
          description: (snippet.description || '').slice(0, 240),
          platform: 'YouTube',
          instructor: snippet.channelTitle || 'YouTube',
          rating: calcYouTubeRating(views, likes),
          reviewCount: likes,
          duration,
          durationHours: Number(durationMeta.totalHours.toFixed(2)),
          level: 'All Levels',
          thumbnail: snippet.thumbnails?.medium?.url || snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || '',
          url: `https://www.youtube.com/watch?v=${item.id}`,
          topics: extractTopics(snippet.title, snippet.description),
          popularity: Math.min(100, Math.max(10, Math.round((views / 200000) * 100)))
        }, index);
      })
      .filter(Boolean)
      .slice(0, maxResults);
  } catch (error) {
    console.error('[CourseService] YouTube API error:', error.response?.data?.error?.message || error.message);
    return [];
  }
}

function buildFallbackPool(platform = 'All', count = 20) {
  const allCourses = [
    { id: 'fb_u1', title: 'The Complete JavaScript Course 2024: From Zero to Expert!', platform: 'Udemy', instructor: 'Jonas Schmedtmann', rating: 4.7, reviewCount: 180000, duration: '68h 30m', durationHours: 68.5, level: 'Beginner', url: 'https://www.udemy.com/course/the-complete-javascript-course/', topics: ['JavaScript', 'ES6', 'OOP'], popularity: 95, description: 'Master modern JavaScript with ES6+, OOP, closures, async and project-based practice.', thumbnail: '' },
    { id: 'fb_u2', title: 'Node.js, Express, MongoDB & More: The Complete Bootcamp', platform: 'Udemy', instructor: 'Jonas Schmedtmann', rating: 4.8, reviewCount: 95000, duration: '42h 15m', durationHours: 42.25, level: 'Intermediate', url: 'https://www.udemy.com/course/nodejs-express-mongodb-bootcamp/', topics: ['Node.js', 'Express', 'MongoDB'], popularity: 90, description: 'Complete Node.js backend development course covering REST APIs, authentication, security, and deployment.', thumbnail: '' },
    { id: 'fb_u3', title: 'Docker & Kubernetes: The Practical Guide', platform: 'Udemy', instructor: 'Maximilian Schwarzmuller', rating: 4.7, reviewCount: 52000, duration: '24h 00m', durationHours: 24, level: 'Intermediate', url: 'https://www.udemy.com/course/docker-kubernetes-the-practical-guide/', topics: ['Docker', 'Kubernetes', 'DevOps'], popularity: 85, description: 'Learn Docker and Kubernetes with hands-on examples including deployments and production workflows.', thumbnail: '' },
    { id: 'fb_u4', title: 'Angular - The Complete Guide (2024 Edition)', platform: 'Udemy', instructor: 'Maximilian Schwarzmuller', rating: 4.6, reviewCount: 130000, duration: '35h 00m', durationHours: 35, level: 'Beginner', url: 'https://www.udemy.com/course/the-complete-guide-to-angular-2/', topics: ['Angular', 'TypeScript', 'RxJS'], popularity: 88, description: 'Build production-ready Angular apps with components, routing, state management, and reactive forms.', thumbnail: '' },
    { id: 'fb_u5', title: 'React - The Complete Guide', platform: 'Udemy', instructor: 'Maximilian Schwarzmuller', rating: 4.7, reviewCount: 190000, duration: '49h 00m', durationHours: 49, level: 'Beginner', url: 'https://www.udemy.com/course/react-the-complete-guide-incl-redux/', topics: ['React', 'Redux', 'Hooks'], popularity: 96, description: 'Master React, hooks, modern routing, and production patterns with multiple real-world projects.', thumbnail: '' },
    { id: 'fb_u6', title: 'Python Bootcamp: Go from Zero to Hero in Python 3', platform: 'Udemy', instructor: 'Jose Portilla', rating: 4.6, reviewCount: 480000, duration: '22h 00m', durationHours: 22, level: 'Beginner', url: 'https://www.udemy.com/course/complete-python-bootcamp/', topics: ['Python', 'OOP', 'Scripting'], popularity: 92, description: 'Comprehensive Python course covering fundamentals, object-oriented programming, and automation projects.', thumbnail: '' },
    { id: 'fb_u7', title: 'GraphQL with React: The Complete Developers Guide', platform: 'Udemy', instructor: 'Stephen Grider', rating: 4.5, reviewCount: 31000, duration: '13h 00m', durationHours: 13, level: 'Intermediate', url: 'https://www.udemy.com/course/graphql-with-react-course/', topics: ['GraphQL', 'React', 'APIs'], popularity: 78, description: 'Build full-stack GraphQL apps with React, Apollo, schema design, and data modeling.', thumbnail: '' },
    { id: 'fb_c1', title: 'Google IT Automation with Python Professional Certificate', platform: 'Coursera', instructor: 'Google', rating: 4.8, reviewCount: 120000, duration: '32h 00m', durationHours: 32, level: 'Beginner', url: 'https://www.coursera.org/professional-certificates/google-it-automation', topics: ['Python', 'Automation', 'Git'], popularity: 88, description: 'Professional certificate covering Python scripting, version control, automation, and problem solving.', thumbnail: '' },
    { id: 'fb_c2', title: 'IBM Full Stack Software Developer Professional Certificate', platform: 'Coursera', instructor: 'IBM', rating: 4.6, reviewCount: 75000, duration: '60h 00m', durationHours: 60, level: 'Beginner', url: 'https://www.coursera.org/professional-certificates/ibm-full-stack-javascript-developer', topics: ['JavaScript', 'React', 'Node.js', 'Docker'], popularity: 82, description: 'IBM certificate covering frontend, backend, cloud-native tools, and interview prep.', thumbnail: '' },
    { id: 'fb_c3', title: 'Deep Learning Specialization', platform: 'Coursera', instructor: 'Andrew Ng', rating: 4.9, reviewCount: 180000, duration: '80h 00m', durationHours: 80, level: 'Intermediate', url: 'https://www.coursera.org/specializations/deep-learning', topics: ['Machine Learning', 'AI', 'Python'], popularity: 94, description: 'Five-course specialization covering neural networks, CNNs, sequence models, and optimization.', thumbnail: '' },
    { id: 'fb_c4', title: 'Meta Front-End Developer Professional Certificate', platform: 'Coursera', instructor: 'Meta', rating: 4.7, reviewCount: 65000, duration: '72h 00m', durationHours: 72, level: 'Beginner', url: 'https://www.coursera.org/professional-certificates/meta-front-end-developer', topics: ['HTML', 'CSS', 'JavaScript', 'React'], popularity: 86, description: 'Meta path covering HTML, CSS, JavaScript, React, accessibility, and professional readiness.', thumbnail: '' },
    { id: 'fb_c5', title: 'Meta Back-End Developer Professional Certificate', platform: 'Coursera', instructor: 'Meta', rating: 4.6, reviewCount: 52000, duration: '80h 00m', durationHours: 80, level: 'Beginner', url: 'https://www.coursera.org/professional-certificates/meta-back-end-developer', topics: ['Python', 'Django', 'APIs', 'SQL'], popularity: 84, description: 'Meta backend path from Python basics to Django APIs, databases, and deployment workflows.', thumbnail: '' },
    { id: 'fb_e1', title: "CS50's Web Programming with Python and JavaScript", platform: 'edX', instructor: 'Brian Yu', rating: 4.9, reviewCount: 55000, duration: '80h 00m', durationHours: 80, level: 'Intermediate', url: 'https://www.edx.org/learn/web-development/harvard-university-cs50-s-web-programming-with-python-and-javascript', topics: ['Python', 'JavaScript', 'Django', 'SQL'], popularity: 86, description: 'Harvard course covering Django, React, SQL, testing, and production web development workflows.', thumbnail: '' },
    { id: 'fb_e2', title: 'AWS Cloud Practitioner Essentials', platform: 'edX', instructor: 'Amazon Web Services', rating: 4.7, reviewCount: 80000, duration: '12h 00m', durationHours: 12, level: 'Beginner', url: 'https://www.edx.org/learn/amazon-web-services/amazon-web-services-aws-cloud-practitioner-essentials', topics: ['AWS', 'Cloud', 'DevOps'], popularity: 83, description: 'Official AWS course covering cloud concepts, services, security, and architecture basics.', thumbnail: '' },
    { id: 'fb_e3', title: 'MIT Introduction to Computer Science and Programming Using Python', platform: 'edX', instructor: 'MIT', rating: 4.8, reviewCount: 350000, duration: '90h 00m', durationHours: 90, level: 'Beginner', url: 'https://www.edx.org/learn/computer-science/massachusetts-institute-of-technology-introduction-to-computer-science-and-programming-using-python', topics: ['Python', 'Algorithms', 'Computer Science'], popularity: 90, description: 'MIT foundational computer science course using Python to teach problem solving and computational thinking.', thumbnail: '' },
    { id: 'fb_e4', title: 'Professional Certificate in Computer Science for Web Programming', platform: 'edX', instructor: 'Harvard', rating: 4.8, reviewCount: 70000, duration: '36h 00m', durationHours: 36, level: 'Beginner', url: 'https://www.edx.org/professional-certificate/harvardx-computer-science-for-web-programming', topics: ['Python', 'JavaScript', 'HTML', 'CSS'], popularity: 87, description: 'Harvard certificate combining web fundamentals, backend engineering, and strong portfolio-worthy assignments.', thumbnail: '' },
    { id: 'fb_e5', title: 'Agile Development and Scrum', platform: 'edX', instructor: 'IBM', rating: 4.5, reviewCount: 22000, duration: '6h 00m', durationHours: 6, level: 'Beginner', url: 'https://www.edx.org/learn/agile/ibm-agile-development-and-scrum', topics: ['Agile', 'Scrum', 'Project Management'], popularity: 70, description: 'Learn Agile values, Scrum rituals, sprint planning, and team collaboration patterns.', thumbnail: '' },
    { id: 'fb_f1', title: 'JavaScript Algorithms and Data Structures Certification', platform: 'freeCodeCamp', instructor: 'freeCodeCamp', rating: 4.8, reviewCount: 500000, duration: '30h 00m', durationHours: 30, level: 'Intermediate', url: 'https://www.freecodecamp.org/learn/javascript-algorithms-and-data-structures/', topics: ['JavaScript', 'Algorithms', 'Data Structures'], popularity: 93, description: 'Master JavaScript fundamentals, data structures, and algorithm interview patterns.', thumbnail: '' },
    { id: 'fb_f2', title: 'Responsive Web Design Certification', platform: 'freeCodeCamp', instructor: 'freeCodeCamp', rating: 4.6, reviewCount: 600000, duration: '20h 00m', durationHours: 20, level: 'Beginner', url: 'https://www.freecodecamp.org/learn/2022/responsive-web-design/', topics: ['HTML', 'CSS', 'Flexbox', 'Grid'], popularity: 92, description: 'Modern responsive design with HTML5, CSS3, Flexbox, Grid, and accessibility foundations.', thumbnail: '' },
    { id: 'fb_f3', title: 'Back End Development and APIs Certification', platform: 'freeCodeCamp', instructor: 'freeCodeCamp', rating: 4.7, reviewCount: 300000, duration: '30h 00m', durationHours: 30, level: 'Intermediate', url: 'https://www.freecodecamp.org/learn/back-end-development-and-apis/', topics: ['Node.js', 'Express', 'MongoDB', 'APIs'], popularity: 88, description: 'Build REST APIs with Node.js, Express, MongoDB, and practical backend workflows.', thumbnail: '' },
    { id: 'fb_f4', title: 'Front End Development Libraries Certification', platform: 'freeCodeCamp', instructor: 'freeCodeCamp', rating: 4.6, reviewCount: 400000, duration: '25h 00m', durationHours: 25, level: 'Intermediate', url: 'https://www.freecodecamp.org/learn/front-end-development-libraries/', topics: ['React', 'Redux', 'Bootstrap', 'jQuery'], popularity: 85, description: 'Learn React, Redux, component architecture, and project-based frontend development.', thumbnail: '' }
  ].map((course, index) => normaliseCourse(course, index));

  let pool = allCourses;
  if (platform === 'Other') {
    pool = allCourses.filter((course) => course.platform === 'edX' || course.platform === 'freeCodeCamp');
  } else if (platform && platform !== 'All' && platform !== 'YouTube') {
    pool = allCourses.filter((course) => course.platform === platform);
  }

  while (pool.length > 0 && pool.length < count) {
    pool = [...pool, ...pool];
  }

  return pool.slice(0, count);
}

function dedupeCourses(courses = []) {
  const seen = new Set();
  return courses.filter((course) => {
    const key = `${course.url || ''}|${course.title || ''}`.toLowerCase();
    if (!key.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function buildCoursePool(options = {}) {
  const filters = normaliseCourseFilters(options);
  const careerStack = toTrimmedString(options.careerStack) || 'Full Stack';
  const experienceLevel = toTrimmedString(options.experienceLevel) || 'Student';
  const skillGaps = Array.isArray(options.skillGaps) ? options.skillGaps.map(toTrimmedString).filter(Boolean) : [];
  const knownSkills = Array.isArray(options.knownSkills) ? options.knownSkills.map(toTrimmedString).filter(Boolean) : [];
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
    topic: filters.topic
  };

  const [youtubeCourses, curatedCourses] = await Promise.all([
    youtubeCount > 0 ? fetchYouTubeCourses(query, youtubeCount) : Promise.resolve([]),
    Promise.resolve(buildFallbackPool(filters.platform, curatedCount))
  ]);

  let pool = dedupeCourses([...youtubeCourses, ...curatedCourses].map((course, index) => normaliseCourse(course, index)));
  pool = applyCourseFilters(pool, filters);

  if (!pool.length) {
    const fallbackPool = filters.platform === 'YouTube'
      ? await fetchYouTubeCourses(query, 20)
      : buildFallbackPool(filters.platform, 40);
    pool = applyCourseFilters(
      dedupeCourses(fallbackPool.map((course, index) => normaliseCourse(course, index))),
      filters
    );
  }

  pool = scoreAndRank(pool, rankingContext).map((course) => ({
    ...course,
    platformColor: PLATFORM_COLORS[course.platform] || PLATFORM_COLORS.Udemy
  }));

  if (filters.platform === 'All') {
    pool = blendDefaultPlatformPages(pool);
  }

  return pool;
}

module.exports = {
  buildCoursePool,
  normaliseCourseFilters
};
