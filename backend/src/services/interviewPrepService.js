const aiService = require('./aiservice');
const InterviewPrepSession = require('../models/interviewPrepSession');
const { getInterviewPrepPrompt } = require('../prompts/interviewPrepPrompt');

const normalizeQuestions = (questions = []) => {
  const safe = Array.isArray(questions) ? questions : [];
  return safe.map((q, idx) => ({
    question: String(q.question || q.title || `Question ${idx + 1}`).trim(),
    answer: String(q.answer || q.sampleAnswer || 'Provide a structured response with key points.').trim(),
    difficulty: String(q.difficulty || 'Medium').trim(),
    tags: Array.isArray(q.tags) ? q.tags.map(String) : []
  }));
};

const generateInterviewPrep = async ({ userId, careerStack, experienceLevel, skillGaps = [] }) => {
  const prompt = getInterviewPrepPrompt({ careerStack, experienceLevel, skillGaps });
  const fallback = {
    questions: [
      {
        question: 'Describe a time you debugged a complex issue in your codebase.',
        answer: 'Highlight the context, root cause analysis, and the final fix along with lessons learned.',
        difficulty: 'Medium',
        tags: ['Behavioral']
      },
      {
        question: 'Explain how you would design a scalable API for a high-traffic application.',
        answer: 'Discuss REST/GraphQL decisions, caching, rate limiting, and database scaling.',
        difficulty: 'Hard',
        tags: ['System Design']
      }
    ]
  };

  const result = await aiService.runAIAnalysis(prompt, fallback);
  const questions = normalizeQuestions(result.questions);

  const session = await InterviewPrepSession.create({
    userId,
    careerStack,
    experienceLevel,
    skillGaps,
    questions
  });

  return session;
};

const listInterviewPrepHistory = async (userId, limit = 5) => {
  return InterviewPrepSession.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
};

module.exports = {
  generateInterviewPrep,
  listInterviewPrepHistory
};
