const axios = require('axios');
const crypto = require('node:crypto');
const aiService = require('./aiservice');
const { getJobPrompt } = require('../prompts/jobPrompt');
const { rankJobs } = require('../utils/jobRanker');
const { getIntegrationSecretsSync } = require('./platformSettingsService');

const JSEARCH_HOST = 'jsearch.p.rapidapi.com';
const JSEARCH_BASE = 'https://jsearch.p.rapidapi.com/search';
const JSEARCH_TIMEOUT_MS = Number.parseInt(process.env.JSEARCH_TIMEOUT_MS || '10000', 10);
const JSEARCH_RETRIES = Number.parseInt(process.env.JSEARCH_RETRIES || '1', 10);
const JSEARCH_PRIMARY_MIN = Number.parseInt(process.env.JSEARCH_PRIMARY_MIN || '30', 10);
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
  Other: { bg: '#6366f1', text: '#ffffff' }
};

const LOCATION_ALIASES = {
  all: 'All',
  remote: 'Remote',
  pakistan: 'Pakistan',
  usa: 'USA',
  europe: 'Europe'
};

const VALID_PLATFORMS = ['All', 'LinkedIn', 'Indeed', 'Rozee', 'Glassdoor', 'RemoteOK'];
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
  if (preferred && VALID_PLATFORMS.includes(preferred) && preferred !== 'All') return preferred;
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

function normaliseJob(job = {}, index = 0, source = 'Unknown') {
  const title = toText(job.title) || 'Software Engineer';
  const company = toText(job.company) || 'Technology Company';
  const location = toText(job.location) || 'Remote';
  const description = toText(job.description) || 'Opportunity to contribute to modern software products with a collaborative engineering team.';
  const platform = inferPlatform(job.url, job.platform);
  const skills = uniqueStrings(Array.isArray(job.skills) ? job.skills : [], 8);
  const jobType = normaliseJobType(job.jobType) === 'All'
    ? (location.toLowerCase().includes('remote') ? 'Remote' : 'Full Time')
    : normaliseJobType(job.jobType);
  const postedDate = /\d{4}-\d{2}-\d{2}/.test(toText(job.postedDate))
    ? toText(job.postedDate)
    : new Date().toISOString().split('T')[0];
  const url = /^https?:\/\//i.test(toText(job.url))
    ? toText(job.url)
    : `https://www.google.com/search?q=${encodeURIComponent(`${title} ${company} job`)}`;
  const experienceLevel = normaliseExperienceLabel(job.experienceLevel);
  const salary = toText(job.salary) || 'Competitive';

  return {
    id: toText(job.id) || stableId('job', [source, title, company, location, platform, index]),
    title,
    company,
    companyLogo: toText(job.companyLogo),
    location,
    salary,
    jobType,
    skills,
    postedDate,
    description,
    platform,
    url,
    experienceLevel,
    source,
    logoFallback: company.charAt(0).toUpperCase(),
    platformColor: PLATFORM_COLORS[platform] || PLATFORM_COLORS.Other
  };
}

function buildFallbackPool(count = 20) {
  const today = new Date();
  const daysAgo = (days) => new Date(today - (days * 86400000)).toISOString().split('T')[0];
  const base = [
    { id: 'fb_001', title: 'Senior Full Stack Developer', company: 'Arbisoft', location: 'Lahore, Pakistan', salary: 'PKR 300,000 - 450,000/month', jobType: 'Full Time', skills: ['Node.js', 'React', 'MongoDB', 'TypeScript', 'AWS'], postedDate: daysAgo(2), description: 'Arbisoft is hiring a senior full stack engineer to ship product features across scalable SaaS systems used by international clients.', platform: 'LinkedIn', url: 'https://linkedin.com/jobs/view/100001', experienceLevel: '3-5 years' },
    { id: 'fb_002', title: 'Frontend Engineer (Angular)', company: 'Systems Limited', location: 'Karachi, Pakistan', salary: 'PKR 200,000 - 320,000/month', jobType: 'Full Time', skills: ['Angular', 'TypeScript', 'RxJS', 'SCSS', 'REST APIs'], postedDate: daysAgo(5), description: 'Build enterprise Angular apps for high-scale finance and telecom products with a mature engineering team.', platform: 'Rozee', url: 'https://rozee.pk/job/frontend-angular-sl', experienceLevel: '1-2 years' },
    { id: 'fb_003', title: 'Node.js Backend Developer', company: 'Netsol Technologies', location: 'Islamabad, Pakistan', salary: 'PKR 250,000 - 380,000/month', jobType: 'Full Time', skills: ['Node.js', 'Express', 'PostgreSQL', 'Docker', 'REST APIs'], postedDate: daysAgo(3), description: 'Netsol needs a backend developer to build API services for global financial software products.', platform: 'Indeed', url: 'https://pk.indeed.com/job/nodejs-netsol-001', experienceLevel: '3-5 years' },
    { id: 'fb_004', title: 'React Developer', company: 'Turing', location: 'Remote', salary: '$4,000 - $6,000/month', jobType: 'Remote', skills: ['React', 'TypeScript', 'Redux', 'GraphQL', 'Jest'], postedDate: daysAgo(1), description: 'Join a distributed product team building a modern fintech experience for a fast-growing US startup.', platform: 'RemoteOK', url: 'https://remoteok.com/remote-jobs/react-turing-001', experienceLevel: '3-5 years' },
    { id: 'fb_005', title: 'Full Stack Engineer', company: '10Pearls', location: 'Lahore, Pakistan', salary: 'PKR 280,000 - 420,000/month', jobType: 'Full Time', skills: ['Angular', 'Node.js', 'MongoDB', 'AWS', 'Docker'], postedDate: daysAgo(7), description: 'Design cloud-native web solutions for international healthcare and education products.', platform: 'LinkedIn', url: 'https://linkedin.com/jobs/view/100005', experienceLevel: '3-5 years' },
    { id: 'fb_006', title: 'Junior React Developer', company: 'Contour Software', location: 'Karachi, Pakistan', salary: 'PKR 120,000 - 180,000/month', jobType: 'Full Time', skills: ['React', 'JavaScript', 'HTML', 'CSS', 'Git'], postedDate: daysAgo(4), description: 'Support established enterprise software products while growing your frontend engineering depth.', platform: 'Rozee', url: 'https://rozee.pk/job/junior-react-contour', experienceLevel: 'Entry' },
    { id: 'fb_007', title: 'DevOps Engineer', company: 'Automattic', location: 'Remote', salary: '$5,000 - $8,000/month', jobType: 'Remote', skills: ['Docker', 'Kubernetes', 'CI/CD', 'AWS', 'Terraform'], postedDate: daysAgo(6), description: 'Help scale remote-first infrastructure and developer workflows for widely used publishing platforms.', platform: 'RemoteOK', url: 'https://remoteok.com/remote-jobs/devops-automattic-001', experienceLevel: '3-5 years' },
    { id: 'fb_008', title: 'Software Engineer - TypeScript/Node', company: 'GitLab', location: 'Remote', salary: '$6,000 - $10,000/month', jobType: 'Remote', skills: ['Node.js', 'TypeScript', 'GraphQL', 'PostgreSQL', 'CI/CD'], postedDate: daysAgo(2), description: 'Ship tooling and automation features for developers working at scale inside an all-remote product company.', platform: 'LinkedIn', url: 'https://linkedin.com/jobs/view/100008', experienceLevel: '3-5 years' },
    { id: 'fb_009', title: 'MERN Stack Developer', company: 'TechVista', location: 'Rawalpindi, Pakistan', salary: 'PKR 150,000 - 250,000/month', jobType: 'Full Time', skills: ['MongoDB', 'Express', 'React', 'Node.js', 'Redux'], postedDate: daysAgo(9), description: 'Own platform features end-to-end for an education-focused startup scaling its student portal.', platform: 'Indeed', url: 'https://pk.indeed.com/job/mern-techvista-002', experienceLevel: '1-2 years' },
    { id: 'fb_010', title: 'Software Engineer Intern - Frontend', company: 'Google', location: 'Remote', salary: '$6,000/month', jobType: 'Internship', skills: ['JavaScript', 'TypeScript', 'React', 'HTML', 'CSS'], postedDate: daysAgo(3), description: 'Work on real frontend engineering tasks under mentorship in a global internship program.', platform: 'LinkedIn', url: 'https://linkedin.com/jobs/view/100010', experienceLevel: 'Intern' },
    { id: 'fb_011', title: 'Backend Engineer - Python/Django', company: 'Toptal', location: 'Remote', salary: '$5,500 - $9,000/month', jobType: 'Contract', skills: ['Python', 'Django', 'PostgreSQL', 'REST APIs', 'Docker'], postedDate: daysAgo(5), description: 'Join a contract fintech project focused on core API layers, system reliability, and delivery speed.', platform: 'Glassdoor', url: 'https://glassdoor.com/job-listing/backend-toptal-001', experienceLevel: '5+ years' },
    { id: 'fb_012', title: 'Angular Developer (Mid-Level)', company: 'i2c Inc', location: 'Lahore, Pakistan', salary: 'PKR 220,000 - 340,000/month', jobType: 'Full Time', skills: ['Angular', 'TypeScript', 'RxJS', 'NgRx', 'SCSS'], postedDate: daysAgo(8), description: 'Build digital banking interfaces with a global payments technology team.', platform: 'Rozee', url: 'https://rozee.pk/job/angular-i2c-003', experienceLevel: '1-2 years' },
    { id: 'fb_013', title: 'Senior Software Engineer - Node.js', company: 'Meta', location: 'Remote', salary: '$12,000 - $18,000/month', jobType: 'Full Time', skills: ['Node.js', 'GraphQL', 'React', 'TypeScript', 'Distributed Systems'], postedDate: daysAgo(1), description: 'Design high-throughput backend systems supporting global messaging and collaboration products.', platform: 'Indeed', url: 'https://pk.indeed.com/job/senior-meta-001', experienceLevel: '5+ years' },
    { id: 'fb_014', title: 'Cloud Engineer - AWS', company: 'Comverse', location: 'Karachi, Pakistan', salary: 'PKR 260,000 - 400,000/month', jobType: 'Full Time', skills: ['AWS', 'Terraform', 'Docker', 'Python', 'CI/CD'], postedDate: daysAgo(11), description: 'Own deployment pipelines and cloud infrastructure for digital telecom platforms.', platform: 'LinkedIn', url: 'https://linkedin.com/jobs/view/100014', experienceLevel: '3-5 years' },
    { id: 'fb_015', title: 'TypeScript / Vue.js Developer', company: 'Shopify', location: 'Remote', salary: '$7,000 - $11,000/month', jobType: 'Remote', skills: ['Vue.js', 'TypeScript', 'GraphQL', 'Node.js', 'PostgreSQL'], postedDate: daysAgo(4), description: 'Build storefront experiences and developer tooling in a globally distributed commerce company.', platform: 'RemoteOK', url: 'https://remoteok.com/remote-jobs/vue-shopify-001', experienceLevel: '3-5 years' }
  ];

  const expanded = [];
  let cycle = 0;
  while (expanded.length < count) {
    for (const job of base) {
      if (expanded.length >= count) break;
      expanded.push(normaliseJob({
        ...job,
        id: `${job.id}_${cycle}`,
        url: cycle === 0 ? job.url : `${job.url}${job.url.includes('?') ? '&' : '?'}variant=${cycle}`
      }, expanded.length, 'Fallback'));
    }
    cycle += 1;
  }

  return expanded.slice(0, count);
}

function mapJSearchJob(job = {}, index = 0) {
  const applyLink = toText(job.job_apply_link);
  const location = [job.job_city, job.job_state, job.job_country].filter(Boolean).join(', ') || (job.job_is_remote ? 'Remote' : 'Remote');
  const salary = job.job_min_salary && job.job_max_salary
    ? `$${job.job_min_salary}-${job.job_max_salary}/${job.job_salary_period || 'year'}`
    : 'Competitive';
  const skills = Array.isArray(job.job_required_skills)
    ? job.job_required_skills
    : [];
  const experienceLevel = typeof job.job_required_experience?.required_experience_in_months === 'number'
    ? mapExperienceMonthsToLabel(job.job_required_experience.required_experience_in_months)
    : 'Entry';

  return normaliseJob({
    id: stableId('jsearch', [job.job_id || index, job.job_title, job.employer_name, applyLink]),
    title: job.job_title,
    company: job.employer_name,
    companyLogo: job.employer_logo || '',
    location,
    salary,
    jobType: String(job.job_employment_type || '').replace('_', ' '),
    skills,
    postedDate: job.job_posted_at_datetime_utc ? String(job.job_posted_at_datetime_utc).split('T')[0] : '',
    description: String(job.job_description || '').replace(/\s+/g, ' ').slice(0, 360),
    platform: inferPlatform(applyLink),
    url: applyLink,
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

async function generateAIJobs(options = {}) {
  const prompt = getJobPrompt({
    ...options,
    totalCount: options.aiCount || 30
  });
  const fallback = JSON.stringify(buildFallbackPool(options.aiCount || 30));

  try {
    const rawResult = await aiService.runAIAnalysis(prompt, fallback);
    let parsed;

    if (typeof rawResult === 'string') {
      const match = /\[[\s\S]*\]/.exec(rawResult);
      if (!match) throw new Error('No JSON array found in AI job response.');
      parsed = JSON.parse(match[0]);
    } else if (Array.isArray(rawResult)) {
      parsed = rawResult;
    } else {
      throw new Error('Unexpected AI job response type.');
    }

    return parsed
      .filter((job) => job?.title && job?.company)
      .map((job, index) => normaliseJob({
        ...job,
        id: toText(job.id) || stableId('ai', [job.title, job.company, job.location, index])
      }, index, 'AI'));
  } catch (error) {
    console.warn('[JobService] AI generation failed:', error.message);
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
  return [job.title, job.description, ...(job.skills || [])]
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
    const key = `${job.title}|${job.company}|${job.location}|${job.platform}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

  const jsearchJobs = await fetchJSearchJobs(query, 40);
  let aiJobs = [];
  if (jsearchJobs.length < JSEARCH_PRIMARY_MIN) {
    const aiNeeded = Math.max(20, 60 - jsearchJobs.length);
    aiJobs = await generateAIJobs({
      careerStack,
      experienceLevel,
      skillGaps,
      knownSkills,
      resumeSkills,
      githubSkills,
      platform: filters.platform,
      location: filters.location,
      jobType: filters.jobType,
      skills: filters.skills,
      aiCount: aiNeeded
    });
  }

  const combined = dedupeJobs([...jsearchJobs, ...aiJobs].map((job, index) => normaliseJob(job, index, job.source || 'Unknown')));
  let pool = combined.length >= 5 ? combined : buildFallbackPool(80);
  const hasActiveFilters = [filters.platform, filters.location, filters.jobType, filters.expLevel]
    .some((value) => value && value !== 'All')
    || Boolean(filters.skills);
  const filteredPool = applyFilters(pool, filters);
  pool = hasActiveFilters ? filteredPool : pool;

  if (!pool.length) {
    pool = applyFilters(buildFallbackPool(60), filters);
  }

  return rankJobs(pool, {
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
  normaliseJobFilters
};
