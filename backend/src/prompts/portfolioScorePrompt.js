/**
 * Prompt template for overall Portfolio Strength Scoring.
 */
const getPortfolioScorePrompt = (resumeAnalysis, githubAnalysis, targetRole) => {
  return `
    Generate a final Portfolio Strength Score for a developer targeting the "${targetRole}" role, based on their resume and GitHub profile.
    
    Resume Analysis: ${JSON.stringify(resumeAnalysis)}
    GitHub Analysis: ${JSON.stringify(githubAnalysis)}
    
    Return a structured JSON object with:
    1. "overallScore": number (0-100).
    2. "breakdown": {
       "codeQuality": number (0-100),
       "skillCoverage": number (0-100),
       "industryReadiness": number (0-100),
       "projectImpact": number (0-100)
    }.
    3. "summary": A brief 1-2 sentence professional summary of the portfolio.
    
    Ensure the response is ONLY valid JSON.
  `;
};

module.exports = { getPortfolioScorePrompt };
