const { analyzeGitHubProfile } = require('../services/githubservice');
const aiService = require('../services/aiservice');
const { getSkillGapPrompt } = require('../prompts/skillGapPrompt');
const AnalysisCache = require('../models/analysisCache');
const crypto = require('crypto');

/**
 * @desc  Analyze skill gap using the user's global career profile
 * @route POST /api/skillgap/skill-gap
 */
const analyzeSkillGap = async (req, res) => {
  try {
    let { username, resumeText } = req.body;

    // Career profile: prefer the authenticated user's saved profile, allow body override
    const careerStack     = req.user?.careerStack     || req.body.careerStack     || 'Full Stack';
    const experienceLevel = req.user?.experienceLevel || req.body.experienceLevel || 'Student';

    if (!username) {
      return res.status(400).json({ message: 'Username is required.' });
    }

    // Attempt to recover resumeText from persisted analysis
    if (!resumeText && req.user) {
      const Analysis = require('../models/analysis');
      const analysis = await Analysis.findOne({ userId: req.user._id });
      resumeText = analysis?.resumeText || '';
    }

    const cleanResume = (resumeText || '').trim();
    const resumeHash  = crypto.createHash('sha256').update(cleanResume).digest('hex');
    const cacheKey    = { githubUsername: username, careerStack, experienceLevel, resumeHash };

    // Cache lookup
    const cached = await AnalysisCache.findOne(cacheKey);
    if (cached) {
      return res.json({ ...cached.analysisData, fromCache: true });
    }

    // Fetch GitHub data
    const githubData     = await analyzeGitHubProfile(username.trim());
    const detectedSkills = {
      github:      githubData.repositories.map(r => `${r.name} (${r.language})`),
      repoQuality: githubData.scores
    };

    const prompt = getSkillGapPrompt(careerStack, experienceLevel, detectedSkills);
    const fallback = {
      yourSkills:      [],
      missingSkills:   [],
      coverage:        50,
      missing:         50,
      levelAssessment: '',
      roadmap:         [],
      totalWeeks:      'N/A'
    };

    const aiResult = await aiService.runAIAnalysis(prompt, fallback);

    const fullResult = {
      username,
      careerStack,
      experienceLevel,
      ...aiResult,
      coverage:    Number(aiResult.coverage || 0),
      missing:     Number(aiResult.missing  || 0),
      githubStats: githubData
    };

    if (req.user) {
      await AnalysisCache.findOneAndUpdate(
        cacheKey,
        { $set: { analysisData: fullResult, userId: req.user._id } },
        { upsert: true, new: true }
      );
    }

    res.json(fullResult);

  } catch (error) {
    console.error('Skill Gap Error:', { message: error.message, username: req.body?.username });
    res.status(500).json({
      message: 'Analysis failed. GitHub profile may be private or AI is overloaded. Try again in 30 seconds.',
      error: error.message
    });
  }
};

module.exports = { analyzeSkillGap };

