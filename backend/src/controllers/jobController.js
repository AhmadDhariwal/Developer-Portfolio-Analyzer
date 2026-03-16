const { buildJobPool } = require('../services/jobService');
const AnalysisCache   = require('../models/analysisCache');
const crypto          = require('crypto');

/**
 * @desc  Get AI-ranked job recommendations with pool caching.
 * @route GET /api/jobs
 * @access Protected
 */
const fetchJobs = async (req, res) => {
  try {
    // 1. Resolve career profile from authenticated user or query overrides
    const careerStack     = req.user?.careerStack     || req.query.stack      || 'Full Stack';
    const experienceLevel = req.user?.experienceLevel || req.query.experience || 'Intermediate';

    let skillGaps   = [];
    let knownSkills = [];

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

    // 2. Read filter + pagination params
    const platform        = String(req.query.platform   || 'All');
    const location        = String(req.query.location   || 'All');
    const skills          = String(req.query.skills     || '');
    const jobType         = String(req.query.jobType    || 'All');
    const experience      = String(req.query.expLevel   || 'All');   // filter-level exp
    const page            = Math.max(1,  parseInt(req.query.page)  || 1);
    const limit           = Math.min(20, parseInt(req.query.limit) || 10);

    // 3. SHA-256 cache key — filter params only (NOT page / limit)
    const poolKey  = JSON.stringify({
      careerStack, experienceLevel,
      skillGaps:   skillGaps.slice(0, 6),
      platform, location, skills, jobType, experience
    });
    const poolHash = crypto.createHash('sha256').update(poolKey).digest('hex').slice(0, 20);
    const cacheKey = `jobs_pool_${poolHash}`;

    // 4. Try cache first
    let allJobs = null;
    const cached = await AnalysisCache.findOne({ githubUsername: cacheKey }).lean();
    if (cached?.analysisData?.allJobs && Array.isArray(cached.analysisData.allJobs)) {
      allJobs = cached.analysisData.allJobs;
    }

    // 5. On cache miss — build pool then persist
    if (!allJobs) {
      allJobs = await buildJobPool({
        careerStack, experienceLevel, skillGaps, knownSkills,
        platform, location, skills, jobType, experience
      });
      // Persist asynchronously (don't wait, don't fail on error)
      AnalysisCache.findOneAndUpdate(
        { githubUsername: cacheKey },
        { $set: { userId: req.user?._id, careerStack, experienceLevel, analysisData: { allJobs } } },
        { upsert: true }
      ).catch(err => console.warn('[JobController] Cache write failed:', err.message));
    }

    // 6. Paginate from pool
    const total      = allJobs.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage   = Math.min(page, totalPages);
    const start      = (safePage - 1) * limit;
    const jobs       = allJobs.slice(start, start + limit);

    // 7. Respond
    res.json({
      jobs,
      total,
      page:       safePage,
      totalPages,
      hasMore:    safePage < totalPages,
      fromCache:  !!cached
    });

  } catch (error) {
    console.error('[JobController] Unhandled error:', error.message);
    res.status(500).json({ message: 'Failed to fetch job recommendations. Please try again.' });
  }
};

module.exports = { fetchJobs };
