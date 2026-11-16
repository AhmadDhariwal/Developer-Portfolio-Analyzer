export interface RecruiterJobModel {
  _id: string;
  title: string;
  role: string;
  description: string;
  stack: string;
  requiredSkills: string[];
  preferredSkills: string[];
  minExperienceYears: number;
  location: string;
  employmentType: string;
  status: string;
  teamId?: string | null;
  salaryRangeMin?: number;
  salaryRangeMax?: number;
  updatedAt?: string;
  archivedAt?: string | null;
}
