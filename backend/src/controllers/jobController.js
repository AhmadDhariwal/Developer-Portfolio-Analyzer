const { buildJobPool, refreshJobCache, findCachedJobById, getSourceHealth, getCacheHealth, normaliseJobFilters, isUsableJob } = require('../services/jobService');
const AnalysisCache = require('../models/analysisCache');
const Analysis = require('../models/analysis');
const ResumeAnalysis = require('../models/resumeAnalysis');
const User = require('../models/user');
const Recommendation = require('../models/recommendation');
const CareerSprint = require('../models/careerSprint');
const { getIntegrationSecretsSync } = require('../services/platformSettingsService');
const { buildCoursePool } = require('../services/courseService');
const { rankJobs } = require('../utils/jobRanker');

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

const SOURCE_LABELS = {
  jsearch: 'JSearch',
  jooble: 'Jooble',
  adzuna: 'Adzuna',
  remotive: 'Remotive',
  arbeitnow: 'ArbeitNow',
  remoteok: 'RemoteOK',
  unknown: 'Unknown'
};

const flattenResumeSkills = (skillsMap = {}) => {
  if (!skillsMap) return [];
  const values = skillsMap instanceof Map
    ? Array.from(skillsMap.values())
    : Object.values(skillsMap);
  return uniqueStrings(values.flat(), 18);
};

const flattenResumeSignals = (resumeAnalysis = {}) => {
  const signals = resumeAnalysis?.resumeSignals || {};
  if (Array.isArray(signals.skills) && signals.skills.length) return uniqueStrings(signals.skills, 18);
  if (signals.technologyCategories && typeof signals.technologyCategories === 'object') {
    return uniqueStrings(Object.values(signals.technologyCategories).flat(), 18);
  }
  return flattenResumeSkills(resumeAnalysis?.skills);
};

const loadDefaultResumeAnalysis = async (userId) => {
  const user = await User.findById(userId).select('defaultResumeFileId').lean();
  if (user?.defaultResumeFileId) {
    const analysis = await ResumeAnalysis.findOne({ userId, fileId: user.defaultResumeFileId })
      .sort({ analyzedAt: -1 })
      .lean();
    if (analysis) return analysis;
  }
  return ResumeAnalysis.findOne({ userId }).sort({ analyzedAt: -1 }).lean();
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
    loadDefaultResumeAnalysis(userId),
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
    resumeSkills: flattenResumeSignals(latestResume),
    githubSkills: uniqueStrings(githubSkills, 12)
  };
};

const buildSourceMeta = (jobs = [], diagnostics = {}) => {
  const sourceSummary = jobs.reduce((accumulator, job) => {
    const rawSource = String(job?.source || 'Unknown').toLowerCase();
    const source = rawSource.includes('arbeit') ? 'arbeitnow' : rawSource;
    accumulator[source] = (accumulator[source] || 0) + 1;
    return accumulator;
  }, { jsearch: 0, jooble: 0, adzuna: 0, remotive: 0, arbeitnow: 0, remoteok: 0 });

  const primarySourceKey = Object.entries(sourceSummary)
    .sort((left, right) => Number(right[1]) - Number(left[1]))[0]?.[0] || 'unknown';
  const primarySource = SOURCE_LABELS[primarySourceKey] || primarySourceKey;

  const jsearchConfigured = hasJSearchConfig();
  const joobleConfigured = diagnostics?.sourceConfigs?.jooble?.configured ?? Boolean(process.env.JOOBLE_API_KEY);
  const jsearchCount = Number(sourceSummary.jsearch || 0);
  const secondaryCount = Number(sourceSummary.jooble || 0)
    + Number(sourceSummary.adzuna || 0)
    + Number(sourceSummary.remotive || 0)
    + Number(sourceSummary.arbeitnow || 0)
    + Number(sourceSummary.remoteok || 0);
  let sourceMessage = 'Showing real jobs from live sources and cached real-source results when needed.';

  if (diagnostics?.allLiveSourcesFailed && jobs.length) {
    sourceMessage = 'Live job sources are unavailable right now. Showing cached jobs from JobCache.';
  } else if (jsearchConfigured === false) {
    sourceMessage = joobleConfigured
      ? 'JSearch is disabled right now. Showing real jobs from Jooble, secondary sources, and cached real-source results.'
      : 'JSearch is disabled right now. Showing real jobs from secondary sources and cached real-source results only.';
  } else if (jsearchCount > 0) {
    sourceMessage = secondaryCount > 0
      ? 'Showing live jobs from JSearch plus secondary real job sources.'
      : 'Showing live jobs from JSearch.';
  } else if (secondaryCount > 0) {
    sourceMessage = 'Showing real jobs from secondary job sources because JSearch returned limited coverage.';
  } else if (!jobs.length) {
    sourceMessage = 'No real jobs were available for these filters right now. Try broader filters or refresh later.';
  }

  return {
    primarySource,
    sourceSummary,
    jsearchConfigured,
    joobleConfigured,
    sourceMessage
  };
};

const toSearchTokens = (...groups) => uniqueStrings(
  groups
    .flat()
    .flatMap((value) => String(value || '').split(/[^a-zA-Z0-9+#.]+/))
    .map((value) => value.trim())
    .filter((value) => value.length >= 2),
  18
).map((value) => value.toLowerCase());

const includesAnyToken = (text, tokens = []) => {
  const haystack = String(text || '').toLowerCase();
  return tokens.some((token) => haystack.includes(token));
};

const summarizeCourse = (course) => course ? {
  title: String(course.title || '').trim(),
  platform: String(course.platform || '').trim(),
  url: String(course.url || '').trim(),
  whyRecommended: String(course.whyRecommended || '').trim()
} : null;

const summarizeSprintTask = (task) => task ? {
  title: String(task.title || '').trim(),
  description: String(task.description || '').trim(),
  category: String(task.category || '').trim(),
  priority: String(task.priority || '').trim(),
  points: Number(task.points || 0)
} : null;

const resolveCareerExplanationSignals = async ({
  userId,
  careerStack,
  experienceLevel,
  developerSignals
}) => {
  if (!userId) {
    return { courses: [], sprintTasks: [], recommendationSkills: [] };
  }

  const [recommendations, sprint] = await Promise.all([
    Recommendation.find({ userId }).sort({ createdAt: -1 }).limit(8).lean(),
    CareerSprint.findOne({ userId }).sort({ updatedAt: -1 }).lean()
  ]);

  const recommendationSkills = uniqueStrings(
    (Array.isArray(recommendations) ? recommendations : [])
      .flatMap((item) => [
        ...(Array.isArray(item?.techStack) ? item.techStack : []),
        ...(Array.isArray(item?.isNewTech) ? item.isNewTech : []),
        item?.title,
        item?.category
      ]),
    12
  );
  const courseTopic = developerSignals.skillGaps?.[0] || recommendationSkills[0] || developerSignals.knownSkills?.[0] || '';
  let courses = [];

  try {
    courses = await buildCoursePool({
      platform: 'Other',
      limit: 12,
      careerStack,
      experienceLevel,
      topic: courseTopic,
      skillGaps: uniqueStrings([...(developerSignals.skillGaps || []), ...recommendationSkills], 12),
      knownSkills: developerSignals.knownSkills || []
    });
  } catch (error) {
    console.warn('[JobController] Learning Hub course signal unavailable:', error.message);
  }

  const sprintTasks = Array.isArray(sprint?.tasks)
    ? sprint.tasks.filter((task) => !task?.isCompleted)
    : [];

  return {
    courses: Array.isArray(courses) ? courses : [],
    sprintTasks,
    recommendationSkills
  };
};

const chooseRecommendedCourse = (job = {}, courses = []) => {
  const tokens = toSearchTokens(job.skills || [], job.missingSkills || [], job.title);
  const matched = courses.find((course) =>
    includesAnyToken(`${course?.title || ''} ${course?.description || ''} ${(course?.topics || []).join(' ')}`, tokens)
  );
  return summarizeCourse(matched || courses[0]);
};

const chooseRecommendedSprintTask = (job = {}, sprintTasks = []) => {
  if (!sprintTasks.length) return null;
  const tokens = toSearchTokens(job.skills || [], job.missingSkills || [], job.title);
  const matched = sprintTasks.find((task) => includesAnyToken(`${task?.title || ''} ${task?.description || ''}`, tokens));
  return summarizeSprintTask(matched || sprintTasks[0]);
};

const enrichJobsWithCareerSignals = async (jobs = [], context = {}) => {
  const careerSignals = await resolveCareerExplanationSignals(context);
  return (Array.isArray(jobs) ? jobs : []).map((job) => ({
    ...job,
    recommendedCourse: chooseRecommendedCourse(job, careerSignals.courses),
    recommendedSprintTask: chooseRecommendedSprintTask(job, careerSignals.sprintTasks)
  }));
};

const rankAndEnrichCachedJob = async (job, {
  userId,
  careerStack,
  experienceLevel,
  developerSignals
}) => {
  const [rankedJob] = rankJobs([job], {
    careerStack,
    experienceLevel,
    skillGaps: developerSignals.skillGaps,
    knownSkills: developerSignals.knownSkills,
    resumeSkills: developerSignals.resumeSkills,
    githubSkills: developerSignals.githubSkills
  });
  const [enrichedJob] = await enrichJobsWithCareerSignals([rankedJob || job], {
    userId,
    careerStack,
    experienceLevel,
    developerSignals
  });
  return enrichedJob;
};

const getCacheHealthStatus = async (_req, res) => {
  try {
    const payload = await getCacheHealth();
    return res.json(payload);
  } catch (error) {
    console.error('[JobController] Failed to fetch cache health:', error.message);
    return res.status(500).json({ message: 'Failed to fetch job cache health. Please try again.' });
  }
};

const getSourceHealthStatus = async (_req, res) => {
  try {
    const payload = await getSourceHealth();
    return res.json(payload);
  } catch (error) {
    console.error('[JobController] Failed to fetch source health:', error.message);
    return res.status(500).json({ message: 'Failed to fetch job source health. Please try again.' });
  }
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
    const jobPool = await buildJobPool({
      careerStack,
      experienceLevel,
      skillGaps: developerSignals.skillGaps,
      knownSkills: developerSignals.knownSkills,
      resumeSkills: developerSignals.resumeSkills,
      githubSkills: developerSignals.githubSkills,
      ...filters
    });
    const allJobs = (jobPool.jobs || []).filter(isUsableJob);
    const enrichedAllJobs = await enrichJobsWithCareerSignals(allJobs, {
      userId: req.user?._id,
      careerStack,
      experienceLevel,
      developerSignals
    });
    const diagnostics = jobPool.diagnostics || null;
    const fromCache = Boolean(diagnostics?.fromCacheOnly);

    const total = Array.isArray(enrichedAllJobs) ? enrichedAllJobs.length : 0;
    const totalPages = Math.max(1, Math.ceil(total / filters.limit));
    const safePage = Math.min(filters.page, totalPages);
    const startIndex = (safePage - 1) * filters.limit;
    const jobs = (enrichedAllJobs || []).slice(startIndex, startIndex + filters.limit);
    const sourceMeta = buildSourceMeta(allJobs || [], diagnostics || {});

    res.json({
      jobs,
      total,
      page: safePage,
      totalPages,
      hasMore: safePage < totalPages,
      fromCache,
      ...sourceMeta,
      sourceFailures: diagnostics?.sourceFailures || [],
      cacheCount: Number(diagnostics?.cacheCount || 0),
      warning: diagnostics?.applyFilters?.warning || undefined,
      diagnostics: diagnostics || undefined,
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

const getJobById = async (req, res) => {
  try {
    const id = decodeURIComponent(String(req.params.id || '').trim());
    if (!id) {
      return res.status(400).json({ message: 'Job id is required.' });
    }

    const careerStack = req.user?.careerStack || 'Full Stack';
    const experienceLevel = req.user?.experienceLevel || 'Student';
    const developerSignals = await resolveDeveloperSignals(req.user?._id);
    const cachedJob = await findCachedJobById(id);
    if (cachedJob && isUsableJob(cachedJob)) {
      const job = await rankAndEnrichCachedJob(cachedJob, {
        userId: req.user?._id,
        careerStack,
        experienceLevel,
        developerSignals
      });
      return res.json({ job });
    }

    await refreshJobCache({
      careerStack,
      knownSkills: developerSignals.knownSkills,
      resumeSkills: developerSignals.resumeSkills,
      platform: 'All',
      location: 'All',
      skills: '',
      jobType: 'All',
      expLevel: 'All'
    });

    const refreshedJob = await findCachedJobById(id);
    if (refreshedJob && isUsableJob(refreshedJob)) {
      const job = await rankAndEnrichCachedJob(refreshedJob, {
        userId: req.user?._id,
        careerStack,
        experienceLevel,
        developerSignals
      });
      return res.json({ job });
    }

    return res.status(404).json({ message: 'Job details are no longer available. Refresh Jobs Hub and try again.' });
  } catch (error) {
    console.error('[JobController] Failed to fetch job details:', error.message);
    return res.status(500).json({ message: 'Failed to fetch job details. Please try again.' });
  }
};

module.exports = { fetchJobs, getJobById, getSourceHealthStatus, getCacheHealthStatus };
