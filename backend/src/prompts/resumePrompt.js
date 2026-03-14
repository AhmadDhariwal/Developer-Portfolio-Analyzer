/**
 * Prompt template for resume text analysis.
 * Returns all fields required by the frontend, including score reasoning.
 */
const getResumePrompt = (resumeText) => {
  return `
You are an expert resume analyst and ATS (Applicant Tracking System) evaluator with 10+ years of experience reviewing developer resumes.

Carefully read the full resume below, then return a single valid JSON object with your analysis.

Resume Text:
"""
${resumeText}
"""

Return ONLY a valid JSON object with exactly these fields — no markdown, no explanation outside the JSON:

{
  "skills": [
    {
      "name": "skill name",
      "category": "one of exactly: Programming Languages | Frameworks & Libraries | Technologies & Tools | Soft Skills",
      "confidence": <0.0 to 1.0>
    }
  ],
  "experienceYears": <integer — total professional years based on work history dates>,
  "experienceLevel": "<Junior | Intermediate | Senior>",
  "certifications": ["list each certification found, or empty array"],
  "keyAchievements": ["1-2 sentence achievement with measurable impact if present, or empty array"],

  "atsScore": <integer 0-100>,
  "keywordDensity": <integer 0-100>,
  "formatScore": <integer 0-100>,
  "contentQuality": <integer 0-100>,

  "scoreBreakdown": {
    "atsScore": "1-2 sentences explaining exactly why this score was given — what ATS-friendly elements were found or missing (section headers, standard fonts, no tables, keyword placement)",
    "keywordDensity": "1-2 sentences explaining which technical/domain keywords were found, how densely they appear, and what is missing",
    "formatScore": "1-2 sentences explaining the formatting strengths and weaknesses (section clarity, date consistency, bullet point usage, length appropriateness)",
    "contentQuality": "1-2 sentences explaining the quality of written content — use of action verbs, quantified achievements, specificity vs vagueness"
  },

  "suggestions": [
    {
      "id": "suggestion-1",
      "title": "short actionable title (max 8 words)",
      "description": "1-2 sentences describing what to improve and why it matters for getting interviews",
      "color": "<red | orange | blue | purple | cyan>"
    }
  ]
}

Scoring guide:
- "atsScore": 90-100 = standard formatting + keyword-rich + clear sections. Deduct for tables, columns, graphics in text, missing standard sections, unusual fonts or headers.
- "keywordDensity": Count recognised technical keywords (languages, tools, frameworks, soft skills, domain terms) vs total words. 80+ keywords = 80+, <10 keywords = below 30.
- "formatScore": 90+ = clear Experience/Education/Skills sections, consistent dates, good use of bullets, appropriate length (1-2 pages). Deduct for wall-of-text, missing sections, inconsistent formatting.
- "contentQuality": 90+ = action verbs on every bullet, quantified results (%, numbers, revenue), specific tech mentioned. Deduct for passive voice, vague phrases ("responsible for"), no metrics.

Suggestion color guide:
- "red" = critical issue that will likely cause rejection (missing contact info, no skills section, very low ATS score)
- "orange" = important but not critical (weak action verbs, missing keywords, unclear job titles)
- "blue" = technical improvement (add specific tools, languages, or frameworks)
- "purple" = content/achievement improvement (add metrics, better descriptions)
- "cyan" = positive note or minor polish (good structure, certificates worth highlighting)

Provide 4 to 6 suggestions total. Suggestion ids must be "suggestion-1", "suggestion-2", etc.
  `.trim();
};

module.exports = { getResumePrompt };
