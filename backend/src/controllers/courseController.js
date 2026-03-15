const { buildCoursePool } = require('../services/courseService');
const AnalysisCache        = require('../models/analysisCache');
const crypto               = require('crypto');

/**
 * @desc  Get AI-ranked course recommendations with pool caching.
 *        The FULL ranked pool is cached once per filter-set; the controller
 *        slices it per page so every page is stable and consistent.
 * @route GET /api/courses
 * @access Protected
 */
const fetchCourses = async (req, res) => {
  try {
    // ── 1. Resolve career profile ──────────────────────────────────────────────
    const careerStack     = req.user?.careerStack     || req.query.stack       || 'Full Stack';
    const experienceLevel = req.user?.experienceLevel || req.query.experience  || 'Intermediate';

    let skillGaps   = [];
    let knownSkills = [];

    // Pull skill gaps from the most-recent analysis cache entry for this user
    if (req.user?._id) {
      const latestCache = await AnalysisCache
        .findOne({ userId: req.user._id })
        .sort({ updatedAt: -1 })
        .lean();

      if (latestCache?.analysisData?.missingSkills) {
        skillGaps   = latestCache.analysisData.missingSkills.map(s => s.name || String(s));
        knownSkills = (latestCache.analysisData.yourSkills || []).map(s => s.name || String(s));
      }
    }

    // Allow explicit query override
    if (req.query.skillGaps) {
      skillGaps = Array.isArray(req.query.skillGaps)
        ? req.query.skillGaps
        : String(req.query.skillGaps).split(',').map(s => s.trim()).filter(Boolean);
    }

    // ── 2. Read filter & pagination params ─────────────────────────────────────
    const platform = String(req.query.platform || 'All');
    const rating   = String(req.query.rating   || '');
    const level    = String(req.query.level    || '');
    const topic    = String(req.query.topic    || '');
    const duration = String(req.query.duration || '');
    const page     = Math.max(1,  parseInt(req.query.page)  || 1);
    const limit    = Math.min(20, parseInt(req.query.limit) || 10);

    // ── 3. Build cache key (does NOT include page/limit) ──────────────────────
    //      Same filter-set always hits the same pool regardless of which page
    //      is being requested.  The controller slices the pool per page.
    const poolKey  = JSON.stringify({
      careerStack, experienceLevel,
      skillGaps:   skillGaps.slice(0, 6),
      platform, rating, level, topic, duration
    });
    const poolHash  = crypto.createHash('sha256').update(poolKey).digest('hex').slice(0, 20);
    const cacheKey  = `courses_pool_${poolHash}`;

    // ── 4. Try pool cache ──────────────────────────────────────────────────────
    let allCourses = null;

    const cached = await AnalysisCache.findOne({ githubUsername: cacheKey }).lean();
    if (cached?.analysisData?.allCourses && Array.isArray(cached.analysisData.allCourses)) {
      allCourses = cached.analysisData.allCourses;
      console.log(`[CourseController] Cache HIT  – pool size: ${allCourses.length}`);
    }

    // ── 5. Generate pool on cache miss ─────────────────────────────────────────
    if (!allCourses) {
      console.log('[CourseController] Cache MISS – generating course pool …');

      allCourses = await buildCoursePool({
        careerStack,
        experienceLevel,
        skillGaps,
        knownSkills,
        platform,
        rating,
        level,
        topic,
        duration
      });

      console.log(`[CourseController] Pool generated – ${allCourses.length} courses`);

      // Persist the full pool (TTL index on AnalysisCache handles eviction)
      await AnalysisCache.findOneAndUpdate(
        { githubUsername: cacheKey },
        {
          $set: {
            userId:          req.user?._id,
            careerStack,
            experienceLevel,
            analysisData:    { allCourses }
          }
        },
        { upsert: true }
      ).catch(err => console.warn('[CourseController] Cache write failed:', err.message));
    }

    // ── 6. Paginate from pool ──────────────────────────────────────────────────
    const total      = allCourses.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage   = Math.min(page, totalPages);
    const start      = (safePage - 1) * limit;
    const courses    = allCourses.slice(start, start + limit);

    // ── 7. Send response ───────────────────────────────────────────────────────
    res.json({
      courses,
      total,
      page:       safePage,
      totalPages,
      hasMore:    safePage < totalPages,
      fromCache:  !!cached
    });

  } catch (error) {
    console.error('[CourseController] Unhandled error:', error.message);
    res.status(500).json({ message: 'Failed to fetch course recommendations. Please try again.' });
  }
};

module.exports = { fetchCourses };
