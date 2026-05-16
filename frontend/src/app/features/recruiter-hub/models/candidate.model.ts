export interface CandidateModel {
  id: string;
  userId?: string;
  name: string;
  fullName?: string;
  stack: string;
  experienceLevel?: string;
  yearsOfExperience: number;
  headline: string;
  location: string;
  githubUsername: string;
  githubScore: number;
  resumeScore: number;
  readinessScore: number;
  score?: number;
  profileCompleteness: number;
  availability: string;
  skills: string[];
  skillGaps?: string[];
  publicPortfolioLink?: string;
  aiSummary?: string;
  lastActive?: string | null;
  projects?: Array<{
    title: string;
    description: string;
    impactScore?: number;
    technologies?: string[];
    status?: string;
  }>;
}
