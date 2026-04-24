const mongoose = require('mongoose');
const User = require('../../models/user');
const Analysis = require('../../models/analysis');
const ResumeAnalysis = require('../../models/resumeAnalysis');
const PublicProfile = require('../../models/publicProfile');
const CareerSprint = require('../../models/careerSprint');
const WeeklyReport = require('../../models/weeklyReport');
const Candidate = require('../../models/Candidate');
const Job = require('../../models/Job');
const { rankCandidates } = require('./aiRankingService');

const DEVELOPER_ROLE_VALUES = Object.freeze(['developer', 'user']);

const EXPERIENCE_LEVEL_TO_YEARS = {
  Student: 0,
  Intern: 0.5,
  '0-1 years': 1,
  '1-2 years': 2,
  '2-3 years': 3,
  '3-5 years': 5,
  '5+ years': 7
};

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));

const flattenResumeSkills = (skillsMap = {}) => {
  if (!skillsMap) return [];
  const values = skillsMap instanceof Map ? Array.from(skillsMap.values()) : Object.values(skillsMap);
  return [...new Set(values.flat().map((item) => String(item || '').trim()).filter(Boolean))];
};

const normalizeSkills = (skills = []) => {
  return [...new Set((Array.isArray(skills) ? skills : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean))];
};

const sanitizePublicCandidate = (candidate = {}) => ({
  id: candidate.id,
  userId: candidate.userId,
  fullName: candidate.fullName || candidate.name || '',
  stack: candidate.stack || '',
  yearsOfExperience: Number(candidate.yearsOfExperience || 0),
  headline: candidate.headline || candidate.jobTitle || '',
  location: candidate.location || '',
  githubUsername: candidate.githubUsername || '',
  publicProfileSlug: candidate.publicProfileSlug || null,
  githubScore: Number(candidate.githubScore || 0),
  resumeScore: Number(candidate.resumeScore || 0),
  consistencyScore: Number(candidate.consistencyScore || 0),
  growthPotentialScore: Number(candidate.growthPotentialScore || 0),
  score: Number(candidate.score || 0),
  skills: Array.isArray(candidate.skills) ? candidate.skills : [],
  skillScores: Array.isArray(candidate.skillScores) ? candidate.skillScores : [],
  projects: Array.isArray(candidate.projects)
    ? candidate.projects.map((project) => ({
      title: project?.title || '',
      description: project?.description || '',
      technologies: Array.isArray(project?.technologies) ? project.technologies : [],
      status: project?.status || '',
      impactScore: Number(project?.impactScore || 0)
    }))
    : [],
  githubStats: {
    repos: Number(candidate.githubStats?.repos || 0),
    stars: Number(candidate.githubStats?.stars || 0),
    forks: Number(candidate.githubStats?.forks || 0),
    followers: Number(candidate.githubStats?.followers || 0)
  },
  aiInsight: {
    summary: String(candidate.aiInsight?.summary || ''),
    strengths: Array.isArray(candidate.aiInsight?.strengths) ? candidate.aiInsight.strengths : [],
    weaknesses: Array.isArray(candidate.aiInsight?.weaknesses) ? candidate.aiInsight.weaknesses : [],
    recommendation: String(candidate.aiInsight?.recommendation || '')
  }
});

const computeResumeScore = (resumeAnalysis) => {
  if (!resumeAnalysis) return 0;
  const scores = [
    Number(resumeAnalysis.atsScore || 0),
    Number(resumeAnalysis.keywordDensity || 0),
    Number(resumeAnalysis.formatScore || 0),
    Number(resumeAnalysis.contentQuality || 0)
  ].filter((score) => Number.isFinite(score));

  if (!scores.length) return 0;
  return Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length);
};

const computeConsistencyScore = ({ sprint, weeklyReport }) => {
  const completionRate = Number(sprint?.tasks?.length)
    ? (sprint.tasks.filter((task) => task.isCompleted).length / sprint.tasks.length) * 100
    : Number(weeklyReport?.meta?.sprint?.completionRate || 0);
  const streak = Number(sprint?.currentStreak || sprint?.streak || weeklyReport?.meta?.sprint?.streak || 0);
  const streakScore = Math.min(streak * 8, 100);
  return clamp(completionRate * 0.65 + streakScore * 0.35);
};

const computeGrowthSignals = ({ weeklyReport, sprint, projectCount = 0 }) => {
  const readinessDelta = Number(weeklyReport?.meta?.comparisons?.readinessDelta || 0);
  const coverageDelta = Number(weeklyReport?.meta?.comparisons?.coverageDelta || 0);
  const sprintCompletionRate = Number(weeklyReport?.meta?.sprint?.completionRate || 0) ||
    (Number(sprint?.tasks?.length)
      ? (sprint.tasks.filter((task) => task.isCompleted).length / sprint.tasks.length) * 100
      : 0);
  const githubConsistencySignal = Number(weeklyReport?.meta?.activity?.weeklyCommitSignal || 0);
  const projectVelocity = Math.min(projectCount * 12, 100);

  return {
    readinessDelta,
    weeklyCoverageDelta: coverageDelta,
    sprintCompletionRate,
    githubConsistencySignal,
    projectVelocity
  };
};

const baseCandidateScore = (candidate) => {
  const score =
    Number(candidate.githubScore || 0) * 0.3 +
    Number(candidate.resumeScore || 0) * 0.3 +
    Number(candidate.consistencyScore || 0) * 0.2 +
    Number(candidate.growthPotentialScore || 0) * 0.2;
  return Number(clamp(score).toFixed(2));
};

const toObjectId = (id) => {
  if (!id) return null;
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
};

const listPublicDeveloperUserIds = async () => {
  const [publicUsers, publicProfiles] = await Promise.all([
    User.find({ role: { $in: DEVELOPER_ROLE_VALUES }, isPublic: true }).select('_id').lean(),
    PublicProfile.find({ isPublic: true }).select('userId').lean()
  ]);

  const ids = new Set();
  publicUsers.forEach((entry) => ids.add(String(entry._id)));
  publicProfiles.forEach((entry) => {
    if (entry?.userId) ids.add(String(entry.userId));
  });

  return Array.from(ids).filter((id) => mongoose.Types.ObjectId.isValid(id));
};

const hydrateUserCandidates = async (users = []) => {
  if (!users.length) return [];

  const userIds = users.map((user) => user._id);

  const [analyses, resumeAnalyses, publicProfiles, sprints, weeklyReports] = await Promise.all([
    Analysis.find({ userId: { $in: userIds } }).lean(),
    ResumeAnalysis.find({ userId: { $in: userIds } }).sort({ analyzedAt: -1 }).lean(),
    PublicProfile.find({ userId: { $in: userIds } }).lean(),
    CareerSprint.find({ userId: { $in: userIds } }).sort({ updatedAt: -1 }).lean(),
    WeeklyReport.find({ userId: { $in: userIds } }).sort({ weekEndDate: -1 }).lean()
  ]);

  const analysisByUser = new Map(analyses.map((entry) => [String(entry.userId), entry]));
  const resumeByUser = new Map();
  resumeAnalyses.forEach((entry) => {
    const key = String(entry.userId);
    if (!resumeByUser.has(key)) resumeByUser.set(key, entry);
  });
  const profileByUser = new Map(publicProfiles.map((entry) => [String(entry.userId), entry]));
  const sprintByUser = new Map();
  sprints.forEach((entry) => {
    const key = String(entry.userId);
    if (!sprintByUser.has(key)) sprintByUser.set(key, entry);
  });
  const weeklyByUser = new Map();
  weeklyReports.forEach((entry) => {
    const key = String(entry.userId);
    if (!weeklyByUser.has(key)) weeklyByUser.set(key, entry);
  });

  return users.map((user) => {
    const userId = String(user._id);
    const analysis = analysisByUser.get(userId);
    const resume = resumeByUser.get(userId);
    const profile = profileByUser.get(userId);
    const sprint = sprintByUser.get(userId);
    const weeklyReport = weeklyByUser.get(userId);

    const resumeSkills = flattenResumeSkills(resume?.skills);
    const profileSkills = (profile?.skills || []).map((skill) => skill?.name).filter(Boolean);
    const skills = normalizeSkills([...resumeSkills, ...profileSkills]);
    const projects = (profile?.projects || []).map((project) => ({
      title: project.title,
      description: project.description || '',
      technologies: normalizeSkills(project.tech || []),
      impactScore: 65,
      status: project.status === 'completed' ? 'completed' : 'in-progress'
    }));

    const githubScore = Number(analysis?.githubScore || 0);
    const resumeScore = computeResumeScore(resume);
    const consistencyScore = computeConsistencyScore({ sprint, weeklyReport });
    const growthSignals = computeGrowthSignals({ weeklyReport, sprint, projectCount: projects.length });
    const growthPotentialScore = clamp(
      growthSignals.weeklyCoverageDelta +
      growthSignals.readinessDelta +
      growthSignals.sprintCompletionRate * 0.4 +
      growthSignals.githubConsistencySignal * 0.4 +
      growthSignals.projectVelocity * 0.2
    );

    const candidate = {
      id: String(user._id),
      userId: String(user._id),
      sourceType: 'user',
      name: user.name,
      fullName: user.name,
      email: user.email,
      stack: user.activeCareerStack || user.careerStack || 'Full Stack',
      yearsOfExperience: Number(resume?.experienceYears || EXPERIENCE_LEVEL_TO_YEARS[user.activeExperienceLevel || user.experienceLevel] || 0),
      jobTitle: user.jobTitle || '',
      headline: user.jobTitle || '',
      location: user.location || '',
      avatar: user.avatar || '',
      githubUsername: user.githubUsername || '',
      githubScore,
      resumeScore,
      consistencyScore,
      growthPotentialScore,
      skills,
      skillScores: (profile?.skills || []).map((skill) => ({
        name: skill?.name || '',
        score: Number(skill?.score || 0)
      })).filter((skill) => Boolean(skill.name)),
      projects,
      skillGaps: analysis?.missingSkills || [],
      publicProfileSlug: profile?.isPublic ? String(profile.slug || '') : null,
      githubStats: {
        repos: Number(analysis?.githubStats?.repos || 0),
        stars: Number(analysis?.githubStats?.stars || 0),
        forks: Number(analysis?.githubStats?.forks || 0),
        followers: Number(analysis?.githubStats?.followers || 0)
      },
      aiInsight: {
        summary: '',
        strengths: [],
        weaknesses: [],
        recommendation: ''
      },
      enrichment: growthSignals
    };

    candidate.score = baseCandidateScore(candidate);
    return candidate;
  });
};

const normalizeCandidateDoc = (candidateDoc = {}) => {
  const candidate = {
    id: String(candidateDoc._id),
    userId: candidateDoc.userId ? String(candidateDoc.userId) : '',
    sourceType: 'candidate',
    name: candidateDoc.fullName,
    fullName: candidateDoc.fullName,
    email: candidateDoc.email,
    stack: candidateDoc.stack || 'Full Stack',
    yearsOfExperience: Number(candidateDoc.yearsOfExperience || 0),
    jobTitle: candidateDoc.headline || '',
    headline: candidateDoc.headline || '',
    location: candidateDoc.location || '',
    avatar: '',
    githubUsername: candidateDoc.githubUsername || '',
    githubScore: Number(candidateDoc.githubScore || 0),
    resumeScore: Number(candidateDoc.resumeScore || 0),
    consistencyScore: Number(candidateDoc.consistencyScore || 0),
    growthPotentialScore: Number(candidateDoc.growthPotentialScore || 0),
    skills: normalizeSkills(candidateDoc.skills || []),
    skillScores: [],
    projects: Array.isArray(candidateDoc.projects) ? candidateDoc.projects : [],
    skillGaps: Array.isArray(candidateDoc.skillGaps) ? candidateDoc.skillGaps : [],
    publicProfileSlug: null,
    githubStats: {
      repos: Number(candidateDoc.githubStats?.repos || 0),
      stars: Number(candidateDoc.githubStats?.stars || 0),
      forks: Number(candidateDoc.githubStats?.forks || 0),
      followers: Number(candidateDoc.githubStats?.followers || 0)
    },
    aiInsight: candidateDoc.aiInsight || {
      summary: '',
      strengths: [],
      weaknesses: [],
      recommendation: ''
    },
    enrichment: {}
  };

  candidate.score = baseCandidateScore(candidate);
  return candidate;
};

const mergeCandidates = (candidateDocs = [], hydratedUsers = []) => {
  const mergedMap = new Map();

  hydratedUsers.forEach((candidate) => {
    const key = candidate.userId || candidate.email.toLowerCase();
    mergedMap.set(key, candidate);
  });

  candidateDocs.forEach((doc) => {
    const normalized = normalizeCandidateDoc(doc);
    const key = normalized.userId || normalized.email.toLowerCase();
    const existing = mergedMap.get(key);

    if (existing) {
      mergedMap.set(key, {
        ...existing,
        ...normalized,
        name: normalized.name || existing.name,
        jobTitle: normalized.jobTitle || existing.jobTitle,
        avatar: normalized.avatar || existing.avatar || '',
        publicProfileSlug: normalized.publicProfileSlug || existing.publicProfileSlug || null,
        skillScores: normalized.skillScores?.length ? normalized.skillScores : (existing.skillScores || []),
        skills: normalizeSkills([...(existing.skills || []), ...(normalized.skills || [])]),
        projects: normalized.projects?.length ? normalized.projects : existing.projects,
        skillGaps: normalized.skillGaps?.length ? normalized.skillGaps : existing.skillGaps
      });
    } else {
      mergedMap.set(key, normalized);
    }
  });

  return Array.from(mergedMap.values());
};

const applyCandidateFilters = (candidates = [], filters = {}) => {
  const normalizedSearch = String(filters.search || '').trim().toLowerCase();
  const normalizedStack = String(filters.stack || '').trim().toLowerCase();
  const minExperience = Number(filters.experience || 0);
  const minScore = Number(filters.minScore || 0);

  return candidates.filter((candidate) => {
    if (normalizedSearch) {
      const haystack = `${candidate.fullName} ${candidate.email} ${candidate.githubUsername} ${candidate.headline}`.toLowerCase();
      if (!haystack.includes(normalizedSearch)) return false;
    }

    if (normalizedStack && normalizedStack !== 'all') {
      if (!String(candidate.stack || '').toLowerCase().includes(normalizedStack)) return false;
    }

    if (minExperience > 0 && Number(candidate.yearsOfExperience || 0) < minExperience) {
      return false;
    }

    if (minScore > 0 && Number(candidate.score || 0) < minScore) {
      return false;
    }

    return true;
  });
};

const listCandidates = async ({ search = '', stack = '', experience = 0, minScore = 0, limit = 50 } = {}) => {
  const visibleDeveloperIds = await listPublicDeveloperUserIds();
  if (!visibleDeveloperIds.length) return [];

  const userObjectIds = visibleDeveloperIds.map((id) => new mongoose.Types.ObjectId(id));
  const userQuery = {
    _id: { $in: userObjectIds },
    role: { $in: DEVELOPER_ROLE_VALUES }
  };

  if (search) {
    const regex = new RegExp(search, 'i');
    userQuery.$or = [
      { name: regex },
      { email: regex },
      { githubUsername: regex },
      { jobTitle: regex }
    ];
  }

  const users = await User.find(userQuery)
    .select('name email githubUsername jobTitle location avatar careerStack activeCareerStack experienceLevel activeExperienceLevel isPublic')
    .limit(Math.max(limit, 100))
    .lean();

  if (!users.length) return [];

  const hydratedUsers = await hydrateUserCandidates(users);
  const hydratedUserIds = hydratedUsers
    .map((candidate) => candidate.userId)
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const candidateDocs = hydratedUserIds.length
    ? await Candidate.find({ isActive: true, userId: { $in: hydratedUserIds } }).lean()
    : [];

  const merged = mergeCandidates(candidateDocs, hydratedUsers);
  const filtered = applyCandidateFilters(merged, { search, stack, experience, minScore });

  const sorted = [...filtered].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  return sorted.slice(0, limit).map((candidate) => sanitizePublicCandidate(candidate));
};

const getCandidateById = async (id) => {
  const objectId = toObjectId(id);
  if (!objectId) return null;

  const candidateDoc = await Candidate.findById(objectId).lean();
  if (candidateDoc?.userId) {
    const userId = String(candidateDoc.userId);
    const [user, publicProfile] = await Promise.all([
      User.findOne({ _id: userId, role: { $in: DEVELOPER_ROLE_VALUES } })
        .select('name email githubUsername jobTitle location avatar careerStack activeCareerStack experienceLevel activeExperienceLevel isPublic')
        .lean(),
      PublicProfile.findOne({ userId, isPublic: true }).select('_id').lean()
    ]);

    if (!user || (!user.isPublic && !publicProfile)) {
      return null;
    }

    const [hydratedCandidate] = await hydrateUserCandidates([user]);
    const merged = mergeCandidates([candidateDoc], hydratedCandidate ? [hydratedCandidate] : []);
    return sanitizePublicCandidate(merged[0] || hydratedCandidate || null);
  }

  const [user, publicProfile] = await Promise.all([
    User.findOne({ _id: objectId, role: { $in: DEVELOPER_ROLE_VALUES } })
      .select('name email githubUsername jobTitle location avatar careerStack activeCareerStack experienceLevel activeExperienceLevel isPublic')
      .lean(),
    PublicProfile.findOne({ userId: objectId, isPublic: true }).select('_id').lean()
  ]);

  if (!user || (!user.isPublic && !publicProfile)) {
    return null;
  }

  const [candidate] = await hydrateUserCandidates([user]);
  return sanitizePublicCandidate(candidate || null);
};

const assertOrganizationScope = (organizationId) => {
  const safeOrganizationId = String(organizationId || '').trim();
  if (!safeOrganizationId) {
    const error = new Error('organizationId is required.');
    error.code = 400;
    throw error;
  }

  return safeOrganizationId;
};

const createJob = async ({ recruiterId, organizationId, payload }) => {
  const safeOrganizationId = assertOrganizationScope(organizationId);

  const job = await Job.create({
    organizationId: safeOrganizationId,
    recruiterId,
    title: String(payload.title || '').trim(),
    role: String(payload.role || payload.title || '').trim(),
    description: String(payload.description || '').trim(),
    stack: String(payload.stack || 'Full Stack').trim(),
    requiredSkills: normalizeSkills(payload.requiredSkills || []),
    preferredSkills: normalizeSkills(payload.preferredSkills || []),
    minExperienceYears: Number(payload.minExperienceYears || 0),
    location: String(payload.location || '').trim(),
    employmentType: payload.employmentType || 'full-time',
    status: payload.status || 'open'
  });

  return job;
};

const updateJob = async ({ organizationId, jobId, payload }) => {
  const safeOrganizationId = assertOrganizationScope(organizationId);

  const job = await Job.findOne({ _id: jobId, organizationId: safeOrganizationId });
  if (!job) return null;

  const patch = {
    title: payload.title,
    role: payload.role,
    description: payload.description,
    stack: payload.stack,
    requiredSkills: Array.isArray(payload.requiredSkills) ? normalizeSkills(payload.requiredSkills) : undefined,
    preferredSkills: Array.isArray(payload.preferredSkills) ? normalizeSkills(payload.preferredSkills) : undefined,
    minExperienceYears: payload.minExperienceYears,
    location: payload.location,
    employmentType: payload.employmentType,
    status: payload.status
  };

  Object.entries(patch).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      job[key] = value;
    }
  });

  await job.save();
  return job;
};

const deleteJob = async ({ organizationId, jobId }) => {
  const safeOrganizationId = assertOrganizationScope(organizationId);
  const deleted = await Job.findOneAndDelete({ _id: jobId, organizationId: safeOrganizationId });
  return !!deleted;
};

const listJobs = async ({ organizationId, recruiterId = '' }) => {
  const safeOrganizationId = assertOrganizationScope(organizationId);
  const query = { organizationId: safeOrganizationId };
  if (recruiterId) query.recruiterId = recruiterId;
  return Job.find(query).sort({ updatedAt: -1 }).lean();
};

const listOrganizationJobs = async ({ organizationId, limit = 100 }) => {
  const safeOrganizationId = assertOrganizationScope(organizationId);
  return Job.find({ organizationId: safeOrganizationId })
    .sort({ updatedAt: -1 })
    .limit(Math.max(1, Math.min(500, Number(limit) || 100)))
    .lean();
};

const matchCandidatesToJob = async ({ organizationId, jobId, candidateIds = [] }) => {
  const safeOrganizationId = assertOrganizationScope(organizationId);
  const job = await Job.findOne({ _id: jobId, organizationId: safeOrganizationId }).lean();
  if (!job) {
    const error = new Error('Job not found.');
    error.code = 404;
    throw error;
  }

  const visibleCandidates = await listCandidates({
    stack: job.stack,
    minScore: 0,
    limit: 500
  });

  let candidates = visibleCandidates;
  if (Array.isArray(candidateIds) && candidateIds.length > 0) {
    const selected = new Set(candidateIds.map((candidateId) => String(candidateId).trim()).filter(Boolean));
    candidates = visibleCandidates.filter((candidate) => {
      const candidateId = String(candidate.id || '').trim();
      const userId = String(candidate.userId || '').trim();
      return selected.has(candidateId) || selected.has(userId);
    });
  }

  const ranked = rankCandidates({ job, candidates });
  return {
    job,
    ...ranked
  };
};

module.exports = {
  listCandidates,
  getCandidateById,
  createJob,
  updateJob,
  deleteJob,
  listJobs,
  listOrganizationJobs,
  matchCandidatesToJob
};
