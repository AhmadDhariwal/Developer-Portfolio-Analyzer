const crypto = require('node:crypto');
const { analyzeGitHubProfile } = require('../services/githubservice');
const aiService = require('../services/aiservice');
const { getSkillGapPrompt } = require('../prompts/skillGapPrompt');
const AnalysisCache = require('../models/analysisCache');
const ResumeAnalysis = require('../models/resumeAnalysis');
const User = require('../models/user');
const { createVersion } = require('../services/aiVersionService');
const { buildSkillGraph, generateWeeklyLearningRoadmap } = require('../services/skillGraphService');
const {
  getDeveloperSignals,
  buildSignalHash,
  buildSignalsUsedSummary
} = require('../services/developerSignalService');

const ANALYSIS_VERSION = 'v4-signals';
const MIN_MISSING_SKILLS = 12;
const MIN_KNOWN_SKILLS = 8;

const DEFAULT_MISSING_SKILLS = [
  'Testing',
  'System Design',
  'CI/CD',
  'Docker',
  'SQL',
  'Cloud Basics',
  'Security Basics',
  'Performance Optimization',
  'Design Patterns',
  'Monitoring and Observability',
  'API Versioning',
  'Caching Strategies',
  'Scalability Patterns',
  'Accessibility',
  'Documentation'
];

const isValidUrl = (value) => typeof value === 'string' && /^https?:\/\//i.test(value.trim());

const toDocSearchUrl = (topic) => {
  const query = encodeURIComponent(String(topic || 'software engineering docs'));
  return `https://www.google.com/search?q=${query}`;
};

const normalizeRoadmapResource = (resource, fallbackTopic = 'software engineering docs') => {
  if (typeof resource === 'object' && resource !== null) {
    const title = String(resource.title || resource.name || fallbackTopic).trim();
    const url = isValidUrl(resource.url) ? resource.url.trim() : toDocSearchUrl(title || fallbackTopic);
    return { title, url };
  }

  const text = String(resource || '').trim();
  if (!text) {
    return { title: fallbackTopic, url: toDocSearchUrl(fallbackTopic) };
  }

  if (isValidUrl(text)) {
    return { title: text.replace(/^https?:\/\//i, '').slice(0, 80), url: text };
  }

  return { title: text, url: toDocSearchUrl(text) };
};

const normalizeRoadmap = (roadmap = [], min = 3) => {
  const defaults = [
    {
      phase: 'Phase 1',
      title: 'Core Foundations',
      description: 'Build strong fundamentals for your current stack.',
      duration: '2-3 weeks',
      skills: ['Core language fundamentals', 'Git workflows'],
      resources: [
        { title: 'Official language docs', url: 'https://developer.mozilla.org/' },
        { title: 'Git documentation', url: 'https://git-scm.com/doc' }
      ],
      color: 'blue'
    },
    {
      phase: 'Phase 2',
      title: 'Project Depth',
      description: 'Apply missing skills in practical projects.',
      duration: '3-4 weeks',
      skills: ['Build one production-like project', 'Add tests and CI'],
      resources: [
        { title: 'Docker docs', url: 'https://docs.docker.com/' },
        { title: 'GitHub Actions docs', url: 'https://docs.github.com/en/actions' }
      ],
      color: 'green'
    },
    {
      phase: 'Phase 3',
      title: 'Interview Readiness',
      description: 'Prepare portfolio and interview-focused practice.',
      duration: '2-3 weeks',
      skills: ['System design practice', 'Behavioral storytelling'],
      resources: [
        { title: 'System Design Primer', url: 'https://github.com/donnemartin/system-design-primer' },
        { title: 'LeetCode', url: 'https://leetcode.com/' }
      ],
      color: 'orange'
    }
  ];

  const safe = Array.isArray(roadmap) ? [...roadmap] : [];
  while (safe.length < min) safe.push(defaults[safe.length % defaults.length]);

  return safe.map((phase, index) => {
    const phaseSkills = Array.isArray(phase.skills) ? phase.skills.map(String).map((value) => value.trim()).filter(Boolean) : [];
    const firstSkill = phaseSkills[0] || 'software engineering';
    const resources = Array.isArray(phase.resources)
      ? phase.resources.map((resource) => normalizeRoadmapResource(resource, firstSkill))
      : [];

    return {
      phase: String(phase.phase || `Phase ${index + 1}`).trim(),
      title: String(phase.title || `Milestone ${index + 1}`).trim(),
      description: String(phase.description || 'Complete focused practice for this milestone.').trim(),
      duration: String(phase.duration || '2-3 weeks').trim(),
      skills: phaseSkills,
      resources: resources.length ? resources : [normalizeRoadmapResource(firstSkill, firstSkill)],
      color: ['purple', 'blue', 'green', 'orange'].includes(String(phase.color || '').trim())
        ? String(phase.color).trim()
        : defaults[index % defaults.length].color
    };
  });
};

const toSkillName = (value) => (typeof value === 'string' ? value : value?.name || '').trim();

const flattenResumeSkills = (skillsMap = {}) => {
  if (!skillsMap) return [];
  const values = skillsMap instanceof Map
    ? Array.from(skillsMap.values())
    : Object.values(skillsMap);
  return values.flat().map(String).map((value) => value.trim()).filter(Boolean);
};

const uniqueByLower = (values = []) => {
  const seen = new Set();
  return values.filter((value) => {
    const key = String(value || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const uniqueObjectsByName = (values = []) => {
  const seen = new Set();
  return values.filter((item) => {
    const key = String(item?.name || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const clamp = (value, min = 0, max = 100) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, Math.round(numeric)));
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
    console.error('Skill gap AI snapshot error:', error.message);
  }
};

const buildResumeHash = (resumeText = '') => {
  const cleanResume = String(resumeText || '').trim();
  return crypto.createHash('sha256').update(cleanResume).digest('hex');
};

const loadResumeAnalysis = async (userId) => {
  if (!userId) return null;
  const userContext = await User.findById(userId).select('defaultResumeFileId').lean();
  const defaultResumeFileId = userContext?.defaultResumeFileId || null;
  if (defaultResumeFileId) {
    const activeAnalysis = await ResumeAnalysis.findOne({ userId, fileId: defaultResumeFileId })
      .sort({ analyzedAt: -1 })
      .lean();
    if (activeAnalysis) return activeAnalysis;
  }
  return ResumeAnalysis.findOne({ userId }).sort({ analyzedAt: -1 }).lean();
};

const getGitHubData = async (username) => {
  try {
    return await analyzeGitHubProfile(String(username || '').trim());
  } catch (error) {
    console.warn('Skill gap GitHub fallback:', error.message);
    return {
      repoCount: 0,
      developerLevel: 'Unknown',
      strengths: [],
      weakAreas: [],
      scores: {},
      languageDistribution: [],
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
  scores: githubData?.scores || {}
});

const emptySignals = {
  careerSprintSignal: { present: false, completedTasks: 0, missedTasks: 0, streak: 0, consistencyScore: 0, activeLearningFocus: '', repeatedIncompleteSkills: [], completedSkillSignals: [], progressPercent: 0, status: 'Unavailable', updatedAt: null },
  weeklyReportSignal: { present: false, weeklyProgressScore: 0, status: 'Unavailable', completedRecommendations: null, missedRecommendations: null, skillsImprovedThisWeek: [], repeatedWeakAreas: [], trendDelta: 0, updatedAt: null },
  portfolioSignal: { present: false, completenessScore: 0, listedProjects: 0, liveLinks: 0, githubLinks: 0, contactVisibility: false, projectPresentationQuality: 0, publicEnabled: false, portfolioSkills: [], updatedAt: null },
  integrationSignal: { present: false, usedProviders: [], integrationScore: 0, strongestProof: [], weakProof: [], detectedSkills: [], certifications: [], updatedAt: null }
};

const loadDeveloperSignalsSafely = async ({ userId, username, resumeInsights, githubInsights }) => {
  if (!userId) {
    return {
      developerSignals: emptySignals,
      signalHash: 'no-signals',
      signalsUsed: buildSignalsUsedSummary({ username, resumeInsights, githubInsights, signals: emptySignals })
    };
  }

  try {
    const developerSignals = await getDeveloperSignals(userId);
    return {
      developerSignals,
      signalHash: buildSignalHash(developerSignals),
      signalsUsed: buildSignalsUsedSummary({ username, resumeInsights, githubInsights, signals: developerSignals })
    };
  } catch (error) {
    console.warn('Skill gap signal fallback:', error.message);
    return {
      developerSignals: emptySignals,
      signalHash: 'no-signals',
      signalsUsed: buildSignalsUsedSummary({ username, resumeInsights, githubInsights, signals: emptySignals })
    };
  }
};

const buildEvidenceBuckets = (signals = {}) => {
  const integrationSkills = new Set((signals.integrationSignal?.detectedSkills || []).map((skill) => String(skill).toLowerCase()));
  const sprintSkills = new Set((signals.careerSprintSignal?.completedSkillSignals || []).map((skill) => String(skill).toLowerCase()));
  const repeatedWeakSkills = new Set([
    ...(signals.careerSprintSignal?.repeatedIncompleteSkills || []),
    ...(signals.weeklyReportSignal?.repeatedWeakAreas || [])
  ].map((skill) => String(skill).toLowerCase()));
  const portfolioSkills = new Set((signals.portfolioSignal?.portfolioSkills || []).map((skill) => String(skill).toLowerCase()));

  return {
    integrationSkills,
    sprintSkills,
    repeatedWeakSkills,
    portfolioSkills
  };
};

const buildFallbackSkillGap = ({
  resumeInsights,
  githubInsights,
  developerSignals
}) => {
  const focusSkills = uniqueByLower([
    ...(developerSignals.weeklyReportSignal?.repeatedWeakAreas || []),
    ...(developerSignals.careerSprintSignal?.repeatedIncompleteSkills || []),
    ...(developerSignals.integrationSignal?.weakProof || []),
    ...DEFAULT_MISSING_SKILLS
  ]);

  return {
    analysisSummary: `Primary evidence comes from GitHub activity, resume skill coverage, and supporting progress signals. Missing areas are prioritized where code evidence is thin and the same topics keep reappearing in progress or sprint signals.`,
    yourSkills: resumeInsights.skills.slice(0, 8).map((skill) => ({
      name: skill,
      category: 'General',
      proficiency: 62,
      isFoundational: true
    })),
    missingSkills: focusSkills.slice(0, MIN_MISSING_SKILLS).map((skill, index) => ({
      name: skill,
      category: index < 4 ? 'Priority Gap' : 'General',
      priority: index < 4 ? 'High' : index < 8 ? 'Medium' : 'Low',
      jobDemand: clamp(88 - (index * 3)),
      levelRelevance: index < 6 ? 'Current' : 'Next Level'
    })),
    coverage: clamp((resumeInsights.atsScore * 0.18) + ((githubInsights.repoCount || 0) * 4)),
    missing: 50,
    levelAssessment: 'Your current evidence shows a workable foundation, but several role-relevant gaps still need stronger proof in code, documentation, or consistent practice.',
    roadmap: [],
    totalWeeks: '8 weeks'
  };
};

const applySkillEvidence = ({ yourSkills, missingSkills, signals }) => {
  const evidence = buildEvidenceBuckets(signals);
  const presentSkillNames = new Set();

  const enrichedCurrent = uniqueObjectsByName(
    yourSkills.map((skill) => {
      const lowerName = String(skill.name || '').toLowerCase();
      let proficiency = clamp(skill.proficiency || 0);
      if (evidence.integrationSkills.has(lowerName)) proficiency = clamp(proficiency + 6);
      if (evidence.sprintSkills.has(lowerName)) proficiency = clamp(proficiency + 4);
      if (evidence.portfolioSkills.has(lowerName)) proficiency = clamp(proficiency + 3);
      presentSkillNames.add(lowerName);
      return {
        ...skill,
        proficiency
      };
    })
  );

  const enrichedMissing = uniqueObjectsByName(
    missingSkills
      .filter((skill) => !presentSkillNames.has(String(skill.name || '').toLowerCase()))
      .map((skill) => {
        const lowerName = String(skill.name || '').toLowerCase();
        const repeatedWeak = evidence.repeatedWeakSkills.has(lowerName);
        return {
          ...skill,
          priority: repeatedWeak ? 'High' : skill.priority,
          jobDemand: repeatedWeak ? clamp((skill.jobDemand || 60) + 6) : clamp(skill.jobDemand || 60)
        };
      })
  );

  return {
    yourSkills: enrichedCurrent,
    missingSkills: enrichedMissing
  };
};

/**
 * @desc Analyze skill gap using the user's global career profile
 * @route POST /api/skillgap/skill-gap
 */
const analyzeSkillGap = async (req, res) => {
  try {
    let { username, resumeText } = req.body;
    const defaultGithubUsername = String(req.user?.githubUsername || '').trim();
    const requestedUsername = String(username || '').trim();
    const isTemporaryMode = req.body?.isTemporary === true
      || req.body?.isTemporary === 'true'
      || Boolean(requestedUsername && defaultGithubUsername && requestedUsername.toLowerCase() !== defaultGithubUsername.toLowerCase());
    username = requestedUsername || defaultGithubUsername;

    const careerStack = req.user?.careerStack || req.body.careerStack || 'Full Stack';
    const experienceLevel = req.user?.experienceLevel || req.body.experienceLevel || 'Student';

    if (!username) {
      return res.status(400).json({ message: 'Username is required.' });
    }

    if (!resumeText && req.user?._id) {
      const Analysis = require('../models/analysis');
      const analysis = await Analysis.findOne({ userId: req.user._id }).lean();
      resumeText = analysis?.resumeText || '';
    }

    const cleanResume = String(resumeText || '').trim();
    const resumeHash = buildResumeHash(cleanResume);

    const [githubData, latestResumeAnalysis] = await Promise.all([
      getGitHubData(username.trim()),
      loadResumeAnalysis(req.user?._id || null)
    ]);

    const resumeInsights = buildResumeInsights(latestResumeAnalysis, experienceLevel);
    const githubInsights = buildGithubInsights(githubData);
    const { developerSignals, signalHash, signalsUsed } = await loadDeveloperSignalsSafely({
      userId: req.user?._id || null,
      username,
      resumeInsights,
      githubInsights
    });

    const cacheKey = {
      githubUsername: username,
      careerStack,
      experienceLevel,
      resumeHash,
      signalHash,
      analysisVersion: ANALYSIS_VERSION
    };

    const scopedCacheKey = req.user?._id && !isTemporaryMode
      ? { ...cacheKey, userId: req.user._id }
      : null;
    const cached = scopedCacheKey ? await AnalysisCache.findOne(scopedCacheKey).lean() : null;
    if (cached?.analysisData) {
      const cachedResult = { ...cached.analysisData, fromCache: true };
      await saveAIVersionSnapshot({
        req,
        source: 'skill_gap',
        output: cachedResult,
        metadata: { fromCache: true, username, careerStack, experienceLevel, signalHash }
      });
      return res.json(cachedResult);
    }

    const detectedSkills = {
      github: (githubData.repositories || [])
        .map((repo) => `${repo.name} (${repo.language || 'Unknown'})`)
        .concat(resumeInsights.skills.slice(0, 15))
        .concat((developerSignals.integrationSignal?.detectedSkills || []).map((skill) => `integration:${skill}`)),
      repoQuality: githubData.scores || {}
    };

    const fallback = buildFallbackSkillGap({
      resumeInsights,
      githubInsights,
      developerSignals
    });
    const prompt = getSkillGapPrompt(
      careerStack,
      experienceLevel,
      detectedSkills,
      resumeInsights,
      githubInsights,
      developerSignals
    );

    const aiResult = await aiService.runAIAnalysis(prompt, {
      yourSkills: fallback.yourSkills,
      missingSkills: fallback.missingSkills,
      coverage: fallback.coverage,
      missing: fallback.missing,
      levelAssessment: fallback.levelAssessment,
      roadmap: fallback.roadmap,
      totalWeeks: fallback.totalWeeks,
      analysisSummary: fallback.analysisSummary
    });

    let yourSkills = (Array.isArray(aiResult.yourSkills) ? aiResult.yourSkills : [])
      .map((skill) => ({
        name: toSkillName(skill),
        category: skill?.category || 'General',
        proficiency: clamp(skill?.proficiency || 50),
        isFoundational: Boolean(skill?.isFoundational)
      }))
      .filter((skill) => skill.name);

    const detectedKnown = uniqueByLower([
      ...resumeInsights.skills,
      ...(githubData.repositories || []).map((repo) => repo.language || '').filter(Boolean),
      ...(developerSignals.integrationSignal?.detectedSkills || []),
      ...(developerSignals.careerSprintSignal?.completedSkillSignals || []),
      ...(developerSignals.portfolioSignal?.portfolioSkills || [])
    ]);

    while (yourSkills.length < MIN_KNOWN_SKILLS && detectedKnown[yourSkills.length]) {
      yourSkills.push({
        name: detectedKnown[yourSkills.length],
        category: 'General',
        proficiency: 60,
        isFoundational: true
      });
    }

    let missingSkills = (Array.isArray(aiResult.missingSkills) ? aiResult.missingSkills : [])
      .map((skill) => ({
        name: toSkillName(skill),
        category: skill?.category || 'General',
        priority: skill?.priority || 'Medium',
        jobDemand: clamp(skill?.jobDemand || 60),
        levelRelevance: skill?.levelRelevance || 'Current'
      }))
      .filter((skill) => skill.name);

    const derivedGapCandidates = uniqueByLower([
      ...missingSkills.map((skill) => skill.name),
      ...(githubInsights.weakAreas || []),
      ...(developerSignals.weeklyReportSignal?.repeatedWeakAreas || []),
      ...(developerSignals.careerSprintSignal?.repeatedIncompleteSkills || []),
      ...(developerSignals.integrationSignal?.weakProof || []),
      ...DEFAULT_MISSING_SKILLS
    ]);
    const existingMissing = new Set(missingSkills.map((skill) => skill.name.toLowerCase()));
    for (const fallbackSkill of derivedGapCandidates) {
      if (missingSkills.length >= MIN_MISSING_SKILLS) break;
      if (existingMissing.has(fallbackSkill.toLowerCase())) continue;
      missingSkills.push({
        name: fallbackSkill,
        category: 'General',
        priority: 'Medium',
        jobDemand: 70,
        levelRelevance: 'Current'
      });
      existingMissing.add(fallbackSkill.toLowerCase());
    }

    const evidenceAdjusted = applySkillEvidence({
      yourSkills,
      missingSkills,
      signals: developerSignals
    });

    yourSkills = evidenceAdjusted.yourSkills;
    missingSkills = evidenceAdjusted.missingSkills;

    const knownCount = yourSkills.length;
    const missingCount = missingSkills.length;
    const avgProficiency = knownCount > 0
      ? Math.round(yourSkills.reduce((sum, skill) => sum + clamp(skill.proficiency || 0), 0) / knownCount)
      : 0;
    const balanceFactor = (knownCount + missingCount) > 0 ? (knownCount / (knownCount + missingCount)) : 0;
    const proficiencyFactor = avgProficiency / 100;
    const resumeFactor = clamp(resumeInsights.atsScore || 0) / 100;
    const aiCoverage = clamp(aiResult.coverage || 0);
    const integrationFactor = clamp(developerSignals.integrationSignal?.integrationScore || 0) / 100;

    const computedCoverage = Math.round(((balanceFactor * 0.57) + (proficiencyFactor * 0.23) + (resumeFactor * 0.1) + (integrationFactor * 0.1)) * 100);
    const blendedCoverage = Math.round((computedCoverage * 0.82) + (aiCoverage * 0.18));
    const coverage = clamp(blendedCoverage);
    const missing = clamp(100 - coverage);

    const fullResult = {
      username,
      careerStack,
      experienceLevel,
      analysisSummary: String(aiResult.analysisSummary || fallback.analysisSummary || '').trim(),
      yourSkills,
      missingSkills,
      coverage,
      missing,
      levelAssessment: String(aiResult.levelAssessment || fallback.levelAssessment || '').trim(),
      roadmap: normalizeRoadmap(aiResult.roadmap, 3),
      totalWeeks: String(aiResult.totalWeeks || fallback.totalWeeks || '8 weeks').trim(),
      resumeInsights,
      githubStats: githubData,
      signalsUsed
    };

    const skillGraph = buildSkillGraph({
      currentSkills: fullResult.yourSkills,
      missingSkills: fullResult.missingSkills
    });

    fullResult.skillGraph = skillGraph;
    fullResult.weeklyRoadmap = generateWeeklyLearningRoadmap(skillGraph, 8);

    if (scopedCacheKey) {
      await AnalysisCache.findOneAndUpdate(
        scopedCacheKey,
        { $set: { analysisData: fullResult, userId: req.user._id } },
        { upsert: true }
      );
    }

    await saveAIVersionSnapshot({
      req,
      source: 'skill_gap',
      output: fullResult,
      metadata: { fromCache: false, username, careerStack, experienceLevel, signalHash }
    });

    return res.json(fullResult);
  } catch (error) {
    console.error('Skill Gap Error:', { message: error.message, username: req.body?.username });
    return res.status(500).json({
      message: 'Analysis failed. GitHub profile may be private or AI is overloaded. Try again in 30 seconds.',
      error: error.message
    });
  }
};

module.exports = { analyzeSkillGap };
