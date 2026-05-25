const crypto = require('node:crypto');
const { buildJobPool, normaliseJobFilters } = require('../services/jobService');
const AnalysisCache = require('../models/analysisCache');
const Analysis = require('../models/analysis');
const ResumeAnalysis = require('../models/resumeAnalysis');
const { getIntegrationSecretsSync } = require('../services/platformSettingsService');

const JOB_POOL_VERSION = 'jobs_pool_v2';

const uniqueStrings = (values = [], limit = 12) => {
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

const hasJSearchConfig = () => {
  const integrations = getIntegrationSecretsSync();
  if (integrations?.jobsEnabled === false) return false;
  const key = String(process.env.RAPIDAPI_KEY || integrations?.jobsApiKey || '').trim();
  return !!key && key !== 'your_rapidapi_key';
};

const flattenResumeSkills = (skillsMap = {}) => {
  if (!skillsMap) return [];
  const values = skillsMap instanceof Map
    ? Array.from(skillsMap.values())
    : Object.values(skillsMap);
  return uniqueStrings(values.flat(), 18);
};

const resolveDeveloperSignals = async (userId) => {
  if (!userId) {
    return {
      skillGaps: [],
      knownSkills: [],
      resumeSkills: [],
      githubSkills: []
    };
  }

  const [latestCache, latestResume, latestAnalysis] = await Promise.all([
    AnalysisCache.findOne({
      userId,
      'analysisData.missingSkills.0': { $exists: true }
    }).sort({ updatedAt: -1 }).lean(),
    ResumeAnalysis.findOne({ userId }).sort({ analyzedAt: -1 }).lean(),
    Analysis.findOne({ userId }).sort({ createdAt: -1 }).lean()
  ]);

  const skillGaps = Array.isArray(latestCache?.analysisData?.missingSkills)
    ? latestCache.analysisData.missingSkills.map((item) => item?.name || item)
    : [];
  const knownSkills = Array.isArray(latestCache?.analysisData?.yourSkills)
    ? latestCache.analysisData.yourSkills.map((item) => item?.name || item)
    : [];
  const githubSkills = latestAnalysis?.languageDistribution
    ? Object.keys(
        latestAnalysis.languageDistribution instanceof Map
          ? Object.fromEntries(latestAnalysis.languageDistribution)
          : latestAnalysis.languageDistribution
      )
    : [];

  return {
    skillGaps: uniqueStrings(skillGaps, 12),
    knownSkills: uniqueStrings(knownSkills, 20),
    resumeSkills: flattenResumeSkills(latestResume?.skills),
    githubSkills: uniqueStrings(githubSkills, 12)
  };
};

const buildCacheLookup = ({ careerStack, experienceLevel, skillGaps, resumeSkills, githubSkills, filters }) => {
  const seed = JSON.stringify({
    careerStack,
    experienceLevel,
    skillGaps: skillGaps.slice(0, 6),
    resumeSkills: resumeSkills.slice(0, 6),
    githubSkills: githubSkills.slice(0, 6),
    platform: filters.platform,
    location: filters.location,
    skills: filters.skills,
    jobType: filters.jobType,
    expLevel: filters.expLevel
  });
  const hash = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 20);

  return {
    signalHash: hash,
    cacheLookup: {
      githubUsername: `jobs_pool_${hash}`,
      careerStack,
      experienceLevel,
      analysisVersion: JOB_POOL_VERSION,
      resumeHash: 'no-resume',
      signalHash: hash
    }
  };
};

const buildSourceMeta = (jobs = []) => {
  const sourceSummary = jobs.reduce((accumulator, job) => {
    const source = String(job?.source || 'Unknown');
    accumulator[source] = (accumulator[source] || 0) + 1;
    return accumulator;
  }, {});

  const primarySource = Object.entries(sourceSummary)
    .sort((left, right) => Number(right[1]) - Number(left[1]))[0]?.[0] || 'Unknown';

  const jsearchConfigured = hasJSearchConfig();
  const jsearchCount = Number(sourceSummary.JSearch || 0);
  const aiCount = Number(sourceSummary.AI || 0);
  const fallbackCount = Number(sourceSummary.Fallback || 0);
  let sourceMessage = 'Showing curated fallback jobs because live source coverage is limited for these filters.';

  if (jsearchConfigured === false) {
    sourceMessage = 'Live job source is disabled right now. Showing AI-expanded and curated suggestions instead.';
  } else if (jsearchCount > 0) {
    sourceMessage = aiCount > 0 || fallbackCount > 0
      ? `Showing live jobs from JSearch with ${aiCount ? 'AI-expanded' : 'curated'} support for fuller coverage.`
      : 'Showing live jobs from JSearch.';
  } else if (aiCount > 0) {
    sourceMessage = 'Live source is unavailable for these filters. Showing AI-expanded suggestions and curated jobs.';
  }

  return {
    primarySource,
    sourceSummary,
    jsearchConfigured,
    sourceMessage
  };
};

const buildRecommendedBasedOn = ({
  careerStack,
  experienceLevel,
  knownSkills,
  skillGaps,
  resumeSkills,
  githubSkills,
  filters,
  fromCache
}) => {
  const activeFilters = {
    platform: filters.platform,
    location: filters.location,
    skills: filters.skills,
    jobType: filters.jobType,
    experienceLevel: filters.expLevel
  };
  const activeFilterParts = [];
  if (filters.platform !== 'All') activeFilterParts.push(filters.platform);
  if (filters.location !== 'All') activeFilterParts.push(filters.location);
  if (filters.jobType !== 'All') activeFilterParts.push(filters.jobType);
  if (filters.expLevel !== 'All') activeFilterParts.push(filters.expLevel);
  if (filters.skills) activeFilterParts.push(`skill: ${filters.skills}`);

  const summary = [
    `Jobs are ranked for your ${careerStack} profile at ${experienceLevel} level.`,
    skillGaps.length ? `Priority gaps used: ${skillGaps.slice(0, 4).join(', ')}.` : 'No explicit skill gaps were available, so broader stack matching was used.',
    activeFilterParts.length ? `Active filters: ${activeFilterParts.join(', ')}.` : 'No extra feed filters are active right now.'
  ].join(' ');

  return {
    careerStack,
    experienceLevel,
    knownSkills: knownSkills.slice(0, 5),
    skillGaps: skillGaps.slice(0, 4),
    resumeSkills: resumeSkills.slice(0, 4),
    githubSkills: githubSkills.slice(0, 4),
    activeFilters,
    fromCache,
    summary
  };
};

const fetchJobs = async (req, res) => {
  try {
    const careerStack = req.user?.careerStack || req.query.stack || 'Full Stack';
    const experienceLevel = req.user?.experienceLevel || req.query.experience || 'Student';
    const filters = normaliseJobFilters(req.query);
    const developerSignals = await resolveDeveloperSignals(req.user?._id);
    const { signalHash, cacheLookup } = buildCacheLookup({
      careerStack,
      experienceLevel,
      skillGaps: developerSignals.skillGaps,
      resumeSkills: developerSignals.resumeSkills,
      githubSkills: developerSignals.githubSkills,
      filters
    });

    let allJobs = null;
    let fromCache = false;
    const cached = await AnalysisCache.findOne(cacheLookup).lean();
    if (Array.isArray(cached?.analysisData?.allJobs)) {
      allJobs = cached.analysisData.allJobs;
      fromCache = true;
    }

    if (!allJobs) {
      allJobs = await buildJobPool({
        careerStack,
        experienceLevel,
        skillGaps: developerSignals.skillGaps,
        knownSkills: developerSignals.knownSkills,
        resumeSkills: developerSignals.resumeSkills,
        githubSkills: developerSignals.githubSkills,
        ...filters
      });

      AnalysisCache.findOneAndUpdate(
        cacheLookup,
        {
          $set: {
            userId: req.user?._id,
            githubUsername: cacheLookup.githubUsername,
            careerStack,
            experienceLevel,
            analysisVersion: JOB_POOL_VERSION,
            resumeHash: 'no-resume',
            signalHash,
            analysisData: { allJobs }
          }
        },
        { upsert: true }
      ).catch(() => null);
    }

    const total = Array.isArray(allJobs) ? allJobs.length : 0;
    const totalPages = Math.max(1, Math.ceil(total / filters.limit));
    const safePage = Math.min(filters.page, totalPages);
    const startIndex = (safePage - 1) * filters.limit;
    const jobs = (allJobs || []).slice(startIndex, startIndex + filters.limit);
    const sourceMeta = buildSourceMeta(allJobs || []);

    res.json({
      jobs,
      total,
      page: safePage,
      totalPages,
      hasMore: safePage < totalPages,
      fromCache,
      ...sourceMeta,
      recommendedBasedOn: buildRecommendedBasedOn({
        careerStack,
        experienceLevel,
        knownSkills: developerSignals.knownSkills,
        skillGaps: developerSignals.skillGaps,
        resumeSkills: developerSignals.resumeSkills,
        githubSkills: developerSignals.githubSkills,
        filters,
        fromCache
      })
    });
  } catch (error) {
    console.error('[JobController] Unhandled error:', error.message);
    res.status(500).json({ message: 'Failed to fetch job recommendations. Please try again.' });
  }
};

module.exports = { fetchJobs };
