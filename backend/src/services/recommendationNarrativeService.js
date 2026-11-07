'use strict';

const EMPTY_RECOMMENDATION_ENRICHMENT = Object.freeze({
  analysisSummary: '',
  projectNarratives: [],
  technologyNarratives: [],
  careerPathNarratives: [],
  portfolioRecommendations: [],
  resumeRecommendations: [],
  learningActions: [],
  interviewReadinessActions: [],
  aiUsed: false,
});
const { uniqueStrings, normalizeActionList } = require('../utils/recommendationUtilities');
const isUsableRecommendationNarrative = (value, { min = 20, max = 800 } = {}) => {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length < min || text.length > max) return false;
  if (
    /[{}\[\]<>]|<\/?[a-z]|lorem ipsum|as an ai\b|language model\b|i cannot\b|not sure\b|\bn\/a\b|todo\b|placeholder|sample text|test summary|leverage synerg|in today's (?:fast-paced|digital)|cutting-edge solutions/i.test(
      text,
    )
  ) {
    return false;
  }
  if ((text.match(/[!?.]/g) || []).length > 8) return false;
  return true;
};

const isRecommendationNarrativeGrounded = (
  text,
  { careerStack = '', experienceLevel = '', anchors = [] } = {},
) => {
  const lower = String(text || '').toLowerCase();
  if (!lower) return false;
  if (careerStack && lower.includes(String(careerStack).toLowerCase())) return true;
  if (experienceLevel && lower.includes(String(experienceLevel).toLowerCase())) return true;
  return (Array.isArray(anchors) ? anchors : []).some((name) => {
    const token = String(name || '')
      .trim()
      .toLowerCase();
    return token.length >= 2 && lower.includes(token);
  });
};

const hasRecommendationFactPollution = (aiResult = {}) => {
  if (!aiResult || typeof aiResult !== 'object' || Array.isArray(aiResult)) return true;
  return (
    Array.isArray(aiResult.projects) ||
    Array.isArray(aiResult.technologies) ||
    Array.isArray(aiResult.careerPaths) ||
    Array.isArray(aiResult.structuredRecommendations) ||
    Array.isArray(aiResult.roadmap) ||
    (aiResult.recommendationScores != null && typeof aiResult.recommendationScores === 'object') ||
    typeof aiResult.readinessScore === 'number' ||
    typeof aiResult.overallRecommendationScore === 'number' ||
    typeof aiResult.impact === 'number' ||
    typeof aiResult.match === 'number' ||
    typeof aiResult.jobDemand === 'number' ||
    typeof aiResult.salaryRange === 'string' ||
    typeof aiResult.startUrl === 'string' ||
    typeof aiResult.exploreUrl === 'string' ||
    typeof aiResult.priority === 'string' ||
    typeof aiResult.difficulty === 'string'
  );
};

const pickGroundedNarrative = (raw, fallbackText, context, bounds) => {
  if (!isUsableRecommendationNarrative(raw, bounds)) return fallbackText;
  const cleaned = String(raw).replace(/\s+/g, ' ').trim();
  if (!isRecommendationNarrativeGrounded(cleaned, context)) return fallbackText;
  return cleaned;
};

const pickGroundedActions = (raw, fallbackActions, min, max, context) => {
  const cleaned = (Array.isArray(raw) ? raw : [])
    .map((value) =>
      String(value || '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(
      (value) =>
        isUsableRecommendationNarrative(value, { min: 12, max: 240 }) &&
        isRecommendationNarrativeGrounded(value, context),
    );
  if (cleaned.length >= min) return uniqueStrings(cleaned, max);
  return normalizeActionList(cleaned, fallbackActions, min, max);
};

const resolveRecommendationEnrichment = (
  aiResult,
  fallback = {},
  { aiOk = false, careerStack = '', experienceLevel = '', anchors = [] } = {},
) => {
  if (
    !aiOk ||
    !aiResult ||
    typeof aiResult !== 'object' ||
    Array.isArray(aiResult) ||
    aiResult.__fallback === true
  ) {
    return { ...EMPTY_RECOMMENDATION_ENRICHMENT };
  }
  if (hasRecommendationFactPollution(aiResult)) {
    return { ...EMPTY_RECOMMENDATION_ENRICHMENT };
  }

  const context = { careerStack, experienceLevel, anchors };
  const planProjectIds = new Set(
    (fallback.projects || []).map((item) => String(item.id || '').trim()).filter(Boolean),
  );
  const planTechNames = new Set(
    (fallback.technologies || [])
      .map((item) =>
        String(item.name || '')
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean),
  );
  const planPathIds = new Set(
    (fallback.careerPaths || []).map((item) => String(item.id || '').trim()).filter(Boolean),
  );

  const projectNarratives = (
    Array.isArray(aiResult.projectNarratives) ? aiResult.projectNarratives : []
  )
    .filter((item) => planProjectIds.has(String(item?.id || '').trim()))
    .map((item) => {
      const id = String(item.id || '').trim();
      const base =
        (fallback.projects || []).find((project) => String(project.id || '').trim() === id) || {};
      const description = pickGroundedNarrative(item.description, '', context, {
        min: 24,
        max: 500,
      });
      const whyThisProject = pickGroundedNarrative(item.whyThisProject, '', context, {
        min: 24,
        max: 500,
      });
      if (!description && !whyThisProject) return null;
      return {
        id,
        description: description || base.description || '',
        whyThisProject: whyThisProject || base.whyThisProject || '',
      };
    })
    .filter(Boolean);

  const technologyNarratives = (
    Array.isArray(aiResult.technologyNarratives) ? aiResult.technologyNarratives : []
  )
    .filter((item) =>
      planTechNames.has(
        String(item?.name || '')
          .trim()
          .toLowerCase(),
      ),
    )
    .map((item) => {
      const name = String(item.name || '').trim();
      const description = pickGroundedNarrative(
        item.description,
        '',
        { ...context, anchors: [...anchors, name] },
        { min: 20, max: 400 },
      );
      if (!description) return null;
      return { name, description };
    })
    .filter(Boolean);

  const careerPathNarratives = (
    Array.isArray(aiResult.careerPathNarratives) ? aiResult.careerPathNarratives : []
  )
    .filter((item) => planPathIds.has(String(item?.id || '').trim()))
    .map((item) => {
      const id = String(item.id || '').trim();
      const base =
        (fallback.careerPaths || []).find((path) => String(path.id || '').trim() === id) || {};
      const description = pickGroundedNarrative(item.description, '', context, {
        min: 24,
        max: 500,
      });
      const actionItems = pickGroundedActions(item.actionItems, [], 0, 6, context);
      if (!description && !actionItems.length) return null;
      return {
        id,
        description: description || base.description || '',
        actionItems: actionItems.length ? actionItems : base.actionItems || [],
      };
    })
    .filter(Boolean);

  const analysisSummary = pickGroundedNarrative(aiResult.analysisSummary, '', context, {
    min: 40,
    max: 800,
  });
  const portfolioRecommendations = pickGroundedActions(
    aiResult.portfolioRecommendations,
    [],
    0,
    4,
    context,
  );
  const resumeRecommendations = pickGroundedActions(
    aiResult.resumeRecommendations,
    [],
    0,
    4,
    context,
  );
  const learningActions = pickGroundedActions(aiResult.learningActions, [], 0, 6, context);
  const interviewReadinessActions = pickGroundedActions(
    aiResult.interviewReadinessActions,
    [],
    0,
    4,
    context,
  );

  const aiUsed = Boolean(
    analysisSummary ||
    projectNarratives.length ||
    technologyNarratives.length ||
    careerPathNarratives.length ||
    portfolioRecommendations.length ||
    resumeRecommendations.length ||
    learningActions.length ||
    interviewReadinessActions.length,
  );

  return {
    analysisSummary,
    projectNarratives,
    technologyNarratives,
    careerPathNarratives,
    portfolioRecommendations,
    resumeRecommendations,
    learningActions,
    interviewReadinessActions,
    aiUsed,
  };
};

const mergeNarrativeEnrichment = (fallback, enrichment = {}) => {
  const projectNarratives = new Map(
    (Array.isArray(enrichment.projectNarratives) ? enrichment.projectNarratives : []).map(
      (item) => [String(item?.id || '').trim(), item],
    ),
  );
  const technologyNarratives = new Map(
    (Array.isArray(enrichment.technologyNarratives) ? enrichment.technologyNarratives : []).map(
      (item) => [
        String(item?.name || '')
          .trim()
          .toLowerCase(),
        item,
      ],
    ),
  );
  const careerPathNarratives = new Map(
    (Array.isArray(enrichment.careerPathNarratives) ? enrichment.careerPathNarratives : []).map(
      (item) => [String(item?.id || '').trim(), item],
    ),
  );

  return {
    ...fallback,
    analysisSummary: String(enrichment.analysisSummary || fallback.analysisSummary || '').trim(),
    projects: fallback.projects.map((project) => {
      const narrative = projectNarratives.get(String(project.id || '').trim()) || {};
      return {
        ...project,
        // Deterministic titles remain authoritative; AI may only enrich narrative fields.
        description: String(narrative.description || project.description || '').trim(),
        whyThisProject: String(narrative.whyThisProject || project.whyThisProject || '').trim(),
      };
    }),
    technologies: fallback.technologies.map((technology) => {
      const narrative =
        technologyNarratives.get(
          String(technology.name || '')
            .trim()
            .toLowerCase(),
        ) || {};
      return {
        ...technology,
        description: String(narrative.description || technology.description || '').trim(),
      };
    }),
    careerPaths: fallback.careerPaths.map((path) => {
      const narrative = careerPathNarratives.get(String(path.id || '').trim()) || {};
      const actionItems =
        Array.isArray(narrative.actionItems) && narrative.actionItems.length
          ? normalizeActionList(narrative.actionItems, path.actionItems, 2, 6)
          : path.actionItems;
      return {
        ...path,
        description: String(narrative.description || path.description || '').trim(),
        actionItems,
      };
    }),
    portfolioRecommendations: normalizeActionList(
      enrichment.portfolioRecommendations,
      fallback.portfolioRecommendations,
      2,
      4,
    ),
    resumeRecommendations: normalizeActionList(
      enrichment.resumeRecommendations,
      fallback.resumeRecommendations,
      2,
      4,
    ),
    learningActions: normalizeActionList(
      enrichment.learningActions,
      fallback.learningActions,
      3,
      6,
    ),
    interviewReadinessActions: normalizeActionList(
      enrichment.interviewReadinessActions,
      fallback.interviewReadinessActions,
      2,
      4,
    ),
    aiUsed: Boolean(enrichment.aiUsed),
  };
};

module.exports = {
  resolveRecommendationEnrichment,
  mergeNarrativeEnrichment,
  isUsableRecommendationNarrative,
  hasRecommendationFactPollution,
};
