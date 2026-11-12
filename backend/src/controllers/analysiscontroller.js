const { buildResumeCacheIdentity } = require('../services/developerSignalService');
const skillGapContract = require('../services/skillGapCacheContract');
const developerContext = require('../services/developerContextService');
const aiService = require('../services/aiservice');
const { getPortfolioScorePrompt } = require('../prompts/portfolioScorePrompt');
const AnalysisCache = require('../models/analysisCache');
const crypto = require('node:crypto');
const { createVersion, createPortfolioVersion } = require('../services/aiVersionService');
const { fingerprint } = require('../services/dashboardConsistencyService');
const {
  calculateTransparentScore,
  normalizeTransparentScorePayload,
} = require('../services/transparentScoringService');
const { getIntegrationInsight } = require('../services/integrationInsightService');

const saveAIVersionSnapshot = async ({ req, source, output, metadata = {}, provenance }) => {
  if (!req.user?._id || !output || typeof output !== 'object') return;
  try {
    const writer = provenance ? createPortfolioVersion : createVersion;
    await writer({
      userId: req.user._id,
      source,
      outputJson: output,
      metadata,
      provenance,
    });
  } catch (error) {
    console.error('Portfolio score AI snapshot error:', error.message);
  }
};

/**
 * @desc  Get overall portfolio strength score (Readiness Score)
 * @route POST /api/analysis/portfolio-score
 */
const getPortfolioReadiness = async (req, res) => {
  try {
    let { username, resumeAnalysis, githubAnalysis, resumeText } = req.body;
    username = username || developerContext.resolveGithubUsername(req.user);

    // Career profile: prefer the authenticated user's saved profile, allow body override
    const careerStack =
      developerContext.resolveCareerStack(req.user) || req.body.careerStack || 'Full Stack';
    const experienceLevel =
      developerContext.resolveExperienceLevel(req.user) || req.body.experienceLevel || 'Student';

    if (!username) {
      return res.status(400).json({ message: 'Username is required.' });
    }

    const cleanResume = (resumeText || '').trim();
    const profileMode =
      !githubAnalysis &&
      !resumeAnalysis &&
      !cleanResume &&
      username.toLowerCase() ===
        String(developerContext.resolveGithubUsername(req.user) || '').toLowerCase();
    const selectedResume = profileMode
      ? await developerContext.resolveResumeAnalysis(req.user._id, req.user)
      : null;
    const resumeIdentity = profileMode
      ? buildResumeCacheIdentity({ resumeAnalysis: selectedResume })
      : { resumeHash: crypto.createHash('sha256').update(cleanResume).digest('hex') };
    const resumeHash = resumeIdentity.resumeHash;
    const identity = {
      githubUsername: username.toLowerCase(),
      careerStack,
      experienceLevel,
      resumeAnalysisId: resumeIdentity.resumeAnalysisId,
    };
    const cacheKey = {
      githubUsername: username,
      careerStack,
      experienceLevel,
      resumeHash,
      ...(profileMode
        ? {
            resumeAnalysisId: resumeIdentity.resumeAnalysisId,
            analysisVersion: 'portfolio-score-v1',
          }
        : {}),
      ...(req.user?._id ? { userId: req.user._id } : {}),
    };

    // A Portfolio snapshot is reusable only for the same authoritative integration revision.
    const integrationInsight = req.user?._id
      ? await getIntegrationInsight(req.user._id)
      : { providers: [], integrationScore: 0, updatedAt: null };
    const integrationRevision = JSON.stringify([
      integrationInsight.updatedAt || null,
      integrationInsight.integrationScore,
      (integrationInsight.providers || []).map((provider) => [
        provider.provider,
        provider.syncedAt,
        provider.ownershipVerified === true,
      ]),
    ]);

    // Try cache first
    const cached = await AnalysisCache.findOne(cacheKey);
    if (
      cached?.analysisData?.portfolioScore &&
      cached.analysisData.portfolioIntegrationRevision === integrationRevision
    ) {
      const cachedResult = {
        ...normalizeTransparentScorePayload(cached.analysisData.portfolioScore),
        fromCache: true,
      };
      await saveAIVersionSnapshot({
        req,
        source: 'portfolio_score',
        output: cachedResult,
        // Older cached scores have no provenance and must never acquire it on read.
        provenance: profileMode ? cached.analysisData.portfolioProvenance : undefined,
        metadata: {
          fromCache: true,
          username,
          careerStack,
          experienceLevel,
          ...(profileMode ? { resumeAnalysisId: resumeIdentity.resumeAnalysisId } : {}),
        },
      });
      return res.json(cachedResult);
    }

    // Fetch missing analysis data if not provided by client
    if (!githubAnalysis) {
      const { analyzeGitHubProfile } = require('../services/githubservice');
      githubAnalysis = await analyzeGitHubProfile(username.trim());
    }

    if (profileMode) resumeAnalysis = selectedResume || { present: false };
    if (!resumeAnalysis && req.user) {
      const analysisDoc = await require('../models/analysis').findOne({ userId: req.user._id });
      resumeAnalysis = analysisDoc
        ? {
            skills: Array.from(analysisDoc.languageDistribution?.keys() || []),
            strengths: [],
            weaknesses: [],
          }
        : { skills: [], strengths: [], weaknesses: [] };
    }
    resumeAnalysis = resumeAnalysis || { skills: [], strengths: [], weaknesses: [] };

    // AI narrative generation; deterministic scoring owns all numeric fields.
    const prompt = getPortfolioScorePrompt(
      resumeAnalysis,
      githubAnalysis,
      careerStack,
      experienceLevel,
    );
    const fallback = {
      overallScore: 70,
      breakdown: { codeQuality: 70, skillCoverage: 70, industryReadiness: 70, projectImpact: 70 },
      summary: 'Solid portfolio with room for improvement in niche areas.',
    };

    const aiResult = await aiService.runAIAnalysis(prompt, fallback);

    const scopedSkillGap = profileMode
      ? await AnalysisCache.findOne(
          skillGapContract.buildScope({
            userId: req.user._id,
            user: req.user,
            resumeIdentity,
          }),
        ).lean()
      : null;
    const transparentResult = calculateTransparentScore(
      {
        githubAnalysis,
        resumeAnalysis,
        skillGapAnalysis: {
          coverage: profileMode
            ? skillGapContract.coverage(scopedSkillGap?.analysisData?.coverage)
            : githubAnalysis?.scores?.skillCoverage,
          yourSkills: resumeAnalysis?.skills || [],
          missingSkills: [],
        },
        integrationInsight,
        careerStack,
      },
      {
        sources: [
          { type: 'github-user', id: username },
          ...(resumeAnalysis?.resumeHash
            ? [{ type: 'resume-hash', id: resumeAnalysis.resumeHash }]
            : []),
        ],
      },
    );

    const scoredResult = normalizeTransparentScorePayload({
      ...transparentResult,
      overallScore: transparentResult.overallScore,
      weightedScore: transparentResult.weightedScore,
      confidenceScore: transparentResult.confidenceScore,
      breakdown: transparentResult.breakdown,
      reasons: transparentResult.reasons,
      explainabilityBreakdown: transparentResult.explainabilityBreakdown,
      summary:
        typeof aiResult?.summary === 'string' && aiResult.summary.trim()
          ? aiResult.summary.trim().slice(0, 1200)
          : 'Weighted score generated with confidence and explainability.',
    });

    const provenance =
      profileMode && Number.isFinite(scoredResult.scoring?.score)
        ? {
            producer: 'portfolio-score-v1',
            ...identity,
            ruleVersion: scoredResult.scoring.ruleVersion,
            assessedAt: new Date(scoredResult.scoring.calculatedAt),
            sourceRevisionHash: fingerprint({
              githubAnalysis,
              selectedResume,
              scopedSkillGap,
              integrationInsight,
            }),
          }
        : undefined;
    if (provenance)
      provenance.assessmentHash = fingerprint({
        ...provenance,
        scoring: scoredResult.scoring,
        overallScore: scoredResult.overallScore,
      });

    if (req.user) {
      await AnalysisCache.findOneAndUpdate(
        cacheKey,
        {
          $set: {
            'analysisData.portfolioScore': scoredResult,
            'analysisData.portfolioIntegrationRevision': integrationRevision,
            ...(provenance ? { 'analysisData.portfolioProvenance': provenance } : {}),
            userId: req.user._id,
          },
        },
        { upsert: true },
      );
    }

    await saveAIVersionSnapshot({
      req,
      source: 'portfolio_score',
      output: scoredResult,
      provenance,
      metadata: {
        fromCache: false,
        username,
        careerStack,
        experienceLevel,
        ...(profileMode ? { resumeAnalysisId: resumeIdentity.resumeAnalysisId } : {}),
      },
    });

    res.json(scoredResult);
  } catch (error) {
    console.error('Portfolio Score Error:', error.message);
    res.status(500).json({ message: 'Failed to calculate portfolio score.' });
  }
};

module.exports = { getPortfolioReadiness };
