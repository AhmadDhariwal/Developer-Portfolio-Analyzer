const { getExperienceConfig } = require('../utils/experienceMapper');

/**
 * Recommendation prompt — context-aware with strict difficulty and new-tech rules.
 * @param {string}   careerStack
 * @param {string}   experienceLevel
 * @param {string[]} knownSkills  — from GitHub + resume
 * @param {string[]} missingSkills — from skill gap analysis
 */
const getRecommendationPrompt = (careerStack, experienceLevel, knownSkills, missingSkills) => {
  const config = getExperienceConfig(experienceLevel);

  return `
    You are a senior software engineering mentor.
    Generate a personalised project roadmap for this developer:

    Career Stack:     "${careerStack}"
    Experience Level: "${experienceLevel}"
    Known Skills:     ${JSON.stringify(knownSkills)}
    Skill Gaps:       ${JSON.stringify(missingSkills)}

    STRICT RULES — you MUST follow ALL of these:
    1. Every project MUST primarily use technologies from "Known Skills".
    2. Each project MAY introduce AT MOST ${config.maxNewTechs} technology from "Skill Gaps" — never more.
    3. Project difficulty MUST only be: ${config.difficultyRange.join(' or ')}.
    4. Generate exactly ${config.projectCount} projects.
    5. Complexity target: ${config.complexityHint}.
    6. Tech depth goal:   ${config.techDepth}.
    7. Do NOT list technologies the developer already knows as "new technologies to learn".

    Return ONLY valid JSON (no markdown, no code fences):

    {
      "projects": [
        {
          "id":             string,
          "title":          string,
          "description":    string,
          "tech":           string[],
          "newTech":        string[],
          "difficulty":     "${config.difficultyRange.join('" | "')}",
          "impact":         number (0-100),
          "estimatedWeeks": string,
          "whyThisProject": string
        }
      ],
      "technologies": [
        {
          "name":        string,
          "category":    string,
          "priority":    string,
          "priorityRaw": "High" | "Medium" | "Low",
          "jobDemand":   number (0-100),
          "description": string
        }
      ],
      "careerPaths": [
        {
          "id":              string,
          "title":           string,
          "match":           number (0-100),
          "salaryRange":     string,
          "description":     string,
          "timeline":        string,
          "hiringCompanies": string[],
          "actionItems":     string[]
        }
      ]
    }

    Salary ranges must be realistic for: ${config.salaryContext}.
  `;
};

module.exports = { getRecommendationPrompt };
