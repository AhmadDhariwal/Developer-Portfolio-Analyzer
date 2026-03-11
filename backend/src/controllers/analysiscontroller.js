const Analysis = require('../models/analysis');
const { calculateDeveloperScore } = require('../utils/scorecalculator');
const { detectSkillGaps } = require('../utils/skilldetector');
const { generateRecommendations } = require('../services/analysisservice');

// @desc    Get complete developer analysis and score
// @route   GET /api/analysis
// @access  Private
const getAnalysis = async (req, res) => {
    try {
        let analysis = await Analysis.findOne({ userId: req.user._id });

        if (!analysis) {
            return res.status(404).json({ message: 'No analysis found. Please analyze GitHub and upload Resume first.' });
        }

        // Combine GitHub score and Skill score into Readiness Score (50/50 weighting)
        const githubScore = analysis.githubScore || 0;
        const skillScore = analysis.skillScore || 0;

        analysis.readinessScore = Math.round((githubScore * 0.5) + (skillScore * 0.5));

        // Detect missing skills using an assumed current skillset (since PRD model didn't store current user skills)
        // For demo accuracy, we will pass empty if they have no skillScore, or some mock data
        const currentSkills = skillScore > 0 ? ['JavaScript', 'HTML', 'CSS'] : []; // Placeholder
        const { missingSkills } = detectSkillGaps(currentSkills);

        analysis.missingSkills = missingSkills;
        analysis.recommendations = generateRecommendations(missingSkills, analysis.readinessScore);

        await analysis.save();

        res.json({
            githubScore: analysis.githubScore,
            skillScore: analysis.skillScore,
            readinessScore: analysis.readinessScore,
            missingSkills: analysis.missingSkills,
            recommendations: analysis.recommendations,
            githubStats: analysis.githubStats,
            languageDistribution: analysis.languageDistribution,
            contributionActivity: analysis.contributionActivity
        });
    } catch (error) {
        console.error('Analysis Engine Error:', error);
        res.status(500).json({ message: 'Server Error generating analysis' });
    }
};

module.exports = { getAnalysis };
