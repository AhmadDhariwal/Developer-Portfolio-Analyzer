/**
 * Job Service — pool-based job generation via AI (Gemini) + optional JSearch (RapidAPI).
 * Falls back to a hardcoded pool when both sources fail.
 */

const axios       = require('axios');
const aiService   = require('./aiservice');
const { getJobPrompt } = require('../prompts/jobPrompt');
const { rankJobs }     = require('../utils/jobRanker');

const RAPIDAPI_KEY  = process.env.RAPIDAPI_KEY || '';
const JSEARCH_HOST  = 'jsearch.p.rapidapi.com';
const JSEARCH_BASE  = 'https://jsearch.p.rapidapi.com/search';
const JSEARCH_TIMEOUT_MS = Number.parseInt(process.env.JSEARCH_TIMEOUT_MS || '10000', 10);
const JSEARCH_RETRIES = Number.parseInt(process.env.JSEARCH_RETRIES || '1', 10);
const JSEARCH_PRIMARY_MIN = Number.parseInt(process.env.JSEARCH_PRIMARY_MIN || '30', 10);

// Platform colour map attached to each job object
const PLATFORM_COLORS = {
  LinkedIn:  { bg: '#0077B5', text: '#ffffff' },
  Indeed:    { bg: '#003A9B', text: '#ffffff' },
  Rozee:     { bg: '#e8282f', text: '#ffffff' },
  Glassdoor: { bg: '#0CAA41', text: '#ffffff' },
  RemoteOK:  { bg: '#14b8a6', text: '#ffffff' },
  Other:     { bg: '#6366f1', text: '#ffffff' }
};

// ─── Hardcoded fallback pool (20 jobs) ───────────────────────────────────────

function buildFallbackPool(count = 20) {
  const today = new Date();
  const daysAgo = (n) => new Date(today - n * 86400000).toISOString().split('T')[0];

  const base = [
    { id: 'fb_001', title: 'Senior Full Stack Developer', company: 'Arbisoft', companyLogo: '', location: 'Lahore, Pakistan', salary: 'PKR 300,000 - 450,000/month', jobType: 'Full Time', skills: ['Node.js', 'React', 'MongoDB', 'TypeScript', 'AWS'], postedDate: daysAgo(2), description: 'Arbisoft is seeking a senior full stack developer to build scalable SaaS products. You will own features end-to-end, from database design to pixel-perfect UI delivery. Join a team of 700+ engineers working on global products.', platform: 'LinkedIn', url: 'https://linkedin.com/jobs/view/100001', experienceLevel: '3-5 years' },
    { id: 'fb_002', title: 'Frontend Engineer (Angular)', company: 'Systems Limited', companyLogo: '', location: 'Karachi, Pakistan', salary: 'PKR 200,000 - 320,000/month', jobType: 'Full Time', skills: ['Angular', 'TypeScript', 'RxJS', 'SCSS', 'REST APIs'], postedDate: daysAgo(5), description: 'Systems Limited is hiring a frontend engineer to develop enterprise-grade Angular applications for banking and telecom clients. You will collaborate with cross-functional teams to deliver high-quality user experiences.', platform: 'Rozee', url: 'https://rozee.pk/job/frontend-angular-sl', experienceLevel: '1-2 years' },
    { id: 'fb_003', title: 'Node.js Backend Developer', company: 'Netsol Technologies', companyLogo: '', location: 'Islamabad, Pakistan', salary: 'PKR 250,000 - 380,000/month', jobType: 'Full Time', skills: ['Node.js', 'Express', 'PostgreSQL', 'Docker', 'REST APIs'], postedDate: daysAgo(3), description: 'Netsol Technologies is looking for a Node.js developer to build microservices for its global fleet financing platform. You will work on high-volume APIs processing millions of transactions daily.', platform: 'Indeed', url: 'https://pk.indeed.com/job/nodejs-netsol-001', experienceLevel: '3-5 years' },
    { id: 'fb_004', title: 'React Developer', company: 'Turing', companyLogo: '', location: 'Remote', salary: '$4,000 - $6,000/month', jobType: 'Remote', skills: ['React', 'TypeScript', 'Redux', 'GraphQL', 'Jest'], postedDate: daysAgo(1), description: 'Turing connects top engineers with US tech companies. This role places you on a Silicon Valley startup building a next-generation fintech product. Work 100% remotely with a high-performing distributed team.', platform: 'RemoteOK', url: 'https://remoteok.com/remote-jobs/react-turing-001', experienceLevel: '3-5 years' },
    { id: 'fb_005', title: 'Full Stack Engineer', company: '10Pearls', companyLogo: '', location: 'Lahore, Pakistan', salary: 'PKR 280,000 - 420,000/month', jobType: 'Full Time', skills: ['Angular', 'Node.js', 'MongoDB', 'AWS', 'Docker'], postedDate: daysAgo(7), description: '10Pearls is a digital innovation company seeking a full stack engineer to join its product engineering team. You will design cloud-native solutions for healthcare and education clients across North America.', platform: 'LinkedIn', url: 'https://linkedin.com/jobs/view/100005', experienceLevel: '3-5 years' },
    { id: 'fb_006', title: 'Junior React Developer', company: 'Contour Software', companyLogo: '', location: 'Karachi, Pakistan', salary: 'PKR 120,000 - 180,000/month', jobType: 'Full Time', skills: ['React', 'JavaScript', 'HTML', 'CSS', 'Git'], postedDate: daysAgo(4), description: 'Contour Software, a subsidiary of Constellation Software, is hiring a junior React developer for its Lahore R&D centre. You will maintain and enhance established enterprise software used by thousands of businesses.', platform: 'Rozee', url: 'https://rozee.pk/job/junior-react-contour', experienceLevel: 'Entry' },
    { id: 'fb_007', title: 'DevOps Engineer', company: 'Automattic', companyLogo: '', location: 'Remote', salary: '$5,000 - $8,000/month', jobType: 'Remote', skills: ['Docker', 'Kubernetes', 'CI/CD', 'AWS', 'Terraform'], postedDate: daysAgo(6), description: 'Automattic (WordPress.com) is a fully remote company hiring a DevOps engineer to maintain infrastructure serving 40% of the web. Help scale platforms used by millions of developers daily.', platform: 'RemoteOK', url: 'https://remoteok.com/remote-jobs/devops-automattic-001', experienceLevel: '3-5 years' },
    { id: 'fb_008', title: 'Software Engineer – TypeScript/Node', company: 'GitLab', companyLogo: '', location: 'Remote', salary: '$6,000 - $10,000/month', jobType: 'Remote', skills: ['Node.js', 'TypeScript', 'GraphQL', 'PostgreSQL', 'Ruby on Rails'], postedDate: daysAgo(2), description: "GitLab is the world's largest all-remote company. This role is on the CI/CD team, building the pipelines that millions of developers rely on every day. You will ship features used globally within weeks of joining.", platform: 'LinkedIn', url: 'https://linkedin.com/jobs/view/100008', experienceLevel: '3-5 years' },
    { id: 'fb_009', title: 'MERN Stack Developer', company: 'TechVista', companyLogo: '', location: 'Rawalpindi, Pakistan', salary: 'PKR 150,000 - 250,000/month', jobType: 'Full Time', skills: ['MongoDB', 'Express', 'React', 'Node.js', 'Redux'], postedDate: daysAgo(9), description: 'TechVista is a growing startup delivering EdTech solutions to Pakistani universities. We need a MERN developer to own our student portal from API to UI and help us scale to 100k users.', platform: 'Indeed', url: 'https://pk.indeed.com/job/mern-techvista-002', experienceLevel: '1-2 years' },
    { id: 'fb_010', title: 'Software Engineer Intern – Frontend', company: 'Google', companyLogo: '', location: 'Remote', salary: '$6,000/month', jobType: 'Internship', skills: ['JavaScript', 'TypeScript', 'React', 'HTML', 'CSS'], postedDate: daysAgo(3), description: "Google's Software Engineering internship program gives students hands-on experience shipping code used by billions. Interns are assigned a mentor, a real project, and full access to Google's engineering resources.", platform: 'LinkedIn', url: 'https://linkedin.com/jobs/view/100010', experienceLevel: 'Intern' },
    { id: 'fb_011', title: 'Backend Engineer – Python/Django', company: 'Toptal', companyLogo: '', location: 'Remote', salary: '$5,500 - $9,000/month', jobType: 'Contract', skills: ['Python', 'Django', 'PostgreSQL', 'REST APIs', 'Docker'], postedDate: daysAgo(5), description: 'Toptal connects the top 3% of freelance engineers with elite clients. This contract role is with a Series-B fintech startup in New York building out their core banking API layer. Strong Python skills required.', platform: 'Glassdoor', url: 'https://glassdoor.com/job-listing/backend-toptal-001', experienceLevel: '5+ years' },
    { id: 'fb_012', title: 'Angular Developer (Mid-Level)', company: 'i2c Inc', companyLogo: '', location: 'Lahore, Pakistan', salary: 'PKR 220,000 - 340,000/month', jobType: 'Full Time', skills: ['Angular', 'TypeScript', 'RxJS', 'NgRx', 'SCSS'], postedDate: daysAgo(8), description: 'i2c Inc. is a global payments and banking technology company. Join their Lahore engineering hub to build next-generation card issuing and digital banking interfaces used by 200+ financial institutions globally.', platform: 'Rozee', url: 'https://rozee.pk/job/angular-i2c-003', experienceLevel: '1-2 years' },
    { id: 'fb_013', title: 'Senior Software Engineer – Node.js', company: 'Meta', companyLogo: '', location: 'Remote', salary: '$12,000 - $18,000/month', jobType: 'Full Time', skills: ['Node.js', 'GraphQL', 'React', 'TypeScript', 'Distributed Systems'], postedDate: daysAgo(1), description: "Meta is hiring senior engineers for WhatsApp's infrastructure team. You will design high-throughput messaging systems serving billions of daily active users and mentor junior engineers across the globe.", platform: 'Indeed', url: 'https://pk.indeed.com/job/senior-meta-001', experienceLevel: '5+ years' },
    { id: 'fb_014', title: 'Cloud Engineer – AWS', company: 'Comverse', companyLogo: '', location: 'Karachi, Pakistan', salary: 'PKR 260,000 - 400,000/month', jobType: 'Full Time', skills: ['AWS', 'Terraform', 'Docker', 'Python', 'CI/CD'], postedDate: daysAgo(11), description: 'Comverse delivers digital BSS solutions for telecom operators across 80 countries. Join as a cloud engineer to build and maintain AWS infrastructure handling billions of telecom transactions per month.', platform: 'LinkedIn', url: 'https://linkedin.com/jobs/view/100014', experienceLevel: '3-5 years' },
    { id: 'fb_015', title: 'TypeScript / Vue.js Developer', company: 'Shopify', companyLogo: '', location: 'Remote', salary: '$7,000 - $11,000/month', jobType: 'Remote', skills: ['Vue.js', 'TypeScript', 'GraphQL', 'Node.js', 'PostgreSQL'], postedDate: daysAgo(4), description: "Shopify powers over 1.7 million businesses worldwide. This role on the Storefront team lets you build the tools merchants use to grow their businesses. Shopify is fully distributed — work from anywhere.", platform: 'RemoteOK', url: 'https://remoteok.com/remote-jobs/vue-shopify-001', experienceLevel: '3-5 years' },
    { id: 'fb_016', title: 'Junior Backend Developer', company: 'Krave Mart', companyLogo: '', location: 'Lahore, Pakistan', salary: 'PKR 100,000 - 160,000/month', jobType: 'Full Time', skills: ['Node.js', 'Express', 'MongoDB', 'REST APIs', 'Git'], postedDate: daysAgo(6), description: 'Krave Mart is a fast-growing e-commerce startup in Pakistan. Grow your backend skills in a fast-paced startup environment, building APIs that serve thousands of daily orders across Pakistan.', platform: 'Rozee', url: 'https://rozee.pk/job/junior-backend-krave', experienceLevel: 'Entry' },
    { id: 'fb_017', title: 'Full Stack Developer – React + .NET', company: 'Devsinc', companyLogo: '', location: 'Islamabad, Pakistan', salary: 'PKR 240,000 - 360,000/month', jobType: 'Full Time', skills: ['React', 'C#', '.NET Core', 'SQL Server', 'Azure'], postedDate: daysAgo(14), description: 'Devsinc is an offshore software development company delivering solutions for US and UK clients. Join as a full stack developer building enterprise web applications for clients across retail, healthcare and logistics.', platform: 'Indeed', url: 'https://pk.indeed.com/job/fullstack-devsinc-002', experienceLevel: '3-5 years' },
    { id: 'fb_018', title: 'Data Engineer – Python & Spark', company: 'Amazon', companyLogo: '', location: 'Remote', salary: '$9,000 - $14,000/month', jobType: 'Full Time', skills: ['Python', 'Apache Spark', 'AWS', 'SQL', 'Airflow'], postedDate: daysAgo(2), description: "Amazon's AWS Data Platform team is hiring a data engineer to build pipelines that power ML models serving AWS customers. Work with Petabyte-scale data sets and world-class distributed infrastructure.", platform: 'Glassdoor', url: 'https://glassdoor.com/job-listing/data-amazon-001', experienceLevel: '5+ years' },
    { id: 'fb_019', title: 'Mobile Developer – React Native', company: 'Careem', companyLogo: '', location: 'Karachi, Pakistan', salary: 'PKR 350,000 - 500,000/month', jobType: 'Full Time', skills: ['React Native', 'TypeScript', 'Redux', 'REST APIs', 'Firebase'], postedDate: daysAgo(7), description: 'Careem, a subsidiary of Uber, is hiring a React Native developer for its Super App team. Work on an app used by 50M+ customers across 15 countries, shipping new features every two weeks.', platform: 'LinkedIn', url: 'https://linkedin.com/jobs/view/100019', experienceLevel: '3-5 years' },
    { id: 'fb_020', title: 'Software Engineer II – Frontend', company: 'Microsoft', companyLogo: '', location: 'Remote', salary: '$8,000 - $13,000/month', jobType: 'Full Time', skills: ['React', 'TypeScript', 'Azure DevOps', 'GraphQL', 'Unit Testing'], postedDate: daysAgo(3), description: "Microsoft Azure's developer tools team is looking for a passionate frontend engineer to build the next generation of cloud development tools. Shape the workflow of millions of developers using Azure every day.", platform: 'Indeed', url: 'https://pk.indeed.com/job/swe-microsoft-001', experienceLevel: '5+ years' }
  ];

  const expanded = [];
  let cycle = 0;
  while (expanded.length < count) {
    for (const job of base) {
      if (expanded.length >= count) break;
      const querySeparator = job.url.includes('?') ? '&' : '?';
      const jobUrl = cycle === 0 ? job.url : `${job.url}${querySeparator}variant=${cycle}`;
      expanded.push({
        ...job,
        id: `${job.id}_c${cycle}`,
        company: cycle === 0 ? job.company : `${job.company} (${cycle + 1})`,
        url: jobUrl
      });
    }
    cycle += 1;
  }

  return expanded.map(j => ({ ...j, source: 'Fallback', platformColor: PLATFORM_COLORS[j.platform] || PLATFORM_COLORS.Other }));
}

// ─── JSearch (RapidAPI) integration ──────────────────────────────────────────

function mapExperienceMonthsToLabel(months) {
  if (months < 12) return 'Entry';
  if (months < 36) return '1-2 years';
  if (months < 60) return '3-5 years';
  return '5+ years';
}

function mapJSearchJob(j, idx) {
  const applyLink = j.job_apply_link || '';
  let platform = 'Other';
  if (applyLink.includes('linkedin.com')) platform = 'LinkedIn';
  else if (applyLink.includes('indeed.com')) platform = 'Indeed';
  else if (applyLink.includes('glassdoor.com')) platform = 'Glassdoor';
  else if (applyLink.includes('remoteok.com')) platform = 'RemoteOK';
  else if (applyLink.includes('rozee.pk')) platform = 'Rozee';

  const months = j.job_required_experience?.required_experience_in_months;
  const experienceLevel = typeof months === 'number' ? mapExperienceMonthsToLabel(months) : 'Entry';

  return {
    id: `jsearch_${idx}_${Date.now()}`,
    title: j.job_title || 'Software Engineer',
    company: j.employer_name || 'Tech Company',
    companyLogo: j.employer_logo || '',
    location: [j.job_city, j.job_state, j.job_country].filter(Boolean).join(', ') || 'Remote',
    salary: j.job_min_salary && j.job_max_salary
      ? `$${j.job_min_salary}-$${j.job_max_salary}/${j.job_salary_period || 'year'}`
      : 'Competitive',
    jobType: (j.job_employment_type || 'FULLTIME').replace('_', ' ').replace('FULLTIME', 'Full Time').replace('CONTRACTOR', 'Contract').replace('PARTTIME', 'Part Time').replace('INTERN', 'Internship'),
    skills: (j.job_required_skills || []).slice(0, 7),
    postedDate: j.job_posted_at_datetime_utc
      ? j.job_posted_at_datetime_utc.split('T')[0]
      : new Date().toISOString().split('T')[0],
    description: (j.job_description || '').substring(0, 250).replaceAll('\n', ' ').trim(),
    platform,
    url: applyLink || 'https://linkedin.com/jobs',
    experienceLevel,
    source: 'JSearch'
  };
}

async function fetchJSearchJobs(query, maxResults = 80) {
  if (!RAPIDAPI_KEY || RAPIDAPI_KEY === 'your_rapidapi_key') {
    console.warn('[JobService] JSearch disabled: RAPIDAPI_KEY is missing or placeholder.');
    return [];
  }
  const headers = {
    'X-RapidAPI-Key': RAPIDAPI_KEY,
    'X-RapidAPI-Host': JSEARCH_HOST,
    'User-Agent': 'Developer-Portfolio-Analyzer/1.0'
  };

  for (let attempt = 0; attempt <= JSEARCH_RETRIES; attempt++) {
    const reducedQuery = attempt > 0 ? `${query} developer` : query;
    const maxPages = Math.max(1, Math.min(Math.ceil(maxResults / 10), attempt > 0 ? 2 : 3));

    try {
      const aggregated = [];

      for (let page = 1; page <= maxPages; page++) {
        const response = await axios.get(JSEARCH_BASE, {
          params: { query: reducedQuery, page, num_pages: 1 },
          headers,
          timeout: JSEARCH_TIMEOUT_MS
        });

        const pageData = response.data?.data || [];
        if (!pageData.length) break;
        aggregated.push(...pageData);

        if (aggregated.length >= maxResults) break;
      }

      if (aggregated.length) {
        return aggregated.slice(0, maxResults).map((j, idx) => mapJSearchJob(j, idx));
      }
    } catch (err) {
      const status = err?.response?.status;
      const message = err?.response?.data?.message || err.message;
      const statusText = status ? ` (status ${status})` : '';
      console.warn(`[JobService] JSearch attempt ${attempt + 1} failed${statusText}: ${message}`);

      if (status === 401 || status === 403) break;
      if (status === 429) {
        await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
        continue;
      }
      if (attempt < JSEARCH_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
      }
    }
  }

  return [];
}

// ─── AI job generation (Gemini) ──────────────────────────────────────────────

async function generateAIJobs(options = {}) {
  const prompt   = getJobPrompt({ ...options, totalCount: options.aiCount || 40 });
  const fallback = JSON.stringify(buildFallbackPool(options.aiCount || 40));
  try {
    const raw = await aiService.runAIAnalysis(prompt, fallback);
    let parsed;
    if (typeof raw === 'string') {
      const match = /\[[\s\S]*\]/.exec(raw);
      if (!match) throw new Error('No JSON array in AI response');
      parsed = JSON.parse(match[0]);
    } else if (Array.isArray(raw)) {
      parsed = raw;
    } else {
      throw new TypeError('Unexpected AI response type');
    }
    if (!Array.isArray(parsed)) throw new Error('Parsed result is not array');
    return parsed
      .filter((job) => job?.title && job?.company && job?.platform)
      .map((j, idx) => ({
        id: j.id || `ai_${idx}_${Date.now()}`,
        title:            String(j.title || '').trim(),
        company:          String(j.company || '').trim(),
        companyLogo:      j.companyLogo || '',
        location:         String(j.location || 'Remote').trim(),
        salary:           String(j.salary || 'Competitive').trim(),
        jobType:          String(j.jobType || 'Full Time').trim(),
        skills:           Array.isArray(j.skills) ? j.skills.slice(0, 7) : [],
        postedDate:       String(j.postedDate || new Date().toISOString().split('T')[0]),
        description:      String(j.description || '').trim(),
        platform:         String(j.platform || 'LinkedIn').trim(),
        url:              String(j.url || '').trim(),
        experienceLevel:  String(j.experienceLevel || 'Entry').trim(),
        source:           'AI'
      }));
  } catch (err) {
    console.warn('[JobService] AI generation failed:', err.message);
    return [];
  }
}

// ─── Filter application ───────────────────────────────────────────────────────

function applyFilters(jobs, { platform, location, skills, jobType, experienceLevel } = {}) {
  return jobs.filter(job => {
    if (platform && platform !== 'All' && job.platform !== platform) return false;
    if (location && location !== 'All') {
      const loc = (job.location || '').toLowerCase();
      const filter = location.toLowerCase();
      if (filter === 'remote' && !loc.includes('remote')) return false;
      if (filter === 'pakistan' && !loc.includes('pakistan') && !loc.includes('lahore') && !loc.includes('karachi') && !loc.includes('islamabad') && !loc.includes('rawalpindi')) return false;
      if (filter === 'usa' && !loc.includes('usa') && !loc.includes('united states') && !loc.includes('new york') && !loc.includes('san francisco')) return false;
      if (filter === 'europe' && !loc.includes('europe') && !loc.includes('uk') && !loc.includes('germany')) return false;
    }
    if (skills?.trim()) {
      const s = skills.toLowerCase();
      const jobSkillsText = (job.skills || []).join(' ').toLowerCase();
      const titleText = job.title.toLowerCase();
      if (!jobSkillsText.includes(s) && !titleText.includes(s)) return false;
    }
    if (jobType && jobType !== 'All') {
      if ((job.jobType || '').toLowerCase() !== jobType.toLowerCase()) return false;
    }
    if (experienceLevel && experienceLevel !== 'All') {
      if ((job.experienceLevel || '').toLowerCase() !== experienceLevel.toLowerCase()) return false;
    }
    return true;
  });
}

// ─── Main exported function ───────────────────────────────────────────────────

/**
 * Builds a ranked, filtered job pool.
 * @param {Object} options - filter + profile options
 * @returns {Promise<Object[]>} sorted job array (no pagination)
 */
async function buildJobPool(options = {}) {
  const {
    careerStack     = 'Full Stack',
    experienceLevel = 'Intermediate',
    skillGaps       = [],
    knownSkills     = [],
    platform        = 'All',
    location        = 'All',
    skills          = '',
    jobType         = 'All',
    experience      = 'All'   // filter-level experience override
  } = options;

  const queryParts = [careerStack, 'developer', knownSkills.slice(0, 2).join(' '), skills]
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  const query = queryParts.join(' ').slice(0, 80);

  // Primary source is JSearch. AI is used only when JSearch is insufficient.
  const jsearchJobs = await fetchJSearchJobs(query, 40);
  let aiJobs = [];

  if (jsearchJobs.length < JSEARCH_PRIMARY_MIN) {
    const aiNeeded = Math.max(20, 60 - jsearchJobs.length);
    aiJobs = await generateAIJobs({
      careerStack,
      experienceLevel,
      skillGaps,
      knownSkills,
      platform,
      location,
      jobType,
      skills,
      aiCount: aiNeeded
    });
  }

  // Merge and deduplicate by title+company
  const seen = new Set();
  const merged = [...jsearchJobs, ...aiJobs].filter(job => {
    const key = `${job.title}|${job.company}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let pool = merged.length >= 5 ? merged : buildFallbackPool(80);

  // Apply client filters
  const filterExperience = experience === 'All' ? null : experience;
  const filtered = applyFilters(pool, { platform, location, skills, jobType, experienceLevel: filterExperience });
  const hasActiveFilters = [platform, location, jobType, filterExperience]
    .some((value) => String(value || '').trim() && String(value || '').trim() !== 'All')
    || Boolean(String(skills || '').trim());
  pool = hasActiveFilters ? filtered : pool;

  // Attach platform colours
  pool = pool.map(job => ({
    ...job,
    platformColor: PLATFORM_COLORS[job.platform] || PLATFORM_COLORS.Other
  }));

  // Rank and return sorted pool (no pagination — controller slices)
  return rankJobs(pool, { careerStack, experienceLevel, skillGaps, knownSkills });
}

module.exports = { buildJobPool };
