const { compactJson } = require('../services/promptBuilderService');

const getGitHubPrompt = (githubData) => {
  const compactSignals = compactJson(githubData, 0);
  return `
    Analyze the following compressed GitHub profile signals for a developer.
    The numeric scores are already calculated deterministically by the backend.
    Do not invent or recalculate scores.
    
    Compressed GitHub Signals:
    ${compactSignals}
    
    Use the supplied facts only as grounding. Generate narrative text only.
    Return a structured JSON object with:
    1. "strengths": Array of 3-6 recruiter-friendly technical strengths.
    2. "weakAreas": Array of 3-6 specific improvement areas.
    3. "summary": A concise recruiter-friendly profile summary.
    4. "explanation": A concise explanation of the deterministic score drivers.
    
    Ensure the response is ONLY valid JSON.
  `;
};

module.exports = { getGitHubPrompt };
