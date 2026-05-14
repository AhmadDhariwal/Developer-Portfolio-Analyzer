import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface RecruiterMetric {
  _id: string;
  name: string;
  email: string;
  isActive: boolean;
  teamId: string | null;
  totalJobs: number;
  recentJobs: number;
  totalAnalyses: number;
  githubAnalyses: number;
  resumeAnalyses: number;
  hiringSuccessRate: number;
  matchesGenerated: number;
  aiUsage: number;
  activityScore: number;
  lastActiveAt: string | null;
  candidatesAnalyzed: number;
  aiRankCalls: number;
  matchCalls: number;
  aiEnhancedCandidates: number;
  score: number;
  joinedAt: string;
}

export interface TeamMetric {
  _id: string;
  name: string;
  isActive: boolean;
  memberCount: number;
  activeMembers: number;
  recruiterCount: number;
  totalJobs: number;
  recentJobs: number;
  hiringPerformance: number;
  engagementScore: number;
  createdAt: string;
}

export interface StackItem { stack: string; count: number; }
export interface TrendItem { label: string; count: number; }

export interface PerformanceData {
  period: { days: number; since: string };
  filters: {
    selectedTeamId: string;
    selectedRecruiterId: string;
    selectedStack: string;
    teams: Array<{ _id: string; name: string }>;
    recruiters: Array<{ _id: string; name: string }>;
    stacks: string[];
  };
  recruiterMetrics: RecruiterMetric[];
  teamMetrics: TeamMetric[];
  hiringAnalytics: {
    total: number; open: number; draft: number; closed: number; recentJobs: number;
    stackDistribution: StackItem[];
    monthlyTrend: TrendItem[];
    invitationFunnel: { total: number; pending: number; accepted: number; expired: number; revoked: number };
    acceptanceRate: number;
  };
  aiStats: {
    totalAnalyses: number;
    recentAnalyses: number;
    analysesByRecruiter: Array<{ name: string; count: number }>;
  };
  candidateAnalytics?: { candidatesAnalyzed: number; aiEnhancedCandidates: number };
  aiEffectiveness?: { aiRankCalls: number; matchCalls: number; aiEnhancedRate: number };
  engagementMeta?: { formula?: string; notes?: string[] };
  skillGapTrends?: Array<{ skill: string; count: number }>;
  portfolioQuality?: { avgGithubScore: number; avgResumeScore: number; avgGrowthPotential: number; sampleSize: number };
  engagementHeatmap?: { days: string[]; buckets: string[]; grid: number[][]; max: number };
  summary: {
    totalRecruiters: number;
    activeRecruiters: number;
    totalTeams: number;
    topRecruiter: string | null;
    topTeam: string | null;
  };
}

@Injectable({ providedIn: 'root' })
export class AdminPerformanceService {
  private readonly base = 'http://localhost:5000/api/admin-console';

  constructor(private readonly http: HttpClient) {}

  getPerformance(
    days = 30,
    filters: { teamId?: string; recruiterId?: string; stack?: string } = {}
  ): Observable<PerformanceData> {
    const params = new URLSearchParams();
    params.set('days', String(days));
    if (filters.teamId) params.set('teamId', filters.teamId);
    if (filters.recruiterId) params.set('recruiterId', filters.recruiterId);
    if (filters.stack) params.set('stack', filters.stack);
    return this.http.get<PerformanceData>(`${this.base}/performance?${params.toString()}`);
  }
}
