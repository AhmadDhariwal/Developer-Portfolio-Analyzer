/**
 * Prompt template for GitHub profile quality evaluation.
 */
const getGitHubPrompt = (githubData) => {
  return `
    Analyze the following GitHub profile data for a developer. Evaluate code quality, repo complexity, and originality.
    
    GitHub Data:
    ${JSON.stringify(githubData, null, 2)}
    
    Return a structured JSON object with:
    1. "developerLevel": "Beginner", "Intermediate", or "Advanced".
    2. "strengths": Array of high-level technical strengths (e.g., "Modular architecture", "Consistent API design").
    3. "weakAreas": Array of areas for improvement (e.g., "Low test coverage", "Lack of documentation").
    4. "scores": { "codeQuality": number (0-100), "projectDiversity": number (0-100), "originality": number (0-100) }.
    5. "explanation": A qualitative summary of why these scores were assigned.
    
    Ensure the response is ONLY valid JSON.
  `;
};

module.exports = { getGitHubPrompt };
