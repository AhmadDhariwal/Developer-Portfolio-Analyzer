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
  openJobs?: number;
  draftJobs?: number;
  closedJobs?: number;
  shortlists?: number;
  recentJobsList?: Array<{ _id: string; title: string; status: string; stack: string; createdAt: string; updatedAt: string }>;
  recentCandidates?: Array<{ fullName: string; stack: string; createdAt: string }>;
  recentActivity?: Array<{ _id: string; action: string; method: string; route: string; statusCode: number; timestamp: string; actorName: string }>;
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
  openJobs?: number;
  draftJobs?: number;
  closedJobs?: number;
  candidatesAnalyzed?: number;
  aiUsage?: number;
  matchesGenerated?: number;
  hiringPerformance: number;
  engagementScore: number;
  performanceScore?: number;
  activityCount?: number;
  activityTimeline?: Array<{ _id: string; action: string; method: string; route: string; statusCode: number; timestamp: string; actorName: string }>;
  recentActions?: Array<{ _id: string; action: string; method: string; route: string; statusCode: number; timestamp: string; actorName: string }>;
  recentJobsList?: Array<{ _id: string; title: string; status: string; stack: string; createdAt: string; updatedAt: string }>;
  recentCandidates?: Array<{ fullName: string; stack: string; createdAt: string }>;
  createdAt: string;
}

export interface StackItem { stack: string; count: number; }
export interface TrendItem { label: string; count: number; }
export interface RecruiterAnalysisUsage { name: string; count: number; recentCount?: number; }
export interface PerformanceComparison { current: number; previous: number; delta: number; deltaPct: number; }

export interface PerformanceData {
  period: { days: number; since: string; until?: string; previousSince?: string };
  filters: {
    selectedTeamId: string;
    selectedRecruiterId: string;
    selectedStack: string;
    selectedJobStatus: string;
    teams: Array<{ _id: string; name: string }>;
    recruiters: Array<{ _id: string; name: string }>;
    stacks: string[];
    jobStatuses: string[];
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
    analysesByRecruiter: RecruiterAnalysisUsage[];
  };
  recentActivity?: Array<{
    _id: string;
    action: string;
    method: string;
    route: string;
    statusCode: number;
    timestamp: string;
    actorName: string;
  }>;
  candidateAnalytics?: { candidatesAnalyzed: number; aiEnhancedCandidates: number };
  aiEffectiveness?: { aiRankCalls: number; matchCalls: number; aiEnhancedRate: number };
  engagementMeta?: { formula?: string; notes?: string[] };
  skillGapTrends?: Array<{ skill: string; count: number }>;
  portfolioQuality?: { avgGithubScore: number; avgResumeScore: number; avgGrowthPotential: number; sampleSize: number };
  engagementHeatmap?: { days: string[]; buckets: string[]; grid: number[][]; max: number };
  comparisons?: {
    jobsCreated?: PerformanceComparison;
    invitationsAccepted?: PerformanceComparison;
    invitationAcceptanceRate?: PerformanceComparison;
    candidatesAnalyzed?: PerformanceComparison;
    aiAnalyses?: PerformanceComparison;
    aiEnhancedCandidates?: PerformanceComparison;
    aiRankCalls?: PerformanceComparison;
    matchCalls?: PerformanceComparison;
    organizationPerformanceScore?: PerformanceComparison;
  };
  summary: {
    totalRecruiters: number;
    activeRecruiters: number;
    inactiveRecruiters?: number;
    totalTeams: number;
    pendingInvitations?: number;
    totalJobs?: number;
    openJobs?: number;
    draftJobs?: number;
    closedJobs?: number;
    matchesGenerated?: number;
    aiRankUsage?: number;
    organizationPerformanceScore?: number;
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
    filters: { teamId?: string; recruiterId?: string; stack?: string; jobStatus?: string } = {}
  ): Observable<PerformanceData> {
    const params = new URLSearchParams();
    params.set('days', String(days));
    if (filters.teamId) params.set('teamId', filters.teamId);
    if (filters.recruiterId) params.set('recruiterId', filters.recruiterId);
    if (filters.stack) params.set('stack', filters.stack);
    if (filters.jobStatus) params.set('jobStatus', filters.jobStatus);
    return this.http.get<PerformanceData>(`${this.base}/performance?${params.toString()}`);
  }
}
