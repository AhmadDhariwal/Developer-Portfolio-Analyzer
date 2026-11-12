const { numeric, clampScore, safeAverage } = require('./scoring/math');
const sprintProgress = require('./scoring/sprintProgressScore');
const skillGapContract = require('./skillGapCacheContract');

const measuredScore = (value) => (numeric(value) === null ? null : clampScore(value));

// Dashboard presents owner-module measurements. It does not infer interview
// readiness from sprint completion or market demand from the existence of a job.
const buildReadinessCenter = ({
  readinessScore,
  latestResume,
  latestPortfolioCache,
  latestSkillGapCache,
  latestRecommendationCache,
  latestCareerSprint,
  integrationScore,
}) => [
  {
    key: 'overall',
    label: 'Overall Readiness',
    value: measuredScore(readinessScore),
    tone: 'primary',
  },
  {
    key: 'resume',
    label: 'Resume Readiness',
    tone: 'blue',
    value: measuredScore(
      latestResume
        ? safeAverage([
            latestResume.atsScore,
            latestResume.keywordDensity,
            latestResume.formatScore,
            latestResume.contentQuality,
          ])
        : null,
    ),
  },
  {
    key: 'portfolio',
    label: 'Portfolio Readiness',
    tone: 'green',
    value: measuredScore(latestPortfolioCache?.analysisData?.portfolioScore?.overallScore),
  },
  {
    key: 'interview',
    label: 'Interview Readiness',
    tone: 'amber',
    value: measuredScore(
      latestRecommendationCache?.analysisData?.recommendationScores?.interviewReadinessScore,
    ),
  },
  {
    key: 'market',
    label: 'Target Skill Coverage',
    tone: 'cyan',
    value: skillGapContract.coverage(latestSkillGapCache?.analysisData?.coverage),
  },
  {
    key: 'integration',
    label: 'Integration Readiness',
    value: measuredScore(integrationScore),
    tone: 'violet',
  },
  {
    key: 'sprint',
    label: 'Sprint Progress',
    tone: 'green',
    value: sprintProgress.calculate(latestCareerSprint?.tasks || []).score,
  },
];

module.exports = { buildReadinessCenter };
