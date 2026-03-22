/**
 * Skill gap prompt — receives careerStack + experienceLevel so the AI
 * can distinguish which gaps are current-level priorities vs future concerns.
 */
const getSkillGapPrompt = (careerStack, experienceLevel, detectedSkills, resumeInsights = {}, githubInsights = {}) => {
  return `
    You are a senior engineering career coach.
    Analyze the skill gap for a developer with the following profile:

    Career Stack:              "${careerStack}"
    Experience Level:          "${experienceLevel}"
    GitHub Repos/Languages:    ${JSON.stringify(detectedSkills.github, null, 2)}
    Repo Quality Signals:      ${JSON.stringify(detectedSkills.repoQuality, null, 2)}
    Resume Insights:           ${JSON.stringify(resumeInsights, null, 2)}
    GitHub Summary:            ${JSON.stringify(githubInsights, null, 2)}

    Return ONLY valid JSON (no markdown, no code fences) with this exact structure:

    {
      "yourSkills": [
        {
          "name": string,
          "category": string,
          "proficiency": number (0-100),
          "isFoundational": boolean
        }
      ],
      "missingSkills": [
        {
          "name": string,
          "category": string,
          "priority": "High" | "Medium" | "Low",
          "jobDemand": number (0-100),
          "levelRelevance": "Current" | "Next Level" | "Advanced"
        }
      ],
      "coverage": number (0-100),
      "missing":  number (0-100),
      "levelAssessment": string (2-3 sentences assessing readiness relative to "${experienceLevel}" level expectations for "${careerStack}"),
      "roadmap": [
        {
          "phase":       string,
          "title":       string,
          "description": string,
          "duration":    string,
          "skills":      string[],
          "resources":   [
            {
              "title": string,
              "url": string (must be a valid https URL)
            }
          ],
          "color":       "purple" | "blue" | "green" | "orange"
        }
      ],
      "totalWeeks": string
    }

    Field rules:
    - Use BOTH resume and GitHub signals. Do not ignore either source.
    - "isFoundational": true if the skill is core to "${careerStack}" at any level.
    - "levelRelevance":
        "Current"    = this gap needs to be closed NOW at "${experienceLevel}"
        "Next Level" = needed to advance one step up from "${experienceLevel}"
        "Advanced"   = only relevant at senior/staff level
    - Calibrate "priority" relative to "${experienceLevel}" expectations, not absolute industry standards.
    - Return at least 6 items in "yourSkills" and at least 12 items in "missingSkills".
    - Return at least 3 phases in "roadmap" with practical milestones.
    - Every roadmap phase must include at least 2 resources and each resource URL must be directly clickable.
    - Ensure coverage + missing is approximately 100.
  `;
};

module.exports = { getSkillGapPrompt };
