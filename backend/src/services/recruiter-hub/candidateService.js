const User = require('../../models/user');
const AuditLog = require('../../models/auditLog');
const { listCandidates, getCandidateById } = require('../recruiter/matchingService');
const { formatCandidateCard, formatCandidateComparison, calculateProfileCompleteness } = require('../../utils/recruiter-hub/candidateFormatter');

const normalizeArrayFilter = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const enrichCandidates = async (candidates = []) => {
  const ids = candidates.map((candidate) => String(candidate.userId || candidate.id || '')).filter(Boolean);
  const users = ids.length
    ? await User.find({ _id: { $in: ids } }).select('_id activeCareerStack activeExperienceLevel location isActive createdAt updatedAt').lean()
    : [];
  const userMap = new Map(users.map((user) => [String(user._id), user]));

  return candidates.map((candidate) => {
    const user = userMap.get(String(candidate.userId || candidate.id || ''));
    return formatCandidateCard({
      ...candidate,
      location: candidate.location || user?.location || '',
      lastActive: user?.updatedAt || user?.createdAt || null,
      experienceLevel: user?.activeExperienceLevel || '',
      isActive: user?.isActive !== false
    });
  });
};

const filterCandidateCards = (candidates = [], filters = {}) => {
  const normalizedSkills = normalizeArrayFilter(filters.skills).map((skill) => skill.toLowerCase());
  const normalizedLocation = String(filters.location || '').trim().toLowerCase();
  const normalizedAvailability = String(filters.availability || '').trim().toLowerCase();
  const minProfileCompletion = Number(filters.profileCompleteness || 0);

  return candidates.filter((candidate) => {
    if (normalizedSkills.length > 0) {
      const skillSet = (candidate.skills || []).map((skill) => String(skill || '').toLowerCase());
      if (!normalizedSkills.every((skill) => skillSet.includes(skill))) return false;
    }

    if (normalizedLocation && !String(candidate.location || '').toLowerCase().includes(normalizedLocation)) {
      return false;
    }

    if (normalizedAvailability && String(candidate.availability || '').toLowerCase() !== normalizedAvailability) {
      return false;
    }

    if (minProfileCompletion > 0 && Number(candidate.profileCompleteness || 0) < minProfileCompletion) {
      return false;
    }

    return true;
  });
};

const listRecruiterCandidates = async ({ organizationId, query = {} }) => {
  const base = await listCandidates({
    search: String(query.search || '').trim(),
    stack: String(query.stack || '').trim(),
    experience: Number(query.experience || 0),
    minScore: Number(query.minReadiness || query.minScore || 0),
    organizationId,
    limit: Math.min(250, Math.max(1, Number(query.limit || 100)))
  });

  const enriched = await enrichCandidates(base);
  const filtered = filterCandidateCards(enriched, query);
  const stacks = [...new Set(filtered.map((candidate) => String(candidate.stack || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const locations = [...new Set(filtered.map((candidate) => String(candidate.location || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  return {
    candidates: filtered,
    filters: {
      stacks,
      locations,
      availability: ['Open to entry roles', 'High intent', 'Available', 'Review needed']
    }
  };
};

const getRecruiterCandidateDetails = async (candidateId) => {
  const candidate = await getCandidateById(candidateId);
  if (!candidate) return null;

  const formatted = formatCandidateCard(candidate);
  return {
    ...formatted,
    profileSummary: formatted.aiSummary || formatted.headline || `${formatted.name} is active in ${formatted.stack}.`,
    projects: Array.isArray(formatted.projects) ? formatted.projects : [],
    skillGaps: Array.isArray(candidate.skillGaps) ? candidate.skillGaps : [],
    portfolio: formatted.publicPortfolioLink,
    recruiterNotes: '',
    shortlistStatus: null,
    profileCompleteness: calculateProfileCompleteness(formatted)
  };
};

const analyzeRecruiterCandidate = async ({ recruiterId, organizationId, teamId, candidateId, route }) => {
  const candidate = await getRecruiterCandidateDetails(candidateId);
  if (!candidate) return null;

  const analysis = {
    summary: candidate.aiSummary || `${candidate.name} shows strongest traction in ${candidate.stack}.`,
    strengths: [
      `Readiness score ${candidate.readinessScore}`,
      `GitHub score ${candidate.githubScore}`,
      `${(candidate.skills || []).slice(0, 3).join(', ')}`
    ].filter((value) => String(value || '').trim().length > 0),
    weaknesses: (candidate.skillGaps || []).slice(0, 3),
    recommendation: candidate.readinessScore >= 75 ? 'Strong fit for outreach.' : 'Promising candidate for pipeline nurture.',
    confidenceScore: Math.round((Number(candidate.readinessScore || 0) + Number(candidate.githubScore || 0) + Number(candidate.resumeScore || 0)) / 3)
  };

  await AuditLog.create({
    actor: recruiterId,
    organizationId,
    teamId: teamId || null,
    action: 'RECRUITER_CANDIDATE_ANALYZED',
    method: 'POST',
    route,
    before: null,
    after: {
      candidateId: String(candidate.id || candidate.userId || ''),
      summary: analysis.summary
    },
    statusCode: 200,
    timestamp: new Date()
  });

  return analysis;
};

const logCandidateView = async ({ recruiterId, organizationId, teamId, candidateId, route }) => {
  await AuditLog.create({
    actor: recruiterId,
    organizationId,
    teamId: teamId || null,
    action: 'RECRUITER_CANDIDATE_VIEWED',
    method: 'GET',
    route,
    before: null,
    after: {
      candidateId: String(candidateId || '')
    },
    statusCode: 200,
    timestamp: new Date()
  });
};

module.exports = {
  listRecruiterCandidates,
  getRecruiterCandidateDetails,
  analyzeRecruiterCandidate,
  logCandidateView,
  formatCandidateComparison
};
