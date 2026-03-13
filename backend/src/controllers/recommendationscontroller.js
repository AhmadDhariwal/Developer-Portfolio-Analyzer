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
    let { username, targetRole, missingSkills, resumeText } = req.body;

    if (!username || !targetRole) {
      return res.status(400).json({ message: 'Username and Target Role are required.' });
    }

    // Try to recover missingSkills and resumeText if not provided (e.g. direct page access)
    if (!missingSkills) {
        // 1. Check Cache first
        const existing = await AnalysisCache.findOne({ githubUsername: username, targetRole });
        if (existing && existing.analysisData.missingSkills) {
            missingSkills = existing.analysisData.missingSkills;
            resumeText = resumeText || existing.resumeHash;
        } else {
            // 2. If no cache, perform a quick on-the-fly gap analysis to get the 'missingSkills'
            const { analyzeGitHubProfile } = require('../services/githubservice');
            const { getSkillGapPrompt } = require('../prompts/skillGapPrompt');
            
            const githubData = await analyzeGitHubProfile(username.trim());
            const detectedSkills = {
                github: githubData.repositories.map(r => `${r.name} (${r.language})`),
                repoQuality: githubData.scores
            };
            const gapPrompt = getSkillGapPrompt(targetRole, detectedSkills);
            
            // Minimal fallback for the gap sub-call
            const gapFallback = { missingSkills: ["Docker", "Testing", "Cloud"] };
            const gapResult = await aiService.runAIAnalysis(gapPrompt, gapFallback);
            missingSkills = gapResult.missingSkills || [];
        }
    }

    // Cache lookup for recommendations specifically
    const cleanResume = (resumeText || "").trim();
    const resumeHash = resumeText ? crypto.createHash('sha256').update(cleanResume).digest('hex') : "no-resume";
    const cacheKey = { githubUsername: username, targetRole, resumeHash };

    const cached = await AnalysisCache.findOne(cacheKey);
    if (cached && cached.analysisData.projects) {
        return res.json({ ...cached.analysisData, fromCache: true });
    }

    // AI Generation
    const prompt = getRecommendationPrompt(targetRole, missingSkills);
    const fallback = {
        projects: [
            { id: "1", title: "Personal Portfolio", description: "Build a modern portfolio", tech: ["HTML", "CSS"], difficulty: "Beginner", impact: 80 }
        ],
        technologies: [
            { name: "Git", category: "Version Control", priority: "Must Learn", priorityRaw: "High", jobDemand: 95, description: "Essential for collaboration" }
        ],
        careerPaths: [
            { id: "c1", title: targetRole, match: 70, salaryRange: "$50k - $80k", description: "Your target career path" }
        ]
    };

    const aiResult = await aiService.runAIAnalysis(prompt, fallback);

    const fullResult = {
        username,
        targetRole,
        ...aiResult
    };

    // Update Cache (Merge with existing gap analysis if any)
    if (req.user) {
        await AnalysisCache.findOneAndUpdate(
            cacheKey,
            { 
                $set: { 
                    "analysisData.projects": aiResult.projects, 
                    "analysisData.technologies": aiResult.technologies,
                    "analysisData.careerPaths": aiResult.careerPaths
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

