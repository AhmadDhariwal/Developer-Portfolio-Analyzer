const axios     = require('axios');
const aiService = require('./aiservice');
const { getCoursePrompt } = require('../prompts/coursePrompt');

// ─── Constants ────────────────────────────────────────────────────────────────

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

// AI pool sizes (total courses generated per platform mode, covers 2 full pages)
const AI_POOL_SIZE = {
  All:      20,   // 7 Udemy + 5 Coursera + 5 edX + 3 freeCodeCamp
  Udemy:    20,
  Coursera: 20,
  YouTube:   0,   // YouTube-only → no AI courses
  Other:    20    // 10 edX + 10 freeCodeCamp
};

// YouTube fetch targets
const YT_POOL_SIZE = {
  All:      6,   // Mixed pool: fetch 6 YouTube videos
  YouTube: 20    // YouTube-only: fetch 20 long videos
};

const PLATFORM_COLORS = {
  Udemy:        { bg: '#a435f0', text: '#ffffff' },
  Coursera:     { bg: '#0056d2', text: '#ffffff' },
  edX:          { bg: '#02262b', text: '#ffffff' },
  freeCodeCamp: { bg: '#006400', text: '#ffffff' },
  YouTube:      { bg: '#ff0000', text: '#ffffff' }
};

// ─── YouTube Fetcher ──────────────────────────────────────────────────────────

/**
 * Fetches real YouTube tutorial videos via Data API v3.
 * Runs two parallel searches (long + medium duration) and merges results.
 */
async function fetchYouTubeCourses(query, maxResults = 6) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || apiKey === 'your_youtube_api_key') {
    console.warn('[CourseService] YOUTUBE_API_KEY not set — YouTube courses skipped.');
    return [];
  }

  try {
    // Two parallel searches for better coverage
    const [longRes, mediumRes] = await Promise.allSettled([
      axios.get(`${YOUTUBE_API_BASE}/search`, {
        params: { part:'snippet', type:'video', q:`${query} full course tutorial`, maxResults: Math.min(25, maxResults + 10), relevanceLanguage:'en', videoDuration:'long', key: apiKey },
        timeout: 10000
      }),
      axios.get(`${YOUTUBE_API_BASE}/search`, {
        params: { part:'snippet', type:'video', q:`${query} tutorial crash course guide`, maxResults: Math.min(15, maxResults + 5), relevanceLanguage:'en', videoDuration:'medium', key: apiKey },
        timeout: 10000
      })
    ]);

    // Collect unique video IDs (long first, medium as fallback)
    const seenIds = new Set();
    const videoIds = [];
    for (const res of [longRes, mediumRes]) {
      if (res.status === 'fulfilled') {
        for (const item of (res.value.data.items || [])) {
          const id = item.id?.videoId;
          if (id && !seenIds.has(id)) { seenIds.add(id); videoIds.push(id); }
        }
      }
    }
    if (!videoIds.length) return [];

    // Fetch video details: duration, views, likes
    const detailsRes = await axios.get(`${YOUTUBE_API_BASE}/videos`, {
      params: { part:'snippet,contentDetails,statistics', id: videoIds.join(','), key: apiKey },
      timeout: 10000
    });

    const items = (detailsRes.data.items || [])
      .map(item => {
        const snippet = item.snippet         || {};
        const stats   = item.statistics      || {};
        const isoD    = item.contentDetails?.duration || 'PT0S';
        const { hours, minutes, totalHours } = parseDuration(isoD);

        if (totalHours < 0.13) return null; // skip < 8 minutes

        const viewCount  = parseInt(stats.viewCount  || '0', 10);
        const likeCount  = parseInt(stats.likeCount  || '0', 10);
        const popularity = Math.min(100, Math.max(10, Math.round((viewCount / 200000) * 100)));

        const durationStr = hours > 0
          ? `${hours}h ${String(minutes).padStart(2,'0')}m`
          : `${minutes}m`;

        return {
          id:           `yt_${item.id}`,
          title:        snippet.title || 'Untitled',
          description:  (snippet.description || '').slice(0, 250) || 'Watch this tutorial on YouTube.',
          platform:     'YouTube',
          instructor:   snippet.channelTitle || 'YouTube',
          rating:       calcYTRating(viewCount, likeCount),
          reviewCount:  likeCount,
          duration:     durationStr,
          durationHours: Math.round(totalHours * 100) / 100,
          level:        'All Levels',
          thumbnail:    snippet.thumbnails?.medium?.url || snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url || '',
          url:          `https://www.youtube.com/watch?v=${item.id}`,
          topics:       extractTopics(snippet.title),
          popularity
        };
      })
      .filter(Boolean)
      .slice(0, maxResults);

    return items;

  } catch (err) {
    console.error('[CourseService] YouTube API error:', err.response?.data?.error?.message || err.message);
    return [];
  }
}

function parseDuration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  const h = parseInt(m?.[1] || '0', 10);
  const min = parseInt(m?.[2] || '0', 10);
  const s = parseInt(m?.[3] || '0', 10);
  return { hours: h, minutes: min, totalHours: h + min / 60 + s / 3600 };
}

function calcYTRating(views, likes) {
  if (!views) return 4.0;
  const ratio = likes / views;
  if (ratio > 0.06) return +((4.6 + Math.random() * 0.3).toFixed(1));
  if (ratio > 0.04) return +((4.4 + Math.random() * 0.2).toFixed(1));
  if (ratio > 0.02) return +((4.2 + Math.random() * 0.2).toFixed(1));
  if (ratio > 0.01) return +((4.0 + Math.random() * 0.2).toFixed(1));
  return 4.0;
}

function extractTopics(title) {
  const known = [
    'JavaScript','TypeScript','Python','React','Angular','Vue','Node.js','Express',
    'MongoDB','SQL','PostgreSQL','Docker','Kubernetes','AWS','GCP','Azure','Git',
    'HTML','CSS','Redux','GraphQL','REST','API','Testing','CI/CD','Linux',
    'System Design','Data Structures','Algorithms','Machine Learning','AI','Java',
    'C#','.NET','PHP','Django','FastAPI','Spring','Next.js','Tailwind','Flutter'
  ];
  return known.filter(t => title.toLowerCase().includes(t.toLowerCase())).slice(0, 4);
}

// ─── AI Course Generator ──────────────────────────────────────────────────────

async function generateAICourses({ careerStack, experienceLevel, skillGaps, knownSkills, platform, topic, count }) {
  const prompt   = getCoursePrompt({ careerStack, experienceLevel, skillGaps, knownSkills, platform, topic, totalCount: count });
  const fallback = { courses: buildFallbackPool(platform, count) };

  let result;
  try { result = await aiService.runAIAnalysis(prompt, fallback); }
  catch { result = fallback; }

  const raw = Array.isArray(result?.courses) ? result.courses : [];

  return raw.map((c, i) => ({
    id:           String(c.id || `ai_${Date.now()}_${i}`),
    title:        String(c.title       || 'Untitled Course'),
    description:  String(c.description || ''),
    platform:     normalisePlatform(c.platform),
    instructor:   String(c.instructor  || 'Instructor'),
    rating:       clamp(parseFloat(c.rating) || 4.3, 1, 5),
    reviewCount:  Math.max(0, parseInt(c.reviewCount) || 1000),
    duration:     String(c.duration    || 'N/A'),
    durationHours: Math.max(0, parseFloat(c.durationHours) || 0),
    level:        normaliseLevel(c.level),
    thumbnail:    String(c.thumbnail   || ''),
    url:          String(c.url         || '#'),
    topics:       Array.isArray(c.topics) ? c.topics.map(String) : [],
    popularity:   clamp(parseInt(c.popularity) || 50, 0, 100)
  }));
}

// ─── Hard-coded fallback pool (20 courses across all platforms) ────────────────

function buildFallbackPool(platform = 'All', count = 20) {
  const all = [
    { id:'fb_u1', title:'The Complete JavaScript Course 2024: From Zero to Expert!', platform:'Udemy', instructor:'Jonas Schmedtmann', rating:4.7, reviewCount:180000, duration:'68h 30m', durationHours:68.5, level:'Beginner', url:'https://www.udemy.com/course/the-complete-javascript-course/', topics:['JavaScript','ES6','OOP'], popularity:95, description:'Master modern JavaScript with ES6+, OOP, closures, async/await, and build real-world projects.', thumbnail:'' },
    { id:'fb_u2', title:'Node.js, Express, MongoDB & More: The Complete Bootcamp', platform:'Udemy', instructor:'Jonas Schmedtmann', rating:4.8, reviewCount:95000, duration:'42h 15m', durationHours:42.25, level:'Intermediate', url:'https://www.udemy.com/course/nodejs-express-mongodb-bootcamp/', topics:['Node.js','Express','MongoDB'], popularity:90, description:'Complete Node.js backend development course covering REST APIs, authentication, and security.', thumbnail:'' },
    { id:'fb_u3', title:'Docker & Kubernetes: The Practical Guide', platform:'Udemy', instructor:'Maximilian Schwarzmüller', rating:4.7, reviewCount:52000, duration:'24h 00m', durationHours:24, level:'Intermediate', url:'https://www.udemy.com/course/docker-kubernetes-the-practical-guide/', topics:['Docker','Kubernetes','DevOps'], popularity:85, description:'Learn Docker and Kubernetes with hands-on examples including cloud deployments.', thumbnail:'' },
    { id:'fb_u4', title:'Angular - The Complete Guide (2024 Edition)', platform:'Udemy', instructor:'Maximilian Schwarzmüller', rating:4.6, reviewCount:130000, duration:'35h 00m', durationHours:35, level:'Beginner', url:'https://www.udemy.com/course/the-complete-guide-to-angular-2/', topics:['Angular','TypeScript','RxJS'], popularity:88, description:'Build production-ready Angular apps covering components, services, routing, and reactive forms.', thumbnail:'' },
    { id:'fb_u5', title:'React - The Complete Guide (incl Hooks, React Router, Redux)', platform:'Udemy', instructor:'Maximilian Schwarzmüller', rating:4.7, reviewCount:190000, duration:'49h 00m', durationHours:49, level:'Beginner', url:'https://www.udemy.com/course/react-the-complete-guide-incl-redux/', topics:['React','Redux','Hooks'], popularity:96, description:'Master React 18, hooks, Redux Toolkit, Next.js fundamentals, and multiple real-world projects.', thumbnail:'' },
    { id:'fb_u6', title:'Python Bootcamp: Go from Zero to Hero in Python 3', platform:'Udemy', instructor:'Jose Portilla', rating:4.6, reviewCount:480000, duration:'22h 00m', durationHours:22, level:'Beginner', url:'https://www.udemy.com/course/complete-python-bootcamp/', topics:['Python','OOP','Scripting'], popularity:92, description:'Comprehensive Python 3 course covering fundamentals, OOP, decorators, and real-world projects.', thumbnail:'' },
    { id:'fb_u7', title:'GraphQL with React: The Complete Developers Guide', platform:'Udemy', instructor:'Stephen Grider', rating:4.5, reviewCount:31000, duration:'13h 00m', durationHours:13, level:'Intermediate', url:'https://www.udemy.com/course/graphql-with-react-course/', topics:['GraphQL','React','APIs'], popularity:78, description:'Build full-stack GraphQL apps with React, Apollo, and MongoDB.', thumbnail:'' },
    { id:'fb_c1', title:'Google IT Automation with Python Professional Certificate', platform:'Coursera', instructor:'Google', rating:4.8, reviewCount:120000, duration:'32h 00m', durationHours:32, level:'Beginner', url:'https://www.coursera.org/professional-certificates/google-it-automation', topics:['Python','Automation','Git'], popularity:88, description:'Professional Google certificate covering Python scripting, version control, and IT automation.', thumbnail:'' },
    { id:'fb_c2', title:'IBM Full Stack Software Developer Professional Certificate', platform:'Coursera', instructor:'IBM', rating:4.6, reviewCount:75000, duration:'60h 00m', durationHours:60, level:'Beginner', url:'https://www.coursera.org/professional-certificates/ibm-full-stack-javascript-developer', topics:['JavaScript','React','Node.js','Docker'], popularity:82, description:'Earn an IBM professional certificate covering the full modern web development stack.', thumbnail:'' },
    { id:'fb_c3', title:'Deep Learning Specialization', platform:'Coursera', instructor:'Andrew Ng', rating:4.9, reviewCount:180000, duration:'80h 00m', durationHours:80, level:'Intermediate', url:'https://www.coursera.org/specializations/deep-learning', topics:['Machine Learning','AI','Python'], popularity:94, description:"Andrew Ng's 5-course specialization covering neural networks, CNNs, RNNs, and NLP."},
    { id:'fb_c4', title:'Meta Front-End Developer Professional Certificate', platform:'Coursera', instructor:'Meta', rating:4.7, reviewCount:65000, duration:'72h 00m', durationHours:72, level:'Beginner', url:'https://www.coursera.org/professional-certificates/meta-front-end-developer', topics:['HTML','CSS','JavaScript','React'], popularity:86, description:'Meta-certified frontend path covering HTML, CSS, React, and professional interview prep.', thumbnail:'' },
    { id:'fb_c5', title:'Meta Back-End Developer Professional Certificate', platform:'Coursera', instructor:'Meta', rating:4.6, reviewCount:52000, duration:'80h 00m', durationHours:80, level:'Beginner', url:'https://www.coursera.org/professional-certificates/meta-back-end-developer', topics:['Python','Django','APIs','SQL'], popularity:84, description:'Meta-certified backend path from Python basics to Django REST APIs and cloud deployment.', thumbnail:'' },
    { id:'fb_e1', title:"CS50's Web Programming with Python and JavaScript", platform:'edX', instructor:'Brian Yu', rating:4.9, reviewCount:55000, duration:'80h 00m', durationHours:80, level:'Intermediate', url:'https://www.edx.org/learn/web-development/harvard-university-cs50-s-web-programming-with-python-and-javascript', topics:['Python','JavaScript','Django','SQL'], popularity:86, description:"Harvard's free web programming course covering Django, React, SQL, and cloud deployment.", thumbnail:'' },
    { id:'fb_e2', title:'AWS Cloud Practitioner Essentials', platform:'edX', instructor:'Amazon Web Services', rating:4.7, reviewCount:80000, duration:'12h 00m', durationHours:12, level:'Beginner', url:'https://www.edx.org/learn/amazon-web-services/amazon-web-services-aws-cloud-practitioner-essentials', topics:['AWS','Cloud','DevOps'], popularity:83, description:'Official AWS course covering core cloud concepts, services, security, and architecture patterns.', thumbnail:'' },
    { id:'fb_e3', title:'MIT Introduction to Computer Science and Programming Using Python', platform:'edX', instructor:'MIT', rating:4.8, reviewCount:350000, duration:'90h 00m', durationHours:90, level:'Beginner', url:'https://www.edx.org/learn/computer-science/massachusetts-institute-of-technology-introduction-to-computer-science-and-programming-using-python', topics:['Python','Algorithms','Computer Science'], popularity:90, description:"MIT's foundational CS course using Python — one of edX's most popular courses ever.", thumbnail:'' },
    { id:'fb_e4', title:'Professional Certificate in Computer Science for Web Programming', platform:'edX', instructor:'Harvard', rating:4.8, reviewCount:70000, duration:'36h 00m', durationHours:36, level:'Beginner', url:'https://www.edx.org/professional-certificate/harvardx-computer-science-for-web-programming', topics:['Python','JavaScript','HTML','CSS'], popularity:87, description:'Harvard professional certificate combining CS50 and CS50W into a complete web dev path.', thumbnail:'' },
    { id:'fb_e5', title:'Agile Development and Scrum', platform:'edX', instructor:'IBM', rating:4.5, reviewCount:22000, duration:'6h 00m', durationHours:6, level:'Beginner', url:'https://www.edx.org/learn/agile/ibm-agile-development-and-scrum', topics:['Agile','Scrum','Project Management'], popularity:70, description:'Learn Agile values, Scrum framework, sprint planning, and retrospectives for software teams.', thumbnail:'' },
    { id:'fb_f1', title:'JavaScript Algorithms and Data Structures Certification', platform:'freeCodeCamp', instructor:'freeCodeCamp', rating:4.8, reviewCount:500000, duration:'30h 00m', durationHours:30, level:'Intermediate', url:'https://www.freecodecamp.org/learn/javascript-algorithms-and-data-structures/', topics:['JavaScript','Algorithms','Data Structures'], popularity:93, description:'Master JavaScript fundamentals, ES6+ syntax, data structures, and algorithm interview patterns.', thumbnail:'' },
    { id:'fb_f2', title:'Responsive Web Design Certification', platform:'freeCodeCamp', instructor:'freeCodeCamp', rating:4.6, reviewCount:600000, duration:'20h 00m', durationHours:20, level:'Beginner', url:'https://www.freecodecamp.org/learn/2022/responsive-web-design/', topics:['HTML','CSS','Flexbox','Grid'], popularity:92, description:'Learn modern responsive design with HTML5, CSS3, Flexbox, CSS Grid, and accessibility.', thumbnail:'' },
    { id:'fb_f3', title:'Back End Development and APIs Certification', platform:'freeCodeCamp', instructor:'freeCodeCamp', rating:4.7, reviewCount:300000, duration:'30h 00m', durationHours:30, level:'Intermediate', url:'https://www.freecodecamp.org/learn/back-end-development-and-apis/', topics:['Node.js','Express','MongoDB','APIs'], popularity:88, description:'Build REST APIs with Node.js, Express, and MongoDB while earning a free certification.', thumbnail:'' },
    { id:'fb_f4', title:'Front End Development Libraries Certification', platform:'freeCodeCamp', instructor:'freeCodeCamp', rating:4.6, reviewCount:400000, duration:'25h 00m', durationHours:25, level:'Intermediate', url:'https://www.freecodecamp.org/learn/front-end-development-libraries/', topics:['React','Redux','Bootstrap','jQuery'], popularity:85, description:'Learn React, Redux, Bootstrap, and jQuery through hands-on project-based learning.', thumbnail:'' }
  ];

  // Filter to requested platform
  let pool = all;
  if (platform && platform !== 'All' && platform !== 'YouTube') {
    const norm = normalisePlatform(platform);
    const filtered = all.filter(c => c.platform === norm);
    pool = filtered.length ? filtered : all;
  }

  // Ensure enough items to fill requested count
  while (pool.length < count) pool = [...pool, ...pool];
  return pool.slice(0, count);
}

// ─── Normalisation helpers ────────────────────────────────────────────────────

function normalisePlatform(raw) {
  const p = (raw || '').toLowerCase();
  if (p.includes('udemy'))                                    return 'Udemy';
  if (p.includes('coursera'))                                 return 'Coursera';
  if (p.includes('edx') || p.includes('edx'))                return 'edX';
  if (p.includes('freecodecamp') || p.includes('free code')) return 'freeCodeCamp';
  if (p.includes('youtube'))                                  return 'YouTube';
  return 'Udemy';
}

function normaliseLevel(raw) {
  const l = (raw || '').toLowerCase();
  if (l.includes('begin')) return 'Beginner';
  if (l.includes('inter')) return 'Intermediate';
  if (l.includes('adv'))   return 'Advanced';
  return 'All Levels';
}

function clamp(val, min, max) { return Math.min(max, Math.max(min, val)); }

// ─── Relevance & Ranking ──────────────────────────────────────────────────────

function computeRelevance(course, skillGaps, careerStack) {
  const gaps   = (skillGaps  || []).map(s => s.toLowerCase());
  const stack  = (careerStack || '').toLowerCase();
  const topics = (course.topics || []).map(t => t.toLowerCase());
  const title  = (course.title  || '').toLowerCase();
  const desc   = (course.description || '').toLowerCase();

  let hits = 0;
  for (const gap of gaps) {
    if (topics.some(t => t.includes(gap) || gap.includes(t))) hits += 3;
    else if (title.includes(gap))                              hits += 2;
    else if (desc.includes(gap))                               hits += 1;
  }
  if (title.includes(stack) || topics.some(t => t.includes(stack))) hits += 2;

  return Math.min(100, Math.round((hits / Math.max(gaps.length * 3 + 2, 1)) * 100));
}

function scoreAndRank(courses, skillGaps, careerStack) {
  return courses
    .map(course => {
      const relevance = computeRelevance(course, skillGaps, careerStack);
      const score = ((course.rating / 5) * 100 * 0.4)
                  + (course.popularity  * 0.3)
                  + (relevance          * 0.3);
      return { ...course, relevanceScore: relevance, finalScore: Math.round(score) };
    })
    .sort((a, b) => b.finalScore - a.finalScore);
}

function matchesDuration(course, f) {
  if (!f || f === 'All') return true;
  const h = course.durationHours || 0;
  if (f === '0-2')  return h <= 2;
  if (f === '2-10') return h > 2 && h <= 10;
  if (f === '10+')  return h > 10;
  return true;
}

// ─── Main: Build full course pool (no pagination — controller paginates) ───────

/**
 * Generates and returns the complete ranked course list.
 * The controller caches this array and paginates from it on each request.
 *
 * @param {object} options
 * @returns {Promise<Course[]>}
 */
async function buildCoursePool(options = {}) {
  const {
    careerStack     = 'Full Stack',
    experienceLevel = 'Intermediate',
    skillGaps       = [],
    knownSkills     = [],
    platform        = 'All',
    rating          = '',
    level           = '',
    topic           = '',
    duration        = ''
  } = options;

  const query = topic
    ? `${topic} ${careerStack}`
    : `${careerStack} ${(skillGaps || []).slice(0, 3).join(' ')} programming`;

  const aiCount = AI_POOL_SIZE[platform] ?? AI_POOL_SIZE.All;
  const ytCount = YT_POOL_SIZE[platform] ?? 0;

  // Fetch AI courses and YouTube in parallel
  const [aiCourses, ytCourses] = await Promise.all([
    aiCount > 0 ? generateAICourses({ careerStack, experienceLevel, skillGaps, knownSkills, platform, topic, count: aiCount }) : Promise.resolve([]),
    ytCount > 0 ? fetchYouTubeCourses(query, ytCount) : Promise.resolve([])
  ]);

  // Merge + de-duplicate
  let pool = [...aiCourses, ...ytCourses];
  const seen = new Set();
  pool = pool.filter(c => {
    const key = (c.url || c.id || '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Apply filters
  if (rating) {
    const min = parseFloat(rating);
    pool = pool.filter(c => c.rating >= min);
  }
  if (level && level !== 'All') {
    pool = pool.filter(c => c.level === level || c.level === 'All Levels');
  }
  if (topic) {
    const t = topic.toLowerCase();
    pool = pool.filter(c =>
      c.title.toLowerCase().includes(t) ||
      (c.topics || []).some(tp => tp.toLowerCase().includes(t)) ||
      c.description.toLowerCase().includes(t)
    );
  }
  if (duration && duration !== 'All') {
    pool = pool.filter(c => matchesDuration(c, duration));
  }

  // If AI+YouTube returned nothing (all filtered out) → use fallback pool
  if (!pool.length) {
    pool = buildFallbackPool(platform, 20);
  }

  // Rank + attach platform colours
  pool = scoreAndRank(pool, skillGaps, careerStack);
  pool = pool.map(c => ({
    ...c,
    platformColor: PLATFORM_COLORS[c.platform] || PLATFORM_COLORS.Udemy
  }));

  return pool;
}

module.exports = { buildCoursePool };
