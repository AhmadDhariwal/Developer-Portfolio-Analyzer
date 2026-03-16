// ─── Type aliases ─────────────────────────────────────────────────────────────

export type JobPlatform       = 'LinkedIn' | 'Indeed' | 'Rozee' | 'Glassdoor' | 'RemoteOK' | 'Other' | 'All';
export type JobType           = 'Full Time' | 'Part Time' | 'Contract' | 'Internship' | 'Remote';
export type JobExperienceFilter = 'Intern' | 'Entry' | '1-2 years' | '3-5 years' | '5+ years' | 'All';
export type JobLocation       = 'Pakistan' | 'Remote' | 'USA' | 'Europe' | 'All';

// ─── Core interfaces ──────────────────────────────────────────────────────────

export interface PlatformColor {
  bg:   string;
  text: string;
}

export interface Job {
  id:               string;
  title:            string;
  company:          string;
  companyLogo:      string;
  location:         string;
  salary:           string;
  jobType:          string;
  skills:           string[];
  postedDate:       string;
  description:      string;
  platform:         JobPlatform;
  url:              string;
  experienceLevel:  string;
  score?:           number;
  platformColor?:   PlatformColor;
}

export interface JobFilters {
  platform:         JobPlatform | 'All';
  experienceLevel:  JobExperienceFilter | 'All';
  jobType:          JobType | 'All';
  location:         JobLocation | 'All';
  skills:           string;
}

export interface JobsResponse {
  jobs:       Job[];
  total:      number;
  page:       number;
  totalPages: number;
  hasMore:    boolean;
  fromCache?: boolean;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_JOB_FILTERS: JobFilters = {
  platform:        'All',
  experienceLevel: 'All',
  jobType:         'All',
  location:        'All',
  skills:          ''
};

// ─── Filter option lists ──────────────────────────────────────────────────────

export const JOB_PLATFORM_OPTIONS: { value: JobPlatform | 'All'; label: string }[] = [
  { value: 'All',       label: 'All Platforms' },
  { value: 'LinkedIn',  label: 'LinkedIn'       },
  { value: 'Indeed',    label: 'Indeed'         },
  { value: 'Rozee',     label: 'Rozee.pk'       },
  { value: 'Glassdoor', label: 'Glassdoor'      },
  { value: 'RemoteOK',  label: 'RemoteOK'       }
];

export const JOB_EXPERIENCE_OPTIONS: { value: JobExperienceFilter | 'All'; label: string }[] = [
  { value: 'All',       label: 'All Levels'  },
  { value: 'Intern',    label: 'Intern'      },
  { value: 'Entry',     label: 'Entry Level' },
  { value: '1-2 years', label: '1–2 Years'   },
  { value: '3-5 years', label: '3–5 Years'   },
  { value: '5+ years',  label: '5+ Years'    }
];

export const JOB_TYPE_OPTIONS: { value: JobType | 'All'; label: string }[] = [
  { value: 'All',        label: 'All Types'  },
  { value: 'Full Time',  label: 'Full Time'  },
  { value: 'Part Time',  label: 'Part Time'  },
  { value: 'Contract',   label: 'Contract'   },
  { value: 'Internship', label: 'Internship' },
  { value: 'Remote',     label: 'Remote'     }
];

export const JOB_LOCATION_OPTIONS: { value: JobLocation | 'All'; label: string }[] = [
  { value: 'All',      label: 'All Locations' },
  { value: 'Pakistan', label: 'Pakistan'       },
  { value: 'Remote',   label: 'Remote'         },
  { value: 'USA',      label: 'USA'            },
  { value: 'Europe',   label: 'Europe'         }
];

export const JOB_SKILL_OPTIONS = [
  'Node.js', 'Angular', 'React', 'Vue.js', 'TypeScript', 'JavaScript',
  'Python', 'Django', 'Flask', 'Docker', 'Kubernetes', 'AWS',
  'MongoDB', 'PostgreSQL', 'GraphQL', 'REST APIs', 'React Native',
  'Next.js', 'Tailwind CSS', 'Git', 'CI/CD', 'Microservices',
  'Spring Boot', 'PHP', 'Laravel', 'Redux', '.NET'
];

// ─── Platform colour map ──────────────────────────────────────────────────────

export const JOB_PLATFORM_COLOR_MAP: Record<string, PlatformColor> = {
  LinkedIn:  { bg: '#0077B5', text: '#ffffff' },
  Indeed:    { bg: '#003A9B', text: '#ffffff' },
  Rozee:     { bg: '#e8282f', text: '#ffffff' },
  Glassdoor: { bg: '#0CAA41', text: '#ffffff' },
  RemoteOK:  { bg: '#14b8a6', text: '#ffffff' },
  Other:     { bg: '#6366f1', text: '#ffffff' }
};
