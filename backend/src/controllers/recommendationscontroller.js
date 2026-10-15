'use strict';
const developerContext = require('../services/developerContextService');
const engine = require('../services/recommendationEngineService');
const SavedPreview = require('../models/savedPreview');
const { parseGitHubUsername } = require('../services/githubservice');
const { uniqueStrings, clamp } = require('../utils/recommendationUtilities');
const {
  runRecommendationPipeline,
  resolveRecommendationEnrichment,
  mergeNarrativeEnrichment,
  isUsableRecommendationNarrative,
  hasRecommendationFactPollution,
  clearRecommendationMemoryCache,
  getRecommendationMemoryCacheSize,
  RECOMMENDATION_ANALYSIS_VERSION,
  ALLOWED_STACKS,
  ALLOWED_LEVELS,
} = require('../services/recommendationService');
const PREVIEW_STACKS = new Set(['Frontend', 'Backend', 'Full Stack', 'AI/ML']);
const PREVIEW_LEVELS = new Set([
  'Student',
  'Intern',
  '0-1 years',
  '1-2 years',
  '2-3 years',
  '3-5 years',
  '5+ years',
]);
const previewText = (value, max = 500) =>
  String(value || '')
    .trim()
    .slice(0, max);
const previewStrings = (values, max = 12) =>
  uniqueStrings(
    Array.isArray(values)
      ? values.map((value) => (typeof value === 'string' ? value : value?.name))
      : [],
    max,
  );
const previewSkills = (values, max = 16) =>
  (Array.isArray(values) ? values : [])
    .map((skill) => ({
      name: previewText(typeof skill === 'string' ? skill : skill?.name, 80),
      priority: previewText(skill?.priority, 16),
      jobDemand: clamp(skill?.jobDemand || 0),
    }))
    .filter((skill) => skill.name)
    .slice(0, max);
const previewCards = (values, max = 8) =>
  (Array.isArray(values) ? values : [])
    .map((card) => ({
      title: previewText(card?.title, 160),
      description: previewText(card?.description || card?.reason, 500),
      priority: previewText(card?.priority, 16),
      estimatedImpact: clamp(card?.estimatedImpact || card?.impact || 0),
    }))
    .filter((card) => card.title)
    .slice(0, max);

const recommendationPreviewCards = (values, max = 8) =>
  (Array.isArray(values) ? values : [])
    .slice(0, max)
    .map((card) => ({
      id: previewText(card?.id, 100),
      title: previewText(card?.title, 160),
      description: previewText(card?.description || card?.reason, 500),
      priority: previewText(card?.priority, 16),
      estimatedImpact: engine.number(card?.estimatedImpact ?? card?.impact),
      actionableNextStep: previewText(card?.actionableNextStep, 500),
      evidence: previewStrings(card?.evidence, 5),
    }))
    .filter((card) => card.title);

const buildSavedPreviewSummary = (module, result = {}) => {
  if (module === 'skill-gap') {
    return {
      ruleVersion: result.ruleVersion || undefined,
      requirementMatrixVersion: result.requirementMatrixVersion || undefined,
      calculatedAt: result.calculatedAt || undefined,
      coverageUnavailableReason: result.coverageUnavailableReason || undefined,
      evidenceConfidence: result.evidenceConfidence || undefined,
      evidenceCompleteness: result.evidenceCompleteness || undefined,
      sourceReferences: result.sourceReferences || undefined,
      warnings: Array.isArray(result.warnings) ? result.warnings : undefined,
      categoryBreakdown: result.categoryBreakdown || undefined,
      legacyReadinessScore: Number.isFinite(Number(result.legacyReadinessScore))
        ? Number(result.legacyReadinessScore)
        : undefined,
      legacyConfidence: result.legacyConfidence || undefined,
      aiUsed: typeof result.aiUsed === 'boolean' ? result.aiUsed : undefined,
      skills: Array.isArray(result.skills) ? result.skills : undefined,
      requiredSkills: Array.isArray(result.requiredSkills) ? result.requiredSkills : undefined,
      optionalSkills: Array.isArray(result.optionalSkills) ? result.optionalSkills : undefined,
      levelAssessment: previewText(result.levelAssessment, 1000),
      analysisSummary: previewText(result.analysisSummary || result.levelAssessment, 1000),
      coverage:
        result.coverage === null || result.coverage === undefined ? null : clamp(result.coverage),
      missing: clamp(result.missing || 0),
      yourSkills: previewSkills(result.yourSkills),
      weakSkills: previewSkills(result.weakSkills),
      highDemandSkills: previewSkills(result.highDemandSkills),
      missingSkills: previewSkills(result.missingSkills),
      actions: previewCards(result.suggestedProjects, 6),
    };
  }
  return {
    verified: false,
    source: 'clientPreviewSummary',
    ruleVersion: previewText(result.ruleVersion, 80) || 'legacy',
    analysisSummary: previewText(result.analysisSummary, 1000),
    projects: recommendationPreviewCards(result.projects, 8),
    technologies: (Array.isArray(result.technologies) ? result.technologies : [])
      .slice(0, 12)
      .map((skill) => ({
        name: previewText(skill?.name, 80),
        priority: previewText(skill?.priorityRaw || skill?.priority, 16),
        jobDemand: engine.number(skill?.jobDemand),
      })),
    careerPaths: recommendationPreviewCards(result.careerPaths, 6),
    portfolioRecommendations: previewStrings(result.portfolioRecommendations, 4),
    resumeRecommendations: previewStrings(result.resumeRecommendations, 4),
    learningActions: previewStrings(result.learningActions, 6),
    interviewReadinessActions: previewStrings(result.interviewReadinessActions, 4),
    recommendationScores: Object.fromEntries(
      Object.entries(result.recommendationScores || {})
        .filter(([, value]) => Number.isFinite(Number(value)))
        .map(([key, value]) => [key, engine.number(value)]),
    ),
    actions: Object.values(result.structuredRecommendations || {})
      .flatMap((cards) => recommendationPreviewCards(cards, 6))
      .slice(0, 16),
  };
};

const savePreview = async (req, res) => {
  try {
    const module = String(req.body?.module || '').trim();
    const githubUsername = String(req.body?.githubUsername || '')
      .trim()
      .replace(/^@/, '')
      .toLowerCase();
    const careerStack = String(req.body?.careerStack || '').trim();
    const experienceLevel = String(req.body?.experienceLevel || '').trim();
    const resumeHash = String(req.body?.resumeHash || 'no-resume').trim();
    if (
      !['skill-gap', 'recommendations'].includes(module) ||
      !githubUsername ||
      !PREVIEW_STACKS.has(careerStack) ||
      !PREVIEW_LEVELS.has(experienceLevel)
    ) {
      return res.status(400).json({ message: 'Invalid saved preview metadata.' });
    }
    if (resumeHash !== 'no-resume' && !/^[a-f0-9]{64}$/i.test(resumeHash)) {
      return res.status(400).json({ message: 'Invalid preview resume identity.' });
    }
    const title = previewText(req.body?.title, 120) || `${githubUsername} ${careerStack} preview`;
    const previewIdentity = {
      userId: req.user._id,
      module,
      githubUsername,
      careerStack,
      experienceLevel,
      resumeHash,
    };
    const update = {
      $set: {
        title,
        source: 'preview',
        resultSummary: buildSavedPreviewSummary(module, req.body?.result),
      },
      $setOnInsert: previewIdentity,
    };
    let preview;
    try {
      preview = await SavedPreview.findOneAndUpdate(previewIdentity, update, {
        upsert: true,
        returnDocument: 'after',
        setDefaultsOnInsert: true,
      }).lean();
    } catch (error) {
      if (error?.code !== 11000) throw error;
      preview = await SavedPreview.findOne(previewIdentity).lean();
      if (!preview) throw error;
    }
    return res.status(200).json({ preview });
  } catch (error) {
    console.error('Save preview error:', error.message);
    return res.status(500).json({ message: 'Failed to save preview.' });
  }
};

const listSavedPreviews = async (req, res) => {
  const previews = await SavedPreview.find({ userId: req.user._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  return res.json({ previews });
};

const deleteSavedPreview = async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(String(req.params.id || ''))) {
    return res.status(400).json({ message: 'Invalid saved preview id.' });
  }
  const deleted = await SavedPreview.findOneAndDelete({
    _id: req.params.id,
    userId: req.user._id,
  }).lean();
  if (!deleted) return res.status(404).json({ message: 'Saved preview not found.' });
  return res.status(204).send();
};
/**
 * @desc Generate personalised roadmap and project suggestions
 * @route POST /api/recommendations
 */
const getRecommendations = async (req, res) => {
  try {
    let { username, forceRefresh } = req.body;
    const activeGithub = String(developerContext.resolveGithubUsername(req.user) || '').trim();

    if (!req.user?._id) {
      return res.status(401).json({ message: 'Authentication required.' });
    }

    const requestedUsername = String(username || '').trim();
    if (requestedUsername && requestedUsername.toLowerCase() !== activeGithub.toLowerCase()) {
      return res.status(400).json({
        message: 'Use Preview mode to analyze another GitHub username.',
      });
    }

    let finalUsername;
    try {
      if (activeGithub) finalUsername = parseGitHubUsername(activeGithub);
      else finalUsername = '';
    } catch (error) {
      return res
        .status(error.status || 400)
        .json({ message: error.message || 'GitHub username is required.' });
    }

    const careerStack =
      developerContext.resolveCareerStack(req.user) || req.body.careerStack || 'Full Stack';
    const experienceLevel =
      developerContext.resolveExperienceLevel(req.user) || req.body.experienceLevel || 'Student';
    if (!ALLOWED_STACKS.includes(careerStack)) {
      return res.status(400).json({
        message: `Target stack must be one of: ${ALLOWED_STACKS.join(', ')}`,
      });
    }
    if (!ALLOWED_LEVELS.includes(experienceLevel)) {
      return res.status(400).json({
        message: `Experience level must be one of: ${ALLOWED_LEVELS.join(', ')}`,
      });
    }

    return await runRecommendationPipeline({
      req,
      res,
      username: finalUsername,
      careerStack,
      experienceLevel,
      resumeText: '',
      knownSkills: undefined,
      missingSkills: undefined,
      userId: req.user._id,
      allowSignals: true,
      saveResult: true,
      source: 'recommendations',
      forceRefresh: forceRefresh === true || forceRefresh === 'true',
    });
  } catch (error) {
    console.error('Recommendations Error:', error.message);
    return res.status(error.status || 500).json({
      message: error.status ? error.message : 'Failed to generate recommendations.',
    });
  }
};

/**
 * @desc Generate recommendations (supports both temporary and permanent analysis)
 * @route POST /api/recommendations/generate
 */
const generateRecommendations = async (req, res) => {
  try {
    let {
      githubUsername,
      careerStack,
      experienceLevel,
      isTemporary,
      missingSkills,
      knownSkills,
      resumeText,
      previewResumeId,
      resumeHash,
    } = req.body;
    const forceRefresh = req.body.forceRefresh === true || req.body.forceRefresh === 'true';
    const isTemporaryMode = isTemporary === true || isTemporary === 'true';
    const activeGithub = String(developerContext.resolveGithubUsername(req.user) || '').trim();
    for (const values of [knownSkills, missingSkills]) {
      if (
        values !== undefined &&
        (!Array.isArray(values) ||
          values.length > 80 ||
          values.some((value) => typeof value !== 'string' || value.length > 100))
      ) {
        return res
          .status(400)
          .json({ message: 'Preview skills must be bounded lists of skill names.' });
      }
    }

    if (!isTemporaryMode) {
      if (!req.user?._id) {
        return res.status(401).json({ message: 'Authentication required for profile mode.' });
      }
      const requestedUsername = String(githubUsername || '').trim();
      if (requestedUsername && requestedUsername.toLowerCase() !== activeGithub.toLowerCase()) {
        return res.status(400).json({
          message: 'Use Preview mode to analyze another GitHub username.',
        });
      }
    }

    let username;
    try {
      username = (isTemporaryMode ? githubUsername : activeGithub)
        ? parseGitHubUsername(isTemporaryMode ? githubUsername : activeGithub)
        : '';
    } catch (error) {
      return res
        .status(error.status || 400)
        .json({ message: error.message || 'GitHub username is required.' });
    }

    const finalCareerStack = isTemporaryMode
      ? careerStack
      : developerContext.resolveCareerStack(req.user) || careerStack || 'Full Stack';
    const finalExperienceLevel = isTemporaryMode
      ? experienceLevel
      : developerContext.resolveExperienceLevel(req.user) || experienceLevel || 'Student';

    // Validation for Preview Mode and profile fallbacks
    if (!ALLOWED_STACKS.includes(finalCareerStack)) {
      return res.status(400).json({
        message: `Target stack is required and must be one of: ${ALLOWED_STACKS.join(', ')}`,
      });
    }
    if (!ALLOWED_LEVELS.includes(finalExperienceLevel)) {
      return res.status(400).json({
        message: `Experience level is required and must be one of: ${ALLOWED_LEVELS.join(', ')}`,
      });
    }
    if (isTemporaryMode) {
      if (resumeText !== undefined && typeof resumeText !== 'string') {
        return res.status(400).json({ message: 'Resume input must be a valid text string.' });
      }
    }

    return await runRecommendationPipeline({
      req,
      res,
      username,
      careerStack: finalCareerStack,
      experienceLevel: finalExperienceLevel,
      resumeText,
      previewResumeId,
      resumeHash,
      knownSkills: isTemporaryMode ? knownSkills : undefined,
      missingSkills: isTemporaryMode ? missingSkills : undefined,
      userId: !isTemporaryMode ? req.user._id : null,
      allowSignals: !isTemporaryMode,
      saveResult: !isTemporaryMode,
      source: 'recommendations/generate',
      forceRefresh,
    });
  } catch (error) {
    console.error('Generate Recommendations Error:', error.message);
    return res.status(error.status || 500).json({
      message: error.status ? error.message : 'Failed to generate recommendations.',
    });
  }
};

const handoffToCareerSprint = async (req, res) => {
  if (!req.user?._id) return res.status(401).json({ message: 'Authentication required.' });
  const signalHash = req.body?.signalHash;
  if (typeof signalHash !== 'string' || !/^[a-f0-9]{64}$/.test(signalHash)) {
    return res.status(400).json({ message: 'A current recommendation signal hash is required.' });
  }
  try {
    let current;
    let status = 200;
    const capture = {
      status(code) {
        status = code;
        return this;
      },
      json(value) {
        current = value;
        return this;
      },
    };
    await getRecommendations({ ...req, body: {} }, capture);
    if (status !== 200) return res.status(status).json(current);
    const recommendation = current.recommendations?.find((item) => item.id === req.params.id);
    const result = await require('../services/recommendationHandoffService').handoff({
      userId: req.user._id,
      recommendation,
      signalHash,
      expectedSignalHash: current.cacheMetadata?.signalHash,
    });
    return res.status(result.status).json(result);
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ message: 'Could not hand this recommendation to Career Sprint.' });
  }
};

const listRecommendationHistory = async (req, res) => {
  if (!req.user?._id) return res.status(401).json({ message: 'Authentication required.' });
  try {
    return res.json({
      snapshots: await require('../services/recommendationHistoryService').list(req.user._id),
    });
  } catch {
    return res.status(503).json({ message: 'Recommendation history is temporarily unavailable.' });
  }
};

module.exports = {
  listRecommendationHistory,
  handoffToCareerSprint,
  getRecommendations,
  generateRecommendations,
  savePreview,
  listSavedPreviews,
  deleteSavedPreview,
  resolveRecommendationEnrichment,
  mergeNarrativeEnrichment,
  isUsableRecommendationNarrative,
  hasRecommendationFactPollution,
  clearRecommendationMemoryCache,
  getRecommendationMemoryCacheSize,
  RECOMMENDATION_ANALYSIS_VERSION,
};
