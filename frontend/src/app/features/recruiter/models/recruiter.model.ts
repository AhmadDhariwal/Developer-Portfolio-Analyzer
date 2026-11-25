export type CandidateFilters = {
  search: string;
  stack: string;
  location: string;
  skills: string;
  minReadiness: number;
  sortBy: string;
  page: number;
  limit: number;
};

export const DEFAULT_CANDIDATE_FILTERS: Readonly<CandidateFilters> = {
  search: '',
  stack: '',
  location: '',
  skills: '',
  minReadiness: 0,
  sortBy: 'score-desc',
  page: 1,
  limit: 12,
};

export interface RecruiterProfile {
  name: string;
  email: string;
  avatar?: string;
  phoneNumber?: string;
  countryCode?: string;
  githubUsername?: string;
  linkedin?: string;
  location?: string;
  bio?: string;
  jobTitle?: string;
  website?: string;
  organization?: {
    _id: string;
    name: string;
  } | null;
  teams?: Array<{
    _id: string;
    name: string;
  }>;
  recruiterPreferences?: {
    preferredStacks: string[];
    preferredLocations: string[];
    preferredJobTypes: string[];
    noteTemplate: string;
    activityDigest: boolean;
  };
  recruiterDetails?: {
    education: string;
    certifications: string[];
    yearsOfExperience: number;
    experienceSummary: string;
    specialties: string[];
    toolsAndPlatforms: string[];
    languages: string[];
  };
}

export interface RecruiterDashboardMetric {
  label: string;
  value: number | string;
  accent?: string;
}
