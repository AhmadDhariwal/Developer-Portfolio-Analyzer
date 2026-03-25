const crypto = require('node:crypto');
const PublicProfile = require('../models/publicProfile');
const PublicProfileView = require('../models/publicProfileView');
const User = require('../models/user');
const Analysis = require('../models/analysis');
const ResumeAnalysis = require('../models/resumeAnalysis');
const SkillGraph = require('../models/skillGraph');

const slugify = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '')
  .slice(0, 48);

const ensureUniqueSlug = async (base) => {
  const normalized = slugify(base) || `dev-${Date.now()}`;
  let slug = normalized;
  let suffix = 1;

  while (await PublicProfile.exists({ slug })) {
    suffix += 1;
    slug = `${normalized}-${suffix}`.slice(0, 60);
  }

  return slug;
};

const toSkillScore = (name, score) => ({
  name: String(name || '').trim(),
  score: Math.round(Number(score || 0))
});

const getSkillScores = async (userId) => {
  const graph = await SkillGraph.findOne({ userId }).sort({ updatedAt: -1 }).lean();
  if (graph?.nodes?.length) {
    const nodes = graph.nodes
      .filter((node) => node.kind === 'current')
      .sort((a, b) => (b.proficiency || 0) - (a.proficiency || 0))
      .slice(0, 10)
      .map((node) => toSkillScore(node.name, node.proficiency));

    if (nodes.length) return nodes;
  }

  const analysis = await Analysis.findOne({ userId }).lean();
  const resumeAnalysis = await ResumeAnalysis.findOne({ userId }).sort({ analyzedAt: -1 }).lean();
  const resumeSkills = resumeAnalysis?.skills
    ? (resumeAnalysis.skills instanceof Map
      ? Array.from(resumeAnalysis.skills.values()).flat()
      : Object.values(resumeAnalysis.skills).flat())
    : [];

  const languageSkills = analysis?.languageDistribution
    ? Object.entries(analysis.languageDistribution instanceof Map
      ? Object.fromEntries(analysis.languageDistribution)
      : analysis.languageDistribution)
    : [];

  const skillScores = [];
  resumeSkills.slice(0, 6).forEach((skill) => {
    skillScores.push(toSkillScore(skill, 70));
  });

  languageSkills.slice(0, 6).forEach(([name, score]) => {
    skillScores.push(toSkillScore(name, Number(score) || 60));
  });

  return skillScores.slice(0, 10);
};

const getOrCreatePublicProfile = async (userId) => {
  let profile = await PublicProfile.findOne({ userId });
  if (profile) return profile;

  const user = await User.findById(userId).lean();
  const slugSource = user?.name || user?.githubUsername || `dev-${userId}`;
  const slug = await ensureUniqueSlug(slugSource);

  profile = await PublicProfile.create({
    userId,
    slug,
    isPublic: false,
    headline: user?.jobTitle || '',
    summary: user?.bio || '',
    socialLinks: {
      website: user?.website || '',
      twitter: user?.twitter || '',
      linkedin: user?.linkedin || '',
      github: user?.githubUsername || ''
    }
  });

  return profile;
};

const updatePublicProfile = async (userId, payload = {}) => {
  const profile = await getOrCreatePublicProfile(userId);
  const updatable = ['isPublic', 'headline', 'summary', 'seoTitle', 'seoDescription'];

  updatable.forEach((field) => {
    if (payload[field] !== undefined) {
      profile[field] = payload[field];
    }
  });

  if (payload.slug && payload.slug !== profile.slug) {
    profile.slug = await ensureUniqueSlug(payload.slug);
  }

  if (payload.skills) {
    profile.skills = Array.isArray(payload.skills)
      ? payload.skills.map((skill) => toSkillScore(skill.name || skill, skill.score || 0))
      : profile.skills;
  }

  if (payload.projects) {
    profile.projects = Array.isArray(payload.projects) ? payload.projects : profile.projects;
  }

  if (payload.socialLinks) {
    profile.socialLinks = {
      ...profile.socialLinks,
      ...payload.socialLinks
    };
  }

  await profile.save();
  return profile;
};

const recordProfileView = async ({ profile, req }) => {
  if (!profile) return;

  const ipAddress = String(req?.headers['x-forwarded-for'] || req?.ip || '').split(',')[0].trim();
  const userAgent = String(req?.headers['user-agent'] || '');
  const viewerHash = crypto.createHash('sha256')
    .update(`${profile._id}:${ipAddress}:${userAgent}`)
    .digest('hex');

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existing = await PublicProfileView.findOne({
    profileId: profile._id,
    viewerHash,
    viewedAt: { $gte: since }
  }).lean();

  await PublicProfileView.create({
    profileId: profile._id,
    viewerHash,
    ipAddress,
    userAgent,
    viewedAt: new Date()
  });

  profile.totalViews = Number(profile.totalViews || 0) + 1;
  if (!existing) {
    profile.uniqueViews = Number(profile.uniqueViews || 0) + 1;
  }
  profile.lastViewedAt = new Date();
  await profile.save();
};

const buildPublicProfilePayload = async (profile, user) => {
  const skillScores = await getSkillScores(profile.userId);

  return {
    id: profile._id,
    slug: profile.slug,
    isPublic: profile.isPublic,
    headline: profile.headline,
    summary: profile.summary,
    seoTitle: profile.seoTitle,
    seoDescription: profile.seoDescription,
    skills: profile.skills?.length ? profile.skills : skillScores,
    projects: profile.projects || [],
    socialLinks: profile.socialLinks || {},
    analytics: {
      totalViews: profile.totalViews || 0,
      uniqueViews: profile.uniqueViews || 0,
      lastViewedAt: profile.lastViewedAt || null
    },
    user: {
      name: user?.name || '',
      jobTitle: user?.jobTitle || '',
      location: user?.location || '',
      avatar: user?.avatar || '',
      githubUsername: user?.githubUsername || ''
    }
  };
};

const getPublicProfileBySlug = async (slug, req) => {
  const profile = await PublicProfile.findOne({ slug, isPublic: true });
  if (!profile) return null;

  const user = await User.findById(profile.userId).select('name jobTitle location avatar githubUsername').lean();
  await recordProfileView({ profile, req });

  return buildPublicProfilePayload(profile, user);
};

const getPublicProfileForOwner = async (userId) => {
  const profile = await getOrCreatePublicProfile(userId);
  const user = await User.findById(userId).select('name jobTitle location avatar githubUsername').lean();
  return buildPublicProfilePayload(profile, user);
};

const getPublicProfileAnalytics = async (userId) => {
  const profile = await getOrCreatePublicProfile(userId);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const views = await PublicProfileView.aggregate([
    { $match: { profileId: profile._id, viewedAt: { $gte: since } } },
    {
      $group: {
        _id: {
          year: { $year: '$viewedAt' },
          month: { $month: '$viewedAt' },
          day: { $dayOfMonth: '$viewedAt' }
        },
        count: { $sum: 1 }
      }
    },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
  ]);

  return {
    totalViews: profile.totalViews || 0,
    uniqueViews: profile.uniqueViews || 0,
    lastViewedAt: profile.lastViewedAt || null,
    last7Days: views.map((entry) => ({
      date: `${entry._id.year}-${String(entry._id.month).padStart(2, '0')}-${String(entry._id.day).padStart(2, '0')}`,
      count: entry.count
    }))
  };
};

module.exports = {
  getOrCreatePublicProfile,
  updatePublicProfile,
  getPublicProfileBySlug,
  getPublicProfileForOwner,
  getPublicProfileAnalytics
};
