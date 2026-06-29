const {
  compactJson,
  compactArray,
  summarizeResume,
  summarizeGithub
} = require('../services/promptBuilderService');

/**
 * Recommendation prompt for text-only enrichment of a deterministic plan.
 * The caller must pass summarized reusable signals only. Do not pass raw GitHub
 * repositories, raw resume text, or full skill-gap analysis payloads here.
 * @param {string} careerStack
 * @param {string} experienceLevel
 * @param {string[]} knownSkills
 * @param {string[]} missingSkills
 * @param {object} resumeInsights
 * @param {object} githubInsights
 * @param {object} developerSignals
 */
const getRecommendationPrompt = (
  careerStack,
  experienceLevel,
  knownSkills,
  missingSkills,
  resumeInsights = {},
  githubInsights = {},
  developerSignals = {},
  deterministicPlan = {}
) => {
  const compactKnownSkills = compactArray(knownSkills, 20);
  const compactMissingSkills = compactArray(missingSkills, 20);
  const compactResume = compactJson(summarizeResume(resumeInsights), 0);
  const compactGithub = compactJson(summarizeGithub(githubInsights), 0);
  const compactSignals = compactJson(developerSignals, 0);
  const compactPlan = compactJson({
    projects: (deterministicPlan.projects || []).slice(0, 4).map(({ id, title }) => ({ id, title })),
    technologies: (deterministicPlan.technologies || []).slice(0, 8).map(({ name }) => ({ name })),
    careerPaths: (deterministicPlan.careerPaths || []).slice(0, 4).map(({ id, title }) => ({ id, title }))
  }, 0);

  return `
    You are a senior software engineering mentor.
    Enrich an already-computed deterministic recommendation plan with concise narrative text.

    Career Stack:     "${careerStack}"
    Experience Level: "${experienceLevel}"
    Known Skills:     ${JSON.stringify(compactKnownSkills)}
    Skill Gaps:       ${JSON.stringify(compactMissingSkills)}
    Resume Signals Summary:  ${compactResume}
    GitHub Signals Summary:  ${compactGithub}
    Developer Signals Summary:${compactSignals}
    Deterministic Plan IDs:    ${compactPlan}

    STRICT RULES - you MUST follow ALL of these:
    1. Do not calculate or return scores, rankings, priorities, difficulty, effort, timelines, salary, URLs, or technology selections.
    2. Do not add or remove recommendation items. The backend owns all deterministic choices and scoring.
    3. Recommendations MUST adapt to progress signals:
        - If weekly progress or sprint consistency is low, prefer smaller, practical next steps.
        - If portfolio completeness is low, include portfolio improvement actions.
        - If integration proof is weak (GitHub, LinkedIn, LeetCode, Kaggle, StackOverflow, certifications), recommend proof-building actions.
        - If repeated weak areas show up across signals, reflect them in technology and learning actions.
    4. Use portfolio and integration signals only as supporting evidence. Do not treat them as stronger than GitHub plus resume.
    5. Avoid generic filler. Every narrative should connect to a real signal from the input.
    6. Keep the tone specific, realistic, and recruiter-useful.
    7. Do NOT infer by re-analyzing raw resume text or raw GitHub repositories; those are intentionally unavailable.
    8. AI may only enrich narrative and action wording. Deterministic platform output remains authoritative.

    Return ONLY valid JSON (no markdown, no code fences):

    {
      "analysisSummary": string,
      "projectNarratives": [
        {
          "id": string,
          "title": string,
          "description": string,
          "whyThisProject": string
        }
      ],
      "technologyNarratives": [
        {
          "name": string,
          "description": string
        }
      ],
      "careerPathNarratives": [
        {
          "id": string,
          "title": string,
          "description": string,
          "actionItems": string[]
        }
      ],
      "portfolioRecommendations": [string],
      "resumeRecommendations": [string],
      "learningActions": [string],
      "interviewReadinessActions": [string]
    }

    ACTION ARRAY RULES:
    - portfolioRecommendations: 2-4 concise actions
    - resumeRecommendations: 2-4 concise actions
    - learningActions: 3-6 concise actions
    - interviewReadinessActions: 2-4 concise actions
    - analysisSummary: 2-3 sentences summarizing how GitHub, resume, and developer signals influence the recommendation set

    IMPORTANT:
    - If a signal source is missing, continue with the remaining evidence.
    - Do not generate sprint tasks, weekly reports, or portfolio content ownership.
    - Focus on recommendations only.

    Keep every returned string concise.
  `;
};

module.exports = { getRecommendationPrompt };
