const crypto = require('node:crypto');
const { buildCoursePool, normaliseCourseFilters } = require('../services/courseService');
const AnalysisCache = require('../models/analysisCache');

const COURSE_POOL_VERSION = 'courses_pool_v3';

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
  if (!userId) {
    return { skillGaps: [], knownSkills: [] };
  }

  const latestSkillGap = await AnalysisCache.findOne({
    userId,
    'analysisData.missingSkills.0': { $exists: true }
  })
    .sort({ updatedAt: -1 })
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

const buildPoolCacheKey = ({
  careerStack,
  experienceLevel,
  skillGaps,
  filters
}) => {
  const poolSeed = JSON.stringify({
    careerStack,
    experienceLevel,
    skillGaps: uniqueStrings(skillGaps, 6),
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
  fromCache
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
    skillGapsUsed.length ? `Top skill gaps used: ${skillGapsUsed.join(', ')}.` : 'Skill gap evidence is limited, so broader stack matching was used.',
    activeFilterParts.length ? `Active filters: ${activeFilterParts.join(', ')}.` : 'No extra filters are active right now.'
  ].join(' ');

  return {
    careerStack,
    experienceLevel,
    skillGapsUsed,
    activeFilters,
    fromCache,
    summary
  };
};

const fetchCourses = async (req, res) => {
  try {
    const careerStack = req.user?.careerStack || req.query.stack || 'Full Stack';
    const experienceLevel = req.user?.experienceLevel || req.query.experience || 'Student';
    const filters = normaliseCourseFilters(req.query);

    const skillSignals = await resolveSkillSignals(req.user?._id);
    let skillGaps = skillSignals.skillGaps;
    const knownSkills = skillSignals.knownSkills;

    if (req.query.skillGaps) {
      const override = Array.isArray(req.query.skillGaps)
        ? req.query.skillGaps
        : String(req.query.skillGaps).split(',');
      skillGaps = uniqueStrings(override, 12);
    }

    const { poolHash, cacheLookup } = buildPoolCacheKey({
      careerStack,
      experienceLevel,
      skillGaps,
      filters
    });

    let allCourses = null;
    let fromCache = false;

    const cached = await AnalysisCache.findOne(cacheLookup).lean();
    if (Array.isArray(cached?.analysisData?.allCourses)) {
      allCourses = cached.analysisData.allCourses;
      fromCache = true;
    }

    if (!allCourses) {
      allCourses = await buildCoursePool({
        careerStack,
        experienceLevel,
        skillGaps,
        knownSkills,
        ...filters
      });

      await AnalysisCache.findOneAndUpdate(
        cacheLookup,
        {
          $set: {
            userId: req.user?._id,
            githubUsername: cacheLookup.githubUsername,
            careerStack,
            experienceLevel,
            analysisVersion: COURSE_POOL_VERSION,
            resumeHash: 'no-resume',
            signalHash: poolHash,
            analysisData: { allCourses }
          }
        },
        { upsert: true }
      ).catch(() => null);
    }

    const total = Array.isArray(allCourses) ? allCourses.length : 0;
    const totalPages = Math.max(1, Math.ceil(total / filters.limit));
    const safePage = Math.min(filters.page, totalPages);
    const startIndex = (safePage - 1) * filters.limit;
    const courses = (allCourses || []).slice(startIndex, startIndex + filters.limit);

    res.json({
      courses,
      total,
      page: safePage,
      totalPages,
      hasMore: safePage < totalPages,
      fromCache,
      recommendedBasedOn: buildRecommendedBasedOn({
        careerStack,
        experienceLevel,
        skillGaps,
        filters,
        fromCache
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
