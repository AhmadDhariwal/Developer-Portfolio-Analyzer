const getGitHubPrompt = (githubData) => {
  return `
    Analyze the following compressed GitHub profile signals for a developer.
    The numeric scores are already calculated deterministically by the backend.
    Do not invent or recalculate scores.
    
    Compressed GitHub Signals:
    ${JSON.stringify(githubData, null, 2)}
    
    Return a structured JSON object with:
    1. "developerLevel": "Beginner", "Intermediate", or "Advanced".
    2. "strengths": Array of 3-6 recruiter-friendly technical strengths.
    3. "weakAreas": Array of 3-6 specific improvement areas.
    4. "summary": A concise recruiter-friendly profile summary.
    5. "explanation": A concise explanation of the deterministic score drivers.
    
    Ensure the response is ONLY valid JSON.
  `;
};

module.exports = { getGitHubPrompt };
