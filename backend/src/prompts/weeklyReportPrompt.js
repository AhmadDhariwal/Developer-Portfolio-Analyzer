const getWeeklyReportPrompt = ({
  name,
  careerStack,
  experienceLevel,
  scoreDelta,
  githubScore,
  resumeScore,
  skillFocus = [],
  topSkills = [],
  missingSkills = []
}) => {
  return `You are an AI career coach. Build a weekly progress report for ${name || 'the developer'}.
Return JSON with keys: progressSummary (string), insights (array of 4 strings), recommendations (array of 4 strings).
Context:
- Career stack: ${careerStack}
- Experience: ${experienceLevel}
- GitHub score: ${githubScore}
- Resume score: ${resumeScore}
- Score change vs last week: ${scoreDelta}
- Focus skills this week: ${skillFocus.join(', ') || 'N/A'}
- Strong skills: ${topSkills.join(', ') || 'N/A'}
- Missing skills: ${missingSkills.join(', ') || 'N/A'}
Tone: encouraging, concise, actionable.
`; };

module.exports = { getWeeklyReportPrompt };
