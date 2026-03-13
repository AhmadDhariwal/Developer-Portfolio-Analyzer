/**
 * Prompt template for role-based skill gap analysis.
 * Compares detected skills against a specific career target.
 */
const getSkillGapPrompt = (targetRole, detectedSkills) => {
  return `
    Analyze the following developer skills against the requirements for a "${targetRole}".
    
    Detected Skills:
    ${JSON.stringify(detectedSkills, null, 2)}
    
    Return a structured JSON object with:
    1. "yourSkills": Array of objects { "name": string, "category": string, "proficiency": number (0-100) }
    2. "missingSkills": Array of objects { "name": string, "category": string, "priority": "High"|"Medium"|"Low", "jobDemand": number (0-100) }
    3. "coverage": Percentage (0-100) of skills the user has for this role.
    4. "missing": Percentage (0-100) of skills the user is missing.
    5. "roadmap": Array of 3-4 objects { "phase": string, "title": string, "description": string, "duration": string, "skills": string[], "resources": string[], "color": "purple"|"blue"|"green"|"orange" }
    6. "totalWeeks": Total estimated time (e.g. "12-16 weeks")

    Ensure the response is ONLY valid JSON.
  `;
};

module.exports = { getSkillGapPrompt };
