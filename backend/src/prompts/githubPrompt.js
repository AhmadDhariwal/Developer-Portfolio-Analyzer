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
  "explanation": "string",
  "interviewTalkingPoints": ["string", "string", "string"]
}

Rules:
- strengths: 3-6 concrete technical strengths grounded in the supplied repos/languages/technologies.
- weakAreas: 3-6 specific improvement areas grounded in weakAreaHints or missing signals.
- summary: 1-2 sentences, recruiter-friendly, no hype, grounded in facts.
- explanation: 1-2 sentences describing the deterministic score drivers without inventing numbers.
- interviewTalkingPoints: 2-5 specific architecture, testing, or engineering tradeoff discussions grounded in the supplied original repositories and technologies.
- Reject generic filler, placeholders, apologies, or content unrelated to this profile.
- Activity represents sampled repository contributor history, not verified personal commits. Do not attribute it to the developer.
- The supplied top repositories exclude forks. Never infer personal authorship, originality of contributions, proficiency, expertise, successful maintenance, or production deployment from repository ownership, languages, stars, or metadata.
- Describe observable repository signals rather than the person's ability. Interview points must ask about supplied original repositories; never assume a particular personal contribution or production experience.
- Begin strengths, summary and explanation with Public, Repository, Inspected, Sampled or Detected and name a supplied original repository, language or technology. Describe observations only; avoid words such as experience, familiarity, engagement, exposure, originality, authorship or contributions.
- Begin weakAreas with Consider, Review, Improve, Document or Assess. They are suggestions about sampled evidence, never assertions of missing personal ability.
- Begin interviewTalkingPoints with How would, What would, or Consider how and name a supplied original repository or detected technology. Make these hypothetical discussions; do not assume an implementation already exists or describe an uninspected project's structure.
- Stars and forks do not establish adoption, a user base or production reach. Metadata does not prove understanding, command, knowledge, or personal ability. Never make those inferences, including inside interview questions.
- Do not repeat numerical quantities; deterministic fields already report those. Strengths, summary and explanation must explicitly describe metadata, signals or the language summary. Do not assert missing implementation or documentation in recommendations; propose a review instead.
- Missing or unsampled README, language, or activity data is unavailable evidence, not proof of absence.
- Never include scores, healthScore, tokens, prompts, or provider details.
`.trim();
};

module.exports = { getGitHubPrompt };
