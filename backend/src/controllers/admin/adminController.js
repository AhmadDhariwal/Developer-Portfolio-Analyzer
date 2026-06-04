const User = require('../../models/user');
const PublicProfile = require('../../models/publicProfile');
const Job = require('../../models/Job');
const Invitation = require('../../models/invitation');
const Team = require('../../models/team');
const AuditLog = require('../../models/auditLog');
const Analysis = require('../../models/analysis');
const ResumeAnalysis = require('../../models/resumeAnalysis');

const DEVELOPER_ROLE_VALUES = ['developer', 'user'];

const resolveVisibleDeveloperUsers = async () => {
  const [publicUsers, publicProfiles] = await Promise.all([
    User.find({ role: { $in: DEVELOPER_ROLE_VALUES }, isPublic: true })
      .select('_id name email githubUsername jobTitle location avatar isPublic createdAt linkedin website careerStack experienceLevel')
      .lean(),
    PublicProfile.find({ isPublic: true })
      .select('userId slug headline summary skills projects socialLinks updatedAt lastViewedAt')
      .lean()
  ]);

  const visibleIds = new Set();
  const profileByUserId = new Map();

  publicUsers.forEach((entry) => visibleIds.add(String(entry._id)));
  publicProfiles.forEach((entry) => {
    if (entry?.userId) {
      const key = String(entry.userId);
      visibleIds.add(key);
      profileByUserId.set(key, entry);
    }
  });

  if (!visibleIds.size) {
    return [];
  }

  const users = await User.find({
    _id: { $in: Array.from(visibleIds) },
    role: { $in: DEVELOPER_ROLE_VALUES }
  })
    .select('name email githubUsername jobTitle location avatar isPublic createdAt linkedin website careerStack experienceLevel')
    .sort({ createdAt: -1 })
    .lean();

  const userIds = users.map((user) => user._id);
  const [analyses, resumeAnalyses] = await Promise.all([
    Analysis.find({ userId: { $in: userIds } })
      .select('userId githubScore readinessScore updatedAt createdAt')
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean(),
    ResumeAnalysis.find({ userId: { $in: userIds } })
      .select('userId atsScore analyzedAt skills')
      .sort({ analyzedAt: -1, createdAt: -1 })
      .lean()
  ]);

  const analysisByUserId = new Map();
  analyses.forEach((analysis) => {
    const key = String(analysis.userId || '');
    if (key && !analysisByUserId.has(key)) {
      analysisByUserId.set(key, analysis);
    }
  });

  const resumeAnalysisByUserId = new Map();
  resumeAnalyses.forEach((analysis) => {
    const key = String(analysis.userId || '');
    if (key && !resumeAnalysisByUserId.has(key)) {
      resumeAnalysisByUserId.set(key, analysis);
    }
  });

  return users.map((user) => ({
    ...(function buildDeveloperSummary() {
      const key = String(user._id);
      const publicProfile = profileByUserId.get(key) || null;
      const analysis = analysisByUserId.get(key) || null;
      const resumeAnalysis = resumeAnalysisByUserId.get(key) || null;
      const resumeSkillValues = resumeAnalysis?.skills
        ? (resumeAnalysis.skills instanceof Map
            ? Array.from(resumeAnalysis.skills.values())
            : Object.values(resumeAnalysis.skills))
        : [];
      const flattenedResumeSkills = resumeSkillValues.flat().map((value) => String(value || '').trim()).filter(Boolean);
      const publicSkills = Array.isArray(publicProfile?.skills)
        ? publicProfile.skills.map((skill) => String(skill?.name || '').trim()).filter(Boolean)
        : [];
      const skills = [...new Set([...publicSkills, ...flattenedResumeSkills])].slice(0, 8);
      const projects = Array.isArray(publicProfile?.projects)
        ? publicProfile.projects.slice(0, 3).map((project) => ({
            title: String(project?.title || '').trim(),
            description: String(project?.description || '').trim(),
            tech: Array.isArray(project?.tech) ? project.tech.map((item) => String(item || '').trim()).filter(Boolean) : [],
            url: String(project?.url || '').trim(),
            repoUrl: String(project?.repoUrl || '').trim()
          }))
        : [];
      return {
        headline: String(publicProfile?.headline || user.jobTitle || '').trim(),
        summary: String(publicProfile?.summary || '').trim(),
        stack: String(user.careerStack || '').trim(),
        experienceLevel: String(user.experienceLevel || '').trim(),
        linkedin: String(publicProfile?.socialLinks?.linkedin || user.linkedin || '').trim(),
        website: String(publicProfile?.socialLinks?.website || user.website || '').trim(),
        githubScore: Number(analysis?.githubScore || 0),
        readinessScore: Number(analysis?.readinessScore || analysis?.githubScore || 0),
        resumeScore: Number(resumeAnalysis?.atsScore || 0),
        skills,
        projects,
        projectsCount: projects.length,
        lastAnalyzedAt: resumeAnalysis?.analyzedAt || analysis?.updatedAt || analysis?.createdAt || null
      };
    })(),
    _id: user._id,
    name: user.name,
    email: user.email,
    githubUsername: user.githubUsername,
    jobTitle: user.jobTitle || '',
    location: user.location || '',
    avatar: user.avatar || '',
    isPublic: Boolean(user.isPublic || profileByUserId.has(String(user._id))),
    publicProfileSlug: String(profileByUserId.get(String(user._id))?.slug || '') || null,
    createdAt: user.createdAt
  }));
};

const getOrganizationOverview = async (req, res) => {
  try {
    const organizationId = req.organizationId;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [recruitersCount, jobsCount, developers, pendingInvitationsCount, activeTeamsCount, recentActivity] = await Promise.all([
      User.countDocuments({ role: 'recruiter', organizationId }),
      Job.countDocuments({ organizationId }),
      resolveVisibleDeveloperUsers(),
      Invitation.countDocuments({
        organizationId,
        role: 'recruiter',
        status: 'pending',
        expiresAt: { $gt: new Date() }
      }),
      Team.countDocuments({ organizationId, isActive: { $ne: false } }),
      AuditLog.find({ organizationId, timestamp: { $gte: since } })
        .sort({ timestamp: -1 })
        .limit(5)
        .populate('actor', 'name email role')
        .select('action method route statusCode timestamp actor')
        .lean()
    ]);

    return res.status(200).json({
      overview: {
        organizationId,
        recruitersCount,
        jobsCount,
        globalDevelopersCount: developers.length,
        pendingInvitationsCount,
        activeTeamsCount,
        recentActivityCount: recentActivity.length,
        recentActivity: recentActivity.map((entry) => ({
          _id: entry._id,
          action: entry.action,
          method: entry.method,
          route: entry.route,
          statusCode: entry.statusCode,
          timestamp: entry.timestamp,
          actorName: entry.actor?.name || entry.actor?.email || 'System'
        }))
      }
    });
  } catch (error) {
    console.error('Admin organization overview error:', error.message);
    return res.status(500).json({ message: 'Failed to load admin overview.' });
  }
};

const getDevelopers = async (_req, res) => {
  try {
    const developers = await resolveVisibleDeveloperUsers();
    return res.status(200).json({ developers });
  } catch (error) {
    console.error('Admin developers error:', error.message);
    return res.status(500).json({ message: 'Failed to load public developers.' });
  }
};

module.exports = {
  getOrganizationOverview,
  getDevelopers
};
