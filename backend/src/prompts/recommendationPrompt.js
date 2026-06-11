const { getExperienceConfig } = require('../utils/experienceMapper');

/**
 * Recommendation prompt - context-aware with strict difficulty and new-tech rules.
 * The caller must pass summarized reusable signals only. Do not pass raw GitHub
 * repositories, raw resume text, or full skill-gap analysis payloads here.
 * @param {string} careerStack
 * @param {string} experienceLevel
 * @param {string[]} knownSkills
 * @param {string[]} missingSkills
 * @param {object} resumeInsights
 * @param {object} githubInsights
 * @param {object} developerSignals
 */
const getRecommendationPrompt = (
  careerStack,
  experienceLevel,
  knownSkills,
  missingSkills,
  resumeInsights = {},
  githubInsights = {},
  developerSignals = {}
) => {
  const config = getExperienceConfig(experienceLevel);

  return `
    You are a senior software engineering mentor.
    Generate a personalised, evidence-based recommendation plan for this developer.

    Career Stack:     "${careerStack}"
    Experience Level: "${experienceLevel}"
    Known Skills:     ${JSON.stringify(knownSkills)}
    Skill Gaps:       ${JSON.stringify(missingSkills)}
    Resume Signals Summary:  ${JSON.stringify(resumeInsights)}
    GitHub Signals Summary:  ${JSON.stringify(githubInsights)}
    Developer Signals Summary:${JSON.stringify(developerSignals)}

    STRICT RULES - you MUST follow ALL of these:
    1. Every project MUST primarily use technologies from "Known Skills".
    2. Each project MAY introduce AT MOST ${config.maxNewTechs} technology from "Skill Gaps" - never more.
    3. Project difficulty MUST only be: ${config.difficultyRange.join(' or ')}.
    4. Generate at least ${Math.max(3, config.projectCount)} projects.
    5. Complexity target: ${config.complexityHint}.
    6. Tech depth goal: ${config.techDepth}.
    7. Do NOT list technologies the developer already knows as "new technologies to learn".
    8. Return at least 6 technologies in the technologies array.
    9. Return at least 3 career paths in the careerPaths array.
    10. Recommendations MUST adapt to progress signals:
        - If weekly progress or sprint consistency is low, prefer smaller, practical next steps.
        - If portfolio completeness is low, include portfolio improvement actions.
        - If integration proof is weak (GitHub, LinkedIn, LeetCode, Kaggle, StackOverflow, certifications), recommend proof-building actions.
        - If repeated weak areas show up across signals, reflect them in technology and learning actions.
    11. Use portfolio and integration signals only as supporting evidence. Do not treat them as stronger than GitHub plus resume.
    12. Avoid generic filler. Every recommendation should connect to a real signal from the input.
    13. Keep the tone specific, realistic, and recruiter-useful.
    14. Do NOT infer by re-analyzing raw resume text or raw GitHub repositories; those are intentionally unavailable.
    15. Use AI only for prioritization, explanation, roadmap wording, and career strategy. Deterministic platform scoring will happen outside this prompt.

    Return ONLY valid JSON (no markdown, no code fences):

    {
      "analysisSummary": string,
      "projects": [
        {
          "id": string,
          "title": string,
          "description": string,
          "tech": string[],
          "newTech": string[],
          "difficulty": "${config.difficultyRange.join('" | "')}",
          "impact": number (0-100),
          "estimatedWeeks": string,
          "whyThisProject": string,
          "startUrl": string (must be a valid https URL)
        }
      ],
      "technologies": [
        {
          "name": string,
          "category": string,
          "priority": string,
          "priorityRaw": "High" | "Medium" | "Low",
          "jobDemand": number (0-100),
          "description": string
        }
      ],
      "careerPaths": [
        {
          "id": string,
          "title": string,
          "match": number (0-100),
          "salaryRange": string,
          "description": string,
          "timeline": string,
          "hiringCompanies": string[],
          "actionItems": string[],
          "exploreUrl": string (must be a valid https URL)
        }
      ],
      "portfolioRecommendations": [string],
      "resumeRecommendations": [string],
      "learningActions": [string],
      "interviewReadinessActions": [string]
    }

    ACTION ARRAY RULES:
    - portfolioRecommendations: 2-4 concise actions
    - resumeRecommendations: 2-4 concise actions
    - learningActions: 3-6 concise actions
    - interviewReadinessActions: 2-4 concise actions
    - analysisSummary: 2-3 sentences summarizing how GitHub, resume, and developer signals influence the recommendation set

    IMPORTANT:
    - If a signal source is missing, continue with the remaining evidence.
    - Do not generate sprint tasks, weekly reports, or portfolio content ownership.
    - Focus on recommendations only.

    Salary ranges must be realistic for: ${config.salaryContext}.
  `;
};

module.exports = { getRecommendationPrompt };
