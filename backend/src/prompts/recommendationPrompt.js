const { getExperienceConfig } = require('../utils/experienceMapper');

/**
 * Recommendation prompt — context-aware with strict difficulty and new-tech rules.
 * @param {string}   careerStack
 * @param {string}   experienceLevel
 * @param {string[]} knownSkills  — from GitHub + resume
 * @param {string[]} missingSkills — from skill gap analysis
 * @param {object}   resumeInsights
 * @param {object}   githubInsights
 */
const getRecommendationPrompt = (careerStack, experienceLevel, knownSkills, missingSkills, resumeInsights = {}, githubInsights = {}) => {
  const config = getExperienceConfig(experienceLevel);

  return `
    You are a senior software engineering mentor.
    Generate a personalised project roadmap for this developer:

    Career Stack:     "${careerStack}"
    Experience Level: "${experienceLevel}"
    Known Skills:     ${JSON.stringify(knownSkills)}
    Skill Gaps:       ${JSON.stringify(missingSkills)}
    Resume Insights:  ${JSON.stringify(resumeInsights)}
    GitHub Insights:  ${JSON.stringify(githubInsights)}

    STRICT RULES — you MUST follow ALL of these:
    1. Every project MUST primarily use technologies from "Known Skills".
    2. Each project MAY introduce AT MOST ${config.maxNewTechs} technology from "Skill Gaps" — never more.
    3. Project difficulty MUST only be: ${config.difficultyRange.join(' or ')}.
    4. Generate at least ${Math.max(3, config.projectCount)} projects.
    5. Complexity target: ${config.complexityHint}.
    6. Tech depth goal:   ${config.techDepth}.
    7. Do NOT list technologies the developer already knows as "new technologies to learn".
    8. Return at least 6 technologies in the technologies array.
    9. Return at least 3 career paths in the careerPaths array.

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
          "whyThisProject": string,
          "startUrl":       string (must be a valid https URL)
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
          "actionItems":     string[],
          "exploreUrl":      string (must be a valid https URL)
        }
      ]
    }

    Salary ranges must be realistic for: ${config.salaryContext}.
  `;
};

module.exports = { getRecommendationPrompt };
