import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { ApiService } from '../../shared/services/api.service';

export interface AdminOverview {
  organizationId: string;
  recruitersCount: number;
  jobsCount: number;
  globalDevelopersCount: number;
}

export interface AdminRecruiter {
  _id: string;
  name: string;
  email: string;
  githubUsername: string;
  linkedin: string;
  phoneNumber: string;
  role: 'recruiter';
  organizationId: string;
  isActive: boolean;
  profileCompleted: boolean;
  createdAt: string;
}

export interface PendingInvitation {
  _id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt: string;
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
  createdAt: string;
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
          globalDevelopersCount: 0
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
  }): Observable<{ invitationLink: string; emailSent: boolean }> {
    return this.api.inviteAdminRecruiter(payload).pipe(
      map((res: { invitationLink?: string; email?: { sent?: boolean } }) => ({
        invitationLink: String(res?.invitationLink || ''),
        emailSent: Boolean(res?.email?.sent)
      }))
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

  expireInvitation(id: string): Observable<void> {
    return this.api.expireAdminInvitation(id).pipe(map(() => void 0));
  }

  deleteInvitation(id: string): Observable<void> {
    return this.api.deleteAdminInvitation(id).pipe(map(() => void 0));
  }

  getDevelopers(): Observable<AdminDeveloper[]> {
    return this.api.getAdminDevelopers().pipe(
      map((res: { developers?: AdminDeveloper[] }) => res?.developers || [])
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
