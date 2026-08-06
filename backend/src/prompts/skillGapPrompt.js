/**
 * Skill gap prompt — narrative only.
 * Deterministic code owns skills, scores, rankings, coverage, and roadmaps.
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

  return `You are a senior engineering career coach. Write narrative only from the compact evidence below. Do not invent skills, scores, rankings, coverage, or roadmap phases.

CONTEXT_JSON:
${JSON.stringify(compactContext)}

Return ONLY valid JSON with this exact shape:
{
  "analysisSummary": string,
  "levelAssessment": string
}

Rules:
- analysisSummary: 1-3 sentences grounded in the provided evidence for ${careerStack} at ${experienceLevel}.
- levelAssessment: 1-2 sentences on readiness gaps that are already visible in CONTEXT_JSON.
- Mention the career stack or at least one listed skill name from CONTEXT_JSON.
- Do not return skills arrays, coverage, missing counts, priorities, jobDemand, or roadmap.
- Do not invent employers, credentials, or unsupported technologies.`;
};

module.exports = { getSkillGapPrompt };
