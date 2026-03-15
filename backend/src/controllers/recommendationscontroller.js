const aiService = require('../services/aiservice');
const { getRecommendationPrompt } = require('../prompts/recommendationPrompt');
const AnalysisCache = require('../models/analysisCache');
const crypto = require('crypto');

/**
 * @desc  Generate personalised roadmap and project suggestions
 * @route POST /api/recommendations
 */
const getRecommendations = async (req, res) => {
  try {
    let { username, missingSkills, knownSkills, resumeText } = req.body;

    // Career profile: prefer the authenticated user's saved profile, allow body override
    const careerStack     = req.user?.careerStack     || req.body.careerStack     || 'Full Stack';
    const experienceLevel = req.user?.experienceLevel || req.body.experienceLevel || 'Student';

    if (!username) {
      return res.status(400).json({ message: 'Username is required.' });
    }

    // Resolve missingSkills and knownSkills if not supplied by the client
    if (!missingSkills || !knownSkills) {
      const { analyzeGitHubProfile } = require('../services/githubservice');
      const { getSkillGapPrompt }    = require('../prompts/skillGapPrompt');

      const cleanResume = (resumeText || '').trim();
      const lookupHash  = resumeText
        ? crypto.createHash('sha256').update(cleanResume).digest('hex')
        : 'no-resume';

      // Check cache for an existing skill gap result first
      const cachedGap = await AnalysisCache.findOne({
        githubUsername: username, careerStack, experienceLevel, resumeHash: lookupHash
      });

      if (cachedGap?.analysisData?.missingSkills) {
        missingSkills = missingSkills || cachedGap.analysisData.missingSkills.map(s => s.name || s);
        knownSkills   = knownSkills   || (cachedGap.analysisData.yourSkills?.map(s => s.name || s) ?? []);
      } else {
        // Run an on-the-fly gap analysis to get both lists
        const githubData     = await analyzeGitHubProfile(username.trim());
        const detectedSkills = {
          github:      githubData.repositories.map(r => `${r.name} (${r.language})`),
          repoQuality: githubData.scores
        };
        const gapPrompt = getSkillGapPrompt(careerStack, experienceLevel, detectedSkills);
        const gapResult = await aiService.runAIAnalysis(gapPrompt, { missingSkills: [], yourSkills: [] });

        missingSkills = missingSkills || (gapResult.missingSkills?.map(s => s.name || s) ?? []);
        knownSkills   = knownSkills   || (gapResult.yourSkills?.map(s => s.name || s)   ?? []);
      }
    }

    const cleanResume = (resumeText || '').trim();
    const resumeHash  = resumeText
      ? crypto.createHash('sha256').update(cleanResume).digest('hex')
      : 'no-resume';
    const cacheKey = { githubUsername: username, careerStack, experienceLevel, resumeHash };

    // Check cache for existing recommendations
    const cached = await AnalysisCache.findOne(cacheKey);
    if (cached?.analysisData?.projects) {
      return res.json({ ...cached.analysisData, fromCache: true });
    }

    // AI generation — pass both known and missing skills so the prompt enforces rules
    const prompt = getRecommendationPrompt(careerStack, experienceLevel, knownSkills, missingSkills);
    const fallback = {
      projects: [{
        id: '1', title: 'Personal Portfolio', description: 'Build a modern portfolio',
        tech: ['HTML', 'CSS', 'JavaScript'], newTech: [], difficulty: 'Beginner',
        impact: 80, estimatedWeeks: '2-3 weeks',
        whyThisProject: 'Great starting point to showcase skills.'
      }],
      technologies: [{
        name: 'Git', category: 'Version Control', priority: 'Must Learn',
        priorityRaw: 'High', jobDemand: 95, description: 'Essential for collaboration'
      }],
      careerPaths: [{
        id: 'c1', title: careerStack, match: 70, salaryRange: 'Varies',
        description: 'Your target career path', timeline: '6-12 months',
        hiringCompanies: [], actionItems: []
      }]
    };

    const aiResult = await aiService.runAIAnalysis(prompt, fallback);

    const fullResult = { username, careerStack, experienceLevel, ...aiResult };

    if (req.user) {
      await AnalysisCache.findOneAndUpdate(
        cacheKey,
        {
          $set: {
            'analysisData.projects':     aiResult.projects,
            'analysisData.technologies': aiResult.technologies,
            'analysisData.careerPaths':  aiResult.careerPaths,
            userId:                      req.user._id
          }
        },
        { upsert: true }
      );
    }

    res.json(fullResult);

  } catch (error) {
    console.error('Recommendations Error:', error.message);
    res.status(500).json({ message: 'Failed to generate recommendations.' });
  }
};

module.exports = { getRecommendations };

