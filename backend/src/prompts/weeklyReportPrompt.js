const { compactJson } = require('../services/promptBuilderService');

const getWeeklyReportPrompt = ({ name, careerStack, experienceLevel, aiInput }) => {
  const rawInput = compactJson(aiInput, 0);
  const compactInput = rawInput.length > 14000 ? rawInput.slice(0, 14000) + '...' : rawInput;
  return `You are an AI career coach. Build a personalized weekly performance report for ${name || 'the developer'}.

Return STRICT JSON only with these keys:
- progressSummary: string
- insights: string[] (exactly 4)
- recommendations: string[] (exactly 4)
- topAchievements: string[] (exactly 3)

Hard requirements:
1) Compare current vs previous metrics with real numbers.
2) Quantify outcomes (scores, deltas, counts, percentages).
3) Keep it personalized to this user's data and stack.
4) Avoid generic advice like "work harder".
5) Use only the provided deterministic metrics as source of truth.
6) If a source is missing, acknowledge the limited signal instead of inventing detail.
7) Generate narrative text only. Never return or alter scores, deltas, risks, snapshots, hashes, or source freshness.

Style:
- concise, confident, and actionable
- each insight/recommendation must include concrete metric context where possible
- recommendations should reflect progress signals from sprint, portfolio, integrations, and interview prep when present

Profile context:
- Career stack: ${careerStack}
- Experience level: ${experienceLevel}

Input data (already transformed for analysis):
${compactInput}
`;
};

module.exports = { getWeeklyReportPrompt };
