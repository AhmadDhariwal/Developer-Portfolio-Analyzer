/**
 * Job Ranking Utility
 * Scores jobs based on user career profile.
 * Formula: score = (stackMatch * 0.4) + (skillMatch * 0.3) + (experienceMatch * 0.2) + (recentness * 0.1)
 */

const STACK_KEYWORDS = {
  'Full Stack': ['full stack', 'fullstack', 'mern', 'mean', 'node', 'express', 'react', 'angular', 'vue', 'next', 'nuxt'],
  'Frontend':   ['frontend', 'front-end', 'react', 'angular', 'vue', 'html', 'css', 'ui', 'ux', 'javascript', 'typescript', 'next.js'],
  'Backend':    ['backend', 'back-end', 'node', 'express', 'server', 'api', 'python', 'django', 'flask', 'java', 'spring', 'golang', 'php', 'laravel'],
  'AI/ML':      ['machine learning', 'deep learning', 'ai', 'ml', 'tensorflow', 'pytorch', 'data science', 'nlp', 'computer vision', 'llm', 'generative ai']
};

const EXPERIENCE_INDEX = {
  'intern':     0, 'internship': 0, 'student': 0,
  'entry':      1, 'entry level': 1, 'junior': 1, '0-1 years': 1,
  '1-2 years':  2,
  '2-3 years':  3,
  '3-5 years':  4, 'mid': 4, 'mid-level': 4,
  '5+ years':   5, 'senior': 5, 'lead': 5, 'principal': 5
};

function normalizeExpIndex(level) {
  return EXPERIENCE_INDEX[String(level).toLowerCase()] ?? 2;
}

function computeStackMatch(job, careerStack) {
  const keywords = STACK_KEYWORDS[careerStack] || STACK_KEYWORDS['Full Stack'];
  const haystack = `${job.title} ${(job.skills || []).join(' ')} ${job.description || ''}`.toLowerCase();
  const hits = keywords.filter(kw => haystack.includes(kw));
  return Math.min(1, hits.length / Math.max(keywords.length * 0.3, 1));
}

function computeSkillMatch(job, userSkills) {
  if (!userSkills?.length || !job.skills?.length) return 0.3;
  const uSkills = userSkills.map(s => s.toLowerCase().trim());
  const jSkills = (job.skills || []).map(s => s.toLowerCase().trim());
  const matches = jSkills.filter(js => uSkills.some(us => js.includes(us) || us.includes(js)));
  return Math.min(1, matches.length / Math.max(jSkills.length, 1));
}

function computeExperienceMatch(job, userExperience) {
  const uIdx = normalizeExpIndex(userExperience);
  const jIdx = normalizeExpIndex(job.experienceLevel || 'entry');
  const diff = Math.abs(uIdx - jIdx);
  if (diff === 0) return 1.0;
  if (diff === 1) return 0.7;
  if (diff === 2) return 0.4;
  return 0.1;
}

function computeRecentness(postedDate) {
  if (!postedDate) return 0.3;
  const daysAgo = (Date.now() - new Date(postedDate).getTime()) / 86400000;
  if (daysAgo <= 3)  return 1.0;
  if (daysAgo <= 7)  return 0.85;
  if (daysAgo <= 14) return 0.65;
  if (daysAgo <= 30) return 0.45;
  return 0.2;
}

/**
 * @param {Object[]} jobs - raw job array
 * @param {Object}   profile - { careerStack, experienceLevel, skillGaps, knownSkills }
 * @returns {Object[]} sorted by descending score
 */
function rankJobs(jobs, { careerStack = 'Full Stack', experienceLevel = 'Intermediate', skillGaps = [], knownSkills = [] } = {}) {
  const userSkills = [...(skillGaps || []), ...(knownSkills || [])];
  return jobs
    .map(job => {
      const stackMatch      = computeStackMatch(job, careerStack);
      const skillMatch      = computeSkillMatch(job, userSkills);
      const experienceMatch = computeExperienceMatch(job, experienceLevel);
      const recentness      = computeRecentness(job.postedDate);
      const score = (stackMatch * 0.4) + (skillMatch * 0.3) + (experienceMatch * 0.2) + (recentness * 0.1);
      return { ...job, score: parseFloat(score.toFixed(4)) };
    })
    .sort((a, b) => b.score - a.score);
}

module.exports = { rankJobs };
