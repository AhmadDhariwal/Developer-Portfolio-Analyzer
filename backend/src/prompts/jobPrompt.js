/**
 * Job Generation Prompt — drives Gemini to produce realistic job postings.
 */

const getJobPrompt = ({
  careerStack     = 'Full Stack',
  experienceLevel = 'Intermediate',
  skillGaps       = [],
  knownSkills     = [],
  platform        = 'All',
  location        = 'All',
  jobType         = 'All',
  skills          = '',
  totalCount      = 20
} = {}) => {
  // Per-platform distribution
  let distribution;
  if (platform !== 'All' && platform) {
    distribution = { [platform]: totalCount };
  } else {
    const l = Math.round(totalCount * 0.30);
    const i = Math.round(totalCount * 0.30);
    const r = Math.round(totalCount * 0.20);
    const g = Math.round(totalCount * 0.10);
    const ro = totalCount - l - i - r - g;
    distribution = { LinkedIn: l, Indeed: i, Rozee: r, Glassdoor: g, RemoteOK: ro };
  }

  const locationGuide =
    !location || location === 'All' ? 'mix of Remote, Pakistan, USA, Europe' : location;

  const skillContext = [
    ...(knownSkills || []).slice(0, 5),
    ...(skillGaps   || []).slice(0, 5)
  ].filter(Boolean).join(', ') || careerStack;

  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

  const jobTypeGuide = (!jobType || jobType === 'All')
    ? 'mix of Full Time, Remote, Contract, Part Time, Internship'
    : jobType;

  const platformLines = Object.entries(distribution)
    .map(([p, c]) => `  - ${p}: ${c} jobs`)
    .join('\n');

  return `You are a job board data API. Generate EXACTLY ${totalCount} realistic job postings for a ${careerStack} developer with ${experienceLevel} experience level.

USER PROFILE:
- Career Stack: ${careerStack}
- Experience Level: ${experienceLevel}
- Known Skills: ${(knownSkills || []).slice(0, 6).join(', ') || 'Not specified'}
- Skill Gaps to fill: ${(skillGaps || []).slice(0, 6).join(', ') || 'General improvement'}
${skills ? `- Filter by skills: ${skills}` : ''}

STRICT PLATFORM DISTRIBUTION (must be followed exactly):
${platformLines}

LOCATION MIX: ${locationGuide}
JOB TYPE MIX: ${jobTypeGuide}

Return EXACTLY ${totalCount} objects in a valid JSON array. Every object MUST contain ALL these fields:
{
  "id": "<unique string like job_001>",
  "title": "<specific role title matching ${careerStack}>",
  "company": "<real company name>",
  "companyLogo": "",
  "location": "<city/country or Remote>",
  "salary": "<range string e.g. '$4,000-$6,000/month' or 'PKR 180,000-280,000/month' or 'Competitive'>",
  "jobType": "<Full Time|Part Time|Contract|Internship|Remote>",
  "skills": ["3-7 skill strings most relevant to ${skillContext}"],
  "postedDate": "<YYYY-MM-DD between ${thirtyDaysAgo} and ${today}>",
  "description": "<2-3 sentences: company context + role responsibilities>",
  "platform": "<LinkedIn|Indeed|Rozee|Glassdoor|RemoteOK>",
  "url": "<realistic URL: linkedin.com/jobs/view/NNN or pk.indeed.com/job/... or rozee.pk/job/... or glassdoor.com/job-listing/... or remoteok.com/remote-jobs/...>",
  "experienceLevel": "<Intern|Entry|1-2 years|3-5 years|5+ years>"
}

RULES — DO NOT SKIP:
1. Assign platforms EXACTLY per the distribution above.
2. Make all skills arrays relevant to ${skillContext}.
3. For Rozee.pk jobs: Pakistani companies, PKR salaries, Pakistan cities (Lahore/Karachi/Islamabad/Rawalpindi).
4. For RemoteOK jobs: remote-first tech companies, USD salaries, location = "Remote".
5. Use REAL well-known companies: Google, Meta, Amazon, Microsoft, Arbisoft, Systems Ltd, Netsol Technologies, 10Pearls, Contour Software, Turing, Toptal, Automattic, GitLab, etc.
6. Vary experience levels naturally around ${experienceLevel}.
7. Return ONLY a valid JSON array. No markdown fences, no extra text, no explanations.`;
};

module.exports = { getJobPrompt };
