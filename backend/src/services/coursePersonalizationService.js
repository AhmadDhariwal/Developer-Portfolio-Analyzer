'use strict';
const developerContext = require('./developerContextService');
const AnalysisCache = require('../models/analysisCache');
const GitHubAnalysisCache = require('../models/githubAnalysisCache');
const { buildResumeCacheIdentity } = require('./developerSignalService');
const { compatibleSkillGap, sourceMetadata, SKILL_RULE } = require('./recommendationEngineService');
const { buildScope } = require('./skillGapCacheContract');
const { digest, skills } = require('../utils/courseIdentity');
const STATUSES = new Set(['DEMONSTRATED', 'PARTIAL', 'CLAIMED_ONLY', 'NOT_EVIDENCED', 'UNKNOWN']);
const taxonomy = require('./courseCatalogTaxonomy');
const learningSkills = (signals, careerStack) => {
  if (signals.personalization?.status !== 'evidence-informed') return [];
  const demonstrated = new Set(
    (signals.targets || [])
      .filter((target) => target.status === 'DEMONSTRATED')
      .map((target) => taxonomy.canonical(target.name)),
  );
  return [
    ...new Set(
      (signals.targets || [])
        .filter((target) => ['PARTIAL', 'CLAIMED_ONLY', 'NOT_EVIDENCED'].includes(target.status))
        .map((target) => taxonomy.canonical(target.name))
        .filter((name) => name && !demonstrated.has(name))
        .filter((name) => {
          if (!careerStack) return true;
          const requirements = require('./skillGapRequirements');
          const metadata = requirements.metadata(name);
          return (
            metadata.name && requirements.STACK_CATEGORIES[careerStack]?.includes(metadata.category)
          );
        }),
    ),
  ].slice(0, 100);
};
const resolveSkillSignals = async (userId, careerStack, experienceLevel, _timer, user = {}) => {
  const username = String(developerContext.resolveGithubUsername(user) || '')
    .trim()
    .toLowerCase();
  const base = {
    userId: String(userId),
    username,
    careerStack,
    experienceLevel,
    selectedResume: String(developerContext.resolveSelectedResumeFileId(user) || ''),
    profileRevision: user.updatedAt || null,
  };
  const fallback = (reason, learningState = 'analysis-required') => ({
    skillGaps: [],
    knownSkills: [],
    targets: [],
    personalization: {
      status: 'career-context-only',
      learningState,
      eligibleSkills: [],
      limitation: reason,
      ruleVersion: SKILL_RULE,
    },
    fingerprint: digest({ ...base, limitation: reason }),
  });
  try {
    // Fresh indexed source reads precede pool-cache hits. A TTL alone cannot detect a new analysis.
    const [resume, github] = await Promise.all([
      developerContext.resolveResumeAnalysis(userId, user),
      username
        ? GitHubAnalysisCache.findOne({ normalizedUsername: username })
            .sort({ updatedAt: -1 })
            .lean()
        : null,
    ]);
    if (
      !resume ||
      !developerContext.resolveCareerStack(user) ||
      !developerContext.resolveExperienceLevel(user)
    )
      return fallback(
        'Select and analyze your resume, choose your career profile, then run Skill Gap to see personalized learning.',
      );
    const resumeIdentity = buildResumeCacheIdentity({ resumeAnalysis: resume });
    const snapshot = await AnalysisCache.findOne({
      ...buildScope({ userId, user, resumeIdentity }),
      careerStack,
      experienceLevel,
    })
      .sort({ updatedAt: -1 })
      .lean();
    const githubData = github?.result
      ? {
          ...github.result,
          cache: {
            ...github.result.cache,
            stale: !github.expiresAt || new Date(github.expiresAt).getTime() <= Date.now(),
          },
        }
      : { unavailable: true };
    const sources = sourceMetadata({ username, githubData, resumeAnalysis: resume });
    const clocksValid =
      new Date(snapshot?.updatedAt).getTime() <= Date.now() + 300_000 &&
      Object.values(sources).every(
        (source) =>
          !source.available ||
          (source.timestamp && new Date(source.timestamp).getTime() <= Date.now() + 300_000),
      );
    const compatible =
      clocksValid && compatibleSkillGap(snapshot, { ...base, ...resumeIdentity, sources });
    const fingerprint = digest({
      ...base,
      ...resumeIdentity,
      sources,
      snapshot: snapshot
        ? {
            id: snapshot._id,
            signalHash: snapshot.signalHash,
            updatedAt: snapshot.updatedAt,
            skills: snapshot.analysisData?.skills,
          }
        : null,
      compatible: !!compatible,
    });
    if (!compatible)
      return {
        ...fallback(
          'Run Skill Gap for your current selected resume and career profile. Current compatible evidence is required for personalized learning.',
        ),
        fingerprint,
      };
    const seen = new Set();
    const targets = (Array.isArray(compatible.skills) ? [...compatible.skills] : [])
      .sort((a, b) => Number(b?.status === 'DEMONSTRATED') - Number(a?.status === 'DEMONSTRATED'))
      .flatMap((item) => {
        const name = skills([item?.name], 1)[0];
        if (!name || !STATUSES.has(item.status) || seen.has(name.toLowerCase())) return [];
        seen.add(name.toLowerCase());
        return [
          {
            name,
            status: item.status,
            requirement: item.requirement === 'REQUIRED' ? 'REQUIRED' : 'OPTIONAL',
          },
        ];
      })
      .slice(0, 100);
    return {
      skillGaps: targets
        .filter((item) => !['DEMONSTRATED', 'UNKNOWN'].includes(item.status))
        .sort((a, b) => Number(b.requirement === 'REQUIRED') - Number(a.requirement === 'REQUIRED'))
        .map((item) => item.name)
        .slice(0, 12),
      knownSkills: targets
        .filter((item) => item.status === 'DEMONSTRATED')
        .map((item) => item.name)
        .slice(0, 20),
      targets,
      fingerprint,
      personalization: {
        status: 'evidence-informed',
        targets: targets.slice(0, 40),
        ruleVersion: SKILL_RULE,
        limitation:
          'Skill classifications describe recorded evidence, not verified proficiency or inability.',
      },
    };
  } catch {
    return fallback(
      'Current learning evidence could not be checked. Retry when evidence storage is available.',
      'evidence-unavailable',
    );
  }
};
module.exports = { resolveSkillSignals, learningSkills, SKILL_GAP_ANALYSIS_VERSION: SKILL_RULE };
