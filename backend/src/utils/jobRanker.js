const STACK_KEYWORDS = {
  'Full Stack': ['full stack', 'fullstack', 'mern', 'mean', 'node', 'express', 'react', 'angular', 'vue', 'next', 'typescript'],
  Frontend: ['frontend', 'front-end', 'react', 'angular', 'vue', 'html', 'css', 'ui', 'ux', 'javascript', 'typescript', 'next.js'],
  Backend: ['backend', 'back-end', 'node', 'express', 'server', 'api', 'python', 'django', 'flask', 'java', 'spring', 'golang', 'php', 'laravel'],
  'AI/ML': ['machine learning', 'deep learning', 'ai', 'ml', 'tensorflow', 'pytorch', 'data science', 'nlp', 'computer vision', 'llm', 'generative ai']
};

const EXPERIENCE_INDEX = {
  intern: 0,
  internship: 0,
  student: 0,
  entry: 1,
  'entry level': 1,
  junior: 1,
  '0-1 years': 1,
  '1-2 years': 2,
  '2-3 years': 3,
  '3-5 years': 4,
  mid: 4,
  'mid-level': 4,
  '5+ years': 5,
  senior: 5,
  lead: 5,
  principal: 5
};

const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const toText = (value) => String(value || '').trim();
const uniqueStrings = (values = [], limit = 12) => {
  const seen = new Set();
  const output = [];

  for (const value of values) {
    const normalized = toText(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
    if (output.length >= limit) break;
  }

  return output;
};

function normalizeExpIndex(level) {
  return EXPERIENCE_INDEX[toText(level).toLowerCase()] ?? 2;
}

function computeStackMatch(job, careerStack) {
  const keywords = STACK_KEYWORDS[careerStack] || STACK_KEYWORDS['Full Stack'];
  const haystack = `${job.title} ${(job.skills || []).join(' ')} ${job.description || ''}`.toLowerCase();
  const hits = keywords.filter((keyword) => haystack.includes(keyword));
  return clamp(Math.round((hits.length / Math.max(keywords.length * 0.28, 1)) * 100));
}

function computeSkillMatch(job, userSkills) {
  const safeUserSkills = uniqueStrings(userSkills, 25).map((skill) => skill.toLowerCase());
  const jobSkills = uniqueStrings(job.skills || [], 12).map((skill) => skill.toLowerCase());
  const haystack = `${job.title} ${job.description} ${jobSkills.join(' ')}`.toLowerCase();

  if (!safeUserSkills.length) {
    return {
      score: 35,
      matchedSkills: [],
      missingSkills: []
    };
  }

  const matchedSkills = safeUserSkills.filter((userSkill) =>
    jobSkills.some((jobSkill) => jobSkill.includes(userSkill) || userSkill.includes(jobSkill))
    || haystack.includes(userSkill)
  );
  const missingSkills = jobSkills.filter((jobSkill) =>
    !safeUserSkills.some((userSkill) => jobSkill.includes(userSkill) || userSkill.includes(jobSkill))
  );

  const score = clamp(Math.round((matchedSkills.length / Math.max(jobSkills.length || safeUserSkills.length, 1)) * 100));

  return {
    score: score || (matchedSkills.length ? 45 : 25),
    matchedSkills: uniqueStrings(matchedSkills, 8),
    missingSkills: uniqueStrings(missingSkills, 5)
  };
}

function computeExperienceMatch(job, userExperience) {
  const userIndex = normalizeExpIndex(userExperience);
  const jobIndex = normalizeExpIndex(job.experienceLevel || 'entry');
  const diff = Math.abs(userIndex - jobIndex);

  if (diff === 0) return 100;
  if (diff === 1) return 78;
  if (diff === 2) return 55;
  return 28;
}

function computeRecentness(postedDate) {
  if (!postedDate) return 35;
  const daysAgo = (Date.now() - new Date(postedDate).getTime()) / 86400000;
  if (daysAgo <= 3) return 100;
  if (daysAgo <= 7) return 84;
  if (daysAgo <= 14) return 66;
  if (daysAgo <= 30) return 48;
  return 24;
}

function buildWhyMatched({ job, careerStack, matchedSkills, experienceMatch, stackMatch }) {
  const reasons = [];
  if (matchedSkills.length) {
    reasons.push(`Strong overlap with ${matchedSkills.slice(0, 3).join(', ')}`);
  }
  if (stackMatch >= 70) {
    reasons.push(`Aligned with your ${careerStack} target stack`);
  }
  if (experienceMatch >= 75) {
    reasons.push(`Close fit for your current experience level`);
  }
  if (!reasons.length) {
    reasons.push('Useful stretch opportunity based on your broader developer profile');
  }
  return reasons.slice(0, 2).join(' • ');
}

function rankJobs(
  jobs,
  {
    careerStack = 'Full Stack',
    experienceLevel = 'Student',
    skillGaps = [],
    knownSkills = [],
    resumeSkills = [],
    githubSkills = []
  } = {}
) {
  const userSkills = uniqueStrings([
    ...(knownSkills || []),
    ...(skillGaps || []),
    ...(resumeSkills || []),
    ...(githubSkills || [])
  ], 30);

  return (Array.isArray(jobs) ? jobs : [])
    .map((job) => {
      const stackMatch = computeStackMatch(job, careerStack);
      const skillSignal = computeSkillMatch(job, userSkills);
      const experienceMatch = computeExperienceMatch(job, experienceLevel);
      const recentness = computeRecentness(job.postedDate);
      const matchScore = clamp(Math.round(
        (stackMatch * 0.28)
        + (skillSignal.score * 0.42)
        + (experienceMatch * 0.2)
        + (recentness * 0.1)
      ));

      return {
        ...job,
        score: Number((matchScore / 100).toFixed(4)),
        matchScore,
        skillMatch: skillSignal.score,
        experienceMatch,
        missingSkills: uniqueStrings(skillSignal.missingSkills, 4),
        whyMatched: buildWhyMatched({
          job,
          careerStack,
          matchedSkills: skillSignal.matchedSkills,
          experienceMatch,
          stackMatch
        })
      };
    })
    .sort((left, right) => Number(right.matchScore || 0) - Number(left.matchScore || 0));
}

module.exports = { rankJobs };
