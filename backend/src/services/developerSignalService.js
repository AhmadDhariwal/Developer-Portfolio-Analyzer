const crypto = require('node:crypto');
const CareerSprint = require('../models/careerSprint');
const WeeklyReport = require('../models/weeklyReport');
const PublicProfile = require('../models/publicProfile');
const User = require('../models/user');
const { calcWeightedProgress } = require('./careerSprintService');
const { buildPublicProfilePayload } = require('./publicProfileService');
const { getIntegrationInsight } = require('./integrationInsightService');

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

const getDeveloperSignals = async (userId) => {
  if (!userId) {
    return {
      careerSprintSignal: await summarizeCareerSprintSignal(null),
      weeklyReportSignal: await summarizeWeeklyReportSignal(null),
      portfolioSignal: await summarizePortfolioSignal(null),
      integrationSignal: await summarizeIntegrationSignal(null)
    };
  }

  const [careerSprintSignal, weeklyReportSignal, portfolioSignal, integrationSignal] = await Promise.all([
    summarizeCareerSprintSignal(userId),
    summarizeWeeklyReportSignal(userId),
    summarizePortfolioSignal(userId),
    summarizeIntegrationSignal(userId)
  ]);

  return {
    careerSprintSignal,
    weeklyReportSignal,
    portfolioSignal,
    integrationSignal
  };
};

const buildSignalHash = (signals = {}) => {
  const payload = {
    careerSprintSignal: signals.careerSprintSignal || {},
    weeklyReportSignal: signals.weeklyReportSignal || {},
    portfolioSignal: signals.portfolioSignal || {},
    integrationSignal: signals.integrationSignal || {}
  };

  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
};

const buildSignalsUsedSummary = ({ username = '', resumeInsights = {}, githubInsights = {}, signals = {} } = {}) => {
  const careerSprintSignal = signals.careerSprintSignal || {};
  const weeklyReportSignal = signals.weeklyReportSignal || {};
  const portfolioSignal = signals.portfolioSignal || {};
  const integrationSignal = signals.integrationSignal || {};

  return {
    github: {
      connected: Boolean(String(username || '').trim()),
      username: String(username || '').trim(),
      repoCount: Number(githubInsights.repoCount || 0),
      developerLevel: String(githubInsights.developerLevel || '').trim()
    },
    resume: {
      analyzed: Boolean(
        Number(resumeInsights.atsScore || 0) > 0 ||
        Number(resumeInsights.experienceYears || 0) > 0 ||
        (Array.isArray(resumeInsights.skills) && resumeInsights.skills.length)
      ),
      atsScore: Number(resumeInsights.atsScore || 0),
      experienceLevel: String(resumeInsights.experienceLevel || '').trim()
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
    }
  };
};

module.exports = {
  getDeveloperSignals,
  buildSignalHash,
  buildSignalsUsedSummary
};
