const getInterviewPrepPrompt = ({
  careerStack,
  experienceLevel,
  skillGaps = []
}) => {
  return `You are an interview coach. Generate practice questions for a ${careerStack} developer (${experienceLevel}).
Return JSON with key: questions (array). Each question object: { question, answer, difficulty, tags }.
Skill gaps to focus on: ${skillGaps.join(', ') || 'general software engineering'}.
Provide 8 questions, balanced between theory and practical scenarios.
`; };

module.exports = { getInterviewPrepPrompt };
