'use strict';

const developerContext = require('./developerContextService');
const engine = require('./recommendationEngineService');
const GitHubCache = require('../models/githubAnalysisCache');
const AnalysisCache = require('../models/analysisCache');
const { buildResumeCacheIdentity } = require('./developerSignalService');
const { digest } = require('./sprintDraftContextService');
const sourceKey = (source) =>
  source
    ? [
        source.type,
        source.type === 'github' ? String(source.id).toLowerCase() : source.id,
        source.timestamp || null,
        source.ruleVersion || null,
        source.freshness,
        source.available ?? null
      ]
    : null;

const currentActions = async ({ userId, user, careerStack, experienceLevel, documents, signals }) => {
  const fallback = {
    tasks: [],
    limitation:
      'No compatible current Recommendation actions are available; general career suggestions are proposed work.'
  };
  if (!user?._id) return fallback;
  try {
    const username = String(developerContext.resolveGithubUsername(user) || '').toLowerCase();
    const [resume, github, snapshot] = await Promise.all([
      developerContext.resolveResumeAnalysis(userId, user),
      username ? GitHubCache.findOne({ normalizedUsername: username }).sort({ updatedAt: -1 }).lean() : null,
      AnalysisCache.findOne({ userId, careerStack, experienceLevel, 'analysisData.ruleVersion': engine.SKILL_RULE })
        .sort({ updatedAt: -1 })
        .lean()
    ]);
    const githubData = github?.result
      ? {
          ...github.result,
          cache: { ...github.result.cache, stale: !github.expiresAt || new Date(github.expiresAt) <= new Date() }
        }
      : { unavailable: true };
    const sources = engine.sourceMetadata({ username, githubData, resumeAnalysis: resume });
    const skillGap = engine.compatibleSkillGap(snapshot, {
      userId,
      username,
      careerStack,
      experienceLevel,
      ...buildResumeCacheIdentity({ resumeAnalysis: resume }),
      sources
    });
    const plan = engine.buildPlan({
      username,
      careerStack,
      experienceLevel,
      githubData,
      resumeAnalysis: resume,
      resumeInsights: engine.resumeSignals(resume),
      skillGap,
      supportingSignals: signals || {}
    });
    const permitted = new Map(plan.recommendations.map((card) => [card.id, card]));
    const tasks = [];
    for (const doc of documents) {
      if (
        String(doc.userId) !== String(userId) ||
        doc.snapshotVersion !== engine.RULE_VERSION ||
        doc.result?.ruleVersion !== engine.RULE_VERSION ||
        doc.careerStack !== careerStack ||
        doc.experienceLevel !== experienceLevel ||
        !/^[a-f0-9]{64}$/.test(doc.contextHash || '') ||
        !(
          Date.now() - new Date(doc.createdAt).getTime() >= 0 &&
          Date.now() - new Date(doc.createdAt).getTime() < 86400000
        )
      )
        continue;
      if (
        ['github', 'resume'].some(
          (type) => digest(sourceKey(doc.result.sourceMetadata?.[type])) !== digest(sourceKey(sources[type]))
        )
      )
        continue;
      for (const saved of doc.result.recommendations || []) {
        const card = permitted.get(saved.id);
        if (!card || card.freshness === 'STALE') continue;
        // Revalidate authoritative actions against current evidence; narrative enrichment
        // and historical score labels cannot create new personal facts.
        if (
          saved.actionableNextStep !== card.actionableNextStep ||
          saved.title !== card.title ||
          saved.priority !== card.priority
        )
          continue;
        if (digest((saved.sources || []).map(sourceKey)) !== digest((card.sources || []).map(sourceKey))) continue;
        const category =
          card.category === 'projects' ? 'project' : card.category === 'learning' ? 'learning' : 'practice';
        tasks.push({
          title: card.title.slice(0, 120),
          description: `${card.actionableNextStep}\nRecommendation: ${card.id}\nContext: ${doc.contextHash}`.slice(
            0,
            1000
          ),
          category,
          points: { learning: 3, project: 5, practice: 4 }[category],
          priority: card.priority.toLowerCase(),
          taskType: 'ai',
          sourceRecommendationId: card.id,
          sourceRecommendationSnapshotId: String(doc._id),
          sourceRecommendationHash: doc.contextHash,
          sourceRule: engine.RULE_VERSION,
          evidenceLimitation: 'Proposed action based on current recorded evidence; not proof of ability.'
        });
      }
    }
    return {
      tasks,
      fingerprint: digest({ sources, skillGap, tasks }),
      limitation: tasks.length
        ? 'Recommendation actions are proposed work; missing evidence does not establish inability.'
        : fallback.limitation
    };
  } catch {
    return fallback;
  }
};
module.exports = { currentActions };
