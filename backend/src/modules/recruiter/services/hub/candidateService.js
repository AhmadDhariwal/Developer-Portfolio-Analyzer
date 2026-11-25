const AuditLog = require('../../../admin/models/auditLog');
const { requireObjectId } = require('../../utils/recruiterValidation');
const { getCandidatesByIds } = require('../matching/matchingService');
const {
  formatCandidateCard,
  formatCandidateComparison,
  calculateProfileCompleteness,
  measuredScore,
  averageAvailableScores
} = require('../../utils/hub/candidateFormatter');

const { listCandidatePage } = require('./candidateDiscoveryService');

const listRecruiterCandidates = listCandidatePage;

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
