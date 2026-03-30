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

const getInterviewQuestionGenerationPrompt = ({ skill, query = '', count = 10 }) => {
  return `You are an interview coach. Generate ${count} concise interview question and answer pairs for ${skill}.
Return valid JSON only with key: questions (array).
Each item format: { question, answer, difficulty, tags }.
Difficulty must be one of: easy, medium, hard.
Tags must be lowercase strings.
${query ? `Focus context: ${query}.` : 'Focus on core concepts and practical interview scenarios.'}
Avoid duplicates and keep answers short but useful.
`; };

module.exports = { getInterviewPrepPrompt, getInterviewQuestionGenerationPrompt };
