const crypto = require('node:crypto');
const Analysis = require('../models/analysis');
const AnalysisCache = require('../models/analysisCache');
const CareerSprint = require('../models/careerSprint');
const Repository = require('../models/repository');
const ResumeAnalysis = require('../models/resumeAnalysis');
const WeeklyReport = require('../models/weeklyReport');
const PublicProfile = require('../models/publicProfile');
const Recommendation = require('../models/recommendation');
const ScenarioSimulation = require('../models/scenarioSimulation');
const User = require('../models/user');
const JobCache = require('../models/jobCache');
const { buildPublicProfilePayload } = require('./publicProfileService');
const { getIntegrationInsight } = require('./integrationInsightService');
const { extractSkillsFromText, canonicalizeSkillName } = require('../utils/skilldetector');

const TOPIC_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'your', 'this', 'that', 'task',
  'tasks', 'build', 'work', 'learn', 'practice', 'complete', 'completed',
  'improve', 'improving', 'create', 'project', 'projects', 'roadmap', 'review',
  'daily', 'weekly', 'career', 'sprint', 'focus', 'goal', 'using', 'more',
  'less', 'need', 'next', 'level', 'high', 'medium', 'low', 'setup', 'deploy'
]);

const clamp = (value, min = 0, max = 100) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, Math.round(numeric)));
};

const calcWeightedProgress = (tasks) => {
  if (!Array.isArray(tasks) || tasks.length === 0) return 0;
  const totalPoints = tasks.reduce((sum, task) => sum + (Number(task?.points) || 1), 0);
  const completedPoints = tasks
    .filter((task) => Boolean(task?.isCompleted))
    .reduce((sum, task) => sum + (Number(task?.points) || 1), 0);

  return totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0;
};

const uniqLower = (values = []) => {
  const seen = new Set();
  return values.filter((value) => {
    const key = String(value || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const safeStrings = (values = [], limit = 6) => uniqLower(
  (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
).slice(0, limit);

const flattenResumeSkills = (skillsMap = {}) => {
  if (!skillsMap) return [];
  const values = skillsMap instanceof Map ? Array.from(skillsMap.values()) : Object.values(skillsMap);
  return safeStrings(values.flat().map((value) => canonicalizeSkillName(value)).filter(Boolean), 30);
};

const deriveResumeStrengths = (analysis = {}) => {
  const safeAnalysis = analysis || {};
  const strengths = [];

  if (Number(safeAnalysis.atsScore || 0) >= 75) strengths.push('Strong ATS structure');
  if (Number(safeAnalysis.keywordDensity || 0) >= 70) strengths.push('Good keyword coverage');
  if (Number(safeAnalysis.formatScore || 0) >= 70) strengths.push('Clear formatting');
  if (Number(safeAnalysis.contentQuality || 0) >= 70) strengths.push('Strong content quality');
  if (Array.isArray(safeAnalysis.keyAchievements) && safeAnalysis.keyAchievements.length) strengths.push('Quantified achievements present');
  if (Array.isArray(safeAnalysis.certifications) && safeAnalysis.certifications.length) strengths.push('Certifications highlighted');

  return safeStrings(strengths, 8);
};

const deriveResumeWeaknesses = (analysis = {}) => {
  const safeAnalysis = analysis || {};
  const weaknesses = [];

  if (Number(safeAnalysis.atsScore || 0) < 70) weaknesses.push('ATS structure needs improvement');
  if (Number(safeAnalysis.keywordDensity || 0) < 65) weaknesses.push('Keyword coverage is thin');
  if (Number(safeAnalysis.formatScore || 0) < 65) weaknesses.push('Formatting could be clearer');
  if (Number(safeAnalysis.contentQuality || 0) < 65) weaknesses.push('Content lacks strong impact language');

  (Array.isArray(safeAnalysis.suggestions) ? safeAnalysis.suggestions : []).forEach((suggestion) => {
    const title = String(suggestion?.title || '').trim();
    if (title) weaknesses.push(title);
  });

  return safeStrings(weaknesses, 10);
};

const deriveMissingResumeSections = (analysis = {}) => {
  const safeAnalysis = analysis || {};
  const catalog = [
    { label: 'Professional Summary', patterns: ['professional summary', 'summary section', 'summary'] },
    { label: 'Projects', patterns: ['project section', 'projects section', 'project'] },
    { label: 'Skills', patterns: ['skills section', 'skill section'] },
    { label: 'Experience', patterns: ['experience section', 'work experience', 'experience'] },
    { label: 'Education', patterns: ['education section', 'education'] },
    { label: 'Contact Info', patterns: ['contact information', 'contact info', 'email', 'phone'] },
    { label: 'Achievements', patterns: ['achievement', 'quantified', 'metrics', 'measurable results'] }
  ];

  const evidenceText = [
    ...Object.values(safeAnalysis.scoreBreakdown || {}),
    ...(Array.isArray(safeAnalysis.suggestions)
      ? safeAnalysis.suggestions.flatMap((suggestion) => [suggestion?.title, suggestion?.description])
      : [])
  ].map((value) => String(value || '').toLowerCase());

  const detected = catalog
    .filter(({ patterns }) => evidenceText.some((text) => patterns.some((pattern) => text.includes(pattern))))
    .map(({ label }) => label);

  if (!Array.isArray(safeAnalysis.keyAchievements) || !safeAnalysis.keyAchievements.length) {
    detected.push('Achievements');
  }

  return safeStrings(detected, 8);
};

const deriveResumeImprovementSuggestions = (analysis = {}) => safeStrings(
  (Array.isArray((analysis || {}).suggestions) ? (analysis || {}).suggestions : [])
    .flatMap((suggestion) => [suggestion?.title, suggestion?.description]),
  10
);

const buildResumeAnalysisSignals = (analysis, fallbackExperienceLevel = '') => {
  if (analysis?.resumeSignals && typeof analysis.resumeSignals === 'object') {
    const stored = analysis.resumeSignals;
    const analyzedAt = analysis.analyzedAt || analysis.createdAt || stored.updatedAt || null;
    return {
      analyzed: Boolean(analysis?._id),
      analysisId: analysis?._id ? String(analysis._id) : 'no-resume',
      fileId: analysis?.fileId ? String(analysis.fileId) : '',
      fileName: String(analysis?.fileName || '').trim(),
      experienceLevel: analysis?.experienceLevel || stored.experienceLevel || fallbackExperienceLevel || '',
      experienceYears: Number(analysis?.experienceYears || stored.experienceYears || 0),
      atsScore: Number(analysis?.atsScore || stored.scores?.atsScore || 0),
      keywordDensity: Number(analysis?.keywordDensity || stored.scores?.keywordDensity || stored.scores?.keywordCoverage || 0),
      formatScore: Number(analysis?.formatScore || stored.scores?.formatScore || stored.scores?.formattingScore || 0),
      contentQuality: Number(analysis?.contentQuality || stored.scores?.contentQuality || 0),
      skills: safeStrings(stored.skills || [], 25),
      technicalSkills: safeStrings(stored.skills || [], 25),
      extractedSkills: safeStrings(stored.skills || [], 25),
      experienceKeywords: safeStrings([
        ...(stored.skills || []),
        ...(stored.achievements || []),
        ...(stored.projects || [])
      ], 16),
      strengths: safeStrings(stored.recruiterPerspective?.strengths || deriveResumeStrengths(analysis), 8),
      weaknesses: safeStrings([
        ...(stored.recruiterPerspective?.concerns || []),
        ...(Array.isArray(stored.warnings) ? stored.warnings.map((warning) => warning?.message) : [])
      ], 10),
      missingSections: safeStrings(
        Array.isArray(stored.warnings)
          ? stored.warnings.filter((warning) => String(warning?.code || '').startsWith('missing_')).map((warning) => warning.message)
          : deriveMissingResumeSections(analysis),
        8
      ),
      improvementSuggestions: deriveResumeImprovementSuggestions(analysis),
      keyAchievements: safeStrings(analysis?.keyAchievements || stored.achievements || [], 8),
      certifications: safeStrings(analysis?.certifications || stored.certifications || [], 8),
      technologyCategories: stored.technologyCategories || {},
      recruiterPerspective: stored.recruiterPerspective || {},
      resumeHash: stored.resumeHash || analysis.resumeHash || '',
      analysisVersion: stored.analysisVersion || analysis.analysisVersion || '',
      lastAnalyzedAt: analyzedAt,
      statusMessage: analysis?._id
        ? `Resume analyzed${analysis?.fileName ? `: ${analysis.fileName}` : ''}`
        : 'Resume not analyzed yet'
    };
  }

  const resumeSkills = flattenResumeSkills(analysis?.skills);
  const skillEntries = analysis?.skills instanceof Map
    ? Array.from(analysis.skills.entries())
    : Object.entries(analysis?.skills || {});
  const technicalSkills = safeStrings(
    skillEntries
      .filter(([category]) => String(category || '').toLowerCase() !== 'soft skills')
      .flatMap(([, values]) => Array.isArray(values) ? values : [])
      .map((value) => canonicalizeSkillName(value))
      .filter(Boolean),
    25
  );
  const experienceKeywords = safeStrings([
    ...extractSkillsFromText([
      ...(analysis?.keyAchievements || []),
      ...(Array.isArray(analysis?.suggestions)
        ? analysis.suggestions.flatMap((suggestion) => [suggestion?.title, suggestion?.description])
        : []),
      ...Object.values(analysis?.scoreBreakdown || {})
    ]),
    ...resumeSkills
  ], 16);

  const analyzedAt = analysis?.analyzedAt || analysis?.createdAt || null;
  const analyzed = Boolean(analysis?._id);

  return {
    analyzed,
    analysisId: analysis?._id ? String(analysis._id) : 'no-resume',
    fileId: analysis?.fileId ? String(analysis.fileId) : '',
    fileName: String(analysis?.fileName || '').trim(),
    experienceLevel: analysis?.experienceLevel || fallbackExperienceLevel || '',
    experienceYears: Number(analysis?.experienceYears || 0),
    atsScore: Number(analysis?.atsScore || 0),
    keywordDensity: Number(analysis?.keywordDensity || 0),
    formatScore: Number(analysis?.formatScore || 0),
    contentQuality: Number(analysis?.contentQuality || 0),
    skills: resumeSkills.slice(0, 25),
    technicalSkills,
    extractedSkills: resumeSkills.slice(0, 25),
    experienceKeywords,
    strengths: deriveResumeStrengths(analysis),
    weaknesses: deriveResumeWeaknesses(analysis),
    missingSections: deriveMissingResumeSections(analysis),
    improvementSuggestions: deriveResumeImprovementSuggestions(analysis),
    keyAchievements: safeStrings(analysis?.keyAchievements || [], 8),
    certifications: safeStrings(analysis?.certifications || [], 8),
    lastAnalyzedAt: analyzedAt,
    statusMessage: analyzed
      ? `Resume analyzed${analysis?.fileName ? `: ${analysis.fileName}` : ''}`
      : 'Resume not analyzed yet'
  };
};

const buildResumeCacheIdentity = ({ resumeText = '', resumeAnalysis = null } = {}) => {
  const cleanResume = String(resumeText || '').trim();
  if (cleanResume) {
    return {
      resumeHash: crypto.createHash('sha256').update(cleanResume).digest('hex'),
      resumeAnalysisId: resumeAnalysis?._id ? String(resumeAnalysis._id) : 'manual-resume-text'
    };
  }

  if (resumeAnalysis?._id) {
    const payload = {
      id: String(resumeAnalysis._id),
      fileId: resumeAnalysis.fileId ? String(resumeAnalysis.fileId) : '',
      fileName: String(resumeAnalysis.fileName || '').trim(),
      atsScore: Number(resumeAnalysis.atsScore || 0),
      keywordDensity: Number(resumeAnalysis.keywordDensity || 0),
      formatScore: Number(resumeAnalysis.formatScore || 0),
      contentQuality: Number(resumeAnalysis.contentQuality || 0),
      experienceYears: Number(resumeAnalysis.experienceYears || 0),
      experienceLevel: String(resumeAnalysis.experienceLevel || '').trim(),
      skills: flattenResumeSkills(resumeAnalysis.skills),
      suggestions: deriveResumeImprovementSuggestions(resumeAnalysis),
      keyAchievements: safeStrings(resumeAnalysis.keyAchievements || [], 8),
      analyzedAt: resumeAnalysis.analyzedAt || resumeAnalysis.createdAt || null
    };

    return {
      resumeHash: crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
      resumeAnalysisId: String(resumeAnalysis._id)
    };
  }

  return {
    resumeHash: 'no-resume',
    resumeAnalysisId: 'no-resume'
  };
};

const buildAnalysisBasedOn = ({
  username = '',
  careerStack = '',
  experienceLevel = '',
  resumeInsights = {},
  lastAnalyzedAt = null
} = {}) => ({
  githubUsername: String(username || '').trim(),
  resumeAnalyzed: Boolean(resumeInsights?.analyzed),
  resumeStatus: String(resumeInsights?.statusMessage || 'Resume not analyzed yet'),
  careerStack: String(careerStack || '').trim(),
  experienceLevel: String(experienceLevel || '').trim(),
  lastAnalyzedAt: lastAnalyzedAt || resumeInsights?.lastAnalyzedAt || null
});

const scoreToStatus = (score) => {
  const numeric = clamp(score);
  if (numeric >= 75) return 'Strong';
  if (numeric >= 50) return 'Improving';
  if (numeric >= 30) return 'Needs Focus';
  return 'Low Momentum';
};

const extractTopics = (...sources) => {
  const counts = new Map();
  sources
    .flat()
    .map((source) => String(source || '').toLowerCase())
    .forEach((text) => {
      const matches = text.match(/[a-z0-9+#.]{2,24}/g) || [];
      matches.forEach((token) => {
        if (TOPIC_STOP_WORDS.has(token)) return;
        if (/^\d+$/.test(token)) return;
        counts.set(token, (counts.get(token) || 0) + 1);
      });
    });

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([token]) => token)
    .slice(0, 8);
};

const summarizeCareerSprintSignal = async (userId) => {
  const sprint = await CareerSprint.findOne({ userId }).sort({ updatedAt: -1 }).lean();
  if (!sprint) {
    return {
      present: false,
      completedTasks: 0,
      missedTasks: 0,
      streak: 0,
      consistencyScore: 0,
      activeLearningFocus: '',
      repeatedIncompleteSkills: [],
      completedSkillSignals: [],
      progressPercent: 0,
      status: 'No sprint data',
      updatedAt: null
    };
  }

  const now = Date.now();
  const tasks = Array.isArray(sprint.tasks) ? sprint.tasks : [];
  const completedTasks = tasks.filter((task) => Boolean(task?.isCompleted));
  const incompleteTasks = tasks.filter((task) => !task?.isCompleted);
  const missedTasks = incompleteTasks.filter((task) => {
    const endDate = task?.endDate || task?.deadline || task?.dueDate;
    return endDate ? new Date(endDate).getTime() < now : false;
  }).length;
  const repeatedIncompleteSkills = extractTopics(
    incompleteTasks.map((task) => task?.title),
    incompleteTasks.map((task) => task?.description),
    sprint.goalTechnology
  ).slice(0, 5);
  const completedSkillSignals = extractTopics(
    completedTasks.map((task) => task?.title),
    completedTasks.map((task) => task?.description),
    sprint.goalTechnology
  ).slice(0, 5);
  const progressPercent = clamp(calcWeightedProgress(tasks));
  const streak = Number(sprint.currentStreak || sprint.streak || 0);
  const consistencyScore = clamp((progressPercent * 0.72) + (Math.min(streak, 14) / 14 * 28));
  const activeLearningFocus = String(
    sprint.goalTechnology || sprint.goalStack || sprint.goalTitle || repeatedIncompleteSkills[0] || ''
  ).trim();

  return {
    present: true,
    completedTasks: completedTasks.length,
    missedTasks,
    streak,
    consistencyScore,
    activeLearningFocus,
    repeatedIncompleteSkills,
    completedSkillSignals,
    progressPercent,
    status: consistencyScore >= 70 ? 'Consistent' : consistencyScore >= 45 ? 'Mixed' : 'Needs smaller steps',
    updatedAt: sprint.updatedAt || null
  };
};

const summarizeWeeklyReportSignal = async (userId) => {
  const reports = await WeeklyReport.find({ userId }).sort({ weekEndDate: -1 }).limit(4).lean();
  const latest = reports[0];

  if (!latest) {
    return {
      present: false,
      weeklyProgressScore: 0,
      status: 'No weekly report',
      completedRecommendations: null,
      missedRecommendations: null,
      skillsImprovedThisWeek: [],
      repeatedWeakAreas: [],
      trendDelta: 0,
      updatedAt: null
    };
  }

  const previous = reports[1];
  const skillsImprovedThisWeek = safeStrings(
    latest?.meta?.skillFocus?.length
      ? latest.meta.skillFocus
      : extractTopics(latest.topAchievements, latest.insights),
    6
  );
  const repeatedWeakAreas = safeStrings(
    extractTopics(
      reports.map((report) => report.biggestRiskArea),
      reports.flatMap((report) => report.recommendations || [])
    ),
    5
  );
  const weeklyProgressScore = clamp(latest.score);
  const trendDelta = clamp((latest?.meta?.comparisons?.scoreDelta ?? (latest.score - Number(previous?.score || 0))), -100, 100);

  return {
    present: true,
    weeklyProgressScore,
    status: scoreToStatus(weeklyProgressScore),
    completedRecommendations: null,
    missedRecommendations: null,
    skillsImprovedThisWeek,
    repeatedWeakAreas,
    trendDelta,
    updatedAt: latest.weekEndDate || latest.updatedAt || null
  };
};

const calculateProjectPresentationQuality = (projects = []) => {
  if (!projects.length) return 0;

  const score = projects.reduce((sum, project) => {
    let quality = 0;
    if (project?.title) quality += 20;
    if (String(project?.description || '').trim().length >= 40) quality += 35;
    if (Array.isArray(project?.tech) && project.tech.length) quality += 20;
    if (project?.url) quality += 15;
    if (project?.repoUrl) quality += 10;
    return sum + quality;
  }, 0);

  return clamp(score / projects.length);
};

const summarizePortfolioSignal = async (userId) => {
  const profile = await PublicProfile.findOne({ userId }).lean();
  if (!profile) {
    return {
      present: false,
      completenessScore: 0,
      listedProjects: 0,
      liveLinks: 0,
      githubLinks: 0,
      contactVisibility: false,
      projectPresentationQuality: 0,
      publicEnabled: false,
      portfolioSkills: [],
      updatedAt: null
    };
  }

  const user = await User.findById(userId)
    .select('name email phoneNumber jobTitle location avatar githubUsername website twitter linkedin bio')
    .lean();
  const payload = await buildPublicProfilePayload(profile, user);
  const projects = Array.isArray(payload?.projects) ? payload.projects : [];
  const liveLinks = projects.filter((project) => Boolean(String(project?.url || '').trim())).length;
  const githubLinks = projects.filter((project) => Boolean(String(project?.repoUrl || '').trim())).length;
  const contactVisibility = Boolean(payload?.sections?.contact?.email || payload?.user?.phoneNumber);
  const portfolioSkills = safeStrings([
    ...(payload?.skills || []).map((skill) => skill?.name),
    ...projects.flatMap((project) => project?.tech || [])
  ], 10);

  return {
    present: true,
    completenessScore: clamp(payload?.profileStrengthScore || 0),
    listedProjects: projects.length,
    liveLinks,
    githubLinks,
    contactVisibility,
    projectPresentationQuality: calculateProjectPresentationQuality(projects),
    publicEnabled: Boolean(payload?.isPublic),
    portfolioSkills,
    updatedAt: profile.updatedAt || null
  };
};

const summarizeIntegrationSignal = async (userId) => {
  const insight = await getIntegrationInsight(userId);
  const providers = Array.isArray(insight.providers) ? insight.providers : [];
  const usedProviders = safeStrings(providers.map((provider) => provider.provider), 10);
  const providerScores = providers.map((provider) => ({
    provider: provider.provider,
    score: clamp(((provider.profileScore || 0) * 0.45) + ((provider.activityScore || 0) * 0.35) + ((provider.confidence || 0) * 0.2))
  }));
  const strongestProof = providerScores.filter((provider) => provider.score >= 70).map((provider) => provider.provider).slice(0, 4);
  const weakProof = providerScores.filter((provider) => provider.score > 0 && provider.score < 45).map((provider) => provider.provider).slice(0, 4);
  const certificationsProvider = providers.find((provider) => provider.provider === 'certifications');
  const certifications = safeStrings(
    Array.isArray(certificationsProvider?.normalized?.certifications)
      ? certificationsProvider.normalized.certifications
      : certificationsProvider?.inferredSkills,
    6
  );

  return {
    present: providers.length > 0,
    usedProviders,
    integrationScore: clamp(insight.integrationScore || 0),
    strongestProof,
    weakProof,
    detectedSkills: safeStrings(insight.mergedSkills || [], 14),
    certifications,
    updatedAt: insight.updatedAt || null
  };
};

const summarizeCareerProfileSignal = async (userId) => {
  const user = userId
    ? await User.findById(userId).select('careerStack experienceLevel careerGoal githubUsername updatedAt').lean()
    : null;

  return {
    present: Boolean(user),
    careerStack: String(user?.careerStack || '').trim(),
    experienceLevel: String(user?.experienceLevel || '').trim(),
    careerGoal: String(user?.careerGoal || '').trim(),
    githubUsername: String(user?.githubUsername || '').trim(),
    updatedAt: user?.updatedAt || null
  };
};

const summarizeJobsDemandSignal = async () => {
  const now = new Date();
  const records = await JobCache.find({ expiresAt: { $gt: now } })
    .select('skills title updatedAt lastSynced')
    .sort({ lastSynced: -1, updatedAt: -1 })
    .limit(250)
    .lean();

  const counts = new Map();
  records.forEach((record) => {
    safeStrings(record.skills || [], 20)
      .map((skill) => canonicalizeSkillName(skill))
      .filter(Boolean)
      .forEach((skill) => {
        const key = skill.toLowerCase();
        const current = counts.get(key) || { skill, count: 0 };
        current.count += 1;
        counts.set(key, current);
      });
  });

  const topSkills = Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill))
    .slice(0, 18)
    .map((entry) => ({
      name: entry.skill,
      demandScore: clamp((entry.count / Math.max(records.length, 1)) * 420),
      postings: entry.count
    }));

  return {
    present: records.length > 0,
    sampledJobs: records.length,
    topSkills,
    updatedAt: records[0]?.lastSynced || records[0]?.updatedAt || null
  };
};

const summarizeRecommendationSignal = async (userId) => {
  const recommendations = userId
    ? await Recommendation.find({ userId }).sort({ createdAt: -1 }).limit(12).lean()
    : [];

  const priorityRecommendations = recommendations
    .map((recommendation) => ({
      title: String(recommendation.title || '').trim(),
      category: String(recommendation.category || '').trim(),
      priority: String(recommendation.priority || '').trim(),
      impact: String(recommendation.impact || '').trim(),
      techStack: safeStrings(recommendation.techStack || [], 8),
      createdAt: recommendation.createdAt || null
    }))
    .filter((recommendation) => recommendation.title);

  return {
    present: priorityRecommendations.length > 0,
    priorityRecommendations,
    skills: {
      recommendedTechnologies: safeStrings(priorityRecommendations.flatMap((item) => item.techStack), 16),
      missingSkills: safeStrings(
        priorityRecommendations
          .filter((item) => /skill|learn|gap/i.test(`${item.category} ${item.title}`))
          .flatMap((item) => item.techStack.length ? item.techStack : [item.title]),
        12
      ),
      weakSkills: []
    },
    updatedAt: priorityRecommendations[0]?.createdAt || null
  };
};

const summarizeScenarioSimulatorSignal = async (userId) => {
  const scenarios = userId
    ? await ScenarioSimulation.find({ userId })
      .sort({ createdAt: -1 })
      .limit(8)
      .select('name role experienceLevel durationWeeks skills projects predicted improvements confidenceScore scenarioHash createdAt')
      .lean()
    : [];

  return {
    present: scenarios.length > 0,
    savedCount: scenarios.length,
    latestScenarioHash: scenarios[0]?.scenarioHash || '',
    latestCreatedAt: scenarios[0]?.createdAt || null,
    savedScenarios: scenarios.map((scenario) => ({
      id: String(scenario._id),
      name: scenario.name,
      role: scenario.role,
      experienceLevel: scenario.experienceLevel,
      durationWeeks: scenario.durationWeeks,
      skills: safeStrings(scenario.skills || [], 8),
      projectNames: safeStrings((scenario.projects || []).map((project) => project.name), 6),
      predicted: scenario.predicted || {},
      improvements: scenario.improvements || {},
      confidenceScore: Number(scenario.confidenceScore || 0),
      scenarioHash: scenario.scenarioHash || '',
      createdAt: scenario.createdAt || null
    }))
  };
};

const toPlainLanguageDistribution = (languageDistribution = {}) => {
  const raw = languageDistribution instanceof Map
    ? Object.fromEntries(languageDistribution)
    : languageDistribution && typeof languageDistribution === 'object'
      ? languageDistribution
      : {};

  return Object.entries(raw)
    .map(([language, percentage]) => ({
      language,
      percentage: clamp(percentage)
    }))
    .filter((entry) => entry.language && entry.percentage > 0)
    .sort((left, right) => right.percentage - left.percentage);
};

const summarizeGithubSignal = async (userId) => {
  const analysis = userId
    ? await Analysis.findOne({ userId }).sort({ updatedAt: -1, createdAt: -1 }).lean()
    : null;

  if (!analysis) {
    return {
      present: false,
      username: '',
      repoCount: 0,
      developerLevel: '',
      strengths: [],
      weakAreas: [],
      languageDistribution: [],
      technologies: [],
      repositories: [],
      scores: {},
      updatedAt: null
    };
  }

  const stored = analysis.githubSignals && typeof analysis.githubSignals === 'object'
    ? analysis.githubSignals
    : {};
  const repositories = await Repository.find({ ownerId: userId })
    .select('repoName language stars forks commits lastUpdated')
    .sort({ lastUpdated: -1 })
    .limit(24)
    .lean()
    .catch(() => []);

  const storedRepositories = Array.isArray(stored.repositories) ? stored.repositories : [];
  const normalizedRepositories = (repositories.length ? repositories : storedRepositories).map((repo) => ({
    name: repo.repoName || repo.name || '',
    language: repo.language || '',
    stars: Number(repo.stars || 0),
    forks: Number(repo.forks || 0),
    commits: Number(repo.commits || 0),
    pushedAt: repo.lastUpdated || repo.pushedAt || repo.updatedAt || null,
    description: repo.description || '',
    technologies: Array.isArray(repo.technologies) ? repo.technologies : []
  }));

  const languageDistribution = Array.isArray(stored?.languages?.main) && stored.languages.main.length
    ? stored.languages.main
    : toPlainLanguageDistribution(analysis.languageDistribution);

  return {
    present: true,
    username: String(stored.username || '').trim(),
    repoCount: Number(stored.stats?.repos || analysis.githubStats?.repos || normalizedRepositories.length || 0),
    developerLevel: String(stored.developerLevel || '').trim(),
    strengths: safeStrings(stored.recruiterInsights?.proofPoints || [], 8),
    weakAreas: safeStrings(stored.weakAreas || [], 8),
    languageDistribution,
    technologies: Array.isArray(stored.technologies) ? stored.technologies.slice(0, 18) : [],
    technologyCategories: stored.technologyCategories || {},
    repositories: normalizedRepositories,
    scores: {
      healthScore: Number(stored.healthScore || analysis.githubScore || 0),
      activity: Number(stored.healthScore || analysis.githubScore || 0)
    },
    recruiterInsights: stored.recruiterInsights || {},
    updatedAt: stored.analyzedAt || analysis.updatedAt || analysis.createdAt || null
  };
};

const loadDefaultResumeAnalysis = async (userId) => {
  const user = userId
    ? await User.findById(userId).select('defaultResumeFileId').lean()
    : null;

  if (user?.defaultResumeFileId) {
    const activeAnalysis = await ResumeAnalysis.findOne({ userId, fileId: user.defaultResumeFileId })
      .sort({ analyzedAt: -1 })
      .lean();
    if (activeAnalysis) return activeAnalysis;
  }

  return userId
    ? ResumeAnalysis.findOne({ userId }).sort({ analyzedAt: -1 }).lean()
    : null;
};

const summarizeResumeSignal = async (userId) => {
  const latestResume = await loadDefaultResumeAnalysis(userId);
  return buildResumeAnalysisSignals(latestResume);
};

const normalizeSkillItems = (values = [], limit = 16) => safeStrings(
  (Array.isArray(values) ? values : [])
    .map((item) => item?.name || item?.skill || item)
    .filter(Boolean),
  limit
);

const summarizeSkillGapSignal = async (userId) => {
  const cache = userId
    ? await AnalysisCache.findOne({
        userId,
        'analysisData.missingSkills.0': { $exists: true }
      }).sort({ updatedAt: -1 }).lean()
    : null;

  if (!cache?.analysisData) {
    return {
      present: false,
      knownSkills: [],
      missingSkills: [],
      weakSkills: [],
      highDemandSkills: [],
      coverage: 0,
      updatedAt: null,
      signalHash: ''
    };
  }

  const data = cache.analysisData;
  const storedSignals = data.skillGapSignals && typeof data.skillGapSignals === 'object'
    ? data.skillGapSignals
    : {};

  return {
    present: true,
    knownSkills: normalizeSkillItems(data.yourSkills || storedSignals.knownSkills, 24),
    missingSkills: normalizeSkillItems(storedSignals.missingSkills || data.missingSkills, 20),
    weakSkills: normalizeSkillItems(storedSignals.weakSkills || data.weakSkills, 12),
    highDemandSkills: Array.isArray(storedSignals.highDemandSkills)
      ? storedSignals.highDemandSkills.slice(0, 12)
      : (Array.isArray(data.highDemandSkills) ? data.highDemandSkills.slice(0, 12) : []),
    immediateSkills: safeStrings(storedSignals.immediateSkills || data.immediateSkills?.map((skill) => skill?.name || skill), 8),
    shortTermSkills: safeStrings(storedSignals.shortTermSkills || data.shortTermSkills?.map((skill) => skill?.name || skill), 8),
    coverage: clamp(storedSignals.coverage || data.coverage || 0),
    coverageBreakdown: storedSignals.coverageBreakdown || data.coverageBreakdown || {},
    provenSkills: safeStrings(storedSignals.provenSkills || data.provenSkills || [], 16),
    claimedButNotProvenSkills: safeStrings(storedSignals.claimedButNotProvenSkills || data.claimedButNotProvenSkills || [], 16),
    updatedAt: cache.updatedAt || cache.createdAt || null,
    signalHash: storedSignals.signalHash || cache.signalHash || ''
  };
};

const getDeveloperSignals = async (userId) => {
  if (!userId) {
    const [githubSignals, resumeSignals, skillGapSignals, careerSprintSignal, weeklyReportSignal, portfolioSignal, integrationSignal, careerProfileSignal, jobsDemandSignal, recommendationSignal, scenarioSimulatorSignal] = await Promise.all([
      summarizeGithubSignal(null),
      summarizeResumeSignal(null),
      summarizeSkillGapSignal(null),
      summarizeCareerSprintSignal(null),
      summarizeWeeklyReportSignal(null),
      summarizePortfolioSignal(null),
      summarizeIntegrationSignal(null),
      summarizeCareerProfileSignal(null),
      summarizeJobsDemandSignal(),
      summarizeRecommendationSignal(null),
      summarizeScenarioSimulatorSignal(null)
    ]);
    return {
      githubSignals,
      resumeSignals,
      skillGapSignals,
      careerSprintSignal,
      weeklyReportSignal,
      portfolioSignal,
      integrationSignal,
      careerProfileSignal,
      jobsDemandSignal,
      portfolioSignals: portfolioSignal,
      careerSprintSignals: careerSprintSignal,
      weeklyReportSignals: weeklyReportSignal,
      integrationSignals: integrationSignal,
      careerProfile: careerProfileSignal,
      jobsDemandSignals: jobsDemandSignal,
      recommendationSignal,
      recommendationSignals: recommendationSignal,
      scenarioSimulatorSignal,
      scenarioSimulatorSignals: scenarioSimulatorSignal
    };
  }

  const [githubSignals, resumeSignals, skillGapSignals, careerSprintSignal, weeklyReportSignal, portfolioSignal, integrationSignal, careerProfileSignal, jobsDemandSignal, recommendationSignal, scenarioSimulatorSignal] = await Promise.all([
    summarizeGithubSignal(userId),
    summarizeResumeSignal(userId),
    summarizeSkillGapSignal(userId),
    summarizeCareerSprintSignal(userId),
    summarizeWeeklyReportSignal(userId),
    summarizePortfolioSignal(userId),
    summarizeIntegrationSignal(userId),
    summarizeCareerProfileSignal(userId),
    summarizeJobsDemandSignal(),
    summarizeRecommendationSignal(userId),
    summarizeScenarioSimulatorSignal(userId)
  ]);

  return {
    githubSignals,
    resumeSignals,
    skillGapSignals,
    careerSprintSignal,
    weeklyReportSignal,
    portfolioSignal,
    integrationSignal,
    careerProfileSignal,
    jobsDemandSignal,
    portfolioSignals: portfolioSignal,
    careerSprintSignals: careerSprintSignal,
    weeklyReportSignals: weeklyReportSignal,
    integrationSignals: integrationSignal,
    careerProfile: careerProfileSignal,
    jobsDemandSignals: jobsDemandSignal,
    recommendationSignal,
    recommendationSignals: recommendationSignal,
    scenarioSimulatorSignal,
    scenarioSimulatorSignals: scenarioSimulatorSignal
  };
};

const buildSignalHash = (signals = {}) => {
  const payload = {
    careerSprintSignal: signals.careerSprintSignal || {},
    weeklyReportSignal: signals.weeklyReportSignal || {},
    portfolioSignal: signals.portfolioSignal || {},
    integrationSignal: signals.integrationSignal || {},
    careerProfileSignal: signals.careerProfileSignal || {},
    jobsDemandSignal: signals.jobsDemandSignal || {},
    recommendationSignal: signals.recommendationSignal || signals.recommendationSignals || {},
    githubSignals: signals.githubSignals || {},
    resumeSignals: signals.resumeSignals || {},
    skillGapSignals: signals.skillGapSignals || {}
  };

  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
};

const buildSignalsUsedSummary = ({ username = '', resumeInsights = {}, githubInsights = {}, signals = {} } = {}) => {
  const githubSignal = signals.githubSignals || {};
  const resumeSignal = signals.resumeSignals || {};
  const skillGapSignal = signals.skillGapSignals || {};
  const careerSprintSignal = signals.careerSprintSignal || {};
  const weeklyReportSignal = signals.weeklyReportSignal || {};
  const portfolioSignal = signals.portfolioSignal || {};
  const integrationSignal = signals.integrationSignal || {};
  const careerProfileSignal = signals.careerProfileSignal || {};
  const jobsDemandSignal = signals.jobsDemandSignal || {};
  const recommendationSignal = signals.recommendationSignal || signals.recommendationSignals || {};
  const scenarioSimulatorSignal = signals.scenarioSimulatorSignal || signals.scenarioSimulatorSignals || {};

  return {
    github: {
      connected: Boolean(String(username || '').trim()),
      username: String(username || '').trim(),
      repoCount: Number(githubInsights.repoCount || githubSignal.repoCount || 0),
      developerLevel: String(githubInsights.developerLevel || githubSignal.developerLevel || '').trim(),
      source: githubSignal.present ? 'githubSignals' : 'fallback'
    },
    resume: {
      analyzed: Boolean(resumeInsights.analyzed || resumeSignal.analyzed),
      analysisId: String(resumeInsights.analysisId || resumeSignal.analysisId || 'no-resume'),
      fileName: String(resumeInsights.fileName || resumeSignal.fileName || '').trim(),
      lastAnalyzedAt: resumeInsights.lastAnalyzedAt || resumeSignal.lastAnalyzedAt || null,
      atsScore: Number(resumeInsights.atsScore || resumeSignal.atsScore || 0),
      experienceLevel: String(resumeInsights.experienceLevel || resumeSignal.experienceLevel || '').trim(),
      extractedSkills: safeStrings(resumeInsights.skills || resumeSignal.skills || [], 12),
      experienceKeywords: safeStrings(resumeInsights.experienceKeywords || resumeSignal.experienceKeywords || [], 12),
      strengths: safeStrings(resumeInsights.strengths || resumeSignal.strengths || [], 6),
      weaknesses: safeStrings(resumeInsights.weaknesses || resumeSignal.weaknesses || [], 6),
      missingSections: safeStrings(resumeInsights.missingSections || resumeSignal.missingSections || [], 6),
      statusMessage: String(resumeInsights.statusMessage || resumeSignal.statusMessage || '').trim(),
      source: resumeSignal.analyzed ? 'resumeSignals' : 'fallback'
    },
    skillGap: {
      present: Boolean(skillGapSignal.present),
      coverage: Number(skillGapSignal.coverage || 0),
      knownSkills: safeStrings(skillGapSignal.knownSkills || [], 10),
      missingSkills: safeStrings(skillGapSignal.missingSkills || [], 10),
      weakSkills: safeStrings(skillGapSignal.weakSkills || [], 8),
      highDemandSkills: Array.isArray(skillGapSignal.highDemandSkills) ? skillGapSignal.highDemandSkills.slice(0, 8) : [],
      updatedAt: skillGapSignal.updatedAt || null
    },
    portfolio: {
      present: Boolean(portfolioSignal.present),
      completenessScore: Number(portfolioSignal.completenessScore || 0),
      projectCount: Number(portfolioSignal.listedProjects || 0),
      liveLinkCount: Number(portfolioSignal.liveLinks || 0)
    },
    integrations: {
      providers: safeStrings(integrationSignal.usedProviders || [], 10),
      score: Number(integrationSignal.integrationScore || 0),
      strongestProof: safeStrings(integrationSignal.strongestProof || [], 4)
    },
    weeklyProgress: {
      status: String(weeklyReportSignal.status || 'Unavailable'),
      score: Number(weeklyReportSignal.weeklyProgressScore || 0),
      trendDelta: Number(weeklyReportSignal.trendDelta || 0)
    },
    careerSprint: {
      consistencyScore: Number(careerSprintSignal.consistencyScore || 0),
      streak: Number(careerSprintSignal.streak || 0),
      activeLearningFocus: String(careerSprintSignal.activeLearningFocus || '').trim()
    },
    careerProfile: {
      careerStack: String(careerProfileSignal.careerStack || '').trim(),
      experienceLevel: String(careerProfileSignal.experienceLevel || '').trim(),
      careerGoal: String(careerProfileSignal.careerGoal || '').trim()
    },
    jobsDemand: {
      sampledJobs: Number(jobsDemandSignal.sampledJobs || 0),
      topSkills: Array.isArray(jobsDemandSignal.topSkills) ? jobsDemandSignal.topSkills.slice(0, 10) : []
    },
    recommendations: {
      present: Boolean(recommendationSignal.present),
      priorityRecommendations: Array.isArray(recommendationSignal.priorityRecommendations)
        ? recommendationSignal.priorityRecommendations.slice(0, 6)
        : []
    },
    scenarioSimulator: {
      present: Boolean(scenarioSimulatorSignal.present),
      savedCount: Number(scenarioSimulatorSignal.savedCount || 0),
      latestScenarioHash: String(scenarioSimulatorSignal.latestScenarioHash || '').trim(),
      savedScenarios: Array.isArray(scenarioSimulatorSignal.savedScenarios)
        ? scenarioSimulatorSignal.savedScenarios.slice(0, 6)
        : []
    }
  };
};

module.exports = {
  getDeveloperSignals,
  buildSignalHash,
  buildSignalsUsedSummary,
  buildResumeAnalysisSignals,
  buildResumeCacheIdentity,
  buildAnalysisBasedOn
};
