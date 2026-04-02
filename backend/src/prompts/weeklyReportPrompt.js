const getWeeklyReportPrompt = ({ name, careerStack, experienceLevel, aiInput }) => {
  return `You are an AI career coach. Build a personalized weekly performance report for ${name || 'the developer'}.

Return STRICT JSON only with these keys:
- progressSummary: string
- insights: string[] (exactly 4)
- recommendations: string[] (exactly 4)
- topAchievements: string[] (exactly 3)
- biggestRiskArea: string
- predictedHiringReadiness: { score: number, reason: string }

Hard requirements:
1) Compare current vs previous metrics with real numbers.
2) Quantify outcomes (scores, deltas, counts, percentages).
3) Keep it personalized to this user's data and stack.
4) Avoid generic advice like "work harder".
5) Mention both positive momentum and at least one risk.

Style:
- concise, confident, and actionable
- each insight/recommendation must include concrete metric context where possible
- predictedHiringReadiness.score must be 0-100

Profile context:
- Career stack: ${careerStack}
- Experience level: ${experienceLevel}

Input data (already transformed for analysis):
${JSON.stringify(aiInput, null, 2)}
`;
};

module.exports = { getWeeklyReportPrompt };
