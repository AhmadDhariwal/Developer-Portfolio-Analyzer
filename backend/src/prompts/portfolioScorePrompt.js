/**
 * Prompt template for overall Portfolio Strength Scoring.
 * Scores are calibrated against level expectations, not absolute industry standards.
 */
const getPortfolioScorePrompt = (resumeAnalysis, githubAnalysis, careerStack, experienceLevel) => {
  return `
    You are a technical hiring manager.
    Score this developer's portfolio readiness.

    Career Stack:    "${careerStack}"
    Experience Level:"${experienceLevel}"

    Resume Analysis: ${JSON.stringify(resumeAnalysis)}
    GitHub Analysis: ${JSON.stringify(githubAnalysis)}

    IMPORTANT: Calibrate ALL scores relative to typical expectations for a
    "${experienceLevel}" developer targeting "${careerStack}" roles.
    A Student is not expected to have the same depth as a 3-5 years developer.

    Return ONLY valid JSON (no markdown, no code fences):

    {
      "overallScore": number (0-100),
      "breakdown": {
        "codeQuality":       number (0-100),
        "skillCoverage":     number (0-100),
        "industryReadiness": number (0-100),
        "projectImpact":     number (0-100)
      },
      "summary": string (2-3 sentences of level-calibrated feedback)
    }
  `;
};

module.exports = { getPortfolioScorePrompt };
