const crypto = require('node:crypto');
const { buildCoursePoolWithMetadata, normaliseCourseFilters } = require('../services/courseService');
const AnalysisCache = require('../models/analysisCache');

const COURSE_POOL_VERSION = 'courses_pool_v4';
const COURSE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_COURSE_CACHE_VARIANTS = 40;

const uniqueStrings = (values = [], limit = 8) => {
  const seen = new Set();
  const output = [];

  for (const value of values) {
    const normalized = String(value || '').trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
    if (output.length >= limit) break;
  }

  return output;
};

const resolveSkillSignals = async (userId) => {
  if (!userId) return { skillGaps: [], knownSkills: [] };

  const latestSkillGap = await AnalysisCache.findOne({
    userId,
    'analysisData.missingSkills.0': { $exists: true }
  })
    .sort({ updatedAt: -1 })
    .select({ 'analysisData.missingSkills': 1, 'analysisData.yourSkills': 1 })
    .lean();

  const missingSkills = Array.isArray(latestSkillGap?.analysisData?.missingSkills)
    ? latestSkillGap.analysisData.missingSkills.map((item) => item?.name || item)
    : [];
  const knownSkills = Array.isArray(latestSkillGap?.analysisData?.yourSkills)
    ? latestSkillGap.analysisData.yourSkills.map((item) => item?.name || item)
    : [];

  return {
    skillGaps: uniqueStrings(missingSkills, 12),
    knownSkills: uniqueStrings(knownSkills, 20)
  };
};

const buildPoolCacheKey = ({ userId, careerStack, experienceLevel, skillGaps, knownSkills, filters }) => {
  const poolSeed = JSON.stringify({
    careerStack,
    experienceLevel,
    skillGaps: uniqueStrings(skillGaps, 6),
    knownSkills: uniqueStrings(knownSkills, 10),
    platform: filters.platform,
    rating: filters.rating,
    level: filters.level,
    topic: filters.topic,
    duration: filters.duration
  });
  const hash = crypto.createHash('sha256').update(poolSeed).digest('hex').slice(0, 20);

  return {
    poolHash: hash,
    cacheLookup: {
      userId,
      githubUsername: `courses_pool_${hash}`,
      careerStack,
      experienceLevel,
      analysisVersion: COURSE_POOL_VERSION,
      resumeHash: 'no-resume',
      signalHash: hash
    }
  };
};

const buildRecommendedBasedOn = ({
  careerStack,
  experienceLevel,
  skillGaps,
  filters,
  fromCache,
  sourceMetadata = {}
}) => {
  const skillGapsUsed = uniqueStrings(skillGaps, 4);
  const activeFilters = {
    platform: filters.platform,
    rating: filters.rating,
    level: filters.level,
    duration: filters.duration,
    topic: filters.topic
  };
  const activeFilterParts = [];
  if (filters.platform !== 'All') activeFilterParts.push(filters.platform);
  if (filters.rating) activeFilterParts.push(`${filters.rating}+ rating`);
  if (filters.level !== 'All') activeFilterParts.push(filters.level);
  if (filters.duration !== 'All') activeFilterParts.push(`${filters.duration} hours`);
  if (filters.topic) activeFilterParts.push(`topic: ${filters.topic}`);

  const summary = [
    `Courses are recommended for your ${careerStack} profile at ${experienceLevel} level.`,
    skillGapsUsed.length
      ? `Top skill gaps used: ${skillGapsUsed.join(', ')}.`
      : 'Skill gap evidence is limited, so broader stack matching was used.',
    activeFilterParts.length
      ? `Active filters: ${activeFilterParts.join(', ')}.`
      : 'No extra filters are active right now.'
  ].join(' ');

  return {
    careerStack,
    experienceLevel,
    skillGapsUsed,
    activeFilters,
    fromCache,
    summary,
    ...sourceMetadata
  };
};

const readCachedPage = async (cacheLookup, filters) => {
  const startIndex = (filters.page - 1) * filters.limit;
  const projection = {
    'analysisData.allCourses': { $slice: [startIndex, filters.limit] },
    'analysisData.total': 1,
    'analysisData.sourceMetadata': 1
  };
  const cached = await AnalysisCache.findOne({
    ...cacheLookup,
    updatedAt: { $gte: new Date(Date.now() - COURSE_CACHE_TTL_MS) }
  }).select(projection).lean();

  if (!Number.isFinite(cached?.analysisData?.total)) return null;

  const total = cached.analysisData.total;
  const totalPages = Math.max(1, Math.ceil(total / filters.limit));
  const safePage = Math.min(filters.page, totalPages);
  let courses = Array.isArray(cached.analysisData.allCourses) ? cached.analysisData.allCourses : [];

  if (safePage !== filters.page) {
    const safeStart = (safePage - 1) * filters.limit;
    const finalPage = await AnalysisCache.findOne(cacheLookup)
      .select({ 'analysisData.allCourses': { $slice: [safeStart, filters.limit] } })
      .lean();
    courses = Array.isArray(finalPage?.analysisData?.allCourses) ? finalPage.analysisData.allCourses : [];
  }

  return {
    courses,
    total,
    page: safePage,
    totalPages,
    sourceMetadata: cached.analysisData.sourceMetadata || {}
  };
};

const pruneCourseCache = async (userId) => {
  const cutoff = new Date(Date.now() - COURSE_CACHE_TTL_MS);
  await AnalysisCache.deleteMany({
    userId,
    githubUsername: /^courses_pool_/,
    $or: [
      { analysisVersion: { $ne: COURSE_POOL_VERSION } },
      { updatedAt: { $lt: cutoff } }
    ]
  });

  const overflow = await AnalysisCache.find({
    userId,
    analysisVersion: COURSE_POOL_VERSION,
    githubUsername: /^courses_pool_/
  })
    .sort({ updatedAt: -1 })
    .skip(MAX_COURSE_CACHE_VARIANTS)
    .select({ _id: 1 })
    .lean();

  if (overflow.length) {
    await AnalysisCache.deleteMany({ _id: { $in: overflow.map((entry) => entry._id) } });
  }
};

const fetchCourses = async (req, res) => {
  try {
    const userId = req.user?._id;
    const careerStack = req.user?.careerStack || req.query.stack || 'Full Stack';
    const experienceLevel = req.user?.experienceLevel || req.query.experience || 'Student';
    const filters = normaliseCourseFilters(req.query);
    const skillSignals = await resolveSkillSignals(userId);
    let skillGaps = skillSignals.skillGaps;

    if (req.query.skillGaps) {
      const override = Array.isArray(req.query.skillGaps)
        ? req.query.skillGaps
        : String(req.query.skillGaps).split(',');
      skillGaps = uniqueStrings(override, 12);
    }

    const { cacheLookup } = buildPoolCacheKey({
      userId,
      careerStack,
      experienceLevel,
      skillGaps,
      knownSkills: skillSignals.knownSkills,
      filters
    });

    let pageResult = await readCachedPage(cacheLookup, filters);
    let fromCache = Boolean(pageResult);

    if (!pageResult) {
      const built = await buildCoursePoolWithMetadata({
        careerStack,
        experienceLevel,
        skillGaps,
        knownSkills: skillSignals.knownSkills,
        ...filters
      });
      const allCourses = built.courses;
      const total = allCourses.length;
      const totalPages = Math.max(1, Math.ceil(total / filters.limit));
      const safePage = Math.min(filters.page, totalPages);
      const startIndex = (safePage - 1) * filters.limit;

      pageResult = {
        courses: allCourses.slice(startIndex, startIndex + filters.limit),
        total,
        page: safePage,
        totalPages,
        sourceMetadata: built.sourceMetadata
      };

      await AnalysisCache.findOneAndUpdate(
        cacheLookup,
        {
          $set: {
            ...cacheLookup,
            analysisData: {
              allCourses,
              total,
              sourceMetadata: built.sourceMetadata
            }
          }
        },
        { upsert: true, setDefaultsOnInsert: true }
      ).catch(() => null);

      await pruneCourseCache(userId).catch(() => null);
    }

    res.json({
      courses: pageResult.courses,
      total: pageResult.total,
      page: pageResult.page,
      totalPages: pageResult.totalPages,
      hasMore: pageResult.page < pageResult.totalPages,
      fromCache,
      recommendedBasedOn: buildRecommendedBasedOn({
        careerStack,
        experienceLevel,
        skillGaps,
        filters,
        fromCache,
        sourceMetadata: pageResult.sourceMetadata
      })
    });
  } catch (error) {
    console.error('[CourseController] Unhandled error:', error.message);
    res.status(500).json({
      message: 'Failed to fetch course recommendations. Please try again.'
    });
  }
};

module.exports = { fetchCourses };
