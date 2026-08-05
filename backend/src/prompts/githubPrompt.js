const { compactJson } = require('../services/promptBuilderService');

const getGitHubPrompt = (githubData) => {
  const compactSignals = compactJson(githubData, 0);
  return `
You write recruiter-facing narrative for a GitHub profile.
Deterministic backend scores, rankings, and evidence are authoritative.
Do not invent, recalculate, contradict, or output numeric scores.

Grounding (JSON):
${compactSignals}

Return ONLY valid JSON with this exact schema:
{
  "strengths": ["string", "string", "string"],
  "weakAreas": ["string", "string", "string"],
  "summary": "string",
  "explanation": "string"
}

Rules:
- strengths: 3-6 concrete technical strengths grounded in the supplied repos/languages/technologies.
- weakAreas: 3-6 specific improvement areas grounded in weakAreaHints or missing signals.
- summary: 1-2 sentences, recruiter-friendly, no hype, grounded in facts.
- explanation: 1-2 sentences describing the deterministic score drivers without inventing numbers.
- Reject generic filler, placeholders, apologies, or content unrelated to this profile.
- Never include scores, healthScore, tokens, prompts, or provider details.
`.trim();
};

module.exports = { getGitHubPrompt };
