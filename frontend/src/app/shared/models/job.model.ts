export type JobPlatform = 'JSearch' | 'Jooble' | 'Adzuna' | 'Remotive' | 'Arbeitnow' | 'LinkedIn' | 'Indeed' | 'Rozee' | 'Glassdoor' | 'RemoteOK' | 'Other' | 'All';
export type JobType = 'Full Time' | 'Part Time' | 'Contract' | 'Internship' | 'Remote' | 'All';
export type JobExperienceFilter = 'Intern' | 'Entry' | '1-2 years' | '3-5 years' | '5+ years' | 'All';
export type JobLocation = 'Pakistan' | 'Remote' | 'USA' | 'Europe' | 'All';

export interface PlatformColor {
  bg: string;
  text: string;
}

export interface Job {
  id: string;
  externalJobId?: string;
  title: string;
  company: string;
  companyLogo: string;
  location: string;
  salary: string;
  jobType: string;
  skills: string[];
  postedDate: string;
  description: string;
  requirements: string[];
  benefits: string[];
  platform: JobPlatform;
  url: string;
  applyUrl: string;
  experienceLevel: string;
  source?: string;
  score?: number;
  matchScore?: number;
  experienceMatch?: number;
  skillMatch?: number;
  missingSkills?: string[];
  whyMatched?: string;
  recommendedCourse?: {
    title: string;
    platform: string;
    url: string;
    whyRecommended?: string;
  } | null;
  recommendedSprintTask?: {
    title: string;
    description?: string;
    category?: string;
    priority?: string;
    points?: number;
  } | null;
  platformColor?: PlatformColor;
}

export interface JobFilters {
  platform: JobPlatform | 'All';
  experienceLevel: JobExperienceFilter | 'All';
  jobType: JobType | 'All';
  location: JobLocation | 'All';
  skills: string;
}

export interface JobRecommendedBasedOn {
  careerStack: string;
  experienceLevel: string;
  knownSkills: string[];
  skillGaps: string[];
  resumeSkills: string[];
  githubSkills: string[];
  activeFilters: {
    platform: JobFilters['platform'];
    location: JobFilters['location'];
    skills: string;
    jobType: JobFilters['jobType'];
    experienceLevel: JobFilters['experienceLevel'];
  };
  fromCache?: boolean;
  summary: string;
}

export interface JobsResponse {
  jobs: Job[];
  total: number;
  page: number;
  totalPages: number;
  hasMore: boolean;
  fromCache?: boolean;
  sourceMessage?: string;
  primarySource?: string;
  sourceSummary?: Record<string, number>;
  sourceFailures?: Array<{
    source: string;
    reason: string;
    status?: number;
    configured?: boolean;
    detail?: string;
  }>;
  cacheCount?: number;
  warning?: string;
  jsearchConfigured?: boolean;
  joobleConfigured?: boolean;
  diagnostics?: {
    query?: string;
    sourceSummaryFetched?: Record<string, number>;
    sourceSummaryUsable?: Record<string, number>;
    sourceSummaryAfterSourceDedupe?: Record<string, number>;
    sourceSummaryBeforeRank?: Record<string, number>;
    sourceSummaryFinal?: Record<string, number>;
    sourceFailures?: Array<{
      source: string;
      reason: string;
      status?: number;
      configured?: boolean;
      detail?: string;
    }>;
    sourceConfigs?: Record<string, { configured: boolean }>;
    applyFilters?: {
      before: number;
      after: number;
      removed: number;
      removedBySkill: number;
      removedByExperience: number;
      removedByLocation: number;
      removedByPlatform: number;
      warning?: string;
    };
    dedupeJobs?: { before: number; after: number; removed: number };
    rankJobs?: { inputCount: number; sourceSummary?: Record<string, number> };
    cacheFallback?: { available: number; used: boolean };
    cacheWrite?: {
      attempted: number;
      synced: number;
      upserted: number;
      modified: number;
      matched: number;
      failed: boolean;
      error?: string;
    };
    cacheCount?: number;
    fromCacheOnly?: boolean;
  };
  recommendedBasedOn?: JobRecommendedBasedOn | null;
}

export interface ActiveJobFilterChip {
  key: keyof JobFilters;
  label: string;
  value: string;
}

export interface JobUiState {
  saved: boolean;
  applied: boolean;
  hidden: boolean;
}

export const DEFAULT_JOB_FILTERS: JobFilters = {
  platform: 'All',
  experienceLevel: 'All',
  jobType: 'All',
  location: 'All',
  skills: ''
};

export const JOB_PLATFORM_OPTIONS: { value: JobPlatform | 'All'; label: string }[] = [
  { value: 'All', label: 'All Sources' },
  { value: 'JSearch', label: 'JSearch' },
  { value: 'Jooble', label: 'Jooble' },
  { value: 'Adzuna', label: 'Adzuna' },
  { value: 'Remotive', label: 'Remotive' },
  { value: 'Arbeitnow', label: 'Arbeitnow' },
  { value: 'LinkedIn', label: 'LinkedIn' },
  { value: 'Indeed', label: 'Indeed' },
  { value: 'Rozee', label: 'Rozee.pk' },
  { value: 'Glassdoor', label: 'Glassdoor' },
  { value: 'RemoteOK', label: 'RemoteOK' }
];

export const JOB_EXPERIENCE_OPTIONS: { value: JobExperienceFilter | 'All'; label: string }[] = [
  { value: 'All', label: 'All Levels' },
  { value: 'Intern', label: 'Intern' },
  { value: 'Entry', label: 'Entry Level' },
  { value: '1-2 years', label: '1-2 Years' },
  { value: '3-5 years', label: '3-5 Years' },
  { value: '5+ years', label: '5+ Years' }
];

export const JOB_TYPE_OPTIONS: { value: JobType | 'All'; label: string }[] = [
  { value: 'All', label: 'All Types' },
  { value: 'Full Time', label: 'Full Time' },
  { value: 'Part Time', label: 'Part Time' },
  { value: 'Contract', label: 'Contract' },
  { value: 'Internship', label: 'Internship' },
  { value: 'Remote', label: 'Remote' }
];

export const JOB_LOCATION_OPTIONS: { value: JobLocation | 'All'; label: string }[] = [
  { value: 'All', label: 'All Locations' },
  { value: 'Pakistan', label: 'Pakistan' },
  { value: 'Remote', label: 'Remote' },
  { value: 'USA', label: 'USA' },
  { value: 'Europe', label: 'Europe' }
];

export const JOB_SKILL_OPTIONS = [
  'Node.js', 'Angular', 'React', 'Vue.js', 'TypeScript', 'JavaScript',
  'Python', 'Django', 'Flask', 'Docker', 'Kubernetes', 'AWS',
  'MongoDB', 'PostgreSQL', 'GraphQL', 'REST APIs', 'React Native',
  'Next.js', 'Tailwind CSS', 'Git', 'CI/CD', 'Microservices',
  'Spring Boot', 'PHP', 'Laravel', 'Redux', '.NET'
];

export const JOB_PLATFORM_COLOR_MAP: Record<string, PlatformColor> = {
  JSearch: { bg: '#2563eb', text: '#ffffff' },
  Jooble: { bg: '#f97316', text: '#111827' },
  Adzuna: { bg: '#0ea5e9', text: '#082f49' },
  Remotive: { bg: '#22c55e', text: '#052e16' },
  Arbeitnow: { bg: '#38bdf8', text: '#082f49' },
  LinkedIn: { bg: '#0077B5', text: '#ffffff' },
  Indeed: { bg: '#003A9B', text: '#ffffff' },
  Rozee: { bg: '#e8282f', text: '#ffffff' },
  Glassdoor: { bg: '#0CAA41', text: '#ffffff' },
  RemoteOK: { bg: '#14b8a6', text: '#ffffff' },
  Other: { bg: '#6366f1', text: '#ffffff' }
};

export function normalizeJobFilters(filters: Partial<JobFilters> = {}): JobFilters {
  const platform = JOB_PLATFORM_OPTIONS.some((option) => option.value === filters.platform)
    ? (filters.platform as JobFilters['platform'])
    : 'All';
  const experienceLevel = JOB_EXPERIENCE_OPTIONS.some((option) => option.value === filters.experienceLevel)
    ? (filters.experienceLevel as JobFilters['experienceLevel'])
    : 'All';
  const jobType = JOB_TYPE_OPTIONS.some((option) => option.value === filters.jobType)
    ? (filters.jobType as JobFilters['jobType'])
    : 'All';
  const location = JOB_LOCATION_OPTIONS.some((option) => option.value === filters.location)
    ? (filters.location as JobFilters['location'])
    : 'All';
  const skills = String(filters.skills || '').trim().replace(/\s+/g, ' ').slice(0, 60);

  return {
    platform,
    experienceLevel,
    jobType,
    location,
    skills
  };
}
