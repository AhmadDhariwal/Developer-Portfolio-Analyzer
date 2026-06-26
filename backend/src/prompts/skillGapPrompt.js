/**
 * Skill gap prompt - receives careerStack + experienceLevel so the AI
 * can distinguish which gaps are current-level priorities vs future concerns.
 */
const getSkillGapPrompt = (
  careerStack,
  experienceLevel,
  detectedSkills,
  resumeInsights = {},
  githubInsights = {},
  developerSignals = {}
) => {
  const compactContext = {
    profile: { careerStack, experienceLevel },
    skills: detectedSkills,
    resume: resumeInsights,
    github: githubInsights,
    signals: developerSignals
  };

  return `You are a senior engineering career coach. Use only the compact evidence below; do not invent unsupported skills.

CONTEXT_JSON:
${JSON.stringify(compactContext)}

Return ONLY valid JSON with this shape:
{
  "analysisSummary": string,
  "yourSkills": [{"name": string, "category": string, "proficiency": number, "isFoundational": boolean}],
  "missingSkills": [{"name": string, "category": string, "priority": "High"|"Medium"|"Low", "jobDemand": number, "levelRelevance": "Current"|"Next Level"|"Advanced"}],
  "coverage": number,
  "missing": number,
  "levelAssessment": string,
  "roadmap": [{"phase": string, "title": string, "description": string, "duration": string, "skills": string[], "resources": [{"title": string, "url": string}], "color": "purple"|"blue"|"green"|"orange"}],
  "totalWeeks": string
}

Rules:
- Prioritize GitHub + resume proof; portfolio, sprint, weekly reports, integrations, and jobs are supporting signals.
- Use only real technical skills from the provided evidence and target profile.
- Calibrate priority for ${careerStack} at ${experienceLevel}; repeated weak/incomplete signals raise urgency.
- Return at least 6 current skills, 12 missing skills, 3 roadmap phases, and keep coverage + missing near 100.
- Roadmap resources must be valid https URLs.`;
};

module.exports = { getSkillGapPrompt };
