const axios = require('axios');
const crypto = require('node:crypto');
const { rankJobs } = require('../utils/jobRanker');
const { getIntegrationSecretsSync } = require('./platformSettingsService');

const JSEARCH_HOST = 'jsearch.p.rapidapi.com';
const JSEARCH_BASE = 'https://jsearch.p.rapidapi.com/search';
const JSEARCH_TIMEOUT_MS = Number.parseInt(process.env.JSEARCH_TIMEOUT_MS || '10000', 10);
const JSEARCH_RETRIES = Number.parseInt(process.env.JSEARCH_RETRIES || '1', 10);
const JOOBLE_BASE = 'https://jooble.org/api';
const REMOTIVE_BASE = 'https://remotive.com/api/remote-jobs';
const ARBEITNOW_BASE = 'https://www.arbeitnow.com/api/job-board-api';
const SECONDARY_SOURCE_TIMEOUT_MS = Number.parseInt(process.env.JOB_SOURCE_TIMEOUT_MS || '9000', 10);
const JOB_LIMITS = {
  defaultPage: 1,
  minPage: 1,
  defaultLimit: 10,
  maxLimit: 20
};

const PLATFORM_COLORS = {
  LinkedIn: { bg: '#0077B5', text: '#ffffff' },
  Indeed: { bg: '#003A9B', text: '#ffffff' },
  Rozee: { bg: '#e8282f', text: '#ffffff' },
  Glassdoor: { bg: '#0CAA41', text: '#ffffff' },
  RemoteOK: { bg: '#14b8a6', text: '#ffffff' },
  JSearch: { bg: '#2563eb', text: '#ffffff' },
  Jooble: { bg: '#f97316', text: '#111827' },
  Remotive: { bg: '#22c55e', text: '#052e16' },
  Arbeitnow: { bg: '#38bdf8', text: '#082f49' },
  Other: { bg: '#6366f1', text: '#ffffff' }
};

const LOCATION_ALIASES = {
  all: 'All',
  remote: 'Remote',
  pakistan: 'Pakistan',
  usa: 'USA',
  europe: 'Europe'
};

const VALID_PLATFORMS = ['All', 'JSearch', 'Jooble', 'Remotive', 'Arbeitnow', 'LinkedIn', 'Indeed', 'Rozee', 'Glassdoor', 'RemoteOK'];
const VALID_JOB_TYPES = ['All', 'Full Time', 'Part Time', 'Contract', 'Internship', 'Remote'];
const VALID_EXP_LEVELS = ['All', 'Intern', 'Entry', '1-2 years', '3-5 years', '5+ years'];
const VALID_LOCATIONS = ['All', 'Remote', 'Pakistan', 'USA', 'Europe'];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
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

function normalisePlatform(raw) {
  const value = toText(raw).toLowerCase();
  if (!value || value === 'all') return 'All';
  if (value.includes('jsearch')) return 'JSearch';
  if (value.includes('jooble')) return 'Jooble';
  if (value.includes('remotive')) return 'Remotive';
  if (value.includes('arbeitnow') || value.includes('arbeit now')) return 'Arbeitnow';
  if (value.includes('linkedin')) return 'LinkedIn';
  if (value.includes('indeed')) return 'Indeed';
  if (value.includes('rozee')) return 'Rozee';
  if (value.includes('glassdoor')) return 'Glassdoor';
  if (value.includes('remoteok') || value.includes('remote ok')) return 'RemoteOK';
  return 'All';
}

function normaliseJobType(raw) {
  const value = toText(raw).toLowerCase();
  if (!value || value === 'all') return 'All';
  if (value.includes('full')) return 'Full Time';
  if (value.includes('part')) return 'Part Time';
  if (value.includes('contract')) return 'Contract';
  if (value.includes('intern')) return 'Internship';
  if (value.includes('remote')) return 'Remote';
  return 'All';
}

function normaliseLocation(raw) {
  const value = toText(raw).toLowerCase();
  return LOCATION_ALIASES[value] || 'All';
}

function normaliseExperienceFilter(raw) {
  const value = toText(raw).toLowerCase();
  if (!value || value === 'all') return 'All';
  if (value.includes('intern')) return 'Intern';
  if (value.includes('entry') || value.includes('0-1') || value.includes('junior')) return 'Entry';
  if (value.includes('1-2')) return '1-2 years';
  if (value.includes('3-5') || value.includes('2-3') || value.includes('mid')) return '3-5 years';
  if (value.includes('5+') || value.includes('senior') || value.includes('lead')) return '5+ years';
  return 'All';
}

function normaliseJobFilters(query = {}) {
  const platform = normalisePlatform(query.platform);
  const location = normaliseLocation(query.location);
  const skills = toText(query.skills).replace(/\s+/g, ' ').slice(0, 60);
  const jobType = normaliseJobType(query.jobType);
  const expLevel = normaliseExperienceFilter(query.expLevel);
  const page = Math.max(JOB_LIMITS.minPage, Number.parseInt(query.page, 10) || JOB_LIMITS.defaultPage);
  const limit = clamp(Number.parseInt(query.limit, 10) || JOB_LIMITS.defaultLimit, 1, JOB_LIMITS.maxLimit);

  return {
    platform: VALID_PLATFORMS.includes(platform) ? platform : 'All',
    location: VALID_LOCATIONS.includes(location) ? location : 'All',
    skills,
    jobType: VALID_JOB_TYPES.includes(jobType) ? jobType : 'All',
    expLevel: VALID_EXP_LEVELS.includes(expLevel) ? expLevel : 'All',
    page,
    limit
  };
}

function stableId(prefix, values = []) {
  const seed = values.map((value) => toText(value).toLowerCase()).join('|');
  const hash = crypto.createHash('sha1').update(seed).digest('hex').slice(0, 12);
  return `${prefix}_${hash}`;
}

function inferPlatform(url = '', preferred = '') {
  const lower = toText(url).toLowerCase();
  const normalizedPreferred = normalisePlatform(preferred);
  if (normalizedPreferred && normalizedPreferred !== 'All') return normalizedPreferred;
  if (lower.includes('jooble.org')) return 'Jooble';
  if (lower.includes('remotive.com')) return 'Remotive';
  if (lower.includes('arbeitnow.com')) return 'Arbeitnow';
  if (lower.includes('linkedin.com')) return 'LinkedIn';
  if (lower.includes('indeed.com')) return 'Indeed';
  if (lower.includes('rozee.pk')) return 'Rozee';
  if (lower.includes('glassdoor.com')) return 'Glassdoor';
  if (lower.includes('remoteok.com')) return 'RemoteOK';
  return 'Other';
}

function mapExperienceMonthsToLabel(months) {
  if (months < 12) return 'Entry';
  if (months < 36) return '1-2 years';
  if (months < 60) return '3-5 years';
  return '5+ years';
}

function normaliseExperienceLabel(raw) {
  const value = toText(raw);
  if (!value) return 'Entry';
  const normalized = normaliseExperienceFilter(value);
  return normalized === 'All' ? 'Entry' : normalized;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(toText(value));
}

function stripHtml(value = '') {
  return toText(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|div|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeStringList(values = [], limit = 12) {
  if (Array.isArray(values)) return uniqueStrings(values, limit);
  const text = stripHtml(values);
  if (!text) return [];
  return uniqueStrings(text.split(/\n|,|•|;|\|/), limit);
}

function extractSkillsFromText(...parts) {
  const catalog = [
    'Angular', 'React', 'Vue.js', 'Next.js', 'Node.js', 'Express', 'TypeScript', 'JavaScript',
    'Python', 'Django', 'Flask', 'Java', 'Spring Boot', 'PHP', 'Laravel', '.NET', 'C#',
    'Ruby', 'Rails', 'Go', 'Golang', 'GraphQL', 'REST APIs', 'MongoDB', 'PostgreSQL',
    'MySQL', 'Redis', 'Docker', 'Kubernetes', 'AWS', 'Azure', 'GCP', 'CI/CD', 'Git',
    'Tailwind CSS', 'SCSS', 'HTML', 'CSS', 'Redux', 'RxJS', 'Jest', 'Cypress',
    'TensorFlow', 'PyTorch', 'Machine Learning', 'Data Science', 'LLM'
  ];
  const haystack = parts.map(stripHtml).join(' ').toLowerCase();
  return uniqueStrings(
    catalog.filter((skill) => haystack.includes(skill.toLowerCase())),
    10
  );
}

function normaliseJob(job = {}, index = 0, source = 'Unknown') {
  const title = toText(job.title) || 'Software Engineer';
  const company = toText(job.company) || 'Technology Company';
  const location = toText(job.location) || 'Remote';
  const description = stripHtml(job.description) || 'Opportunity details were not provided by the source.';
  const applyUrl = isHttpUrl(job.applyUrl) ? toText(job.applyUrl) : (isHttpUrl(job.url) ? toText(job.url) : '');
  const url = isHttpUrl(job.url) ? toText(job.url) : applyUrl;
  const platform = inferPlatform(job.url, job.platform);
  const skills = uniqueStrings(
    Array.isArray(job.skills) && job.skills.length ? job.skills : extractSkillsFromText(title, description, job.requirements),
    10
  );
  const jobType = normaliseJobType(job.jobType) === 'All'
    ? (location.toLowerCase().includes('remote') ? 'Remote' : 'Full Time')
    : normaliseJobType(job.jobType);
  const postedDate = /\d{4}-\d{2}-\d{2}/.test(toText(job.postedDate))
    ? toText(job.postedDate)
    : new Date().toISOString().split('T')[0];
  const experienceLevel = normaliseExperienceLabel(job.experienceLevel);
  const salary = toText(job.salary) || 'Competitive';
  const requirements = normalizeStringList(job.requirements, 12);
  const benefits = normalizeStringList(job.benefits, 10);

  return {
    id: toText(job.id) || stableId('job', [source, title, company, location, platform, index]),
    externalJobId: toText(job.externalJobId || job.id),
    title,
    company,
    companyLogo: toText(job.companyLogo),
    location,
    salary,
    jobType,
    skills,
    postedDate,
    description,
    requirements,
    benefits,
    platform,
    url,
    applyUrl,
    experienceLevel,
    source,
    matchScore: Number(job.matchScore || 0),
    whyMatched: toText(job.whyMatched),
    missingSkills: uniqueStrings(job.missingSkills || [], 5),
    logoFallback: company.charAt(0).toUpperCase(),
    platformColor: PLATFORM_COLORS[platform] || PLATFORM_COLORS.Other
  };
}

function mapJSearchJob(job = {}, index = 0) {
  const applyLink = toText(job.job_apply_link);
  const location = [job.job_city, job.job_state, job.job_country].filter(Boolean).join(', ') || (job.job_is_remote ? 'Remote' : 'Remote');
  const salary = job.job_min_salary && job.job_max_salary
    ? `$${job.job_min_salary}-${job.job_max_salary}/${job.job_salary_period || 'year'}`
    : 'Competitive';
  const highlights = job.job_highlights || {};
  const skills = Array.isArray(job.job_required_skills)
    ? job.job_required_skills
    : extractSkillsFromText(job.job_title, job.job_description, highlights.Qualifications);
  const experienceLevel = typeof job.job_required_experience?.required_experience_in_months === 'number'
    ? mapExperienceMonthsToLabel(job.job_required_experience.required_experience_in_months)
    : 'Entry';

  return normaliseJob({
    id: stableId('jsearch', [job.job_id || index, job.job_title, job.employer_name, applyLink]),
    externalJobId: job.job_id,
    title: job.job_title,
    company: job.employer_name,
    companyLogo: job.employer_logo || '',
    location,
    salary,
    jobType: String(job.job_employment_type || '').replace('_', ' '),
    skills,
    postedDate: job.job_posted_at_datetime_utc ? String(job.job_posted_at_datetime_utc).split('T')[0] : '',
    description: job.job_description,
    requirements: highlights.Qualifications || [],
    benefits: highlights.Benefits || [],
    platform: 'JSearch',
    url: applyLink,
    applyUrl: applyLink,
    experienceLevel
  }, index, 'JSearch');
}

async function fetchJSearchJobs(query, maxResults = 80) {
  const integrations = getIntegrationSecretsSync();
  const rapidApiKey = String(process.env.RAPIDAPI_KEY || integrations?.jobsApiKey || '').trim();
  if (integrations?.jobsEnabled === false) {
    console.warn('[JobService] JSearch disabled by platform settings.');
    return [];
  }
  if (!rapidApiKey || rapidApiKey === 'your_rapidapi_key') {
    console.warn('[JobService] JSearch disabled: RAPIDAPI_KEY is missing or placeholder.');
    return [];
  }

  const headers = {
    'X-RapidAPI-Key': rapidApiKey,
    'X-RapidAPI-Host': JSEARCH_HOST,
    'User-Agent': 'Developer-Portfolio-Analyzer/1.0'
  };

  for (let attempt = 0; attempt <= JSEARCH_RETRIES; attempt += 1) {
    const relaxedQuery = attempt > 0 ? `${query} developer` : query;
    const maxPages = Math.max(1, Math.min(Math.ceil(maxResults / 10), attempt > 0 ? 2 : 3));

    try {
      const aggregated = [];

      for (let page = 1; page <= maxPages; page += 1) {
        const response = await axios.get(JSEARCH_BASE, {
          params: { query: relaxedQuery, page, num_pages: 1 },
          headers,
          timeout: JSEARCH_TIMEOUT_MS
        });
        const pageJobs = response.data?.data || [];
        if (!pageJobs.length) break;
        aggregated.push(...pageJobs);
        if (aggregated.length >= maxResults) break;
      }

      if (aggregated.length) {
        return aggregated.slice(0, maxResults).map((job, index) => mapJSearchJob(job, index));
      }
    } catch (error) {
      const status = error?.response?.status;
      const message = error?.response?.data?.message || error.message;
      console.warn(`[JobService] JSearch attempt ${attempt + 1} failed${status ? ` (${status})` : ''}: ${message}`);

      if (status === 401 || status === 403) break;
      if (status === 429 && attempt < JSEARCH_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
      }
    }
  }

  return [];
}

function mapJoobleJob(job = {}, index = 0) {
  const url = toText(job.link || job.url);
  const description = stripHtml(job.snippet || job.description);
  return normaliseJob({
    id: stableId('jooble', [job.id || index, job.title, job.company, url]),
    externalJobId: job.id,
    title: job.title,
    company: job.company,
    companyLogo: '',
    location: job.location || 'Remote',
    salary: job.salary,
    jobType: job.type,
    skills: extractSkillsFromText(job.title, description),
    postedDate: job.updated ? String(job.updated).split('T')[0] : '',
    description,
    requirements: [],
    benefits: [],
    platform: 'Jooble',
    url,
    applyUrl: url,
    experienceLevel: job.experienceLevel
  }, index, 'Jooble');
}

async function fetchJoobleJobs(query, filters = {}, maxResults = 40) {
  const apiKey = toText(process.env.JOOBLE_API_KEY);
  if (!apiKey) return [];

  try {
    const response = await axios.post(`${JOOBLE_BASE}/${apiKey}`, {
      keywords: query,
      location: filters.location && filters.location !== 'All' ? filters.location : '',
      page: 1
    }, {
      timeout: SECONDARY_SOURCE_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' }
    });
    const jobs = Array.isArray(response.data?.jobs) ? response.data.jobs : [];
    return jobs.slice(0, maxResults).map((job, index) => mapJoobleJob(job, index));
  } catch (error) {
    console.warn(`[JobService] Jooble failed: ${error?.response?.status || ''} ${error.message}`);
    return [];
  }
}

function mapRemotiveJob(job = {}, index = 0) {
  const description = stripHtml(job.description);
  return normaliseJob({
    id: stableId('remotive', [job.id || index, job.title, job.company_name, job.url]),
    externalJobId: job.id,
    title: job.title,
    company: job.company_name,
    companyLogo: job.company_logo,
    location: job.candidate_required_location || 'Remote',
    salary: job.salary,
    jobType: job.job_type,
    skills: Array.isArray(job.tags) ? job.tags : extractSkillsFromText(job.title, description),
    postedDate: job.publication_date ? String(job.publication_date).split('T')[0] : '',
    description,
    requirements: [],
    benefits: [],
    platform: 'Remotive',
    url: job.url,
    applyUrl: job.url,
    experienceLevel: job.experienceLevel
  }, index, 'Remotive');
}

async function fetchRemotiveJobs(query, maxResults = 40) {
  try {
    const response = await axios.get(REMOTIVE_BASE, {
      params: { search: query },
      timeout: SECONDARY_SOURCE_TIMEOUT_MS
    });
    const jobs = Array.isArray(response.data?.jobs) ? response.data.jobs : [];
    return jobs.slice(0, maxResults).map((job, index) => mapRemotiveJob(job, index));
  } catch (error) {
    console.warn(`[JobService] Remotive failed: ${error?.response?.status || ''} ${error.message}`);
    return [];
  }
}

function mapArbeitnowJob(job = {}, index = 0) {
  const createdAt = Number(job.created_at);
  const postedDate = Number.isFinite(createdAt) && createdAt > 0
    ? new Date(createdAt * 1000).toISOString().split('T')[0]
    : '';
  const description = stripHtml(job.description);

  return normaliseJob({
    id: stableId('arbeitnow', [job.slug || index, job.title, job.company_name, job.url]),
    externalJobId: job.slug,
    title: job.title,
    company: job.company_name,
    companyLogo: '',
    location: job.location || (job.remote ? 'Remote' : 'Europe'),
    salary: job.salary,
    jobType: Array.isArray(job.job_types) ? job.job_types[0] : job.job_types,
    skills: Array.isArray(job.tags) ? job.tags : extractSkillsFromText(job.title, description),
    postedDate,
    description,
    requirements: [],
    benefits: [],
    platform: 'Arbeitnow',
    url: job.url,
    applyUrl: job.url,
    experienceLevel: job.experienceLevel
  }, index, 'Arbeitnow');
}

async function fetchArbeitnowJobs(query, maxResults = 40) {
  try {
    const response = await axios.get(ARBEITNOW_BASE, {
      timeout: SECONDARY_SOURCE_TIMEOUT_MS
    });
    const jobs = Array.isArray(response.data?.data) ? response.data.data : [];
    const needle = toText(query).toLowerCase();
    const filtered = needle
      ? jobs.filter((job) => `${job.title || ''} ${job.company_name || ''} ${(job.tags || []).join(' ')} ${stripHtml(job.description)}`.toLowerCase().includes(needle.split(' ')[0]))
      : jobs;
    return filtered.slice(0, maxResults).map((job, index) => mapArbeitnowJob(job, index));
  } catch (error) {
    console.warn(`[JobService] Arbeitnow failed: ${error?.response?.status || ''} ${error.message}`);
    return [];
  }
}

function matchesLocation(job, filterLocation) {
  if (!filterLocation || filterLocation === 'All') return true;
  const location = toText(job.location).toLowerCase();
  if (filterLocation === 'Remote') return location.includes('remote');
  if (filterLocation === 'Pakistan') {
    return ['pakistan', 'lahore', 'karachi', 'islamabad', 'rawalpindi'].some((value) => location.includes(value));
  }
  if (filterLocation === 'USA') {
    return ['usa', 'united states', 'new york', 'san francisco', 'seattle', 'austin'].some((value) => location.includes(value));
  }
  if (filterLocation === 'Europe') {
    return ['europe', 'uk', 'london', 'germany', 'berlin', 'amsterdam', 'remote eu'].some((value) => location.includes(value));
  }
  return true;
}

function matchesSkill(job, filterSkills) {
  if (!filterSkills) return true;
  const needle = filterSkills.toLowerCase();
  return [job.title, job.description, ...(job.skills || []), ...(job.requirements || [])]
    .some((value) => String(value || '').toLowerCase().includes(needle));
}

function applyFilters(jobs = [], filters = {}) {
  return jobs.filter((job) => {
    if (filters.platform && filters.platform !== 'All' && job.platform !== filters.platform) return false;
    if (!matchesLocation(job, filters.location)) return false;
    if (!matchesSkill(job, filters.skills)) return false;
    if (filters.jobType && filters.jobType !== 'All' && toText(job.jobType).toLowerCase() !== filters.jobType.toLowerCase()) return false;
    if (filters.expLevel && filters.expLevel !== 'All' && toText(job.experienceLevel).toLowerCase() !== filters.expLevel.toLowerCase()) return false;
    return true;
  });
}

function dedupeJobs(jobs = []) {
  const seen = new Set();
  return jobs.filter((job) => {
    const urlKey = toText(job.applyUrl || job.url).toLowerCase().replace(/\/$/, '');
    const key = `${job.title}|${job.company}|${urlKey}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isUsableJob(job = {}) {
  return Boolean(toText(job.title) && toText(job.company) && isHttpUrl(job.applyUrl || job.url));
}

async function fetchLiveJobSources(query, filters) {
  const liveJobs = [];

  const append = (jobs) => {
    if (Array.isArray(jobs) && jobs.length) liveJobs.push(...jobs);
  };

  append(await fetchJSearchJobs(query, 40));
  append(await fetchJoobleJobs(query, filters, 35));
  append(await fetchRemotiveJobs(query, 35));
  append(await fetchArbeitnowJobs(query, 35));

  return dedupeJobs(liveJobs
    .map((job, index) => normaliseJob(job, index, job.source || job.platform || 'Unknown'))
    .filter(isUsableJob));
}

async function buildJobPool(options = {}) {
  const filters = normaliseJobFilters(options);
  const careerStack = toText(options.careerStack) || 'Full Stack';
  const experienceLevel = toText(options.experienceLevel) || 'Student';
  const skillGaps = uniqueStrings(options.skillGaps || [], 12);
  const knownSkills = uniqueStrings(options.knownSkills || [], 18);
  const resumeSkills = uniqueStrings(options.resumeSkills || [], 18);
  const githubSkills = uniqueStrings(options.githubSkills || [], 18);
  const query = [
    careerStack,
    'developer',
    knownSkills.slice(0, 2).join(' '),
    resumeSkills.slice(0, 2).join(' '),
    filters.skills
  ].map(toText).filter(Boolean).join(' ').slice(0, 90);

  const liveJobs = await fetchLiveJobSources(query, filters);
  const cachedFallbackJobs = dedupeJobs((options.cachedFallbackJobs || [])
    .map((job, index) => normaliseJob(job, index, job.source || job.platform || 'Cached'))
    .filter(isUsableJob));
  let pool = liveJobs;
  const hasActiveFilters = [filters.platform, filters.location, filters.jobType, filters.expLevel]
    .some((value) => value && value !== 'All')
    || Boolean(filters.skills);
  const filteredPool = applyFilters(pool, filters);
  pool = hasActiveFilters ? filteredPool : pool;

  if (!pool.length) {
    pool = hasActiveFilters ? applyFilters(cachedFallbackJobs, filters) : cachedFallbackJobs;
  }

  return rankJobs(dedupeJobs(pool).filter(isUsableJob), {
    careerStack,
    experienceLevel,
    skillGaps,
    knownSkills,
    resumeSkills,
    githubSkills
  });
}

module.exports = {
  buildJobPool,
  normaliseJobFilters,
  normaliseJob,
  applyFilters,
  isUsableJob
};
