const nodemailer = require('nodemailer');
const sendgrid = require('@sendgrid/mail');
const cron = require('node-cron');
const WeeklyReport = require('../models/weeklyReport');
const User = require('../models/user');
const Analysis = require('../models/analysis');
const ResumeAnalysis = require('../models/resumeAnalysis');
const SkillGraph = require('../models/skillGraph');
const aiService = require('./aiservice');
const { getWeeklyReportPrompt } = require('../prompts/weeklyReportPrompt');

const FRONTEND_BASE_URL = String(process.env.FRONTEND_BASE_URL || 'http://localhost:4200').replace(/\/$/, '');
const APP_NAME = String(process.env.APP_NAME || 'DevInsight AI');

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

const buildEmailHtml = ({ name, summary, recommendations, reportLink }) => {
  const recList = recommendations.map((rec) => `<li style="margin-bottom:8px;">${rec}</li>`).join('');
  return `
  <div style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:620px;margin:0 auto;padding:24px;background:#f8fafc;border-radius:16px;border:1px solid #e2e8f0;">
    <h2 style="margin:0 0 12px 0;">Your weekly AI coach report</h2>
    <p style="margin:0 0 16px 0;">Hi ${name || 'there'}, here is your latest progress summary.</p>
    <div style="padding:14px;border-radius:12px;background:#ffffff;border:1px solid #e2e8f0;margin-bottom:18px;">
      <strong>Progress summary</strong>
      <p style="margin:8px 0 0 0;">${summary}</p>
    </div>
    <div style="padding:14px;border-radius:12px;background:#ffffff;border:1px solid #e2e8f0;margin-bottom:18px;">
      <strong>Top recommendations</strong>
      <ul style="margin:8px 0 0 18px;">${recList}</ul>
    </div>
    <a href="${reportLink}" style="display:inline-block;padding:10px 16px;background:#0f766e;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">View full report</a>
    <p style="margin-top:16px;font-size:12px;color:#64748b;">Sent by ${APP_NAME}</p>
  </div>`;
};

const buildEmailText = ({ name, summary, recommendations, reportLink }) => {
  return [
    `Hi ${name || 'there'},`,
    '',
    'Your weekly AI coach report is ready.',
    '',
    `Summary: ${summary}`,
    '',
    'Recommendations:',
    ...recommendations.map((rec) => `- ${rec}`),
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

const computeResumeScore = (resumeAnalysis) => {
  if (!resumeAnalysis) return 0;
  const scores = [
    Number(resumeAnalysis.atsScore || 0),
    Number(resumeAnalysis.keywordDensity || 0),
    Number(resumeAnalysis.formatScore || 0),
    Number(resumeAnalysis.contentQuality || 0)
  ].filter((v) => Number.isFinite(v));
  if (!scores.length) return 0;
  return Math.round(scores.reduce((sum, val) => sum + val, 0) / scores.length);
};

const getSkillFocus = (skillGraph) => {
  if (skillGraph?.weeklyRoadmap?.length) {
    return skillGraph.weeklyRoadmap[0].focusSkills || [];
  }
  if (skillGraph?.nodes?.length) {
    return skillGraph.nodes
      .filter((node) => node.kind === 'missing')
      .sort((a, b) => (b.demandScore || 0) - (a.demandScore || 0))
      .slice(0, 4)
      .map((node) => node.name);
  }
  return [];
};

const normalizeReport = (result) => {
  return {
    progressSummary: String(result.progressSummary || 'Keep building momentum by shipping focused portfolio improvements.').trim(),
    insights: Array.isArray(result.insights) ? result.insights.map(String).slice(0, 5) : [],
    recommendations: Array.isArray(result.recommendations) ? result.recommendations.map(String).slice(0, 5) : []
  };
};

const generateWeeklyReport = async (userId) => {
  const [user, analysis, resumeAnalysis, skillGraph] = await Promise.all([
    User.findById(userId).lean(),
    Analysis.findOne({ userId }).sort({ updatedAt: -1 }).lean(),
    ResumeAnalysis.findOne({ userId }).sort({ analyzedAt: -1 }).lean(),
    SkillGraph.findOne({ userId }).sort({ updatedAt: -1 }).lean()
  ]);

  if (!user) return null;

  const weekStartDate = startOfWeek();
  const weekEndDate = endOfWeek(weekStartDate);

  const existing = await WeeklyReport.findOne({ userId, weekStartDate, weekEndDate });
  if (existing) return existing;

  const githubScore = Number(analysis?.githubScore || 0);
  const resumeScore = computeResumeScore(resumeAnalysis);
  const scoreInputs = [githubScore, resumeScore].filter((v) => Number.isFinite(v) && v > 0);
  const score = scoreInputs.length ? Math.round(scoreInputs.reduce((sum, v) => sum + v, 0) / scoreInputs.length) : 0;

  const lastReport = await WeeklyReport.findOne({ userId }).sort({ weekEndDate: -1 }).lean();
  const scoreDelta = lastReport ? score - Number(lastReport.score || 0) : 0;

  const skillFocus = getSkillFocus(skillGraph);
  const topSkills = skillGraph?.nodes?.filter((node) => node.kind === 'current').slice(0, 6).map((node) => node.name) || [];
  const missingSkills = skillGraph?.nodes?.filter((node) => node.kind === 'missing').slice(0, 6).map((node) => node.name) || [];

  const prompt = getWeeklyReportPrompt({
    name: user.name,
    careerStack: user.careerStack || 'Full Stack',
    experienceLevel: user.experienceLevel || 'Student',
    scoreDelta,
    githubScore,
    resumeScore,
    skillFocus,
    topSkills,
    missingSkills
  });

  const fallback = {
    progressSummary: 'You maintained steady momentum this week with consistent portfolio activity.',
    insights: [
      'Your GitHub activity shows consistent momentum—keep shipping small improvements.',
      'Resume metrics are stable; highlight your latest project impact with numbers.',
      'Focus on one missing skill to improve your readiness score quickly.',
      'Share your portfolio publicly to attract recruiter attention.'
    ],
    recommendations: [
      'Pick one missing skill and build a mini project this week.',
      'Update your resume with 2 quantified achievements.',
      'Document a recent project in your public portfolio.',
      'Schedule one mock interview for practice.'
    ]
  };

  const aiResult = await aiService.runAIAnalysis(prompt, fallback);
  const normalized = normalizeReport(aiResult);

  const reportText = [
    normalized.progressSummary,
    '',
    'Insights:',
    ...normalized.insights.map((insight) => `- ${insight}`),
    '',
    'Recommendations:',
    ...normalized.recommendations.map((rec) => `- ${rec}`)
  ].join('\n');

  return WeeklyReport.create({
    userId,
    weekStartDate,
    weekEndDate,
    score,
    progressSummary: normalized.progressSummary,
    insights: normalized.insights,
    recommendations: normalized.recommendations,
    reportText,
    meta: { githubScore, resumeScore, skillFocus }
  });
};

const sendWeeklyReportEmail = async (report, user) => {
  if (!report || !user?.email) return { sent: false, reason: 'Missing report or email.' };

  const provider = getProvider();
  if (!provider) {
    return { sent: false, reason: 'No email provider configured.' };
  }

  const reportLink = `${FRONTEND_BASE_URL}/app/weekly-reports`;
  const subject = 'Your weekly AI coach report';
  const html = buildEmailHtml({
    name: user.name,
    summary: report.progressSummary,
    recommendations: report.recommendations,
    reportLink
  });
  const text = buildEmailText({
    name: user.name,
    summary: report.progressSummary,
    recommendations: report.recommendations,
    reportLink
  });

  if (provider === 'sendgrid') {
    await sendWithSendGrid({ to: user.email, subject, html, text });
  } else {
    await sendWithSmtp({ to: user.email, subject, html, text });
  }

  return { sent: true, provider };
};

const startWeeklyReportScheduler = () => {
  const scheduleExpr = process.env.WEEKLY_REPORT_CRON || '0 8 * * 1';
  cron.schedule(scheduleExpr, async () => {
    const users = await User.find({ 'notifications.weeklyScoreReport': true }).lean();
    for (const user of users) {
      try {
        const report = await generateWeeklyReport(user._id);
        if (report) {
          await sendWeeklyReportEmail(report, user);
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
  startWeeklyReportScheduler
};
