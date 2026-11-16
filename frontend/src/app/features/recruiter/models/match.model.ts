export interface MatchModel {
  _id?: string;
  candidateId: string;
  jobId: string;
  matchScore: number;
  skillMatchPercent: number;
  experienceMatch: string;
  githubProjectScore: number;
  readinessScore: number;
  confidenceScore: number;
  recommendation: string;
  strengths: string[];
  weaknesses: string[];
  explanation: string;
  breakdown: Record<string, unknown>;
  status?: string;
  shortlisted?: boolean;
  rank?: number;
  candidate?: any;
  job?: any;
}
