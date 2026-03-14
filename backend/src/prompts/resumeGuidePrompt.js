/**
 * Builds the AI prompt that generates a comprehensive, personalised resume improvement guide
 * from an existing ResumeAnalysis document.
 */
const getResumeGuidePrompt = (analysis) => {
  const {
    atsScore        = 0,
    keywordDensity  = 0,
    formatScore     = 0,
    contentQuality  = 0,
    experienceLevel = 'Junior',
    experienceYears = 0,
    skillsFlat      = '',
    certifications  = [],
    keyAchievements = [],
    suggestions     = [],
    fileName        = 'resume.pdf',
  } = analysis;

  const suggestionText = suggestions.length
    ? suggestions.map((s, i) => `  ${i + 1}. ${s.title}: ${s.description}`).join('\n')
    : '  No suggestions available.';

  const certsLine = certifications.length ? certifications.join(', ') : 'None listed';
  const achievementsLine = keyAchievements.length ? keyAchievements.join(' | ') : 'None listed';

  return `
You are a senior career coach and professional resume expert with 15+ years of experience helping software developers land top-tier roles.

Based on the resume analysis data below, generate a deeply personalised, actionable improvement guide.

=== RESUME ANALYSIS DATA ===
File:              ${fileName}
ATS Score:         ${atsScore}/100
Keyword Density:   ${keywordDensity}/100
Format Score:      ${formatScore}/100
Content Quality:   ${contentQuality}/100
Experience Level:  ${experienceLevel} (${experienceYears} years)
Current Skills:    ${skillsFlat || 'Not detected'}
Certifications:    ${certsLine}
Key Achievements:  ${achievementsLine}

EXISTING QUICK SUGGESTIONS:
${suggestionText}
=== END DATA ===

Generate a comprehensive improvement guide and return ONLY a single valid JSON object — no markdown fences, no explanation outside the JSON.

{
  "executiveSummary": "2-3 sentence overall honest assessment and what this guide helps them achieve",
  "overallGrade": "<A | B | C | D>",
  "priorityLevel": "<Critical | High | Moderate | Strong>",
  "headline": "one punchy sentence summarising the biggest opportunity (e.g. 'Your resume is 60% of the way there — these fixes will unlock senior-level interviews.')",

  "sections": [
    {
      "title": "section name (e.g. ATS & Keyword Optimisation, Professional Summary, Work Experience, Skills Section, Formatting & Layout, Quantified Achievements, Certifications & Learning)",
      "score": <integer 0-100 or null if not applicable>,
      "status": "<Needs Urgent Work | Needs Improvement | Solid | Excellent>",
      "problem": "2-3 sentences describing the specific issue or strength",
      "actionSteps": ["concrete action step 1", "concrete action step 2", "concrete action step 3"],
      "example": "A real before/after example or a sample sentence they can adapt verbatim",
      "impact": "<High | Medium | Low>",
      "timeToFix": "<15 min | 30 min | 1-2 hrs | Ongoing>"
    }
  ],

  "skillsToAdd": [
    { "skill": "skill name", "reason": "why this skill is valuable for their level and role", "priority": "<Must Have | Nice to Have>" }
  ],

  "quickWins": [
    { "action": "specific thing to do", "timeEstimate": "<5 min | 10 min | 15 min | 30 min>", "impact": "<High | Medium>" }
  ],

  "thirtyDayPlan": [
    { "week": 1, "focus": "theme for the week", "tasks": ["task 1", "task 2", "task 3"] },
    { "week": 2, "focus": "theme for the week", "tasks": ["task 1", "task 2", "task 3"] },
    { "week": 3, "focus": "theme for the week", "tasks": ["task 1", "task 2", "task 3"] },
    { "week": 4, "focus": "theme for the week", "tasks": ["task 1", "task 2", "task 3"] }
  ],

  "atsKeywords": ["keyword1", "keyword2", "keyword3"],

  "powerVerbs": ["achieved", "optimised", "delivered"],

  "industryInsight": "2-3 sentences about current hiring trends for their experience level and skill set",

  "finalNote": "1-2 sentence motivational closing statement"
}

Requirements:
- Include 5–7 sections that cover the most impactful areas for this specific candidate
- skillsToAdd should have 6–10 items prioritised for their level
- quickWins should have 4–6 items that can be done immediately
- atsKeywords should have 12–18 relevant high-value keywords
- powerVerbs should have 10–15 strong action verbs
- Be specific to the candidate's data — avoid generic advice where possible
- Be direct, honest, and encouraging
  `.trim();
};

module.exports = { getResumeGuidePrompt };
