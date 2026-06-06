import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { ApiService } from '../../shared/services/api.service';

export interface AdminOverview {
  organizationId: string;
  recruitersCount: number;
  jobsCount: number;
  globalDevelopersCount: number;
  pendingInvitationsCount: number;
  activeTeamsCount: number;
  recentActivityCount: number;
  recentActivity: Array<{
    _id: string;
    action: string;
    method: string;
    route: string;
    statusCode: number;
    timestamp: string;
    actorName: string;
  }>;
}

export interface AdminRecruiter {
  _id: string;
  name: string;
  email: string;
  githubUsername: string;
  linkedin: string;
  phoneNumber: string;
  avatar?: string;
  jobTitle?: string;
  location?: string;
  bio?: string;
  role: 'recruiter';
  organizationId: string;
  organization?: { _id: string; name: string } | null;
  recruiterDetails?: {
    education: string;
    certifications: string[];
    yearsOfExperience: number;
    experienceSummary: string;
    specialties: string[];
    toolsAndPlatforms: string[];
    languages: string[];
  };
  isActive: boolean;
  profileCompleted: boolean;
  teams: Array<{ _id: string; name: string; isActive?: boolean; role?: string }>;
  createdAt: string;
  metrics?: {
    profileCompletion: number;
    jobsCreated: number;
    activeJobs: number;
    matchesGenerated: number;
    candidatesAnalyzed: number;
    aiUsageCount: number;
    shortlists: number;
    activityScore: number;
    recruiterScore: number;
    hiringEffectiveness: number;
    teamContribution: number;
    lastActive: string | null;
    recentActivity: Array<{
      _id: string;
      action: string;
      actionLabel: string;
      method: string;
      route: string;
      statusCode: number;
      timestamp: string;
    }>;
  };
}

export interface PendingInvitation {
  _id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  invitedBy?: { _id?: string; name?: string; email?: string } | null;
  teamId?: { _id?: string; name?: string } | null;
}

export interface AdminTeamOption {
  _id: string;
  name: string;
}

export interface AdminDeveloper {
  _id: string;
  name: string;
  email: string;
  githubUsername: string;
  jobTitle: string;
  location: string;
  avatar: string;
  isPublic: boolean;
  publicProfileSlug: string | null;
  headline?: string;
  summary?: string;
  stack?: string;
  experienceLevel?: string;
  linkedin?: string;
  website?: string;
  githubScore?: number;
  readinessScore?: number;
  resumeScore?: number;
  skills?: string[];
  projects?: Array<{
    title: string;
    description: string;
    tech: string[];
    url: string;
    repoUrl: string;
  }>;
  projectsCount?: number;
  lastAnalyzedAt?: string | null;
  createdAt: string;
}

export interface AdminDeveloperQuery {
  page?: number;
  limit?: number;
  search?: string;
  stack?: string;
  experienceLevel?: string;
  minScore?: number | null;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface AdminDeveloperPage {
  developers: AdminDeveloper[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface AdminJob {
  _id: string;
  title: string;
  role: string;
  description: string;
  stack: string;
  requiredSkills: string[];
  preferredSkills: string[];
  minExperienceYears: number;
  location: string;
  employmentType: 'full-time' | 'part-time' | 'contract' | 'internship';
  status: 'draft' | 'open' | 'closed';
  updatedAt?: string;
}

export interface AdminRankedCandidate {
  rank: number;
  rankScore: number;
  candidateId: string;
  candidate: {
    fullName: string;
    githubUsername: string;
    stack: string;
  };
  aiInsight: {
    summary: string;
    strengths: string[];
    weaknesses: string[];
    recommendation: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class AdminHiringService {
  constructor(private readonly api: ApiService) {}

  getOverview(): Observable<AdminOverview> {
    return this.api.getAdminOverview().pipe(
      map((res: { overview?: AdminOverview }) => {
        return res?.overview || {
          organizationId: '',
          recruitersCount: 0,
          jobsCount: 0,
          globalDevelopersCount: 0,
          pendingInvitationsCount: 0,
          activeTeamsCount: 0,
          recentActivityCount: 0,
          recentActivity: []
        };
      })
    );
  }

  getRecruiters(): Observable<AdminRecruiter[]> {
    return this.api.getAdminRecruiters().pipe(
      map((res: { recruiters?: AdminRecruiter[] }) => res?.recruiters || [])
    );
  }

  inviteRecruiter(payload: {
    name: string;
    email: string;
    role?: 'recruiter';
    teamId?: string;
  }): Observable<{ invitationLink: string; emailSent: boolean }> {
    return this.api.inviteAdminRecruiter(payload).pipe(
      map((res: { invitationLink?: string; email?: { sent?: boolean } }) => ({
        invitationLink: String(res?.invitationLink || ''),
        emailSent: Boolean(res?.email?.sent)
      }))
    );
  }

  createRecruiterDirect(payload: {
    name: string;
    email: string;
    password: string;
    teamId?: string;
  }): Observable<AdminRecruiter> {
    return this.api.createAdminRecruiterDirect(payload).pipe(
      map((res: { recruiter: AdminRecruiter }) => res.recruiter)
    );
  }

  getTeams(organizationId: string): Observable<AdminTeamOption[]> {
    return this.api.getTeams(organizationId).pipe(
      map((res: { teams?: AdminTeamOption[] }) => res?.teams || [])
    );
  }

  updateRecruiter(id: string, payload: Partial<Pick<AdminRecruiter, 'name' | 'email' | 'githubUsername' | 'linkedin' | 'phoneNumber'>>): Observable<AdminRecruiter> {
    return this.api.updateAdminRecruiter(id, payload).pipe(
      map((res: { recruiter: AdminRecruiter }) => res.recruiter)
    );
  }

  setRecruiterActive(id: string, isActive: boolean): Observable<AdminRecruiter> {
    return this.api.setAdminRecruiterActive(id, isActive).pipe(
      map((res: { recruiter: AdminRecruiter }) => res.recruiter)
    );
  }

  revokeRecruiterAccess(id: string): Observable<AdminRecruiter> {
    return this.api.revokeAdminRecruiterAccess(id).pipe(
      map((res: { recruiter: AdminRecruiter }) => res.recruiter)
    );
  }

  deleteRecruiter(id: string): Observable<void> {
    return this.api.deleteAdminRecruiter(id).pipe(
      map(() => void 0)
    );
  }

  getPendingInvitations(): Observable<PendingInvitation[]> {
    return this.api.getAdminPendingInvitations().pipe(
      map((res: { invitations?: PendingInvitation[] }) => res?.invitations || [])
    );
  }

  revokeInvitation(id: string): Observable<void> {
    return this.api.revokeAdminInvitation(id).pipe(map(() => void 0));
  }

  resendInvitation(id: string): Observable<{ invitationLink: string; emailSent: boolean }> {
    return this.api.resendAdminInvitation(id).pipe(
      map((res: { invitationLink?: string; email?: { sent?: boolean } }) => ({
        invitationLink: String(res?.invitationLink || ''),
        emailSent: Boolean(res?.email?.sent)
      }))
    );
  }

  expireInvitation(id: string): Observable<void> {
    return this.api.expireAdminInvitation(id).pipe(map(() => void 0));
  }

  deleteInvitation(id: string): Observable<void> {
    return this.api.deleteAdminInvitation(id).pipe(map(() => void 0));
  }

  getDevelopers(query: AdminDeveloperQuery = {}): Observable<AdminDeveloperPage> {
    const params: Record<string, string | number> = {};
    if (query.page) params['page'] = query.page;
    if (query.limit) params['limit'] = query.limit;
    if (query.search) params['search'] = query.search;
    if (query.stack) params['stack'] = query.stack;
    if (query.experienceLevel) params['experienceLevel'] = query.experienceLevel;
    if (query.minScore !== undefined && query.minScore !== null) params['minScore'] = query.minScore;
    if (query.sortBy) params['sortBy'] = query.sortBy;
    if (query.sortOrder) params['sortOrder'] = query.sortOrder;

    return this.api.getAdminDevelopers(params).pipe(
      map((res: Partial<AdminDeveloperPage>) => ({
        developers: res?.developers || [],
        page: Number(res?.page || query.page || 1),
        limit: Number(res?.limit || query.limit || 10),
        total: Number(res?.total || 0),
        totalPages: Number(res?.totalPages || 1),
        hasMore: Boolean(res?.hasMore)
      }))
    );
  }

  getJobs(): Observable<AdminJob[]> {
    return this.api.getAdminJobs().pipe(
      map((res: { jobs?: AdminJob[] }) => res?.jobs || [])
    );
  }

  createJob(payload: Partial<AdminJob>): Observable<AdminJob> {
    return this.api.createAdminJob(payload).pipe(
      map((res: { job: AdminJob }) => res.job)
    );
  }

  rankCandidates(jobId: string, candidateIds: string[] = []): Observable<AdminRankedCandidate[]> {
    return this.api.runAdminAiRanking({ jobId, candidateIds }).pipe(
      map((res: { rankedCandidates?: AdminRankedCandidate[] }) => res?.rankedCandidates || [])
    );
  }
}
