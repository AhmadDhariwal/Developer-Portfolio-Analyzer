/**
 * Prompt template for step-by-step learning roadmap generation.
 */
const getRecommendationPrompt = (targetRole, gaps) => {
  return `
    Based on the following skill gaps for a "${targetRole}" position, generate a personalized step-by-step learning roadmap.
    
    Skill Gaps:
    ${JSON.stringify(gaps, null, 2)}
    
    Return a structured JSON object with:
    1. "projects": Array of objects { "id": string, "title": string, "description": string, "tech": string[], "difficulty": "Beginner"|"Intermediate"|"Advanced", "impact": number (0-100), "estimatedWeeks": string }
    2. "technologies": Array of objects { "name": string, "category": string, "priority": string, "priorityRaw": "High"|"Medium"|"Low", "jobDemand": number (0-100), "description": string }
    3. "careerPaths": Array of objects { "id": string, "title": string, "match": number (0-100), "salaryRange": string, "description": string, "timeline": string, "hiringCompanies": string[], "actionItems": string[] }

    Ensure the response is ONLY valid JSON.
  `;
};

module.exports = { getRecommendationPrompt };
