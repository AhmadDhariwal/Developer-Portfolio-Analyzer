const { compactArray, truncateText } = require('../services/promptBuilderService');

const getJobPrompt = ({
  careerStack = 'Full Stack',
  experienceLevel = 'Student',
  skillGaps = [],
  knownSkills = [],
  resumeSkills = [],
  githubSkills = [],
  platform = 'All',
  location = 'All',
  jobType = 'All',
  skills = '',
  totalCount = 20
} = {}) => {
  let distribution;
  if (platform !== 'All' && platform) {
    distribution = { [platform]: totalCount };
  } else {
    const linkedInCount = Math.round(totalCount * 0.3);
    const indeedCount = Math.round(totalCount * 0.26);
    const rozeeCount = Math.round(totalCount * 0.16);
    const glassdoorCount = Math.round(totalCount * 0.12);
    const remoteOkCount = totalCount - linkedInCount - indeedCount - rozeeCount - glassdoorCount;
    distribution = {
      LinkedIn: linkedInCount,
      Indeed: indeedCount,
      Rozee: rozeeCount,
      Glassdoor: glassdoorCount,
      RemoteOK: remoteOkCount
    };
  }

  const locationGuide = !location || location === 'All'
    ? 'Mix of Remote, Pakistan, USA, and Europe'
    : location;
  const jobTypeGuide = !jobType || jobType === 'All'
    ? 'Mix of Full Time, Remote, Contract, Part Time, and Internship'
    : jobType;
  const topSignals = [
    ...compactArray(knownSkills, 5),
    ...compactArray(resumeSkills, 4),
    ...compactArray(githubSkills, 4),
    ...compactArray(skillGaps, 4)
  ].filter(Boolean).join(', ') || careerStack;
  const platformLines = Object.entries(distribution)
    .map(([source, count]) => `- ${source}: exactly ${count} jobs`)
    .join('\n');
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

  return `You are a job feed data API. Generate EXACTLY ${totalCount} realistic software job postings for a developer profile.

TARGET PROFILE
- Career Stack: ${careerStack}
- Experience Level: ${experienceLevel}
- Known Skills: ${compactArray(knownSkills, 8).join(', ') || 'Not specified'}
- Resume Skills: ${compactArray(resumeSkills, 8).join(', ') || 'Not available'}
- GitHub Technologies: ${compactArray(githubSkills, 8).join(', ') || 'Not available'}
- Skill Gaps to improve: ${compactArray(skillGaps, 8).join(', ') || 'General improvement'}
${skills ? `- Must include a strong ${truncateText(skills, 80)} signal in title, description, or required skills` : ''}

STRICT SOURCE DISTRIBUTION
${platformLines}

LOCATION MIX: ${locationGuide}
JOB TYPE MIX: ${jobTypeGuide}

Return ONLY a valid JSON array with EXACTLY ${totalCount} objects.

Each object MUST contain ALL these fields:
{
  "id": "job_001",
  "title": "specific software role title",
  "company": "realistic company name",
  "companyLogo": "",
  "location": "Remote or city/country",
  "salary": "salary range string or Competitive",
  "jobType": "Full Time | Part Time | Contract | Internship | Remote",
  "skills": ["3-8 relevant skills"],
  "postedDate": "YYYY-MM-DD between ${thirtyDaysAgo} and ${today}",
  "description": "2-3 realistic sentences about company and role",
  "platform": "LinkedIn | Indeed | Rozee | Glassdoor | RemoteOK",
  "url": "realistic public job URL",
  "experienceLevel": "Intern | Entry | 1-2 years | 3-5 years | 5+ years"
}

RULES
1. Every job must align with this developer context: ${topSignals}.
2. Use realistic companies and believable role/location combinations.
3. Rozee jobs must be Pakistan-focused with PKR salaries.
4. RemoteOK jobs must be remote-first with USD salaries and location "Remote".
5. Vary companies, titles, descriptions, and skills. Avoid duplicates.
6. Keep each role relevant to ${careerStack} and generally suitable for ${experienceLevel}.
7. Return JSON only. No markdown, no comments, no extra text.`;
};

module.exports = { getJobPrompt };
