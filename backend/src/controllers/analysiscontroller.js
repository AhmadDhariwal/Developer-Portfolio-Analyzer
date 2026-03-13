const aiService = require('../services/aiservice');
const { getPortfolioScorePrompt } = require('../prompts/portfolioScorePrompt');
const AnalysisCache = require('../models/analysisCache');
const crypto = require('crypto');

/**
 * @desc  Get overall portfolio strength score (Readiness Score)
 * @route POST /api/analysis/portfolio-score
 */
const getPortfolioReadiness = async (req, res) => {
  try {
    let { username, targetRole, resumeAnalysis, githubAnalysis, resumeText } = req.body;

    if (!username || !targetRole) {
      return res.status(400).json({ message: 'Username and Target Role are required.' });
    }

    // Try to recover missing analysis data
    if (!resumeAnalysis || !githubAnalysis) {
        // 1. Check Cache first
        const existing = await AnalysisCache.findOne({ githubUsername: username, targetRole });
        if (existing && existing.analysisData.portfolioScore) {
            return res.json({ ...existing.analysisData.portfolioScore, fromCache: true });
        }

        // 2. Fetch fresh data if needed
        const { analyzeGitHubProfile } = require('../services/githubservice');
        const resumeService = require('../services/resumeservice');
        
        if (!githubAnalysis) {
            githubAnalysis = await analyzeGitHubProfile(username.trim());
        }
        
        if (!resumeAnalysis) {
            // Find the user's latest resume analysis
            if (req.user) {
                const analysisDoc = await require('../models/analysis').findOne({ userId: req.user._id });
                if (analysisDoc) {
                    resumeAnalysis = {
                        skills: Array.from(analysisDoc.languageDistribution?.keys() || []),
                        strengths: ["Detailed experience"], // Fallback traits
                        weaknesses: []
                    };
                }
            }
            // If still no resume, use an empty placeholder
            resumeAnalysis = resumeAnalysis || { skills: [], strengths: [], weaknesses: [] };
        }
    }

    // Cache lookup
    const cleanResume = (resumeText || "").trim();
    const resumeHash = crypto.createHash('sha256').update(cleanResume).digest('hex');
    const cacheKey = { githubUsername: username, targetRole, resumeHash };

    const cached = await AnalysisCache.findOne(cacheKey);
    if (cached && cached.analysisData.portfolioScore) {
        return res.json({ ...cached.analysisData.portfolioScore, fromCache: true });
    }

    // AI Score Generation
    const prompt = getPortfolioScorePrompt(resumeAnalysis, githubAnalysis, targetRole);
    const fallback = {
        overallScore: 70,
        breakdown: { codeQuality: 70, skillCoverage: 70, industryReadiness: 70, projectImpact: 70 },
        summary: "Solid portfolio with room for improvement in niche areas."
    };

    const aiResult = await aiService.runAIAnalysis(prompt, fallback);

    // Update Cache
    if (req.user) {
        await AnalysisCache.findOneAndUpdate(
            cacheKey,
            { $set: { "analysisData.portfolioScore": aiResult } },
            { upsert: true }
        );
    }

    res.json(aiResult);

  } catch (error) {
    console.error('Portfolio Score Error:', error.message);
    res.status(500).json({ message: 'Failed to calculate portfolio score.' });
  }
};

module.exports = { getPortfolioReadiness };
