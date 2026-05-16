export interface RecruiterProfile {
  name: string;
  email: string;
  phoneNumber?: string;
  countryCode?: string;
  githubUsername?: string;
  linkedin?: string;
  location?: string;
  bio?: string;
  jobTitle?: string;
  recruiterPreferences?: {
    preferredStacks: string[];
    preferredLocations: string[];
    preferredJobTypes: string[];
    noteTemplate: string;
    activityDigest: boolean;
  };
}

export interface RecruiterDashboardMetric {
  label: string;
  value: number | string;
  accent?: string;
}
