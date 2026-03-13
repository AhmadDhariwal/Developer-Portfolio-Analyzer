const { analyzeGitHubProfile } = require('../services/githubservice');
const aiService = require('../services/aiservice');
const { getSkillGapPrompt } = require('../prompts/skillGapPrompt');
const AnalysisCache = require('../models/analysisCache');
const crypto = require('crypto');

/**
 * @desc  Analyze skill gap for a target role
 * @route POST /api/analysis/skill-gap
 */
const analyzeSkillGap = async (req, res) => {
  try {
    let { username, targetRole, resumeText } = req.body;
    
    if (!username || !targetRole) {
      return res.status(400).json({ message: 'Username and Target Role are required.' });
    }

    // Try to get resume text from latest analysis if not provided
    if (!resumeText && req.user) {
        const Analysis = require('../models/analysis');
        const analysis = await Analysis.findOne({ userId: req.user._id });
        resumeText = analysis?.resumeText || "";
    }

    // Generate cache key components
    const cleanResume = (resumeText || "").trim();
    const resumeHash = crypto.createHash('sha256').update(cleanResume).digest('hex');

    // Check Cache
    const cached = await AnalysisCache.findOne({ 
        githubUsername: username, 
        targetRole, 
        resumeHash 
    });
    
    if (cached) {
        return res.json({ ...cached.analysisData, fromCache: true });
    }

    // Fetch Base Data
    const githubData = await analyzeGitHubProfile(username.trim());
    
    // Construct AI Prompt
    const detectedSkills = {
        github: githubData.repositories.map(r => `${r.name} (${r.language})`),
        repoQuality: githubData.scores
    };

    const prompt = getSkillGapPrompt(targetRole, detectedSkills);
    const fallback = {
        yourSkills: [],
        missingSkills: [],
        coverage: 50,
        missing: 50,
        roadmap: [],
        totalWeeks: "N/A"
    };

    const aiResult = await aiService.runAIAnalysis(prompt, fallback);

    const fullResult = {
        username,
        targetRole,
        ...aiResult,
        coverage: Number(aiResult.coverage || 0),
        missing: Number(aiResult.missing || 0),
        githubStats: githubData
    };

    // Store in Cache (if user logged in)
    if (req.user) {
        await AnalysisCache.findOneAndUpdate(
            { githubUsername: username, targetRole, resumeHash },
            { $set: { analysisData: fullResult, userId: req.user._id } },
            { upsert: true }
        );
    }

    res.json(fullResult);

  } catch (error) {
    console.error('Skill Gap Error Details:', {
        message: error.message,
        stack: error.stack,
        username: req.body?.username
    });
    res.status(500).json({ 
        message: 'Analysis failed. This usually happens if the GitHub profile is private or the AI is overloaded. Please try again in 30 seconds.',
        error: error.message 
    });
  }
};

module.exports = { analyzeSkillGap };

