const User = require('../../../auth/models/user');
const AuditLog = require('../../../admin/models/auditLog');
const { requireObjectId } = require('../../utils/recruiterValidation');
const { listCandidates, getCandidatesByIds } = require('../matching/matchingService');
const {
  formatCandidateCard,
  formatCandidateComparison,
  calculateProfileCompleteness,
  measuredScore,
  averageAvailableScores
} = require('../../utils/hub/candidateFormatter');

const normalizeArrayFilter = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const sortCandidates = (candidates = [], sortBy = 'score-desc') => {
  const list = [...candidates];
  switch (String(sortBy || 'score-desc')) {
    case 'name-asc':
      return list.sort((left, right) =>
        String(left.name || '').localeCompare(String(right.name || ''))
      );
    case 'experience-desc':
      return list.sort(
        (left, right) => toNumber(right.yearsOfExperience) - toNumber(left.yearsOfExperience)
      );
    case 'experience-asc':
      return list.sort(
        (left, right) => toNumber(left.yearsOfExperience) - toNumber(right.yearsOfExperience)
      );
    case 'latest':
      return list.sort(
        (left, right) =>
          new Date(right.lastActive || 0).getTime() - new Date(left.lastActive || 0).getTime()
      );
    case 'score-asc':
      return list.sort(
        (left, right) => toNumber(left.readinessScore) - toNumber(right.readinessScore)
      );
    case 'score-desc':
    default:
      return list.sort(
        (left, right) => toNumber(right.readinessScore) - toNumber(left.readinessScore)
      );
  }
};

const enrichCandidates = async (candidates = []) => {
  const missingIds = candidates
    .filter(
      (candidate) => candidate.lastActive === undefined || candidate.experienceLevel === undefined
    )
    .map((candidate) => String(candidate.userId || candidate.id || ''))
    .filter(Boolean);
  const users = missingIds.length
    ? await User.find({ _id: { $in: missingIds } })
        .select('_id activeCareerStack activeExperienceLevel location isActive createdAt updatedAt')
        .lean()
    : [];
  const userMap = new Map(users.map((user) => [String(user._id), user]));

  return candidates.map((candidate) => {
    const user = userMap.get(String(candidate.userId || candidate.id || ''));
    return formatCandidateCard({
      ...candidate,
      id: candidate.userId || candidate.id,
      location: candidate.location || user?.location || '',
      lastActive: candidate.lastActive ?? user?.updatedAt ?? user?.createdAt ?? null,
      experienceLevel: candidate.experienceLevel || user?.activeExperienceLevel || '',
      isActive: candidate.isActive !== undefined ? candidate.isActive : user?.isActive !== false
    });
  });
};

const filterCandidateCards = (candidates = [], filters = {}) => {
  const normalizedSkills = normalizeArrayFilter(filters.skills).map((skill) => skill.toLowerCase());
  const normalizedLocation = String(filters.location || '')
    .trim()
    .toLowerCase();
  const normalizedAvailability = String(filters.availability || '')
    .trim()
    .toLowerCase();
  const minProfileCompletion = Number(filters.profileCompleteness || 0);

  return candidates.filter((candidate) => {
    if (normalizedSkills.length > 0) {
      const skillSet = (candidate.skills || []).map((skill) => String(skill || '').toLowerCase());
      if (!normalizedSkills.every((skill) => skillSet.includes(skill))) return false;
    }

    if (
      normalizedLocation &&
      !String(candidate.location || '')
        .toLowerCase()
        .includes(normalizedLocation)
    ) {
      return false;
    }

    if (
      normalizedAvailability &&
      String(candidate.availability || '').toLowerCase() !== normalizedAvailability
    ) {
      return false;
    }

    if (
      minProfileCompletion > 0 &&
      Number(candidate.profileCompleteness || 0) < minProfileCompletion
    ) {
      return false;
    }

    return true;
  });
};

const listRecruiterCandidates = async ({ organizationId, query = {} }) => {
  const page = Math.max(1, Math.floor(toNumber(query.page, 1)));
  const limit = Math.min(240, Math.max(1, Math.floor(toNumber(query.limit, 12))));
  const sortBy = String(query.sortBy || 'score-desc').trim() || 'score-desc';
  const poolCap = Math.min(
    2000,
    Math.max(320, Number.parseInt(process.env.RECRUITER_CANDIDATE_POOL_CAP, 10) || 1000)
  );
  const base = await listCandidates({
    search: String(query.search || '').trim(),
    stack: String(query.stack || '').trim(),
    experience: toNumber(query.experience, 0),
    minScore: toNumber(query.minReadiness || query.minScore, 0),
    organizationId,
    limit: poolCap
  });

  const enriched = await enrichCandidates(base);
  const filtered = filterCandidateCards(enriched, query);
  const sorted = sortCandidates(filtered, sortBy);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;
  const paged = sorted.slice(start, start + limit);
  const stacks = [
    ...new Set(filtered.map((candidate) => String(candidate.stack || '').trim()).filter(Boolean))
  ].sort((a, b) => a.localeCompare(b));
  const locations = [
    ...new Set(filtered.map((candidate) => String(candidate.location || '').trim()).filter(Boolean))
  ].sort((a, b) => a.localeCompare(b));

  return {
    candidates: paged,
    filters: {
      stacks,
      locations,
      availability: ['Open to entry roles', 'High intent', 'Available', 'Review needed']
    },
    meta: {
      page: safePage,
      limit,
      total,
      totalPages,
      sortBy
    }
  };
};

const toCandidateDetails = (candidate) => {
  if (!candidate) return null;

  const formatted = formatCandidateCard({ ...candidate, id: candidate.userId || candidate.id });
  return {
    ...formatted,
    profileSummary:
      formatted.aiSummary ||
      formatted.headline ||
      `${formatted.name} is active in ${formatted.stack}.`,
    projects: Array.isArray(formatted.projects) ? formatted.projects : [],
    skillGaps: Array.isArray(candidate.skillGaps) ? candidate.skillGaps : [],
    portfolio: formatted.publicPortfolioLink,
    recruiterNotes: '',
    shortlistStatus: null,
    profileCompleteness: calculateProfileCompleteness(formatted)
  };
};

const getRecruiterCandidatesByIds = async (candidateIds, organizationId, session) => {
  const candidates = await getCandidatesByIds(candidateIds, { organizationId, session });
  return new Map([...candidates].map(([id, candidate]) => [id, toCandidateDetails(candidate)]));
};

const getRecruiterCandidateDetails = async (candidateId, organizationId) => {
  const id = requireObjectId(candidateId, 'candidateId');
  const candidates = await getRecruiterCandidatesByIds([id], organizationId);
  return candidates.get(id) || null;
};

const analyzeRecruiterCandidate = async ({
  recruiterId,
  organizationId,
  teamId,
  candidateId,
  route
}) => {
  const candidate = await getRecruiterCandidateDetails(candidateId, organizationId);
  if (!candidate) return null;

  const signals = [
    { key: 'readiness', label: 'Readiness', score: measuredScore(candidate.readinessScore) },
    { key: 'github', label: 'GitHub', score: measuredScore(candidate.githubScore) },
    { key: 'resume', label: 'Resume', score: measuredScore(candidate.resumeScore) }
  ];
  const availableSignalScore = averageAvailableScores(signals.map((signal) => signal.score));
  const analysis = {
    assessmentType: 'deterministic',
    summary:
      availableSignalScore === null
        ? 'No valid score measurements are available. Missing evidence does not establish low ability.'
        : `Assessment uses ${signals.filter((signal) => signal.score !== null).length} of 3 available score measurements. Review the underlying evidence before outreach.`,
    strengths: signals
      .filter((signal) => signal.score !== null)
      .map((signal) => `${signal.label} score ${signal.score}/100`),
    weaknesses: (candidate.skillGaps || []).slice(0, 3),
    recommendation:
      availableSignalScore === null
        ? 'Collect evidence before assessment.'
        : 'Review recorded evidence for outreach; this is not a job-match recommendation.',
    availableSignalScore,
    // Compatibility alias for existing API consumers; this is not statistical confidence.
    confidenceScore: availableSignalScore,
    scoreExplanation:
      'Rounded arithmetic mean of available readiness, GitHub and resume scores. Missing values are excluded; zero is included. Readiness can reuse the same underlying sources. This is neither statistical confidence nor a job-match score.',
    evidence: signals.map((signal) => ({
      ...signal,
      available: signal.score !== null,
      recordedAt: candidate.assessmentEvidence?.[signal.key]?.recordedAt || null,
      explanation:
        candidate.assessmentEvidence?.[signal.key]?.explanation ||
        (signal.score === null
          ? 'No valid measurement is available.'
          : 'Source timestamp is not recorded.')
    }))
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
  getRecruiterCandidatesByIds,
  toCandidateDetails,
  analyzeRecruiterCandidate,
  logCandidateView,
  formatCandidateComparison
};
