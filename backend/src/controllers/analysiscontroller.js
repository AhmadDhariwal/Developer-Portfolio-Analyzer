const aiService = require('../services/aiservice');
const { getPortfolioScorePrompt } = require('../prompts/portfolioScorePrompt');
const AnalysisCache = require('../models/analysisCache');
const crypto = require('crypto');
const { createVersion } = require('../services/aiVersionService');

const saveAIVersionSnapshot = async ({ req, source, output, metadata = {} }) => {
  if (!req.user?._id || !output || typeof output !== 'object') return;
  try {
    await createVersion({
      userId: req.user._id,
      source,
      outputJson: output,
      metadata
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
    username = username || req.user?.activeGithubUsername || req.user?.githubUsername;

    // Career profile: prefer the authenticated user's saved profile, allow body override
    const careerStack     = req.user?.careerStack     || req.body.careerStack     || 'Full Stack';
    const experienceLevel = req.user?.experienceLevel || req.body.experienceLevel || 'Student';

    if (!username) {
      return res.status(400).json({ message: 'Username is required.' });
    }

    const cleanResume = (resumeText || '').trim();
    const resumeHash  = crypto.createHash('sha256').update(cleanResume).digest('hex');
    const cacheKey    = { githubUsername: username, careerStack, experienceLevel, resumeHash };

    // Try cache first
    const cached = await AnalysisCache.findOne(cacheKey);
    if (cached?.analysisData?.portfolioScore) {
      const cachedResult = { ...cached.analysisData.portfolioScore, fromCache: true };
      await saveAIVersionSnapshot({
        req,
        source: 'portfolio_score',
        output: cachedResult,
        metadata: { fromCache: true, username, careerStack, experienceLevel }
      });
      return res.json(cachedResult);
    }

    // Fetch missing analysis data if not provided by client
    if (!githubAnalysis) {
      const { analyzeGitHubProfile } = require('../services/githubservice');
      githubAnalysis = await analyzeGitHubProfile(username.trim());
    }

    if (!resumeAnalysis && req.user) {
      const analysisDoc = await require('../models/analysis').findOne({ userId: req.user._id });
      resumeAnalysis = analysisDoc
        ? { skills: Array.from(analysisDoc.languageDistribution?.keys() || []), strengths: [], weaknesses: [] }
        : { skills: [], strengths: [], weaknesses: [] };
    }
    resumeAnalysis = resumeAnalysis || { skills: [], strengths: [], weaknesses: [] };

    // AI Score Generation
    const prompt = getPortfolioScorePrompt(resumeAnalysis, githubAnalysis, careerStack, experienceLevel);
    const fallback = {
      overallScore: 70,
      breakdown: { codeQuality: 70, skillCoverage: 70, industryReadiness: 70, projectImpact: 70 },
      summary: 'Solid portfolio with room for improvement in niche areas.'
    };

    const aiResult = await aiService.runAIAnalysis(prompt, fallback);

    if (req.user) {
      await AnalysisCache.findOneAndUpdate(
        cacheKey,
        { $set: { 'analysisData.portfolioScore': aiResult, userId: req.user._id } },
        { upsert: true }
      );
    }

    await saveAIVersionSnapshot({
      req,
      source: 'portfolio_score',
      output: aiResult,
      metadata: { fromCache: false, username, careerStack, experienceLevel }
    });

    res.json(aiResult);

  } catch (error) {
    console.error('Portfolio Score Error:', error.message);
    res.status(500).json({ message: 'Failed to calculate portfolio score.' });
  }
};

module.exports = { getPortfolioReadiness };
