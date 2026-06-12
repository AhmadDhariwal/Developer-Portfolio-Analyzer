const nodemailer = require('nodemailer');
const sendgrid = require('@sendgrid/mail');
const cron = require('node-cron');
const crypto = require('node:crypto');
const WeeklyReport = require('../models/weeklyReport');
const User = require('../models/user');
const Analysis = require('../models/analysis');
const ResumeAnalysis = require('../models/resumeAnalysis');
const SkillGraph = require('../models/skillGraph');
const CareerSprint = require('../models/careerSprint');
const InterviewPrepSession = require('../models/interviewPrepSession');
const Repository = require('../models/repository');
const Recommendation = require('../models/recommendation');
const PublicProfile = require('../models/publicProfile');
const IntegrationConnection = require('../models/integrationConnection');
const aiService = require('./aiservice');
const { getDeveloperSignals, buildSignalsUsedSummary } = require('./developerSignalService');
const { getWeeklyReportPrompt } = require('../prompts/weeklyReportPrompt');

const WEEKLY_REPORT_VERSION = 'weekly-report-v2';

const FRONTEND_BASE_URL = String(process.env.FRONTEND_BASE_URL || 'http://localhost:4200').replace(/\/$/, '');
const APP_NAME = String(process.env.APP_NAME || 'DevInsight AI');

const clamp = (value, min = 0, max = 100) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, Math.round(numeric)));
};
const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(Number(value || 0))));
const toNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const sumNumbers = (values = []) => values.reduce((sum, value) => sum + toNumber(value), 0);
const signed = (value) => `${toNumber(value) > 0 ? '+' : ''}${Math.round(toNumber(value))}`;
const toCleanStrings = (values = [], limit = 6) => {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .slice(0, limit);
};

const escapeHtml = (value = '') => {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
};

const getProvider = () => {
  if (process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL) return 'sendgrid';
  if (process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM_EMAIL) {
    return 'smtp';
  }
  return null;
};

const sendWithSendGrid = async ({ to, subject, html, text }) => {
  sendgrid.setApiKey(process.env.SENDGRID_API_KEY);
  await sendgrid.send({ to, from: process.env.SENDGRID_FROM_EMAIL, subject, html, text });
};

const sendWithSmtp = async ({ to, subject, html, text }) => {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number.parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM_EMAIL,
    to,
    subject,
    html,
    text
  });
};

const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value && typeof value === 'object' && value._bsontype) return JSON.stringify(String(value));
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const buildStableHash = (value) => crypto
  .createHash('sha256')
  .update(stableStringify(value))
  .digest('hex');

const updateWeeklyReportEmailStatus = async (reportId, { status = 'skipped', error = '' } = {}) => {
  if (!reportId) return null;
  return WeeklyReport.findByIdAndUpdate(
    reportId,
    {
      $set: {
        emailStatus: status,
        emailedAt: status === 'sent' ? new Date() : null,
        emailError: String(error || '').trim().slice(0, 300)
      }
    },
    { returnDocument: 'after' }
  );
};

const buildEmailHtml = ({
  name,
  score,
  githubScore,
  resumeScore,
  summary,
  recommendations,
  topAchievements,
  biggestRiskArea,
  predictedHiringReadiness,
  reportLink
}) => {
  const safeRecommendations = toCleanStrings(recommendations, 5);
  const safeAchievements = toCleanStrings(topAchievements, 3);
  const safeSummary = escapeHtml(summary);
  const safeRisk = escapeHtml(biggestRiskArea || 'No critical risk flagged this week.');
  const readiness = predictedHiringReadiness || { score: 0, reason: '' };
  const readinessScore = clampPercent(readiness.score);
  const readinessReason = escapeHtml(readiness.reason || 'Momentum remains stable if execution stays consistent next week.');

  const recList = safeRecommendations.map((rec) => `
    <li style="margin-bottom:12px; display:flex; align-items:flex-start;">
      <span style="color:#a3a6ff; margin-right:8px; font-weight:bold;">-</span>
      <span style="color:#dee5ff;">${escapeHtml(rec)}</span>
    </li>`).join('');

  const achievementsList = safeAchievements.map((achievement) => `
    <li style="margin-bottom:10px; color:#dee5ff; line-height:1.6;">${escapeHtml(achievement)}</li>`).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin:0; padding:0; background-color:#060e20; font-family:'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <div style="max-width:600px; margin:0 auto; padding:40px 20px; color:#dee5ff;">

        <div style="margin-bottom:32px; text-align:center;">
          <h1 style="font-family:'Space Grotesk', sans-serif; font-size:24px; font-weight:700; color:#a3a6ff; margin:0; text-transform:uppercase; letter-spacing:1px;">Weekly Insight</h1>
          <p style="margin:8px 0 0 0; color:#a3aac4; font-size:14px;">Your AI Career Momentum Report</p>
        </div>

        <div style="background:linear-gradient(135deg, #091328 0%, #0f1930 100%); border-radius:24px; padding:32px; text-align:center; margin-bottom:24px; border:1px solid rgba(163, 166, 255, 0.1);">
          <div style="font-family:'Space Grotesk', sans-serif; font-size:64px; font-weight:700; color:#a3a6ff; line-height:1; margin-bottom:8px;">${clampPercent(score)}%</div>
          <div style="font-size:14px; font-weight:600; color:#53ddfc; text-transform:uppercase; letter-spacing:2px; margin-bottom:16px;">Weekly Growth Score</div>
          <p style="color:#dee5ff; font-size:16px; line-height:1.6; margin:0;">Hi ${escapeHtml(name || 'there')}, your velocity is building. Here is how you performed this week.</p>
        </div>

        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom:24px;">
          <tr>
            <td width="50%" align="center" style="background:#091328; border-radius:16px; padding:20px;">
              <div style="font-size:12px; color:#a3aac4; text-transform:uppercase; margin-bottom:4px;">GitHub Activity</div>
              <div style="font-size:20px; font-weight:700; color:#53ddfc;">${clampPercent(githubScore)}%</div>
            </td>
            <td width="20">&nbsp;</td>
            <td width="50%" align="center" style="background:#091328; border-radius:16px; padding:20px;">
              <div style="font-size:12px; color:#a3aac4; text-transform:uppercase; margin-bottom:4px;">Resume Health</div>
              <div style="font-size:20px; font-weight:700; color:#a3a6ff;">${clampPercent(resumeScore)}%</div>
            </td>
          </tr>
        </table>

        <div style="background:rgba(147, 150, 255, 0.05); border-radius:20px; padding:24px; margin-bottom:24px; border-left:4px solid #a3a6ff;">
          <h3 style="margin:0 0 12px 0; font-size:16px; color:#a3a6ff;">Executive Summary</h3>
          <p style="margin:0; font-size:15px; line-height:1.6; color:#dee5ff;">${safeSummary}</p>
        </div>

        <div style="background:#091328; border-radius:20px; padding:24px; margin-bottom:20px;">
          <h3 style="margin:0 0 16px 0; font-size:16px; color:#53ddfc;">Top 3 Achievements</h3>
          <ol style="margin:0; padding-left:18px;">
            ${achievementsList || '<li style="color:#dee5ff;">Progress remained stable this week.</li>'}
          </ol>
        </div>

        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom:20px;">
          <tr>
            <td width="50%" style="background:#091328; border-radius:16px; padding:18px; vertical-align:top;">
              <div style="font-size:12px; color:#a3aac4; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">Biggest Risk Area</div>
              <div style="color:#fbbf24; line-height:1.6;">${safeRisk}</div>
            </td>
            <td width="16">&nbsp;</td>
            <td width="50%" style="background:#091328; border-radius:16px; padding:18px; vertical-align:top;">
              <div style="font-size:12px; color:#a3aac4; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px;">Predicted Hiring Readiness (Next Week)</div>
              <div style="font-size:24px; font-weight:700; color:#22c55e; margin-bottom:6px;">${readinessScore}%</div>
              <div style="color:#dee5ff; line-height:1.6;">${readinessReason}</div>
            </td>
          </tr>
        </table>

        <div style="background:#091328; border-radius:20px; padding:24px; margin-bottom:32px;">
          <h3 style="margin:0 0 16px 0; font-size:16px; color:#53ddfc;">Next Steps to Accelerate</h3>
          <ul style="margin:0; padding:0; list-style:none;">${recList}</ul>
        </div>

        <div style="text-align:center;">
          <a href="${reportLink}" style="display:inline-block; padding:16px 32px; background:linear-gradient(45deg, #4f46e5, #6366f1); color:#ffffff; text-decoration:none; border-radius:12px; font-weight:700; font-size:15px; box-shadow:0 4px 12px rgba(79, 70, 229, 0.3);">Access Full Dashboard</a>
          <p style="margin-top:24px; font-size:12px; color:#6d758c;">This report was generated by ${escapeHtml(APP_NAME)} AI Coach.<br/>To manage your notifications, visit your account settings.</p>
        </div>

      </div>
    </body>
    </html>`;
};

const buildEmailText = ({
  name,
  summary,
  recommendations,
  topAchievements,
  biggestRiskArea,
  predictedHiringReadiness,
  reportLink
}) => {
  const safeRecommendations = toCleanStrings(recommendations, 5);
  const safeAchievements = toCleanStrings(topAchievements, 3);
  const readiness = predictedHiringReadiness || { score: 0, reason: '' };

  return [
    `Hi ${name || 'there'},`,
    '',
    'Your weekly AI coach report is ready.',
    '',
    `Summary: ${String(summary || '').trim()}`,
    '',
    'Top achievements:',
    ...safeAchievements.map((achievement, index) => `${index + 1}. ${achievement}`),
    '',
    `Biggest risk area: ${String(biggestRiskArea || '').trim()}`,
    `Predicted hiring readiness next week: ${clampPercent(readiness.score)}%`,
    `Why: ${String(readiness.reason || '').trim()}`,
    '',
    'Recommendations:',
    ...safeRecommendations.map((recommendation) => `- ${recommendation}`),
    '',
    `View report: ${reportLink}`
  ].join('\n');
};

const startOfWeek = (date = new Date()) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfWeek = (startDate) => {
  const d = new Date(startDate);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
};

const previousWeekRange = (weekStartDate) => {
  const previousStart = new Date(weekStartDate);
  previousStart.setDate(previousStart.getDate() - 7);
  previousStart.setHours(0, 0, 0, 0);
  return {
    start: previousStart,
    end: endOfWeek(previousStart)
  };
};

const computeResumeScore = (resumeAnalysis) => {
  if (!resumeAnalysis) return 0;
  const scores = [
    toNumber(resumeAnalysis.atsScore),
    toNumber(resumeAnalysis.keywordDensity),
    toNumber(resumeAnalysis.formatScore),
    toNumber(resumeAnalysis.contentQuality)
  ];
  if (!scores.length) return 0;
  return clampPercent(sumNumbers(scores) / scores.length);
};

const getSkillFocus = (skillGraph) => {
  if (Array.isArray(skillGraph?.weeklyRoadmap) && skillGraph.weeklyRoadmap.length) {
    return toCleanStrings(skillGraph.weeklyRoadmap[0].focusSkills || [], 6);
  }

  if (Array.isArray(skillGraph?.nodes) && skillGraph.nodes.length) {
    return skillGraph.nodes
      .filter((node) => node.kind === 'missing')
      .sort((a, b) => toNumber(b.demandScore) - toNumber(a.demandScore))
      .slice(0, 4)
      .map((node) => String(node.name || '').trim())
      .filter(Boolean);
  }

  return [];
};

const extractSkillSignals = (skillGraph) => {
  const nodes = Array.isArray(skillGraph?.nodes) ? skillGraph.nodes : [];
  const currentNodes = nodes.filter((node) => node.kind === 'current');
  const missingNodes = nodes.filter((node) => node.kind === 'missing');

  const strong = currentNodes
    .sort((a, b) => toNumber(b.proficiency) - toNumber(a.proficiency))
    .slice(0, 6)
    .map((node) => String(node.name || '').trim())
    .filter(Boolean);

  const missing = missingNodes
    .sort((a, b) => toNumber(b.demandScore) - toNumber(a.demandScore))
    .slice(0, 6)
    .map((node) => String(node.name || '').trim())
    .filter(Boolean);

  const averageProficiency = currentNodes.length
    ? Math.round(sumNumbers(currentNodes.map((node) => node.proficiency)) / currentNodes.length)
    : 0;

  const totalSkills = currentNodes.length + missingNodes.length;
  const ratioScore = totalSkills ? (currentNodes.length / totalSkills) * 100 : 0;
  const coverageScore = clampPercent((ratioScore * 0.7) + (averageProficiency * 0.3));

  return {
    strong,
    missing,
    currentSkillCount: currentNodes.length,
    missingSkillCount: missingNodes.length,
    averageProficiency,
    coverageScore
  };
};

const buildActivitySnapshot = (repositories, weekStartDate) => {
  const safeRepos = Array.isArray(repositories) ? repositories : [];
  const commits = sumNumbers(safeRepos.map((repo) => repo.commits));
  const stars = sumNumbers(safeRepos.map((repo) => repo.stars));
  const forks = sumNumbers(safeRepos.map((repo) => repo.forks));
  const activeRepositories = safeRepos.filter((repo) => {
    if (!repo?.lastUpdated) return false;
    const updatedAt = new Date(repo.lastUpdated);
    return !Number.isNaN(updatedAt.getTime()) && updatedAt >= weekStartDate;
  }).length;

  return {
    repositoriesTracked: safeRepos.length,
    activeRepositories,
    commits,
    weeklyCommitSignal: commits > 0 ? commits : activeRepositories * 3,
    stars,
    forks
  };
};

const buildSprintSnapshot = (sprint) => {
  const tasks = Array.isArray(sprint?.tasks) ? sprint.tasks : [];
  const tasksCompleted = tasks.filter((task) => Boolean(task?.isCompleted)).length;
  const tasksTotal = tasks.length;
  const completionRate = tasksTotal ? Math.round((tasksCompleted / tasksTotal) * 100) : 0;

  return {
    tasksCompleted,
    tasksTotal,
    completionRate: clampPercent(completionRate),
    weeklyGoal: toNumber(sprint?.weeklyGoal),
    streak: toNumber(sprint?.streak)
  };
};

const buildInterviewSnapshot = (sessions = []) => {
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  return {
    sessions: safeSessions.length,
    questionsGenerated: sumNumbers(safeSessions.map((session) => (Array.isArray(session?.questions) ? session.questions.length : 0)))
  };
};

const buildRecommendationSnapshot = (recommendations = [], weeklyReportSignal = {}) => {
  const safeRecommendations = Array.isArray(recommendations) ? recommendations : [];
  const categoryCounts = safeRecommendations.reduce((accumulator, recommendation) => {
    const key = String(recommendation?.category || 'General').trim() || 'General';
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});

  return {
    total: safeRecommendations.length,
    highPriority: safeRecommendations.filter((recommendation) => String(recommendation?.priorityType || recommendation?.priority || '').toLowerCase() === 'high').length,
    categories: Object.entries(categoryCounts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 4)
      .map(([category]) => category),
    titles: safeRecommendations.slice(0, 4).map((recommendation) => String(recommendation?.title || '').trim()).filter(Boolean),
    completedRecommendations: weeklyReportSignal?.completedRecommendations,
    missedRecommendations: weeklyReportSignal?.missedRecommendations
  };
};

const buildPortfolioSnapshot = (profile, portfolioSignal = {}) => ({
  isPublic: Boolean(profile?.isPublic),
  completenessScore: clamp(portfolioSignal.completenessScore || 0),
  listedProjects: Number(portfolioSignal.listedProjects || 0),
  liveLinks: Number(portfolioSignal.liveLinks || 0),
  githubLinks: Number(portfolioSignal.githubLinks || 0),
  projectPresentationQuality: clamp(portfolioSignal.projectPresentationQuality || 0)
});

const buildIntegrationSnapshot = (connections = [], integrationSignal = {}) => {
  const safeConnections = Array.isArray(connections) ? connections : [];
  return {
    connectedProviders: safeConnections.filter((connection) => connection?.status === 'connected').map((connection) => connection.provider),
    providerCount: safeConnections.filter((connection) => connection?.status === 'connected').length,
    integrationScore: clamp(integrationSignal.integrationScore || 0),
    strongestProof: toCleanStrings(integrationSignal.strongestProof || [], 4),
    weakProof: toCleanStrings(integrationSignal.weakProof || [], 4)
  };
};

const buildWeeklySignalFromReports = (reports = []) => {
  const safeReports = Array.isArray(reports) ? reports.filter(Boolean) : [];
  const latest = safeReports[0];
  const previous = safeReports[1];

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

  return {
    present: true,
    weeklyProgressScore: clamp(latest.score || 0),
    status: clamp(latest.score || 0) >= 75 ? 'Strong' : clamp(latest.score || 0) >= 50 ? 'Improving' : 'Needs Focus',
    completedRecommendations: null,
    missedRecommendations: null,
    skillsImprovedThisWeek: toCleanStrings(latest.meta?.skillFocus || latest.topAchievements || [], 6),
    repeatedWeakAreas: toCleanStrings(safeReports.flatMap((report) => [
      report.biggestRiskArea,
      ...(report.recommendations || [])
    ]), 5),
    trendDelta: toNumber(latest?.meta?.comparisons?.scoreDelta ?? (toNumber(latest.score) - toNumber(previous?.score))),
    updatedAt: latest.weekEndDate || latest.updatedAt || null
  };
};

const loadDefaultResumeAnalysis = async (userId, user = {}) => {
  if (user?.defaultResumeFileId) {
    const activeAnalysis = await ResumeAnalysis.findOne({ userId, fileId: user.defaultResumeFileId })
      .sort({ analyzedAt: -1, updatedAt: -1 })
      .select('atsScore keywordDensity formatScore contentQuality keyAchievements analyzedAt updatedAt createdAt fileId fileName')
      .lean();
    if (activeAnalysis) return activeAnalysis;
  }

  return ResumeAnalysis.findOne({ userId })
    .sort({ analyzedAt: -1, updatedAt: -1 })
    .select('atsScore keywordDensity formatScore contentQuality keyAchievements analyzedAt updatedAt createdAt fileId fileName')
    .lean();
};

const buildDataSourcesUsed = ({
  analysis,
  resumeAnalysis,
  skillGraph,
  recommendations,
  currentSprint,
  currentInterviewSessions,
  publicProfile,
  integrationConnections,
  developerSignals
}) => {
  const portfolioSignal = developerSignals?.portfolioSignal || {};
  const integrationSignal = developerSignals?.integrationSignal || {};
  const sprintSignal = developerSignals?.careerSprintSignal || {};

  return {
    github: {
      connected: Boolean(analysis),
      lastAnalyzedAt: analysis?.updatedAt || analysis?.createdAt || null,
      status: analysis ? 'Connected' : 'Unavailable'
    },
    resume: {
      analyzed: Boolean(resumeAnalysis),
      lastAnalyzedAt: resumeAnalysis?.analyzedAt || resumeAnalysis?.updatedAt || resumeAnalysis?.createdAt || null,
      status: resumeAnalysis ? 'Analyzed' : 'Unavailable'
    },
    skillGap: {
      analyzed: Boolean(skillGraph),
      lastAnalyzedAt: skillGraph?.updatedAt || skillGraph?.createdAt || null,
      status: skillGraph ? 'Analyzed' : 'Unavailable'
    },
    recommendations: {
      available: recommendations.length > 0,
      lastAnalyzedAt: recommendations[0]?.createdAt || null,
      status: recommendations.length ? `${recommendations.length} active` : 'Unavailable'
    },
    careerSprint: {
      connected: Boolean(currentSprint),
      lastAnalyzedAt: currentSprint?.updatedAt || currentSprint?.createdAt || sprintSignal?.updatedAt || null,
      status: currentSprint ? String(sprintSignal?.status || 'Active') : 'Unavailable'
    },
    interviewPrep: {
      analyzed: currentInterviewSessions.length > 0,
      lastAnalyzedAt: currentInterviewSessions[0]?.updatedAt || currentInterviewSessions[0]?.createdAt || null,
      status: currentInterviewSessions.length ? `${currentInterviewSessions.length} sessions` : 'Unavailable'
    },
    portfolio: {
      connected: Boolean(publicProfile || portfolioSignal?.present),
      lastAnalyzedAt: publicProfile?.updatedAt || portfolioSignal?.updatedAt || null,
      status: publicProfile ? (publicProfile.isPublic ? 'Public' : 'Draft') : 'Unavailable'
    },
    integrations: {
      connected: integrationConnections.some((connection) => connection?.status === 'connected'),
      lastAnalyzedAt: integrationConnections[0]?.lastSyncedAt || integrationConnections[0]?.updatedAt || integrationSignal?.updatedAt || null,
      status: integrationConnections.some((connection) => connection?.status === 'connected')
        ? `${integrationConnections.filter((connection) => connection?.status === 'connected').length} connected`
        : 'Unavailable'
    }
  };
};

const buildBasePreviousSnapshot = ({ previousSprint, previousInterview }) => ({
  activity: {
    repositoriesTracked: 0,
    activeRepositories: 0,
    commits: 0,
    weeklyCommitSignal: 0,
    stars: 0,
    forks: 0
  },
  skills: {
    focus: [],
    strong: [],
    missing: [],
    currentSkillCount: 0,
    missingSkillCount: 0,
    averageProficiency: 0,
    coverageScore: 0
  },
  github: {
    score: 0,
    repos: 0,
    stars: 0,
    forks: 0,
    followers: 0,
    contributionCount: 0
  },
  resume: {
    score: 0,
    atsScore: 0,
    keywordDensity: 0,
    formatScore: 0,
    contentQuality: 0,
    achievementsCount: 0
  },
  sprint: previousSprint,
  interview: previousInterview,
  score: {
    overall: 0,
    readiness: 0
  }
});

const buildSnapshotFromReport = (report) => {
  if (!report) return null;

  if (report.meta?.snapshot && typeof report.meta.snapshot === 'object') {
    return report.meta.snapshot;
  }

  return {
    activity: {
      ...report.meta?.activity
    },
    skills: {
      focus: toCleanStrings(report.meta?.skillFocus || [], 6)
    },
    github: {
      score: toNumber(report.meta?.githubScore)
    },
    resume: {
      score: toNumber(report.meta?.resumeScore)
    },
    sprint: {
      ...report.meta?.sprint
    },
    interview: {
      ...report.meta?.interview
    },
    score: {
      overall: toNumber(report.score),
      readiness: toNumber(report.score)
    }
  };
};

const mergeSnapshots = (base, override = {}) => ({
  ...base,
  ...override,
  activity: { ...base.activity, ...override.activity },
  skills: { ...base.skills, ...override.skills },
  github: { ...base.github, ...override.github },
  resume: { ...base.resume, ...override.resume },
  sprint: { ...base.sprint, ...override.sprint },
  interview: { ...base.interview, ...override.interview },
  score: { ...base.score, ...override.score }
});

const computeOverallScore = ({ githubScore, resumeScore, sprintCompletionRate, interviewSignal, skillCoverage }) => {
  return clampPercent(
    (githubScore * 0.3) +
    (resumeScore * 0.25) +
    (sprintCompletionRate * 0.2) +
    (interviewSignal * 0.15) +
    (skillCoverage * 0.1)
  );
};

const buildComparisons = ({ current, previous }) => ({
  scoreDelta: toNumber(current?.score?.overall) - toNumber(previous?.score?.overall),
  readinessDelta: toNumber(current?.score?.readiness) - toNumber(previous?.score?.readiness),
  githubDelta: toNumber(current?.github?.score) - toNumber(previous?.github?.score),
  resumeDelta: toNumber(current?.resume?.score) - toNumber(previous?.resume?.score),
  sprintCompletionDelta: toNumber(current?.sprint?.completionRate) - toNumber(previous?.sprint?.completionRate),
  tasksCompletedDelta: toNumber(current?.sprint?.tasksCompleted) - toNumber(previous?.sprint?.tasksCompleted),
  interviewSessionsDelta: toNumber(current?.interview?.sessions) - toNumber(previous?.interview?.sessions),
  interviewQuestionsDelta: toNumber(current?.interview?.questionsGenerated) - toNumber(previous?.interview?.questionsGenerated),
  activityCommitsDelta: toNumber(current?.activity?.weeklyCommitSignal) - toNumber(previous?.activity?.weeklyCommitSignal || previous?.activity?.commits),
  activeReposDelta: toNumber(current?.activity?.activeRepositories) - toNumber(previous?.activity?.activeRepositories),
  missingSkillsDelta: toNumber(current?.skills?.missingSkillCount) - toNumber(previous?.skills?.missingSkillCount),
  coverageDelta: toNumber(current?.skills?.coverageScore) - toNumber(previous?.skills?.coverageScore)
});

const buildTopAchievements = ({ userData, previousData, comparisons }) => {
  const achievements = [];

  if (comparisons.githubDelta > 0) {
    achievements.push({
      impact: Math.abs(comparisons.githubDelta) + 25,
      text: `GitHub score improved from ${clampPercent(toNumber(previousData?.github?.score))}% to ${clampPercent(userData.github.score)}% (${signed(comparisons.githubDelta)}), with ${userData.activity.activeRepositories} active repositories this week.`
    });
  }

  if (userData.sprint.tasksCompleted > 0) {
    achievements.push({
      impact: (userData.sprint.tasksCompleted * 4) + Math.max(0, comparisons.sprintCompletionDelta),
      text: `Completed ${userData.sprint.tasksCompleted}/${userData.sprint.tasksTotal} sprint tasks (${userData.sprint.completionRate}%), shifting execution by ${signed(comparisons.sprintCompletionDelta)} points week-over-week.`
    });
  }

  if (userData.interview.sessions > 0 || userData.interview.questionsGenerated > 0) {
    achievements.push({
      impact: (userData.interview.sessions * 8) + userData.interview.questionsGenerated,
      text: `Ran ${userData.interview.sessions} interview prep sessions and practiced ${userData.interview.questionsGenerated} questions, a delta of ${signed(comparisons.interviewQuestionsDelta)} questions vs last week.`
    });
  }

  if (comparisons.resumeDelta > 0) {
    achievements.push({
      impact: Math.abs(comparisons.resumeDelta) + 18,
      text: `Resume score climbed from ${clampPercent(toNumber(previousData?.resume?.score))}% to ${clampPercent(userData.resume.score)}% (${signed(comparisons.resumeDelta)}), improving recruiter-facing quality signals.`
    });
  }

  if (comparisons.coverageDelta > 0 || comparisons.missingSkillsDelta < 0) {
    achievements.push({
      impact: Math.abs(comparisons.coverageDelta) + Math.abs(comparisons.missingSkillsDelta * 2),
      text: `Skill coverage rose by ${signed(comparisons.coverageDelta)} points and missing skills moved by ${signed(comparisons.missingSkillsDelta)}, indicating better stack alignment.`
    });
  }

  if (userData.activity.weeklyCommitSignal > 0) {
    achievements.push({
      impact: Math.min(20, userData.activity.weeklyCommitSignal),
      text: `Sustained coding momentum with a weekly activity signal of ${userData.activity.weeklyCommitSignal} and ${userData.activity.repositoriesTracked} tracked repositories.`
    });
  }

  const unique = [];
  const sortedAchievements = achievements.slice().sort((a, b) => b.impact - a.impact);
  sortedAchievements.forEach((item) => {
    if (!unique.includes(item.text)) unique.push(item.text);
  });

  if (unique.length >= 3) return unique.slice(0, 3);

  const fallback = [
    `Overall score reached ${userData.score.overall}% (${signed(comparisons.scoreDelta)} vs previous period).`,
    `GitHub and resume signals now stand at ${userData.github.score}% and ${userData.resume.score}% respectively.`,
    `Sprint completion is ${userData.sprint.completionRate}% with ${userData.sprint.tasksCompleted} completed tasks.`
  ];

  return [...unique, ...fallback.filter((item) => !unique.includes(item))].slice(0, 3);
};

const determineBiggestRiskArea = ({ userData, comparisons }) => {
  const risks = [];

  if (userData.sprint.completionRate < 50) {
    risks.push({
      severity: 90,
      message: `Sprint consistency risk: only ${userData.sprint.tasksCompleted}/${userData.sprint.tasksTotal} tasks completed (${userData.sprint.completionRate}%), which can reduce delivery credibility.`
    });
  }

  if (userData.interview.sessions === 0) {
    risks.push({
      severity: 85,
      message: 'Interview readiness risk: no interview sessions were logged this week, reducing short-term interview confidence.'
    });
  }

  if (comparisons.githubDelta < 0) {
    risks.push({
      severity: 75,
      message: `GitHub momentum risk: activity score dropped by ${Math.abs(Math.round(comparisons.githubDelta))} points from last week.`
    });
  }

  if (comparisons.resumeDelta < 0) {
    risks.push({
      severity: 72,
      message: `Resume quality risk: resume score decreased by ${Math.abs(Math.round(comparisons.resumeDelta))} points, which can hurt shortlist probability.`
    });
  }

  if (userData.skills.missingSkillCount >= 6) {
    risks.push({
      severity: 70,
      message: `${userData.skills.missingSkillCount} missing skills are still open, creating a stack-fit risk for current target roles.`
    });
  }

  if (!risks.length) {
    return 'No critical risk flagged this week. Maintain consistency to protect momentum.';
  }

  risks.sort((a, b) => b.severity - a.severity);
  return risks[0].message;
};

const predictHiringReadinessNextWeek = ({ userData, comparisons }) => {
  const positiveMomentum =
    Math.max(0, comparisons.githubDelta) * 0.35 +
    Math.max(0, comparisons.resumeDelta) * 0.3 +
    Math.max(0, comparisons.sprintCompletionDelta) * 0.2 +
    Math.max(0, comparisons.interviewQuestionsDelta) * 0.12 +
    Math.max(0, comparisons.coverageDelta) * 0.15;

  let riskPenalty = 0;
  if (userData.sprint.completionRate < 50) riskPenalty += 6;
  if (userData.interview.sessions === 0) riskPenalty += 5;
  if (userData.skills.missingSkillCount >= 6) riskPenalty += 4;
  if (comparisons.githubDelta < 0) riskPenalty += 3;
  if (comparisons.resumeDelta < 0) riskPenalty += 3;

  const projected = clampPercent(userData.score.readiness + positiveMomentum - riskPenalty);
  const reason = `Projected from readiness ${userData.score.readiness}%, adjusted by momentum (+${Math.round(positiveMomentum)}) and risk penalty (-${riskPenalty}) based on this week's execution pattern.`;

  return { score: projected, reason };
};

const transformIntoAIInput = ({
  user,
  weekStartDate,
  weekEndDate,
  userData,
  previousData,
  comparisons,
  topAchievements,
  biggestRiskArea,
  predictedHiringReadiness,
  dataSourcesUsed,
  signalsUsedSummary
}) => {
  return {
    reportingPeriod: {
      weekStart: weekStartDate.toISOString(),
      weekEnd: weekEndDate.toISOString()
    },
    profile: {
      name: user?.name || 'Developer',
      careerStack: user?.activeCareerStack || user?.careerStack || 'Full Stack',
      experienceLevel: user?.activeExperienceLevel || user?.experienceLevel || 'Student'
    },
    current: userData,
    previous: previousData,
    deltas: comparisons,
    deterministicSignals: {
      topAchievements,
      biggestRiskArea,
      predictedHiringReadiness
    },
    dataSourcesUsed,
    signalsUsedSummary,
    outputRequirements: [
      'Compare past vs present with concrete numbers.',
      'Use quantified language in every section.',
      'Stay personalized to the user data only.',
      'Top achievements must contain exactly three bullets.',
      'Include one clear biggest risk area.',
      'Predict next-week hiring readiness as a number and reason.',
      'Use AI only to summarize deterministic inputs and never invent source data.'
    ]
  };
};

const normalizeReadiness = (input, fallback) => {
  const fallbackScore = clampPercent(fallback?.score || 0);
  const fallbackReason = String(fallback?.reason || '').trim();

  if (input && typeof input === 'object') {
    return {
      score: clampPercent(input.score ?? input.value ?? fallbackScore),
      reason: String(input.reason || input.summary || fallbackReason).trim() || fallbackReason
    };
  }

  if (Number.isFinite(Number(input))) {
    return {
      score: clampPercent(input),
      reason: fallbackReason
    };
  }

  return {
    score: fallbackScore,
    reason: fallbackReason
  };
};

const normalizeReport = (result, fallback) => {
  const progressSummary = String(result?.progressSummary || fallback.progressSummary || '').trim();
  const insights = toCleanStrings(result?.insights, 5);
  const recommendations = toCleanStrings(result?.recommendations, 5);
  const achievements = toCleanStrings(result?.topAchievements, 3);

  const mergedInsights = insights.length ? insights : toCleanStrings(fallback.insights, 5);
  const mergedRecommendations = recommendations.length ? recommendations : toCleanStrings(fallback.recommendations, 5);
  const mergedAchievements = achievements.length ? achievements : toCleanStrings(fallback.topAchievements, 3);

  return {
    progressSummary: progressSummary || fallback.progressSummary,
    insights: mergedInsights,
    recommendations: mergedRecommendations,
    topAchievements: mergedAchievements,
    biggestRiskArea: String(result?.biggestRiskArea || fallback.biggestRiskArea || '').trim() || fallback.biggestRiskArea,
    predictedHiringReadiness: normalizeReadiness(
      result?.predictedHiringReadiness || {
        score: result?.predictedHiringReadinessScore,
        reason: result?.predictedHiringReadinessReason
      },
      fallback.predictedHiringReadiness
    )
  };
};

const generateWeeklyReport = async (userId, options = {}) => {
  const { forceRefresh = false } = options;

  const user = await User.findById(userId)
    .select('name email githubUsername activeGithubUsername careerStack experienceLevel activeCareerStack activeExperienceLevel defaultResumeFileId notifications')
    .lean();
  if (!user) return null;

  const weekStartDate = startOfWeek();
  const weekEndDate = endOfWeek(weekStartDate);
  const previousWeek = previousWeekRange(weekStartDate);

  const [analysis, resumeAnalysis, skillGraph, repositories] = await Promise.all([
    Analysis.findOne({ userId })
      .sort({ updatedAt: -1 })
      .select('githubScore readinessScore githubStats contributionActivity updatedAt createdAt')
      .lean(),
    loadDefaultResumeAnalysis(userId, user),
    SkillGraph.findOne({ userId })
      .sort({ updatedAt: -1 })
      .select('weeklyRoadmap nodes updatedAt createdAt')
      .lean(),
    Repository.find({ ownerId: userId })
      .select('repoName language stars forks commits lastUpdated')
      .lean()
  ]);

  const [
    existingReport,
    recentReports,
    currentSprint,
    previousSprint,
    currentInterviewSessions,
    previousInterviewSessions,
    recommendations,
    publicProfile,
    integrationConnections,
    developerSignals
  ] = await Promise.all([
    WeeklyReport.findOne({ userId, weekStartDate, weekEndDate }).lean(),
    WeeklyReport.find({ userId }).sort({ weekEndDate: -1 }).limit(4).lean(),
    CareerSprint.findOne({ userId, weekStartDate: { $lte: weekEndDate }, weekEndDate: { $gte: weekStartDate } }).sort({ updatedAt: -1 }).lean(),
    CareerSprint.findOne({ userId, weekStartDate: { $lte: previousWeek.end }, weekEndDate: { $gte: previousWeek.start } }).sort({ updatedAt: -1 }).lean(),
    InterviewPrepSession.find({ userId, createdAt: { $gte: weekStartDate, $lte: weekEndDate } }).lean(),
    InterviewPrepSession.find({ userId, createdAt: { $gte: previousWeek.start, $lte: previousWeek.end } }).lean(),
    Recommendation.find({ userId })
      .sort({ createdAt: -1 })
      .limit(8)
      .select('title priority priorityType category createdAt')
      .lean(),
    PublicProfile.findOne({ userId })
      .select('isPublic updatedAt projects skills')
      .lean(),
    IntegrationConnection.find({ userId })
      .sort({ lastSyncedAt: -1, updatedAt: -1 })
      .select('provider status lastSyncedAt updatedAt')
      .lean(),
    getDeveloperSignals(userId)
  ]);

  if (existingReport && !forceRefresh) {
    return existingReport;
  }

  const previousReport = recentReports.find((report) => !existingReport || String(report._id) !== String(existingReport._id)) || null;
  const previousWeeklyReports = recentReports.filter((report) => !existingReport || String(report._id) !== String(existingReport._id));
  const previousWeeklySignal = buildWeeklySignalFromReports(previousWeeklyReports);
  const reportDeveloperSignals = {
    ...developerSignals,
    weeklyReportSignal: previousWeeklySignal,
    weeklyReportSignals: previousWeeklySignal
  };

  const githubScore = clampPercent(toNumber(analysis?.githubScore));
  const resumeScore = computeResumeScore(resumeAnalysis);
  const skillSignals = extractSkillSignals(skillGraph);
  const skillFocus = getSkillFocus(skillGraph);
  const weeklySignal = previousWeeklySignal;
  const careerSprintSignal = reportDeveloperSignals?.careerSprintSignal || {};
  const portfolioSignal = reportDeveloperSignals?.portfolioSignal || {};
  const integrationSignal = reportDeveloperSignals?.integrationSignal || {};
  const activitySnapshot = buildActivitySnapshot(repositories, weekStartDate);
  const sprintSnapshot = buildSprintSnapshot(currentSprint);
  const previousSprintSnapshot = buildSprintSnapshot(previousSprint);
  const interviewSnapshot = buildInterviewSnapshot(currentInterviewSessions);
  const previousInterviewSnapshot = buildInterviewSnapshot(previousInterviewSessions);
  const recommendationSnapshot = buildRecommendationSnapshot(recommendations, weeklySignal);
  const portfolioSnapshot = buildPortfolioSnapshot(publicProfile, portfolioSignal);
  const integrationSnapshot = buildIntegrationSnapshot(integrationConnections, integrationSignal);

  const interviewSignal = clampPercent((interviewSnapshot.sessions * 20) + (interviewSnapshot.questionsGenerated * 3));
  const score = computeOverallScore({
    githubScore,
    resumeScore,
    sprintCompletionRate: sprintSnapshot.completionRate,
    interviewSignal,
    skillCoverage: skillSignals.coverageScore
  });

  const readiness = clampPercent(toNumber(analysis?.readinessScore) || score);

  const contributionCount = sumNumbers((analysis?.contributionActivity || []).map((entry) => entry.count));

  const userData = {
    activity: activitySnapshot,
    skills: {
      focus: skillFocus,
      strong: skillSignals.strong,
      missing: skillSignals.missing,
      currentSkillCount: skillSignals.currentSkillCount,
      missingSkillCount: skillSignals.missingSkillCount,
      averageProficiency: skillSignals.averageProficiency,
      coverageScore: skillSignals.coverageScore
    },
    github: {
      score: githubScore,
      repos: toNumber(analysis?.githubStats?.repos),
      stars: toNumber(analysis?.githubStats?.stars),
      forks: toNumber(analysis?.githubStats?.forks),
      followers: toNumber(analysis?.githubStats?.followers),
      contributionCount
    },
    resume: {
      score: resumeScore,
      atsScore: clampPercent(toNumber(resumeAnalysis?.atsScore)),
      keywordDensity: clampPercent(toNumber(resumeAnalysis?.keywordDensity)),
      formatScore: clampPercent(toNumber(resumeAnalysis?.formatScore)),
      contentQuality: clampPercent(toNumber(resumeAnalysis?.contentQuality)),
      achievementsCount: toCleanStrings(resumeAnalysis?.keyAchievements, 10).length
    },
    sprint: sprintSnapshot,
    interview: interviewSnapshot,
    recommendations: recommendationSnapshot,
    portfolio: portfolioSnapshot,
    integrations: integrationSnapshot,
    jobsDemand: {
      sampledJobs: Number(reportDeveloperSignals?.jobsDemandSignal?.sampledJobs || 0),
      topSkills: Array.isArray(reportDeveloperSignals?.jobsDemandSignal?.topSkills)
        ? reportDeveloperSignals.jobsDemandSignal.topSkills.slice(0, 10)
        : []
    },
    weeklySignals: {
      progressScore: clamp(weeklySignal.weeklyProgressScore || 0),
      trendDelta: toNumber(weeklySignal.trendDelta),
      skillsImprovedThisWeek: toCleanStrings(weeklySignal.skillsImprovedThisWeek || [], 5),
      repeatedWeakAreas: toCleanStrings(weeklySignal.repeatedWeakAreas || [], 5),
      recommendationCompletion: {
        completed: weeklySignal.completedRecommendations,
        missed: weeklySignal.missedRecommendations
      }
    },
    consistency: {
      sprintConsistencyScore: clamp(careerSprintSignal.consistencyScore || sprintSnapshot.completionRate),
      streak: toNumber(careerSprintSignal.streak || sprintSnapshot.streak),
      activeLearningFocus: String(careerSprintSignal.activeLearningFocus || '').trim()
    },
    score: {
      overall: score,
      readiness
    }
  };

  const previousBase = buildBasePreviousSnapshot({
    previousSprint: previousSprintSnapshot,
    previousInterview: previousInterviewSnapshot
  });

  const previousFromReport = buildSnapshotFromReport(previousReport);
  const previousData = mergeSnapshots(previousBase, previousFromReport || {});

  if (!toNumber(previousData.score.overall) && previousReport) {
    previousData.score.overall = toNumber(previousReport.score);
  }
  if (!toNumber(previousData.score.readiness)) {
    previousData.score.readiness = toNumber(previousData.score.overall);
  }

  const comparisons = buildComparisons({ current: userData, previous: previousData });

  const topAchievements = buildTopAchievements({ userData, previousData, comparisons });
  const biggestRiskArea = determineBiggestRiskArea({ userData, comparisons });
  const predictedHiringReadiness = predictHiringReadinessNextWeek({ userData, comparisons });
  const dataSourcesUsed = buildDataSourcesUsed({
    analysis,
    resumeAnalysis,
    skillGraph,
    recommendations,
    currentSprint,
    currentInterviewSessions,
    publicProfile,
    integrationConnections,
    developerSignals: reportDeveloperSignals
  });
  const signalsUsedSummary = buildSignalsUsedSummary({
    username: user.activeGithubUsername || user.githubUsername || (analysis ? 'github-connected' : ''),
    resumeInsights: {
      analyzed: Boolean(resumeAnalysis),
      analysisId: resumeAnalysis?._id ? String(resumeAnalysis._id) : '',
      fileName: resumeAnalysis?.fileName || '',
      lastAnalyzedAt: resumeAnalysis?.analyzedAt || resumeAnalysis?.updatedAt || resumeAnalysis?.createdAt || null,
      skills: reportDeveloperSignals?.resumeSignals?.skills || [],
      atsScore: userData.resume.atsScore,
      experienceLevel: user.activeExperienceLevel || user.experienceLevel || ''
    },
    githubInsights: {
      repoCount: userData.github.repos,
      developerLevel: userData.github.score >= 75 ? 'Strong' : userData.github.score >= 50 ? 'Growing' : 'Early'
    },
    signals: reportDeveloperSignals
  });

  const aiInput = transformIntoAIInput({
    user,
    weekStartDate,
    weekEndDate,
    userData,
    previousData,
    comparisons,
    topAchievements,
    biggestRiskArea,
    predictedHiringReadiness,
    dataSourcesUsed,
    signalsUsedSummary
  });

  const signalHash = buildStableHash({
    version: WEEKLY_REPORT_VERSION,
    userId: String(userId),
    weekStartDate: weekStartDate.toISOString(),
    weekEndDate: weekEndDate.toISOString(),
    current: userData,
    previous: previousData,
    deltas: comparisons,
    dataSourcesUsed,
    signalsUsedSummary
  });

  if (existingReport?.meta?.signalHash === signalHash) {
    return existingReport;
  }

  const prompt = getWeeklyReportPrompt({
    name: user.name,
    careerStack: user.activeCareerStack || user.careerStack || 'Full Stack',
    experienceLevel: user.activeExperienceLevel || user.experienceLevel || 'Student',
    aiInput
  });

  const fallback = {
    progressSummary: `Your overall score moved from ${clampPercent(previousData.score.overall)}% to ${userData.score.overall}% (${signed(comparisons.scoreDelta)}). GitHub is ${userData.github.score}% (${signed(comparisons.githubDelta)}), resume is ${userData.resume.score}% (${signed(comparisons.resumeDelta)}), and sprint completion is ${userData.sprint.completionRate}% with ${userData.sprint.tasksCompleted}/${userData.sprint.tasksTotal} tasks done.`,
    insights: [
      `GitHub momentum is ${userData.github.score}% with ${userData.activity.activeRepositories} active repositories and a commit signal of ${userData.activity.weeklyCommitSignal}.`,
      `Resume quality is ${userData.resume.score}% with ATS ${userData.resume.atsScore}% and content quality ${userData.resume.contentQuality}%.`,
      `Sprint completion changed by ${signed(comparisons.sprintCompletionDelta)} to ${userData.sprint.completionRate}%, indicating ${userData.sprint.completionRate >= 70 ? 'strong' : 'inconsistent'} execution cadence.`,
      `Interview prep logged ${userData.interview.sessions} sessions and ${userData.interview.questionsGenerated} questions (${signed(comparisons.interviewQuestionsDelta)} vs last period), while portfolio completeness is ${userData.portfolio.completenessScore}% and integrations score is ${userData.integrations.integrationScore}%.`,
      userData.jobsDemand.sampledJobs > 0
        ? `Jobs demand sampled ${userData.jobsDemand.sampledJobs} postings, with ${userData.jobsDemand.topSkills[0]?.name || 'target-stack skills'} appearing as a priority market signal.`
        : 'Jobs demand data was unavailable this week, so market-fit guidance is based on saved developer signals only.'
    ],
    recommendations: [
      `Increase sprint completion to at least 70% by finishing ${Math.max(0, Math.ceil((0.7 * Math.max(1, userData.sprint.tasksTotal)) - userData.sprint.tasksCompleted))} more tasks next week.`,
      `Run at least 2 interview sessions and solve 15+ questions to stabilize hiring readiness.`,
      `Prioritize one missing skill (${userData.skills.missing[0] || 'core stack skill'}) and ship one small project artifact around it.`,
      `Raise resume score by 5+ points by adding quantified outcomes from this week's work, and review ${userData.recommendations.titles[0] || 'your highest-priority recommendation'} for execution next week.`
    ],
    topAchievements,
    biggestRiskArea,
    predictedHiringReadiness
  };

  let aiResult = fallback;
  let narrativeSource = 'deterministic';
  try {
    aiResult = await aiService.runAIAnalysis(prompt, fallback);
    narrativeSource = aiResult === fallback ? 'deterministic' : 'ai-enhanced';
  } catch {
    aiResult = fallback;
  }
  const normalized = normalizeReport(aiResult, fallback);

  const reportText = [
    normalized.progressSummary,
    '',
    'Top 3 Achievements:',
    ...normalized.topAchievements.map((achievement, index) => `${index + 1}. ${achievement}`),
    '',
    `Biggest Risk Area: ${normalized.biggestRiskArea}`,
    `Predicted Hiring Readiness Next Week: ${normalized.predictedHiringReadiness.score}%`,
    `Reason: ${normalized.predictedHiringReadiness.reason}`,
    '',
    'Insights:',
    ...normalized.insights.map((insight) => `- ${insight}`),
    '',
    'Recommendations:',
    ...normalized.recommendations.map((recommendation) => `- ${recommendation}`)
  ].join('\n');

  const scoreBreakdown = {
    github: { label: 'GitHub', score: githubScore, weight: 30 },
    resume: { label: 'Resume', score: resumeScore, weight: 25 },
    sprint: { label: 'Sprint completion', score: sprintSnapshot.completionRate, weight: 20 },
    interview: { label: 'Interview prep', score: interviewSignal, weight: 15 },
    skillCoverage: { label: 'Skill coverage', score: skillSignals.coverageScore, weight: 10 }
  };

  const reportHash = buildStableHash({
    signalHash,
    score,
    normalized,
    reportText
  });

  const payload = {
    userId,
    weekStartDate,
    weekEndDate,
    score,
    progressSummary: normalized.progressSummary,
    insights: normalized.insights,
    recommendations: normalized.recommendations,
    topAchievements: normalized.topAchievements,
    biggestRiskArea: normalized.biggestRiskArea,
    predictedHiringReadiness: normalized.predictedHiringReadiness,
    emailStatus: 'skipped',
    emailedAt: null,
    emailError: '',
    reportText,
    meta: {
      githubScore,
      resumeScore,
      skillFocus,
      activity: activitySnapshot,
      sprint: sprintSnapshot,
      interview: interviewSnapshot,
      comparisons,
      dataSourcesUsed,
      signalHash,
      reportHash,
      narrativeSource,
      scoreBreakdown,
      snapshot: userData
    }
  };

  if (existingReport && forceRefresh) {
    return WeeklyReport.findByIdAndUpdate(existingReport._id, { $set: payload }, { returnDocument: 'after' });
  }

  return WeeklyReport.findOneAndUpdate(
    { userId, weekStartDate, weekEndDate },
    { $set: payload },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
};

const sendWeeklyReportEmail = async (report, user) => {
  if (!report || !user?.email) {
    await updateWeeklyReportEmailStatus(report?._id, {
      status: 'skipped',
      error: 'Missing report or recipient email.'
    });
    return { sent: false, reason: 'Missing report or email.' };
  }

  const provider = getProvider();
  if (!provider) {
    await updateWeeklyReportEmailStatus(report._id, {
      status: 'skipped',
      error: 'No email provider configured.'
    });
    return { sent: false, reason: 'No email provider configured.' };
  }

  const reportLink = `${FRONTEND_BASE_URL}/app/weekly-reports`;
  const subject = `[Insight] Your Weekly Performance Report: ${report.score}%`;
  const html = buildEmailHtml({
    name: user.name,
    score: report.score,
    githubScore: report.meta?.githubScore || 0,
    resumeScore: report.meta?.resumeScore || 0,
    summary: report.progressSummary,
    recommendations: report.recommendations,
    topAchievements: report.topAchievements,
    biggestRiskArea: report.biggestRiskArea,
    predictedHiringReadiness: report.predictedHiringReadiness,
    reportLink
  });
  const text = buildEmailText({
    name: user.name,
    summary: report.progressSummary,
    recommendations: report.recommendations,
    topAchievements: report.topAchievements,
    biggestRiskArea: report.biggestRiskArea,
    predictedHiringReadiness: report.predictedHiringReadiness,
    reportLink
  });

  try {
    if (provider === 'sendgrid') {
      await sendWithSendGrid({ to: user.email, subject, html, text });
    } else {
      await sendWithSmtp({ to: user.email, subject, html, text });
    }

    await updateWeeklyReportEmailStatus(report._id, { status: 'sent', error: '' });
    return { sent: true, provider };
  } catch (error) {
    await updateWeeklyReportEmailStatus(report._id, {
      status: 'failed',
      error: error?.message || 'Email send failed.'
    });
    throw error;
  }
};

const startWeeklyReportScheduler = () => {
  const scheduleExpr = process.env.WEEKLY_REPORT_CRON || '0 8 * * 1';
  cron.schedule(scheduleExpr, async () => {
    const users = await User.find({ 'notifications.weeklyScoreReport': { $ne: false } })
      .select('name email notifications careerStack experienceLevel activeCareerStack activeExperienceLevel')
      .lean();
    for (const user of users) {
      try {
        const report = await generateWeeklyReport(user._id);
        if (report) {
          if (user?.email) {
            await sendWeeklyReportEmail(report, user);
          } else {
            await updateWeeklyReportEmailStatus(report._id, {
              status: 'skipped',
              error: 'No user email is configured.'
            });
          }
        }
      } catch (error) {
        console.error('Weekly report cron error:', error.message);
      }
    }
  });
};

module.exports = {
  generateWeeklyReport,
  sendWeeklyReportEmail,
  updateWeeklyReportEmailStatus,
  startWeeklyReportScheduler
};
