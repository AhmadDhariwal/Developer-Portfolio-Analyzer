const toTitle = (value) => String(value || '').trim();

const calculateProfileCompleteness = (candidate = {}) => {
  const fields = [
    candidate.fullName,
    candidate.stack,
    candidate.location,
    candidate.githubUsername,
    candidate.headline,
    Array.isArray(candidate.skills) && candidate.skills.length ? 'skills' : '',
    candidate.publicProfileSlug,
    Array.isArray(candidate.projects) && candidate.projects.length ? 'projects' : ''
  ];

  const filled = fields.filter((item) => String(item || '').trim().length > 0).length;
  return Math.round((filled / fields.length) * 100);
};

const inferAvailability = (candidate = {}) => {
  if (Number(candidate.yearsOfExperience || 0) === 0) return 'Open to entry roles';
  if (Number(candidate.score || 0) >= 80) return 'High intent';
  if (Number(candidate.score || 0) >= 60) return 'Available';
  return 'Review needed';
};

const formatCandidateCard = (candidate = {}) => ({
  ...candidate,
  name: candidate.fullName || candidate.name || '',
  readinessScore: Number(candidate.score || 0),
  publicPortfolioLink: candidate.publicProfileSlug ? `/p/${candidate.publicProfileSlug}` : '',
  profileCompleteness: calculateProfileCompleteness(candidate),
  availability: inferAvailability(candidate),
  lastActive: candidate.lastActive || candidate.updatedAt || candidate.createdAt || null,
  aiSummary: toTitle(candidate.aiInsight?.summary)
});

const formatCandidateComparison = (candidate = {}) => ({
  id: candidate.id || candidate.userId || '',
  name: candidate.fullName || '',
  stack: candidate.stack || '',
  experience: Number(candidate.yearsOfExperience || 0),
  readinessScore: Number(candidate.score || 0),
  githubScore: Number(candidate.githubScore || 0),
  resumeScore: Number(candidate.resumeScore || 0),
  projectQuality: Array.isArray(candidate.projects)
    ? Math.round(candidate.projects.reduce((sum, project) => sum + Number(project?.impactScore || 0), 0) / Math.max(candidate.projects.length, 1))
    : 0,
  skillGaps: Array.isArray(candidate.skillGaps) ? candidate.skillGaps : [],
  recommendation: toTitle(candidate.aiInsight?.recommendation || candidate.aiSummary || '')
});

module.exports = {
  calculateProfileCompleteness,
  formatCandidateCard,
  formatCandidateComparison
};
