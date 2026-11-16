const { canonicalizeSkillName, normalizeSkillList } = require('../utils/skilldetector');

const estimateTokens = (value = '') => Math.ceil(Buffer.byteLength(String(value || ''), 'utf8') / 4);
const DEFAULT_TEXT_LIMIT = Number.parseInt(process.env.AI_PROMPT_TEXT_LIMIT || '6000', 10);
const DEFAULT_ARRAY_LIMIT = Number.parseInt(process.env.AI_PROMPT_ARRAY_LIMIT || '20', 10);

const uniqueByLower = (values = []) => {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const clean = String(value || '').trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
};

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value) || 0));

const truncateText = (value = '', limit = DEFAULT_TEXT_LIMIT) => {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit)}... [truncated]` : clean;
};

const compactObject = (value, depth = 0) => {
  if (value == null) return value;
  if (typeof value === 'string') return truncateText(value, depth > 0 ? 600 : DEFAULT_TEXT_LIMIT);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, DEFAULT_ARRAY_LIMIT).map((item) => compactObject(item, depth + 1));
  }
  if (typeof value === 'object') {
    const output = {};
    for (const [key, child] of Object.entries(value)) {
      if (child == null || child === '') continue;
      if (/^(raw|html|blob|buffer|pdf|base64|password|token|secret)$/i.test(key)) continue;
      output[key] = compactObject(child, depth + 1);
    }
    return output;
  }
  return value;
};

const compactJson = (value, space = 0) => JSON.stringify(compactObject(value), null, space);

const compactArray = (values = [], limit = 8) => uniqueByLower((Array.isArray(values) ? values : []).map((value) => {
  if (typeof value === 'string') return value;
  return value?.name || value?.skill || value?.title || '';
}).filter(Boolean)).slice(0, limit);

const uniqueSkillNames = (skills = [], limit = 20) => normalizeSkillList(skills)
  .map((skill) => skill.name)
  .filter(Boolean)
  .slice(0, limit);

const summarizeRepositories = (repositories = [], limit = 8) => (Array.isArray(repositories) ? repositories : [])
  .slice(0, 30)
  .map((repo) => ({
    name: String(repo?.name || '').slice(0, 80),
    language: String(repo?.language || '').slice(0, 40),
    topics: compactArray(repo?.topics || [], 5),
    signal: String(repo?.description || '').slice(0, 140)
  }))
  .filter((repo) => repo.name || repo.language || repo.topics.length)
  .slice(0, limit);

const summarizeResume = (resumeInsights = {}) => ({
  analyzed: Boolean(resumeInsights?.analyzed || resumeInsights?.analysisId),
  atsScore: clamp(resumeInsights?.atsScore || 0),
  fileName: resumeInsights?.fileName || '',
  strengths: compactArray(resumeInsights?.strengths || [], 6),
  weaknesses: compactArray(resumeInsights?.weaknesses || [], 6),
  missingSections: compactArray(resumeInsights?.missingSections || [], 6)
});

const summarizeResumeTextForPrompt = (resumeText = '') => {
  const text = String(resumeText || '').replace(/\r/g, '\n');
  const lines = uniqueByLower(text.split('\n').map((line) => line.trim()).filter(Boolean));
  const sectionHints = ['summary', 'experience', 'projects', 'skills', 'education', 'certifications', 'achievements'];
  const highlightedLines = lines.filter((line) => sectionHints.some((hint) => line.toLowerCase().includes(hint))).slice(0, 20);
  return {
    charCount: text.length,
    wordEstimate: text.split(/\s+/).filter(Boolean).length,
    highlightedLines,
    excerpt: truncateText(lines.slice(0, 80).join('\n'), 5000)
  };
};

const summarizeGithub = (githubInsights = {}) => ({
  repoCount: Number(githubInsights?.repoCount || 0),
  developerLevel: githubInsights?.developerLevel || '',
  strengths: compactArray(githubInsights?.strengths || [], 6),
  weakAreas: compactArray(githubInsights?.weakAreas || [], 6),
  topLanguages: (githubInsights?.languageDistribution || []).slice(0, 8),
  repositories: summarizeRepositories(githubInsights?.repositories || [], 8),
  scores: githubInsights?.scores || {}
});

const summarizeJobDemand = (jobsDemandSignal = {}) => ({
  sampledJobs: Number(jobsDemandSignal?.sampledJobs || 0),
  topSkills: (jobsDemandSignal?.topSkills || []).map((skill) => ({
    name: canonicalizeSkillName(skill?.name || '') || String(skill?.name || '').slice(0, 50),
    demandScore: clamp(skill?.demandScore || skill?.jobDemand || 0),
    postings: Number(skill?.postings || 0)
  })).filter((skill) => skill.name).slice(0, 10)
});

const summarizeDeveloperSignals = (signals = {}) => ({
  portfolio: {
    present: Boolean(signals.portfolioSignal?.present),
    completenessScore: clamp(signals.portfolioSignal?.completenessScore || 0),
    skills: uniqueSkillNames(signals.portfolioSignal?.portfolioSkills || [], 10)
  },
  integrations: {
    present: Boolean(signals.integrationSignal?.present),
    providers: compactArray(signals.integrationSignal?.usedProviders || [], 5),
    detectedSkills: uniqueSkillNames(signals.integrationSignal?.detectedSkills || [], 10),
    weakProof: uniqueSkillNames(signals.integrationSignal?.weakProof || [], 8)
  },
  sprint: {
    consistencyScore: clamp(signals.careerSprintSignal?.consistencyScore || 0),
    completedSkills: uniqueSkillNames(signals.careerSprintSignal?.completedSkillSignals || [], 8),
    repeatedIncompleteSkills: uniqueSkillNames(signals.careerSprintSignal?.repeatedIncompleteSkills || [], 8)
  },
  weekly: {
    status: signals.weeklyReportSignal?.status || 'Unavailable',
    score: clamp(signals.weeklyReportSignal?.weeklyProgressScore || 0),
    repeatedWeakAreas: uniqueSkillNames(signals.weeklyReportSignal?.repeatedWeakAreas || [], 8)
  },
  jobs: summarizeJobDemand(signals.jobsDemandSignal)
});

const buildSkillGapPromptContext = ({
  careerStack,
  experienceLevel,
  evidenceBreakdown,
  resumeInsights,
  githubInsights,
  developerSignals,
  deterministicGroups
}) => ({
  profile: { careerStack, experienceLevel },
  detectedSkills: {
    github: uniqueSkillNames(evidenceBreakdown.githubSkills || [], 20),
    resume: uniqueSkillNames(evidenceBreakdown.resumeSkills || [], 20),
    proven: uniqueSkillNames(evidenceBreakdown.provenSkills || [], 12),
    claimedButNotProven: uniqueSkillNames(evidenceBreakdown.claimedButNotProvenSkills || [], 12),
    missingExpected: uniqueSkillNames(evidenceBreakdown.missingExpectedSkills || [], 16),
    deterministicKnown: (deterministicGroups.yourSkills || []).map((skill) => skill.name).filter(Boolean).slice(0, 12),
    deterministicMissing: (deterministicGroups.missingSkills || []).map((skill) => skill.name).filter(Boolean).slice(0, 16)
  },
  resume: summarizeResume(resumeInsights),
  github: summarizeGithub(githubInsights),
  signals: summarizeDeveloperSignals(developerSignals)
});

module.exports = {
  estimateTokens,
  truncateText,
  compactObject,
  compactJson,
  compactArray,
  summarizeRepositories,
  summarizeResume,
  summarizeResumeTextForPrompt,
  summarizeGithub,
  summarizeDeveloperSignals,
  summarizeJobDemand,
  buildSkillGapPromptContext
};
