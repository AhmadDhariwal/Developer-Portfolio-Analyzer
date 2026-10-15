'use strict';
const developerContext = require('./developerContextService');
const AnalysisCache = require('../models/analysisCache');
const GitHubAnalysisCache = require('../models/githubAnalysisCache');
const { buildResumeCacheIdentity } = require('./developerSignalService');
const { compatibleSkillGap, sourceMetadata, SKILL_RULE } = require('./recommendationEngineService');
const { digest, skills } = require('../utils/courseIdentity');
const STATUSES = new Set(['DEMONSTRATED', 'PARTIAL', 'CLAIMED_ONLY', 'NOT_EVIDENCED', 'UNKNOWN']);
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
  const fallback = (reason) => ({
    skillGaps: [],
    knownSkills: [],
    targets: [],
    personalization: { status: 'career-context-only', limitation: reason, ruleVersion: SKILL_RULE },
    fingerprint: digest({ ...base, limitation: reason }),
  });
  try {
    // Fresh indexed source reads precede pool-cache hits. A TTL alone cannot detect a new analysis.
    const [resume, github, snapshot] = await Promise.all([
      developerContext.resolveResumeAnalysis(userId, user),
      username
        ? GitHubAnalysisCache.findOne({ normalizedUsername: username })
            .sort({ updatedAt: -1 })
            .lean()
        : null,
      AnalysisCache.findOne({
        userId,
        githubUsername: {
          $regex: '^' + username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$',
          $options: 'i',
        },
        careerStack,
        experienceLevel,
        'analysisData.ruleVersion': SKILL_RULE,
      })
        .sort({ updatedAt: -1 })
        .lean(),
    ]);
    const resumeIdentity = buildResumeCacheIdentity({ resumeAnalysis: resume });
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
          'A compatible current Skill Gap snapshot is unavailable. Results use career context and your explicit filters; absent evidence does not establish missing ability.',
        ),
        fingerprint,
      };
    const seen = new Set();
    const targets = (Array.isArray(compatible.skills) ? compatible.skills : [])
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
        .filter((item) => item.status !== 'DEMONSTRATED')
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
      'Current evidence could not be checked. Showing career-context catalog results without historical skill scores.',
    );
  }
};
module.exports = { resolveSkillSignals, SKILL_GAP_ANALYSIS_VERSION: SKILL_RULE };
