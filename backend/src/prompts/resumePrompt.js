/**
 * Prompt template for resume text analysis.
 * Extracts skills and experience with confidence scoring.
 */
const getResumePrompt = (resumeText) => {
  return `
    Analyze the following resume text. Extract technical skills, professional experience, and assign confidence levels to each extraction.
    
    Resume Text:
    ${resumeText}
    
    Return a structured JSON object with:
    1. "skills": Array of objects { "name": string, "category": string, "confidence": number (0-1) }.
    2. "experienceYears": Number indicating years of experience.
    3. "experienceLevel": "Junior", "Intermediate", or "Senior".
    4. "certifications": Array of strings.
    5. "keyAchievements": Array of strings summarizing impact.
    
    Ensure the response is ONLY valid JSON.
  `;
};

module.exports = { getResumePrompt };
