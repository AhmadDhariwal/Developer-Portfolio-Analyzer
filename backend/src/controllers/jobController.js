const { buildJobPool } = require('../services/jobService');
const AnalysisCache   = require('../models/analysisCache');
const crypto          = require('node:crypto');

const hasJSearchConfig = () => {
  const key = String(process.env.RAPIDAPI_KEY || '').trim();
  return !!key && key !== 'your_rapidapi_key';
};

const inferJobSource = (job = {}) => {
  if (job.source) return job.source;
  const url = String(job.url || '').toLowerCase();
  if (url.includes('linkedin.com') || url.includes('indeed.com') || url.includes('glassdoor.com') || url.includes('jsearch')) {
    return 'JSearch';
  }
  if (String(job.id || '').startsWith('fb_')) return 'Fallback';
  if (String(job.id || '').startsWith('ai_')) return 'AI';
  return 'Unknown';
};

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
    const page            = Math.max(1,  Number.parseInt(req.query.page, 10)  || 1);
    const limit           = Math.min(20, Number.parseInt(req.query.limit, 10) || 10);

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

    if (Array.isArray(allJobs)) {
      allJobs = allJobs.map((job) => ({ ...job, source: inferJobSource(job) }));
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
      ).catch(() => null);
    }

    // 6. Paginate from pool
    const total      = allJobs.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage   = Math.min(page, totalPages);
    const start      = (safePage - 1) * limit;
    const jobs       = allJobs.slice(start, start + limit);

    const sourceSummary = allJobs.reduce((acc, job) => {
      const source = String(job?.source || 'Unknown');
      acc[source] = (acc[source] || 0) + 1;
      return acc;
    }, {});

    const primarySource = Object.entries(sourceSummary)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';

    const jsearchConfigured = hasJSearchConfig();
    const jsearchCount = Number(sourceSummary.JSearch || 0);
    const aiCount = Number(sourceSummary.AI || 0);
    const fallbackCount = Number(sourceSummary.Fallback || 0);
    let sourceMessage = 'JSearch returned no jobs for these filters. Showing the fallback pool so the page stays populated.';

    if (jsearchConfigured === false) {
      sourceMessage = 'JSearch is disabled because RAPIDAPI_KEY is missing in backend/.env.';
    } else if (jsearchCount > 0) {
      sourceMessage = `JSearch is active with ${jsearchCount} jobs in the current pool.`;
    } else if (aiCount > 0) {
      sourceMessage = `JSearch returned no jobs for these filters. AI-generated jobs are being shown (${aiCount} items).`;
    } else if (fallbackCount > 0) {
      sourceMessage = `JSearch returned no jobs for these filters. Curated fallback jobs are being shown (${fallbackCount} items).`;
    }

    // 7. Respond
    res.json({
      jobs,
      total,
      page:       safePage,
      totalPages,
      hasMore:    safePage < totalPages,
      fromCache:  !!cached,
      primarySource,
      sourceSummary,
      jsearchConfigured,
      sourceMessage
    });

  } catch (error) {
    console.error('[JobController] Unhandled error:', error.message);
    res.status(500).json({ message: 'Failed to fetch job recommendations. Please try again.' });
  }
};

module.exports = { fetchJobs };
