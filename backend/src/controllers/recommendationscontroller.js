const crypto = require('node:crypto');
const aiService = require('../services/aiservice');
const { getRecommendationPrompt } = require('../prompts/recommendationPrompt');
const { getSkillGapPrompt } = require('../prompts/skillGapPrompt');
const AnalysisCache = require('../models/analysisCache');
const ResumeAnalysis = require('../models/resumeAnalysis');
const User = require('../models/user');
const { createVersion } = require('../services/aiVersionService');
const {
  getDeveloperSignals,
  buildSignalHash,
  buildSignalsUsedSummary
} = require('../services/developerSignalService');

const RECOMMENDATION_ANALYSIS_VERSION = 'v3-signals';
const SKILL_GAP_LOOKUP_VERSION = 'v4-signals';

const isValidUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value.trim());
const toSearchUrl = (query) => `https://www.google.com/search?q=${encodeURIComponent(String(query || 'software engineering'))}`;

const normalizeProjectLink = (project) => {
  if (isValidUrl(project?.startUrl)) return project.startUrl.trim();
  if (isValidUrl(project?.url)) return project.url.trim();
  const query = `${project?.title || 'software project'} github tutorial`;
  return toSearchUrl(query);
};

const normalizeCareerPathLink = (path) => {
  if (isValidUrl(path?.exploreUrl)) return path.exploreUrl.trim();
  if (isValidUrl(path?.url)) return path.url.trim();
  const query = `${path?.title || 'software engineer'} career roadmap`;
  return toSearchUrl(query);
};

const toSkillName = (value) => (typeof value === 'string' ? value : value?.name || '').trim();

const flattenResumeSkills = (skillsMap = {}) => {
  if (!skillsMap) return [];
  const values = skillsMap instanceof Map
    ? Array.from(skillsMap.values())
    : Object.values(skillsMap);
  return values.flat().map(String).map((value) => value.trim()).filter(Boolean);
};

const uniqueBy = (values = [], keyFn) => {
  const seen = new Set();
  return values.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const uniqueStrings = (values = [], limit = 12) => uniqueBy(
  values.map((value) => String(value || '').trim()).filter(Boolean),
  (value) => value.toLowerCase()
).slice(0, limit);

const clamp = (value, min = 0, max = 100) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, Math.round(numeric)));
};

const priorityToRaw = (priority = '') => {
  const normalized = String(priority || '').toLowerCase();
  if (normalized.includes('must') || normalized.includes('high')) return 'High';
  if (normalized.includes('medium')) return 'Medium';
  return 'Low';
};

const normalizeActionList = (values = [], fallback = [], min = 2, max = 6) => {
  const safe = uniqueStrings(values, max);
  if (safe.length >= min) return safe.slice(0, max);
  return uniqueStrings([...safe, ...fallback], max).slice(0, Math.max(min, Math.min(max, safe.length + fallback.length)));
};

const normalizeRecommendationPayload = (payload = {}) => {
  const projects = Array.isArray(payload.projects) ? payload.projects : [];
  const technologies = Array.isArray(payload.technologies) ? payload.technologies : [];
  const careerPaths = Array.isArray(payload.careerPaths) ? payload.careerPaths : [];

  return {
    ...payload,
    analysisSummary: String(payload.analysisSummary || '').trim(),
    projects: projects.map((project, index) => ({
      ...project,
      id: project.id || `p_${index + 1}`,
      tech: uniqueStrings(project.tech || [], 8),
      newTech: uniqueStrings(project.newTech || [], 4),
      impact: clamp(project.impact || 0),
      startUrl: normalizeProjectLink(project)
    })),
    technologies: technologies.map((technology) => ({
      ...technology,
      priorityRaw: priorityToRaw(technology.priorityRaw || technology.priority)
    })),
    careerPaths: careerPaths.map((path, index) => ({
      ...path,
      id: path.id || `c_${index + 1}`,
      hiringCompanies: uniqueStrings(path.hiringCompanies || [], 6),
      actionItems: uniqueStrings(path.actionItems || [], 6),
      exploreUrl: normalizeCareerPathLink(path)
    })),
    portfolioRecommendations: normalizeActionList(payload.portfolioRecommendations, [], 0, 4),
    resumeRecommendations: normalizeActionList(payload.resumeRecommendations, [], 0, 4),
    learningActions: normalizeActionList(payload.learningActions, [], 0, 6),
    interviewReadinessActions: normalizeActionList(payload.interviewReadinessActions, [], 0, 4)
  };
};

const saveAIVersionSnapshot = async ({ req, source, output, metadata = {} }) => {
  if (!req.user?._id || !output || typeof output !== 'object') return;
  try {
    await createVersion({
      userId: req.user._id,
      source,
      outputJson: output,
      metadata
    });
  } catch (error) {
    console.error('Recommendation AI snapshot error:', error.message);
  }
};

const loadResumeAnalysis = async (userId) => {
  if (!userId) return null;
  const userContext = await User.findById(userId)
    .select('activeResumeFileId defaultResumeFileId')
    .lean();
  const activeResumeFileId = userContext?.activeResumeFileId || userContext?.defaultResumeFileId || null;
  if (activeResumeFileId) {
    const activeAnalysis = await ResumeAnalysis.findOne({ userId, fileId: activeResumeFileId })
      .sort({ analyzedAt: -1 })
      .lean();
    if (activeAnalysis) return activeAnalysis;
  }
  return ResumeAnalysis.findOne({ userId }).sort({ analyzedAt: -1 }).lean();
};

const getGitHubData = async (username) => {
  const { analyzeGitHubProfile } = require('../services/githubservice');
  try {
    return await analyzeGitHubProfile(String(username || '').trim());
  } catch (githubError) {
    console.warn('Recommendations GitHub fallback:', githubError.message);
    return {
      repoCount: 0,
      developerLevel: 'Unknown',
      strengths: [],
      weakAreas: [],
      languageDistribution: [],
      scores: {},
      repositories: []
    };
  }
};

const buildResumeInsights = (analysis, fallbackExperienceLevel = '') => {
  const resumeSkills = flattenResumeSkills(analysis?.skills);
  return {
    experienceLevel: analysis?.experienceLevel || fallbackExperienceLevel || '',
    experienceYears: analysis?.experienceYears || 0,
    atsScore: analysis?.atsScore || 0,
    keywordDensity: analysis?.keywordDensity || 0,
    skills: resumeSkills.slice(0, 25),
    keyAchievements: (analysis?.keyAchievements || []).slice(0, 8)
  };
};

const buildGithubInsights = (githubData = {}) => ({
  repoCount: githubData?.repoCount || 0,
  developerLevel: githubData?.developerLevel || '',
  strengths: githubData?.strengths || [],
  weakAreas: githubData?.weakAreas || [],
  languageDistribution: githubData?.languageDistribution || [],
  scores: githubData?.scores || {}
});

const buildRecommendationFallback = ({
  username,
  careerStack,
  experienceLevel,
  knownSkills,
  missingSkills,
  resumeInsights,
  githubInsights,
  developerSignals
}) => {
  const sprintSignal = developerSignals.careerSprintSignal || {};
  const weeklySignal = developerSignals.weeklyReportSignal || {};
  const portfolioSignal = developerSignals.portfolioSignal || {};
  const integrationSignal = developerSignals.integrationSignal || {};

  const focusSkills = uniqueStrings([
    ...missingSkills,
    ...(weeklySignal.repeatedWeakAreas || []),
    ...(sprintSignal.repeatedIncompleteSkills || []),
    ...(integrationSignal.weakProof || [])
  ], 6);
  const baseTech = uniqueStrings(knownSkills, 5);
  const summaryParts = [
    githubInsights.repoCount > 0 ? `${username} has ${githubInsights.repoCount} repositories contributing live code evidence` : 'GitHub signal is currently limited',
    resumeInsights.atsScore ? `resume ATS signal is ${resumeInsights.atsScore}` : 'resume ATS signal is limited',
    portfolioSignal.completenessScore ? `portfolio completeness is ${portfolioSignal.completenessScore}%` : 'portfolio evidence is still thin',
    weeklySignal.weeklyProgressScore ? `weekly progress is ${weeklySignal.weeklyProgressScore}%` : 'weekly progress data is limited'
  ];

  const projectTemplates = focusSkills.slice(0, 3).map((skill, index) => ({
    id: `p_${index + 1}`,
    title: `${careerStack} ${skill} Builder`,
    description: `Ship a scoped ${careerStack.toLowerCase()} project that proves ${skill} with measurable functionality and clean delivery.`,
    tech: baseTech,
    newTech: skill ? [skill] : [],
    difficulty: sprintSignal.consistencyScore < 45 ? 'Beginner' : experienceLevel.includes('5+') ? 'Advanced' : 'Intermediate',
    impact: clamp(72 + (index * 6) + (weeklySignal.weeklyProgressScore >= 70 ? 8 : 0)),
    estimatedWeeks: sprintSignal.consistencyScore < 45 ? '1-2 weeks' : '2-4 weeks',
    whyThisProject: `This directly addresses ${skill} while keeping the build realistic for ${experienceLevel} level progression.`,
    startUrl: toSearchUrl(`${careerStack} ${skill} project tutorial`)
  }));

  const technologyTemplates = focusSkills.slice(0, 6).map((skill, index) => ({
    name: skill,
    category: index < 2 ? 'Priority Gap' : 'Growth Opportunity',
    priority: index < 2 ? 'Must Learn' : index < 4 ? 'High' : 'Medium',
    priorityRaw: index < 2 ? 'High' : index < 4 ? 'High' : 'Medium',
    jobDemand: clamp(88 - (index * 4)),
    description: `${skill} is showing up as a meaningful gap across your current code, profile, or progress signals.`
  }));

  const roleLabel = `${careerStack} Engineer`;
  const careerPaths = [
    {
      id: 'c_1',
      title: roleLabel,
      match: clamp(76 + Math.min(12, knownSkills.length)),
      salaryRange: 'Market dependent',
      description: `Best-fit target path based on current stack evidence from GitHub, resume, and recent learning focus.`,
      timeline: sprintSignal.consistencyScore < 45 ? '4-8 months' : '3-6 months',
      hiringCompanies: ['Product teams', 'SaaS companies', 'Startups'],
      actionItems: normalizeActionList([
        `Convert ${focusSkills[0] || 'your main gap'} into a shipped project`,
        `Quantify ${resumeInsights.keyAchievements?.[0] || 'recent outcomes'} on your resume`
      ], [], 2, 4),
      exploreUrl: toSearchUrl(`${careerStack} engineer roadmap`)
    },
    {
      id: 'c_2',
      title: `${careerStack} Platform Contributor`,
      match: clamp(64 + (githubInsights.scores?.architecture || 0)),
      salaryRange: 'Market dependent',
      description: 'Good secondary path if you deepen delivery, reliability, and collaboration proof.',
      timeline: '6-9 months',
      hiringCompanies: ['Growth-stage startups', 'Platform teams'],
      actionItems: normalizeActionList([
        `Improve ${focusSkills[1] || 'delivery quality'} through a production-like build`,
        'Add clearer architectural tradeoffs in project documentation'
      ], [], 2, 4),
      exploreUrl: toSearchUrl(`${careerStack} platform engineer roadmap`)
    },
    {
      id: 'c_3',
      title: 'Solution-Focused Developer',
      match: clamp(58 + portfolioSignal.projectPresentationQuality),
      salaryRange: 'Market dependent',
      description: 'A practical alternative path for developers growing stronger product and communication proof.',
      timeline: '6-12 months',
      hiringCompanies: ['Consultancies', 'Service companies'],
      actionItems: normalizeActionList([
        'Polish portfolio case studies with clearer outcomes',
        'Add stronger external proof through integrations and shipped demos'
      ], [], 2, 4),
      exploreUrl: toSearchUrl('software consultant developer roadmap')
    }
  ];

  return normalizeRecommendationPayload({
    analysisSummary: `${summaryParts[0]}, ${summaryParts[1]}, ${summaryParts[2]}, and ${summaryParts[3]}. Recommendations therefore prioritize ${focusSkills[0] || 'the highest-value missing proof'} through realistic next steps.`,
    projects: projectTemplates,
    technologies: technologyTemplates,
    careerPaths,
    portfolioRecommendations: normalizeActionList([
      portfolioSignal.completenessScore < 60 ? 'Add 2 polished project case studies with outcomes and screenshots' : '',
      portfolioSignal.liveLinks < Math.min(2, portfolioSignal.listedProjects || 0) ? 'Add working live links for your strongest public projects' : '',
      !portfolioSignal.present ? 'Create a public portfolio page that highlights your strongest shipped work' : ''
    ], ['Refresh project summaries so recruiters can scan impact quickly'], 2, 4),
    resumeRecommendations: normalizeActionList([
      resumeInsights.atsScore < 70 ? 'Increase ATS alignment by mirroring target-role keywords naturally in experience bullets' : '',
      !resumeInsights.keyAchievements?.length ? 'Add quantified impact bullets for your most relevant projects and roles' : '',
      resumeInsights.keywordDensity < 55 ? 'Tighten skill-to-experience alignment so core stack keywords appear with evidence' : ''
    ], ['Review resume bullets for stronger measurable outcomes'], 2, 4),
    learningActions: normalizeActionList([
      sprintSignal.consistencyScore < 45 ? `Break ${focusSkills[0] || 'your next gap'} into 30-45 minute sessions instead of one large weekly task` : '',
      weeklySignal.weeklyProgressScore < 50 ? 'Pick one priority gap and finish a proof-of-work artifact before adding another topic' : '',
      sprintSignal.repeatedIncompleteSkills?.[0] ? `Resolve the repeated incomplete area around ${sprintSignal.repeatedIncompleteSkills[0]}` : '',
      focusSkills[0] ? `Practice ${focusSkills[0]} inside a real repository rather than isolated notes only` : ''
    ], ['Stay consistent with one focused learning goal this week'], 3, 6),
    interviewReadinessActions: normalizeActionList([
      integrationSignal.usedProviders.includes('leetcode') ? '' : 'Start a lightweight DSA routine to strengthen coding interview readiness',
      githubInsights.weakAreas?.[0] ? `Prepare concise explanations for ${githubInsights.weakAreas[0]} tradeoffs in interviews` : '',
      resumeInsights.keyAchievements?.[0] ? `Turn "${resumeInsights.keyAchievements[0]}" into a STAR-style interview story` : 'Prepare two project stories with measurable outcomes'
    ], ['Practice explaining one shipped project end-to-end'], 2, 4)
  });
};

const buildResumeHash = (resumeText = '') => {
  const cleanResume = String(resumeText || '').trim();
  return cleanResume
    ? crypto.createHash('sha256').update(cleanResume).digest('hex')
    : 'no-resume';
};

const loadDeveloperSignalsSafely = async ({ userId, username, resumeInsights, githubInsights, allowSignals }) => {
  if (!allowSignals || !userId) {
    const emptySignals = {
      careerSprintSignal: { present: false, completedTasks: 0, missedTasks: 0, streak: 0, consistencyScore: 0, activeLearningFocus: '', repeatedIncompleteSkills: [], completedSkillSignals: [], progressPercent: 0, status: 'Unavailable', updatedAt: null },
      weeklyReportSignal: { present: false, weeklyProgressScore: 0, status: 'Unavailable', completedRecommendations: null, missedRecommendations: null, skillsImprovedThisWeek: [], repeatedWeakAreas: [], trendDelta: 0, updatedAt: null },
      portfolioSignal: { present: false, completenessScore: 0, listedProjects: 0, liveLinks: 0, githubLinks: 0, contactVisibility: false, projectPresentationQuality: 0, publicEnabled: false, portfolioSkills: [], updatedAt: null },
      integrationSignal: { present: false, usedProviders: [], integrationScore: 0, strongestProof: [], weakProof: [], detectedSkills: [], certifications: [], updatedAt: null }
    };

    return {
      developerSignals: emptySignals,
      signalHash: 'no-signals',
      signalsUsed: buildSignalsUsedSummary({
        username,
        resumeInsights,
        githubInsights,
        signals: emptySignals
      })
    };
  }

  try {
    const developerSignals = await getDeveloperSignals(userId);
    const signalHash = buildSignalHash(developerSignals);
    const signalsUsed = buildSignalsUsedSummary({
      username,
      resumeInsights,
      githubInsights,
      signals: developerSignals
    });
    return { developerSignals, signalHash, signalsUsed };
  } catch (error) {
    console.warn('Developer signal fallback:', error.message);
    return loadDeveloperSignalsSafely({
      userId: null,
      username,
      resumeInsights,
      githubInsights,
      allowSignals: false
    });
  }
};

const resolveKnownAndMissingSkills = async ({
  username,
  careerStack,
  experienceLevel,
  resumeText,
  resumeSkills,
  githubData,
  resumeInsights,
  githubInsights,
  developerSignals,
  providedKnownSkills,
  providedMissingSkills
}) => {
  let knownSkills = Array.isArray(providedKnownSkills) ? providedKnownSkills : null;
  let missingSkills = Array.isArray(providedMissingSkills) ? providedMissingSkills : null;

  if (!knownSkills || !missingSkills) {
    const lookupHash = buildResumeHash(resumeText);
    const cachedGap = await AnalysisCache.findOne({
      githubUsername: username,
      careerStack,
      experienceLevel,
      resumeHash: lookupHash,
      analysisVersion: SKILL_GAP_LOOKUP_VERSION
    }).lean();

    if (cachedGap?.analysisData?.missingSkills?.length) {
      missingSkills = missingSkills || cachedGap.analysisData.missingSkills.map((skill) => skill.name || skill);
      knownSkills = knownSkills || (cachedGap.analysisData.yourSkills?.map((skill) => skill.name || skill) ?? []);
    } else {
      const detectedSkills = {
        github: (githubData.repositories || [])
          .map((repo) => `${repo.name} (${repo.language || 'Unknown'})`)
          .concat(resumeSkills.slice(0, 15)),
        repoQuality: githubData.scores || {}
      };
      const gapPrompt = getSkillGapPrompt(
        careerStack,
        experienceLevel,
        detectedSkills,
        resumeInsights,
        githubInsights,
        developerSignals
      );
      const gapResult = await aiService.runAIAnalysis(gapPrompt, {
        yourSkills: [],
        missingSkills: [],
        coverage: 0,
        missing: 0,
        levelAssessment: '',
        roadmap: [],
        totalWeeks: 'N/A'
      });

      missingSkills = missingSkills || (gapResult.missingSkills?.map((skill) => skill.name || skill) ?? []);
      knownSkills = knownSkills || (gapResult.yourSkills?.map((skill) => skill.name || skill) ?? []);
    }
  }

  const integrationSkills = developerSignals.integrationSignal?.detectedSkills || [];
  const sprintEvidenceSkills = developerSignals.careerSprintSignal?.completedSkillSignals || [];
  const portfolioSkills = developerSignals.portfolioSignal?.portfolioSkills || [];

  return {
    knownSkills: uniqueStrings([
      ...(knownSkills || []),
      ...resumeSkills,
      ...(githubData?.languageDistribution || []).map((language) => language.language),
      ...integrationSkills,
      ...sprintEvidenceSkills,
      ...portfolioSkills
    ], 30),
    missingSkills: uniqueStrings(
      (missingSkills || []).map((skill) => toSkillName(skill)).filter(Boolean),
      20
    )
  };
};

const finalizeRecommendationResult = ({
  username,
  careerStack,
  experienceLevel,
  rawResult,
  fallback,
  resumeInsights,
  githubInsights,
  signalsUsed
}) => {
  const projects = uniqueBy(Array.isArray(rawResult.projects) ? rawResult.projects : [], (item) => String(item?.title || '').toLowerCase());
  const technologies = uniqueBy(Array.isArray(rawResult.technologies) ? rawResult.technologies : [], (item) => String(item?.name || '').toLowerCase());
  const careerPaths = uniqueBy(Array.isArray(rawResult.careerPaths) ? rawResult.careerPaths : [], (item) => String(item?.title || '').toLowerCase());

  while (projects.length < 3 && fallback.projects[projects.length]) projects.push(fallback.projects[projects.length]);
  while (technologies.length < 6 && fallback.technologies[technologies.length]) technologies.push(fallback.technologies[technologies.length]);
  while (careerPaths.length < 3 && fallback.careerPaths[careerPaths.length]) careerPaths.push(fallback.careerPaths[careerPaths.length]);

  return normalizeRecommendationPayload({
    username,
    careerStack,
    experienceLevel,
    analysisSummary: rawResult.analysisSummary || fallback.analysisSummary || '',
    projects: projects.slice(0, 8),
    technologies: technologies.slice(0, 12),
    careerPaths: careerPaths.slice(0, 6),
    portfolioRecommendations: normalizeActionList(rawResult.portfolioRecommendations, fallback.portfolioRecommendations, 2, 4),
    resumeRecommendations: normalizeActionList(rawResult.resumeRecommendations, fallback.resumeRecommendations, 2, 4),
    learningActions: normalizeActionList(rawResult.learningActions, fallback.learningActions, 3, 6),
    interviewReadinessActions: normalizeActionList(rawResult.interviewReadinessActions, fallback.interviewReadinessActions, 2, 4),
    resumeInsights,
    githubInsights,
    signalsUsed
  });
};

const runRecommendationPipeline = async ({
  req,
  res,
  username,
  careerStack,
  experienceLevel,
  resumeText,
  knownSkills,
  missingSkills,
  userId,
  allowSignals,
  saveResult,
  source
}) => {
  const githubData = await getGitHubData(username);
  const latestResumeAnalysis = await loadResumeAnalysis(userId);
  const resumeInsights = buildResumeInsights(latestResumeAnalysis, experienceLevel);
  const githubInsights = buildGithubInsights(githubData);
  const { developerSignals, signalHash, signalsUsed } = await loadDeveloperSignalsSafely({
    userId,
    username,
    resumeInsights,
    githubInsights,
    allowSignals
  });

  const resolvedSkills = await resolveKnownAndMissingSkills({
    username,
    careerStack,
    experienceLevel,
    resumeText,
    resumeSkills: resumeInsights.skills,
    githubData,
    resumeInsights,
    githubInsights,
    developerSignals,
    providedKnownSkills: knownSkills,
    providedMissingSkills: missingSkills
  });

  const resumeHash = buildResumeHash(resumeText);
  const cacheKey = {
    githubUsername: username,
    careerStack,
    experienceLevel,
    resumeHash,
    signalHash,
    analysisVersion: RECOMMENDATION_ANALYSIS_VERSION
  };

  if (saveResult) {
    const cached = await AnalysisCache.findOne(cacheKey).lean();
    if (cached?.analysisData?.projects?.length) {
      const cachedResult = { ...normalizeRecommendationPayload(cached.analysisData), fromCache: true };
      await saveAIVersionSnapshot({
        req,
        source,
        output: cachedResult,
        metadata: { fromCache: true, username, careerStack, experienceLevel, signalHash }
      });
      return res.json(cachedResult);
    }
  }

  const fallback = buildRecommendationFallback({
    username,
    careerStack,
    experienceLevel,
    knownSkills: resolvedSkills.knownSkills,
    missingSkills: resolvedSkills.missingSkills,
    resumeInsights,
    githubInsights,
    developerSignals
  });
  const prompt = getRecommendationPrompt(
    careerStack,
    experienceLevel,
    resolvedSkills.knownSkills,
    resolvedSkills.missingSkills,
    resumeInsights,
    githubInsights,
    developerSignals
  );

  const aiResult = await aiService.runAIAnalysis(prompt, fallback);
  const fullResult = finalizeRecommendationResult({
    username,
    careerStack,
    experienceLevel,
    rawResult: aiResult,
    fallback,
    resumeInsights,
    githubInsights,
    signalsUsed
  });

  if (saveResult && req.user?._id) {
    await AnalysisCache.findOneAndUpdate(
      cacheKey,
      {
        $set: {
          analysisData: fullResult,
          userId: req.user._id
        }
      },
      { upsert: true }
    );
  }

  await saveAIVersionSnapshot({
    req,
    source,
    output: fullResult,
    metadata: { fromCache: false, username, careerStack, experienceLevel, signalHash }
  });

  return res.json(fullResult);
};

/**
 * @desc Generate personalised roadmap and project suggestions
 * @route POST /api/recommendations
 */
const getRecommendations = async (req, res) => {
  try {
    let { username, knownSkills, missingSkills, resumeText } = req.body;
    username = username || req.user?.activeGithubUsername || req.user?.githubUsername;

    const careerStack = req.user?.careerStack || req.body.careerStack || 'Full Stack';
    const experienceLevel = req.user?.experienceLevel || req.body.experienceLevel || 'Student';

    if (!username) {
      return res.status(400).json({ message: 'Username is required.' });
    }

    return runRecommendationPipeline({
      req,
      res,
      username: username.trim(),
      careerStack,
      experienceLevel,
      resumeText,
      knownSkills,
      missingSkills,
      userId: req.user?._id || null,
      allowSignals: true,
      saveResult: true,
      source: 'recommendations'
    });
  } catch (error) {
    console.error('Recommendations Error:', error.message);
    return res.status(500).json({
      message: 'Failed to generate recommendations.',
      error: error.message
    });
  }
};

/**
 * @desc Generate recommendations (supports both temporary and permanent analysis)
 * @route POST /api/recommendations/generate
 */
const generateRecommendations = async (req, res) => {
  try {
    let {
      githubUsername,
      careerStack,
      experienceLevel,
      isTemporary,
      missingSkills,
      knownSkills,
      resumeText
    } = req.body;
    const isTemporaryMode = isTemporary === true || isTemporary === 'true';

    if (!githubUsername) {
      return res.status(400).json({ message: 'GitHub username is required.' });
    }

    if (!careerStack) {
      return res.status(400).json({ message: 'Career stack is required.' });
    }

    if (!experienceLevel) {
      return res.status(400).json({ message: 'Experience level is required.' });
    }

    const finalCareerStack = isTemporaryMode
      ? careerStack
      : (req.user?.careerStack || careerStack || 'Full Stack');
    const finalExperienceLevel = isTemporaryMode
      ? experienceLevel
      : (req.user?.experienceLevel || experienceLevel || 'Student');

    return runRecommendationPipeline({
      req,
      res,
      username: githubUsername.trim(),
      careerStack: finalCareerStack,
      experienceLevel: finalExperienceLevel,
      resumeText,
      knownSkills,
      missingSkills,
      userId: !isTemporaryMode ? (req.user?._id || null) : null,
      allowSignals: !isTemporaryMode,
      saveResult: !isTemporaryMode,
      source: 'recommendations/generate'
    });
  } catch (error) {
    console.error('Generate Recommendations Error:', error.message);
    return res.status(500).json({
      message: 'Failed to generate recommendations.',
      error: error.message
    });
  }
};

module.exports = { getRecommendations, generateRecommendations };
